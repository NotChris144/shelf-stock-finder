#!/usr/bin/env bash
# One day's watch over the branch's stock, run by .github/workflows/stock.yml.
#
# GitHub's own timer for workflows proved unreliable: on the first morning not one of its timed
# runs started. So a run does not wait to be woken every 15 minutes; it keeps watch itself:
#   - a look at the stock every 15 minutes, a minute after CeX's own update (scripts/track-stock.ts)
#   - every half hour, a look for new phone and tablet spec sheets (scripts/update-specs.ts)
# GitHub stops any job after six hours, so shortly before then the run starts its successor and
# ends. After 9pm UK time the watch ends for the night. The next morning it is started by
# GitHub's timer if that fires, or by hand from the Actions tab.
set -uo pipefail

DATA=stock-data
# Hand over to a fresh run after this long, safely inside GitHub's six-hour limit.
SESSION=$((320 * 60))
started=$(date +%s)
looks=0
BOT=(-c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com")

uk_hour() { TZ=Europe/London date +%-H; }
open_hours() {
  local h
  h=$(uk_hour)
  ((h >= 8 && h < 21))
}

# The record lives on its own branch as a single commit, replaced each time.
publish_stock() {
  local tmp
  tmp=$(mktemp -d)
  cp "$DATA/state.json" "$DATA/log.json" "$tmp/"
  (
    cd "$tmp" &&
      git init -q -b stock-data &&
      git add state.json log.json &&
      git "${BOT[@]}" commit -q -m "Stock at $(date -u +'%Y-%m-%d %H:%M') UTC" &&
      git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" stock-data
  ) || echo "Could not save the stock record this time; the next look will."
  rm -rf "$tmp"
}

look_at_stock() {
  local flag
  flag=$(mktemp)
  if GITHUB_OUTPUT="$flag" node scripts/track-stock.ts "$DATA"; then
    if grep -q '^changed=1' "$flag"; then publish_stock; fi
  else
    echo "That look failed; the next one tries again."
  fi
  rm -f "$flag"
}

# Spec sheets are kept on main, so a change is committed there and the site rebuilt.
look_for_specs() {
  node scripts/update-specs.ts --auto || {
    echo "Spec sheets: that run failed."
    git checkout -q -- . 2>/dev/null
    return
  }
  git add src/data/specs.json scripts/spec-models.json scripts/spec-state.json
  if git diff --cached --quiet; then return; fi
  local sheets=0
  git diff --cached --quiet -- src/data/specs.json || sheets=1
  git "${BOT[@]}" commit -q -m "Update spec sheets"
  if git pull -q --rebase origin main && git push -q origin HEAD:main; then
    if ((sheets)); then gh workflow run deploy.yml --ref main; fi
  else
    echo "Spec sheets: could not save; the next look tries again."
    git rebase --abort 2>/dev/null
    git fetch -q origin main && git reset -q --hard origin/main
  fi
}

mkdir -p "$DATA"
if git fetch -q --depth=1 origin stock-data 2>/dev/null; then
  git show FETCH_HEAD:state.json >"$DATA/state.json" 2>/dev/null || rm -f "$DATA/state.json"
  git show FETCH_HEAD:log.json >"$DATA/log.json" 2>/dev/null || rm -f "$DATA/log.json"
else
  echo "No record yet: this look sets the starting point."
fi

while :; do
  echo "== $(TZ=Europe/London date +'%H:%M') UK"
  look_at_stock
  if ((looks % 2 == 0)); then look_for_specs; fi
  looks=$((looks + 1))
  if ! open_hours; then
    echo "The shop is closed: the watch is over for today."
    exit 0
  fi
  now=$(date +%s)
  next=$(((now / 900 + 1) * 900 + 60))
  if ((next - started > SESSION)); then
    echo "Near GitHub's six-hour limit: handing over to a new run."
    gh workflow run stock.yml --ref main || echo "Could not start the next run."
    exit 0
  fi
  sleep $((next - now))
  if ! open_hours; then
    echo "The shop is closed: the watch is over for today."
    exit 0
  fi
done
