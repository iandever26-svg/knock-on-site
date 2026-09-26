# knock-on live feed (v1)

Public JSON feed for the **knock-on** Expo app. Served by GitHub Pages.

## URLs

- Index: https://iandever26-svg.github.io/knock-on-site/feed/v1/index.json
- Scores (all current-round): https://iandever26-svg.github.io/knock-on-site/feed/v1/scores.json
- Lineup: https://iandever26-svg.github.io/knock-on-site/feed/v1/lineups/{match_id}.json
- Events: https://iandever26-svg.github.io/knock-on-site/feed/v1/events/{match_id}.json

## Shape

- `scores.json` → `{ schema_version, generatedAt, updatedAt, scores: LiveScoreDocument[] }`
  (same fields as app `data/scores/{match_id}.json`).
- `index.json` → per-match availability + `scoreUpdatedAt` / `lineupUpdatedAt`.
- Lineups are either app `MatchLineupFile` or WRS ingest documents (app adapter accepts both).
- `events/{match_id}.json` → `{ schema_version, match_id, updated_at, final, provenance, events: [{ id, minute, period, type, team, player, detail, … }] }`
  (chronological; source ESPN core API; index `events` / `eventsUpdatedAt` flag availability).

Published by `scripts/matchday-update.mjs` in the private knock-on repo.
