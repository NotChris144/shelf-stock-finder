// Barcode scanner for shelf labels, built for scanning through cabinet glass.
//
// Two ways in:
//   live   – camera preview; every barcode in view is outlined and labelled. Tapping the picture
//            zooms in on that spot, which is what makes small, distant labels readable.
//   photo  – a frozen frame or a full-resolution photo. The whole picture is searched tile by
//            tile, so one shot of a cabinet finds every label in it; tap any that were missed.
//
// Loaded on demand so the decoder (about 1 MB of WebAssembly) costs nothing until it is used.

import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
});

export interface ScanHost {
  /** A code was seen for the first time. */
  onCode(code: string): void;
  /** Text to show on a barcode: undefined while looking up, null when the code is not a product. */
  labelFor(code: string): string | null | undefined;
  /** The user tapped a highlighted barcode. */
  onPick(code: string): void;
}

export interface Scanner {
  /** Redraw the labels after lookups finish. */
  refresh(): void;
  /** Search a picture for barcodes. */
  scanImage(file: Blob): Promise<void>;
}

interface Point {
  x: number;
  y: number;
}
interface Found {
  text: string;
  pts: Point[];
}
interface Mark {
  x: number;
  y: number;
  w: number;
  h: number;
  seen: number;
  el: HTMLButtonElement;
}

// Shape Detection API, where the platform has it (Chrome on Android): faster than WebAssembly.
interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; cornerPoints: Point[] }[]>;
}
declare const BarcodeDetector:
  | { new (init?: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]> }
  | undefined;

const LIVE: ReaderOptions = { formats: ['AllLinear'], tryHarder: true, tryRotate: false, tryInvert: false, tryDownscale: true, maxNumberOfSymbols: 16 };
const PHOTO: ReaderOptions = { ...LIVE, tryRotate: true };
/** Widest frame handed to the decoder during live scanning; larger costs too much per frame. */
const LIVE_MAX = 1920;
const ZOOMS = [1, 2, 3];
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const isCode = (s: string): boolean => /^[\w.-]{5,32}$/.test(s);

let nativePromise: Promise<NativeDetector | null> | null = null;
function nativeDetector(): Promise<NativeDetector | null> {
  nativePromise ??= (async () => {
    try {
      if (typeof BarcodeDetector === 'undefined') return null;
      const wanted = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'];
      const have = await BarcodeDetector.getSupportedFormats();
      if (!have.includes('code_128')) return null;
      return new BarcodeDetector({ formats: wanted.filter((f) => have.includes(f)) });
    } catch {
      return null;
    }
  })();
  return nativePromise;
}

/**
 * Horizontal unsharp mask on a greyscale copy. Glass, distance and hand shake soften the thin bars
 * until the decoder cannot separate them; a mild boost restores enough edge to read them. Testing
 * showed plain and sharpened passes each rescue labels the other misses, so callers use both.
 */
