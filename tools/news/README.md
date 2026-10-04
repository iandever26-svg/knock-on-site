# News feed tooling (public, free Actions minutes)

`.github/workflows/news-feed.yml` runs hourly (:07), builds `feed/v1/news.json` from YouTube channel RSS + a curated Bluesky list
and commits **only that one file**, and only when the content changed.

* **Edit the source list here:** `tools/news/data/news-sources.json` (channels, accounts, limits, `blockWords`). Commit to `main`;
  it takes effect on the next hourly run (or run the workflow manually: Actions → news-feed → Run workflow).
  This copy is the live one. The knock-on app repo has the original seed at `data/news-sources.json`; changes are NOT synced automatically — ask Grok Bot to update this copy.
* `tools/news/scripts/*` is a verbatim copy of `scripts/news-feed.mjs` + `scripts/lib/news-feed.mjs` from the knock-on repo (docs/NEWS_FEED.md there).
* Check sources: `node tools/news/scripts/news-feed.mjs --verify`.
* Remove a publisher / take something down: delete its entry (or add a `blockWords` entry) and push.
