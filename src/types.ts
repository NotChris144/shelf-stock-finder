export type Kind = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'other';
export type SupportStatus = 'ok' | 'warn' | 'ended' | 'unknown' | 'na';

/** A raw record from CeX's search index (only the fields we ask for). */
export interface Hit {
  boxId: string;
  boxName: string;
  sellPrice: number;
  cashPriceCalculated?: number;
  exchangePriceCalculated?: number;
  categoryFriendlyName?: string;
  superCatFriendlyName?: string;
  imageUrls?: { small?: string | null; medium?: string | null; large?: string | null } | null;
  Grade?: string[] | string | null;
  rating?: number | null;
  [attr: string]: unknown;
}

export interface Support {
  status: SupportStatus;
  /** Short badge text. */
  label: string;
  /** One-sentence explanation you can read to a customer. */
  detail: string;
  /** Epoch ms when updates are expected to stop, when known or estimated. */
  until?: number;
  /** True when `until` is our estimate rather than a manufacturer date. */
  est?: boolean;
}

export interface Perf {
  /** Approximate benchmark score (Geekbench 6 multi-core for mobile, PassMark-style for PCs). */
  score: number;
  /** 0..1, comparable across device types. */
  pct: number;
  tier: 1 | 2 | 3 | 4 | 5;
  label: string;
  chip: string;
}

export interface Item {
  id: string;
  name: string;
  price: number;
  cash: number;
  voucher: number;
  category: string;
  superCat: string;
  img: string;
  grade: string;
  rating: number;
  /** Epoch ms of the last price change on CeX's system (0 when unknown). */
  priceChanged: number;
  kind: Kind;
  brand: string;
  model: string;
  storage: string;
  ram: string;
  cpu: string;
  /** What distinguishes this SKU inside its group (colour, network, grade). */
  variant: string;
  title: string;
  sub: string;
  /** Items sharing a group key are the same product in different colours/grades. */
  gkey: string;
  support: Support;
  perf: Perf | null;
  /** Position in the search engine's relevance order. */
  idx: number;
}
