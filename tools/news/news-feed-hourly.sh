#!/usr/bin/env bash
# Hourly News feed on the box (replaces the Actions schedule that emailed cancel/fail notices when
# hosts were unavailable — 5 Oct 2026). Wakes at :07 each hour, builds feed/v1/news.json, commits
# only that file when content changed, pull --rebase + push with retries. No force, no git config.
#
# Start (detached, durable across this shell but not a box reboot — restart after reboot):
#   nohup setsid bash tools/news/news-feed-hourly.sh >> /workspace/knock-on-site/.cache/news-feed.log 2>&1 < /dev/null &
# Stop: kill "$(cat /workspace/knock-on-site/.cache/news-feed.pid)"
# One-shot now: NEWS_ONCE=1 bash tools/news/news-feed-hourly.sh
#
# Uses a dedicated clone (/workspace/knock-on-site-news) so we never disturb the matchday publisher's
# shared checkout at /workspace/knock-on-site. Log + PID live under /workspace/knock-on-site/.cache/
# (stable path). Override with NEWS_SITE / NEWS_LOG / NEWS_PID.
set -u
SITE="${NEWS_SITE:-/workspace/knock-on-site-news}"
LOG="${NEWS_LOG:-/workspace/knock-on-site/.cache/news-feed.log}"
PIDF="${NEWS_PID:-/workspace/knock-on-site/.cache/news-feed.pid}"
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-iandever26-svg}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-iandever26-svg@users.noreply.github.com}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-iandever26-svg}"
export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-iandever26-svg@users.noreply.github.com}"
mkdir -p "$(dirname "$LOG")" "$(dirname "$PIDF")"
LOG(){ echo "$(date '+%F %T %Z') news: $*"; }
run_once(){
  cd "$SITE" || { LOG "cd $SITE failed"; return 1; }
  git pull --ff-only -q origin main 2>&1 | sed 's/^/  pull: /' || {
    # dirty tree or non-ff: reset to origin (this clone is news-only)
    git fetch -q origin main && git reset --hard -q origin/main && LOG "reset to origin/main (clone was dirty/diverged)"
  }
  if ! node tools/news/scripts/news-feed.mjs --out feed/v1/news.json; then
    LOG "builder exited non-zero (kept previous items if any)"
    return 1
  fi
  if [ -z "$(git status --porcelain -- feed/v1/news.json)" ]; then
    LOG "news.json unchanged — nothing to commit"
    return 0
  fi
  git add feed/v1/news.json
  git commit -q -m "news: update feed/v1/news.json" || { LOG "commit failed"; return 1; }
  for i in 1 2 3 4; do
    if ! git pull --rebase -q origin main; then
      git rebase --abort 2>/dev/null || true
      LOG "rebase failed (attempt $i) — retry"
      sleep $((i * 5))
      continue
    fi
    if git push -q origin HEAD:main; then
      LOG "pushed (attempt $i) sha=$(git rev-parse --short HEAD)"
      return 0
    fi
    LOG "push failed (attempt $i) — retry"
    sleep $((i * 5))
  done
  LOG "could not push after 4 attempts (publisher busy?) — next hour retries"
  return 0
}
sleep_until_next_07(){
  # Wall-clock wake at HH:07:00 local (Europe/Dublin on this box). Short sleep slices so a pause/resume still lands.
  local now next h m wait
  now=$(date +%s)
  h=$((10#$(date +%H))); m=$((10#$(date +%M)))
  if [ "$m" -lt 7 ]; then
    next=$(date -d "today $(printf '%02d' "$h"):07:00" +%s)
  elif [ "$h" -eq 23 ]; then
    next=$(date -d "tomorrow 00:07:00" +%s)
  else
    next=$(date -d "today $(printf '%02d' "$((h+1))"):07:00" +%s)
  fi
  wait=$(( next - now ))
  LOG "sleep ${wait}s until $(date -d "@$next" '+%F %T %Z')"
  while [ "$(date +%s)" -lt "$next" ]; do sleep 20; done
}
if [ "${NEWS_ONCE:-0}" = 1 ]; then
  run_once
  exit $?
fi
# replace a previous loop if the same PID file is ours; refuse if another live timer owns it
if [ -f "$PIDF" ]; then
  old=$(cat "$PIDF" 2>/dev/null || true)
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
    LOG "already running pid=$old — exit"
    exit 0
  fi
fi
echo $$ > "$PIDF"
trap 'rm -f "$PIDF"' EXIT
LOG "timer start pid=$$ site=$SITE log=$LOG"
while :; do
  sleep_until_next_07
  run_once || true
done