function sharpen(image: ImageData, amount: number, radius: number): void {
  const { data, width: w, height: h } = image;
  const grey = new Float32Array(w * h);
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) grey[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  const win = 2 * radius + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += grey[o + clamp(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      const v = grey[o + x];
      const out = clamp(v + amount * (v - sum / win), 0, 255);
      const p = (o + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = out;
      sum += grey[o + Math.min(w - 1, x + radius + 1)] - grey[o + Math.max(0, x - radius)];
    }
  }
}

/** `sharp` is the unsharp radius in pixels (0 = leave the image as it is). */
async function detect(canvas: HTMLCanvasElement, thorough: boolean, sharp = 0): Promise<Found[]> {
  const out: Found[] = [];
  const native = await nativeDetector();
  if (native) {
    try {
      for (const b of await native.detect(canvas)) out.push({ text: b.rawValue, pts: b.cornerPoints });
    } catch {
      /* fall through to the WebAssembly decoder */
    }
    if (out.length && !thorough) return out;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (sharp) sharpen(image, 1.5, sharp);
  for (const r of await readBarcodes(image, thorough ? PHOTO : LIVE)) {
    if (!r.text || out.some((o) => o.text === r.text)) continue;
    const p = r.position;
    out.push({ text: r.text, pts: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft] });
  }
  return out;
}

export function openScanner(dialog: HTMLDialogElement, host: ScanHost): Scanner {
  dialog.innerHTML = `
    <div class="scan-view">
      <video playsinline muted autoplay></video>
      <canvas class="scan-still" hidden></canvas>
      <div class="scan-marks"></div>
      <p class="scan-hint" role="status" aria-live="polite">Starting camera…</p>
    </div>
    <div class="scan-bar">
      <button type="button" class="chip" data-scan="close">Close</button>
      <button type="button" class="chip" data-scan="zoom" aria-label="Zoom">1×</button>
      <button type="button" class="chip" data-scan="freeze">Freeze</button>
      <button type="button" class="chip" data-scan="live" hidden>Live camera</button>
      <label class="chip">Photo<input type="file" accept="image/*" hidden></label>
      <button type="button" class="chip" data-scan="torch" aria-pressed="false" hidden>Light</button>
    </div>
    <div class="scan-tray" id="scanTray"></div>`;

  const q = <T extends HTMLElement>(sel: string): T => dialog.querySelector<T>(sel)!;
  const view = q<HTMLDivElement>('.scan-view');
  const video = q<HTMLVideoElement>('video');
  const still = q<HTMLCanvasElement>('.scan-still');
  const marksEl = q<HTMLDivElement>('.scan-marks');
  const hint = q<HTMLParagraphElement>('.scan-hint');
  const zoomBtn = q<HTMLButtonElement>('[data-scan="zoom"]');
  const freezeBtn = q<HTMLButtonElement>('[data-scan="freeze"]');
  const liveBtn = q<HTMLButtonElement>('[data-scan="live"]');
  const torchBtn = q<HTMLButtonElement>('[data-scan="torch"]');
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true })!;
  const life = new AbortController();

  let mode: 'live' | 'photo' = 'live';
  let stream: MediaStream | null = null;
  let track: MediaStreamTrack | null = null;
  let hwZoom: { min: number; max: number } | null = null;
  let z = 1;
  let sw = 0;
  let sh = 0;
  let focus: Point = { x: 0, y: 0 };
  let geo = { s: 1, tx: 0, ty: 0, W: 0, H: 0 };
  let running = true;
  let timer = 0;
  let tickNo = 0;
  let lastHit = performance.now();
  let busy = false;
  /** Bumped to cancel the photo sweep in progress. */
  let sweepNo = 0;
  const marks = new Map<string, Mark>();

  const setHint = (text: string): void => {
    if (hint.textContent !== text) hint.textContent = text;
  };

  // ---------------------------------------------------------------- geometry

  /** Fit the picture to the view and apply zoom around the focus point. */
  function layout(): void {
    const W = view.clientWidth;
    const H = view.clientHeight;
    if (!sw || !W) return;
    const base = mode === 'live' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
    // With a real camera zoom the stream itself is magnified, so the view stays at 1×.
    const zz = mode === 'live' && hwZoom ? 1 : z;
    const cw = sw * base;
    const ch = sh * base;
    const cx = cw * zz <= W ? cw / 2 : clamp(focus.x * base, W / (2 * zz), cw - W / (2 * zz));
    const cy = ch * zz <= H ? ch / 2 : clamp(focus.y * base, H / (2 * zz), ch - H / (2 * zz));
    geo = { s: base * zz, tx: W / 2 - cx * zz, ty: H / 2 - cy * zz, W, H };
    const el = mode === 'live' ? video : still;
    el.style.width = `${cw}px`;
    el.style.height = `${ch}px`;
    el.style.transform = `translate(${geo.tx}px, ${geo.ty}px) scale(${zz})`;
    drawMarks();
  }

  const toView = (p: Point): Point => ({ x: geo.tx + p.x * geo.s, y: geo.ty + p.y * geo.s });
  const fromView = (p: Point): Point => ({ x: (p.x - geo.tx) / geo.s, y: (p.y - geo.ty) / geo.s });

  /** The part of the picture currently on screen, in picture pixels. */
  function visible(): { x: number; y: number; w: number; h: number } {
    const a = fromView({ x: 0, y: 0 });
    const b = fromView({ x: geo.W, y: geo.H });
    const x = clamp(a.x, 0, sw);
    const y = clamp(a.y, 0, sh);
    return { x, y, w: clamp(b.x, 0, sw) - x, h: clamp(b.y, 0, sh) - y };
  }

  // ---------------------------------------------------------------- marks

  function addFound(found: Found[], map: (p: Point) => Point, keep: boolean): number {
    let fresh = 0;
    for (const f of found) {
      const code = f.text.trim();
      if (!isCode(code)) continue;
      const pts = f.pts.map(map);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const box = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, seen: keep ? Infinity : performance.now() };
      const m = marks.get(code);
      if (m) Object.assign(m, box);
      else {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'scan-mark';
        el.dataset.code = code;
        el.innerHTML = '<span></span>';
        marksEl.append(el);
        marks.set(code, { ...box, el });
        fresh++;
        host.onCode(code);
      }
    }
    return fresh;
  }

  function drawMarks(): void {
    const now = performance.now();
    for (const [code, m] of marks) {
      if (now - m.seen > 1500) {
        m.el.remove();
        marks.delete(code);
        continue;
      }
      const label = host.labelFor(code);
      const a = toView({ x: m.x, y: m.y });
      const w = m.w * geo.s;
      const h = Math.max(m.h * geo.s, 18);
      const off = a.x > geo.W || a.y > geo.H || a.x + w < 0 || a.y + h < 0;
      m.el.hidden = label === null || off;
      if (m.el.hidden) continue;
      m.el.classList.toggle('pending', label === undefined);
      m.el.style.transform = `translate(${a.x - 6}px, ${a.y - 6}px)`;
      m.el.style.width = `${w + 12}px`;
      m.el.style.height = `${h + 12}px`;
      const span = m.el.firstElementChild as HTMLElement;
      // Neighbouring labels sit close together, so small boxes get just the price; the full
      // name appears once zoomed in, and is always in the list below.
      const full = label ?? '…';
      const text = w < 110 ? (full.split(' · ').pop() ?? full) : full;
      if (span.textContent !== text) span.textContent = text;
    }
  }

  function clearMarks(): void {
    for (const m of marks.values()) m.el.remove();
    marks.clear();
  }

  // ---------------------------------------------------------------- live camera

  async function tick(): Promise<void> {
    if (!running) return;
    try {
      if (mode === 'live' && !busy && video.readyState >= 2 && video.videoWidth) {
        if (video.videoWidth !== sw || video.videoHeight !== sh) {
          sw = video.videoWidth;
          sh = video.videoHeight;
          focus = { x: sw / 2, y: sh / 2 };
          layout();
        }
        const r = visible();
        let { x, y, w, h } = r;
        let k = Math.min(1, LIVE_MAX / w);
        let sharp = 0;
        // Alternate the whole view with an enlarged crop around the focus point. Small or soft
        // barcodes only decode when magnified, and every other crop is sharpened as well.
        const turn = tickNo % 4;
        if (turn % 2) {
          k = turn === 1 ? 1.5 : 2;
          sharp = turn === 3 ? 4 : 0;
          const cw = Math.min(r.w, LIVE_MAX / k);
          const ch = Math.min(r.h, (cw * r.h) / r.w);
          x = clamp(focus.x - cw / 2, r.x, r.x + r.w - cw);
          y = clamp(focus.y - ch / 2, r.y, r.y + r.h - ch);
          w = cw;
          h = ch;
        }
        work.width = Math.round(w * k);
        work.height = Math.round(h * k);
        wctx.imageSmoothingQuality = 'high';
        wctx.drawImage(video, x, y, w, h, 0, 0, work.width, work.height);
        const found = await detect(work, false, sharp);
        if (running && mode === 'live') {
          addFound(found, (p) => ({ x: x + p.x / k, y: y + p.y / k }), false);
          const now = performance.now();
          if (found.length) lastHit = now;
          if (marks.size) setHint(marks.size > 1 ? 'Tap the label you want.' : 'Got it — tap the label for details.');
          else if (now - lastHit > 4000) setHint('Nothing yet. Tap the label to zoom in, tilt to move glare off it, or use Freeze.');
          else setHint('Point at a label. Tap one to zoom in on it.');
          drawMarks();
        }
      }
    } catch {
      /* a bad frame is not worth stopping for */
    }
    tickNo++;
    timer = window.setTimeout(tick, 50);
  }

  function stopCamera(): void {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    track = null;
    video.srcObject = null;
  }

  async function startCamera(): Promise<void> {
    const fail = (text: string): void => {
      freezeBtn.hidden = true;
      zoomBtn.hidden = true;
      setHint(text);
    };
    if (!navigator.mediaDevices?.getUserMedia) return fail("This browser can't open the camera here. Use Photo instead.");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      });
    } catch (e) {
      const denied = e instanceof DOMException && e.name === 'NotAllowedError';
      return fail(denied ? 'Camera access is blocked. Allow it in your browser settings, or use Photo.' : 'No camera available. Use Photo to scan a picture.');
    }
    if (!running) return stopCamera();
    track = stream.getVideoTracks()[0];
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    // Zoom, torch and focus are optional extras that vary by phone and browser.
    const caps = (track.getCapabilities?.() ?? {}) as { zoom?: { min?: number; max: number }; torch?: boolean; focusMode?: string[] };
    hwZoom = caps.zoom && caps.zoom.max >= 2 ? { min: caps.zoom.min ?? 1, max: caps.zoom.max } : null;
    torchBtn.hidden = !caps.torch;
    if (caps.focusMode?.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
    }
    setHint('Point at a label. Tap one to zoom in on it.');
  }

  function setZoom(next: number): void {
    z = next;
    zoomBtn.textContent = `${z}×`;
    if (mode === 'live' && hwZoom && track) {
      const value = clamp(hwZoom.min * z, hwZoom.min, hwZoom.max);
      track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] }).catch(() => undefined);
    }
    layout();
  }

  // ---------------------------------------------------------------- photo

  /** Decode one region of the still at a given scale, adding anything found. */
  async function pass(x: number, y: number, w: number, h: number, k: number, sharp = false): Promise<number> {
    work.width = Math.max(1, Math.round(w * k));
    work.height = Math.max(1, Math.round(h * k));
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(still, x, y, w, h, 0, 0, work.width, work.height);
    const found = await detect(work, true, sharp ? Math.max(1, Math.round(2 * k)) : 0);
    const fresh = addFound(found, (p) => ({ x: x + p.x / k, y: y + p.y / k }), true);
    drawMarks();
    return fresh;
  }

  // A timer, not requestAnimationFrame: frames stop while the page is hidden and the scan would hang.
  const breathe = (): Promise<void> => new Promise((r) => window.setTimeout(r, 16));

  async function scanStill(source: CanvasImageSource, w: number, h: number): Promise<void> {
    mode = 'photo';
    busy = true;
    clearMarks();
    // 4096 px keeps a 12 MP photo inside mobile canvas limits while leaving labels readable.
    const k = Math.min(1, 4096 / Math.max(w, h));
    still.width = Math.round(w * k);
    still.height = Math.round(h * k);
    still.getContext('2d')!.drawImage(source, 0, 0, still.width, still.height);
    sw = still.width;
    sh = still.height;
    focus = { x: sw / 2, y: sh / 2 };
    video.hidden = true;
    still.hidden = false;
    freezeBtn.hidden = true;
    liveBtn.hidden = false;
    zoomBtn.hidden = false;
    setZoom(1);
    setHint('Reading labels…');
    await breathe();
    busy = false;
    void sweep(++sweepNo);
  }

  /**
   * Search the whole still, coarse to fine, so close-up labels appear at once and distant ones
   * follow. Runs in the background: tapping a label interrupts it to look at that spot first.
   */
  async function sweep(mine: number): Promise<void> {
    const live = (): boolean => running && mode === 'photo' && mine === sweepNo;
    // [tile size in picture pixels, magnification, sharpen]
    const layers: [number, number, boolean][] = [
      [Math.max(sw, sh), Math.min(1, 2000 / Math.max(sw, sh)), false],
      [2000, 1, false],
      [1000, 1.5, false],
      [1000, 2, true],
    ];
    const jobs: [number, number, number, number, number, boolean][] = [];
    for (const [size, k, sharp] of layers) {
      if (jobs.length && size >= Math.max(sw, sh)) continue;
      const nx = Math.ceil(sw / size);
      const ny = Math.ceil(sh / size);
      // Tiles overlap by about a third so a barcode on a seam is whole in at least one of them.
      const tw = Math.min(sw, (sw / nx) * 1.35);
      const th = Math.min(sh, (sh / ny) * 1.35);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          jobs.push([nx === 1 ? 0 : (i * (sw - tw)) / (nx - 1), ny === 1 ? 0 : (j * (sh - th)) / (ny - 1), tw, th, k, sharp]);
        }
      }
    }
    for (let n = 0; n < jobs.length; n++) {
      while (busy && live()) await breathe();
      if (!live()) return;
      busy = true;
      try {
        await pass(...jobs[n]);
      } catch {
        /* skip a tile the decoder chokes on */
      } finally {
        busy = false;
      }
      const pct = Math.round(((n + 1) / jobs.length) * 100);
      setHint(marks.size ? `Found ${marks.size} — tap one. Still looking… ${pct}%` : `Reading labels… ${pct}%`);
      await breathe();
    }
    setHint(marks.size ? 'Tap a highlighted label, or tap any label that was missed.' : 'No barcodes read. Tap a label to look closer, or retake nearer and straight on.');
  }

  async function scanImage(file: Blob): Promise<void> {
    try {
      const bmp = await createImageBitmap(file);
      await scanStill(bmp, bmp.width, bmp.height);
      bmp.close();
    } catch {
      setHint("That picture couldn't be opened. Try another photo.");
    }
  }

  async function freeze(): Promise<void> {
    if (!track || !video.videoWidth) return;
    // A still capture uses the full sensor where the browser supports it; otherwise use the frame on screen.
    const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
    if (IC) {
      try {
        setHint('Capturing…');
        return await scanImage(await new IC(track).takePhoto());
      } catch {
        /* fall back to the preview frame */
      }
    }
    await scanStill(video, video.videoWidth, video.videoHeight);
  }

  function backToLive(): void {
    mode = 'live';
    clearMarks();
    still.hidden = true;
    video.hidden = false;
    liveBtn.hidden = true;
    freezeBtn.hidden = false;
    sw = 0;
    sh = 0;
    lastHit = performance.now();
    setZoom(1);
    if (!stream) void startCamera();
  }

  // ---------------------------------------------------------------- input

  async function tapAt(p: Point): Promise<void> {
    const ring = document.createElement('i');
    ring.className = 'scan-ring';
    ring.style.left = `${p.x}px`;
    ring.style.top = `${p.y}px`;
    view.append(ring);
    window.setTimeout(() => ring.remove(), 650);
    if (!sw) return;
    const at = fromView(p);
    focus = { x: clamp(at.x, 0, sw), y: clamp(at.y, 0, sh) };
    if (mode === 'live') {
      if (hwZoom) {
        // Ask the camera to focus and expose for the tapped spot, where it can.
        const poi = { x: focus.x / sw, y: focus.y / sh };
        track?.applyConstraints({ advanced: [{ pointsOfInterest: [poi], focusMode: 'single-shot' } as MediaTrackConstraintSet] }).catch(() => undefined);
        if (z === 1) setZoom(2);
      } else setZoom(Math.max(z, 2));
      return;
    }
    // Stop any background sweep: the tapped spot takes priority.
    const mine = ++sweepNo;
    setZoom(Math.max(z, 3));
    while (busy && mine === sweepNo && running) await breathe();
    if (mine !== sweepNo || !running || mode !== 'photo') return;
    busy = true;
    setHint('Looking closer…');
    await breathe();
    try {
      // A label-sized crop around the tap, small enough to magnify three times over.
      const v = visible();
      const cw = Math.min(v.w, 900);
      const ch = Math.min(v.h, 650);
      const r = { x: clamp(focus.x - cw / 2, v.x, v.x + v.w - cw), y: clamp(focus.y - ch / 2, v.y, v.y + v.h - ch), w: cw, h: ch };
      const inView = (): boolean => [...marks.values()].some((m) => m.x + m.w > r.x && m.x < r.x + r.w && m.y + m.h > r.y && m.y < r.y + r.h);
      // Try several magnifications, plain and sharpened, until one reads a barcode here.
      const tries: [number, boolean][] = [[1.5, false], [2, true], [1, false], [3, false], [3, true], [1.5, true], [2.5, false], [2.5, true]];
      for (const [k, sharp] of tries) {
        if (inView() || mine !== sweepNo) break;
        await pass(r.x, r.y, r.w, r.h, k, sharp);
        await breathe();
      }
      setHint(inView() ? 'Tap a highlighted label.' : "Couldn't read a barcode here. Glare or blur is likely — retake closer, at a slight angle.");
    } finally {
      busy = false;
    }
  }

  const opts = { signal: life.signal };
  view.addEventListener(
    'click',
    (ev) => {
      const mark = (ev.target as HTMLElement).closest<HTMLElement>('.scan-mark');
      if (mark?.dataset.code) return host.onPick(mark.dataset.code);
      const rect = view.getBoundingClientRect();
      void tapAt({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
    },
    opts,
  );
  dialog.addEventListener(
    'click',
    (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-scan]');
      switch (btn?.dataset.scan) {
        case 'close':
          dialog.close();
          break;
        case 'zoom':
          setZoom(ZOOMS[(ZOOMS.indexOf(z) + 1) % ZOOMS.length] ?? 1);
          break;
        case 'freeze':
          void freeze();
          break;
        case 'live':
          backToLive();
          break;
        case 'torch': {
          const on = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(on));
          track?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => undefined);
          break;
        }
      }
    },
    opts,
  );
  dialog.querySelector<HTMLInputElement>('input[type="file"]')!.addEventListener(
    'change',
    (ev) => {
      const input = ev.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (file) void scanImage(file);
    },
    opts,
  );
  window.addEventListener('resize', layout, opts);
  dialog.addEventListener(
    'close',
    () => {
      running = false;
      window.clearTimeout(timer);
      stopCamera();
      life.abort();
    },
    { once: true },
  );

  if (!dialog.open) dialog.showModal();
  void startCamera();
  void tick();

  return { refresh: drawMarks, scanImage };
}
