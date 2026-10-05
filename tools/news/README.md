# News feed tooling (public site repo)

Builds `feed/v1/news.json` from YouTube channel RSS + a curated Bluesky list. Touches **only that one file**.

## Hourly refresh (box timer — preferred)

Scheduled GitHub Actions runs were cancelled when hosted runners were unavailable and those cancels emailed
the repo owner. The hourly job therefore runs on the box instead:

```bash
# start (once; survives the shell, not a box reboot)
mkdir -p /workspace/knock-on-site/.cache
nohup setsid bash /workspace/knock-on-site-news/tools/news/news-feed-hourly.sh \
  >> /workspace/knock-on-site/.cache/news-feed.log 2>&1 < /dev/null &

# stop
kill "$(cat /workspace/knock-on-site/.cache/news-feed.pid)"

# one-shot now
NEWS_ONCE=1 bash /workspace/knock-on-site-news/tools/news/news-feed-hourly.sh
```

- Wakes at **:07** each hour (Europe/Dublin on the box).
- Working clone: `/workspace/knock-on-site-news` (dedicated — never the matchday publisher's shared
  `/workspace/knock-on-site` checkout).
- Log: `/workspace/knock-on-site/.cache/news-feed.log` · PID: `/workspace/knock-on-site/.cache/news-feed.pid`
- Same commit/push rules as before: only `feed/v1/news.json`, only when content changed, `pull --rebase`,
  up to 4 push retries, no force, GIT_* env identity (no `git config`).

## Manual Actions run

`.github/workflows/news-feed.yml` keeps **`workflow_dispatch` only** (no `schedule:`). Actions → news-feed → Run workflow.

## Edit the source list

Edit **`tools/news/data/news-sources.json`** on `main` (channels, accounts, limits, `blockWords`). Takes effect on
the next :07 box run (or a manual Actions / `NEWS_ONCE=1` run). The knock-on app repo's `data/news-sources.json`
is only the seed and is not synced automatically — ask Grok Bot to update this copy.

Check sources: `node tools/news/scripts/news-feed.mjs --verify`.

Live URL: https://iandever26-svg.github.io/knock-on-site/feed/v1/news.json
