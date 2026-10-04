#!/usr/bin/env node
/**
 * News feed builder: URC/club YouTube RSS + a curated list of Bluesky accounts → data/news/news.json.
 * Free sources only (YouTube channel RSS, Bluesky public AppView API — no keys, no auth).
 * The app links out to the originals; nothing is re-hosted.
 *
 *   node scripts/news-feed.mjs [--dry-run] [--verify] [--out <file>]
 *
 *   --verify   check every configured source (existence, last activity) and print a table; writes nothing
 *   --dry-run  fetch and print a summary, write nothing
 *
 * Exit 0 on success / unchanged / partial success; 1 when nothing could be fetched at all.
 * Failed sources keep their previous items (from the existing news.json) so one outage never empties
 * the page. Meant to run roughly hourly, separate from the live-score loop (see docs/NEWS_FEED.md).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BSKY_PUBLIC_API,
  DEFAULT_LIMITS,
  NEWS_SCHEMA_VERSION,
  YT_FEED_URL,
  mergeNews,
  normalizeBlueskyFeed,
  parseYoutubeRss,
  sameNewsContent,
  validateSources,
} from './lib/news-feed.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'data', 'news-sources.json');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(ROOT, 'data', 'news', 'news.json');
const UA = 'knock-on-news/1.0 (+https://github.com/iandever26-svg/knock-on)';
const TIMEOUT_MS = 15_000;

async function getText(url, accept = '*/*') {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
const getJson = async (url) => JSON.parse(await getText(url, 'application/json'));

function irelandIso(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'longOffset',
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  const off = (p.timeZoneName || 'GMT').replace('GMT', '') || '+00:00';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`;
}

async function fetchYoutube(src, limits) {
  const xml = await getText(YT_FEED_URL(src.channelId), 'application/atom+xml');
  const { channelTitle, items } = parseYoutubeRss(xml, { max: src.max ?? limits.perYoutubeChannel });
  return { name: channelTitle || src.name, items };
}

async function fetchBluesky(src, limits, blockWords) {
  const url = `${BSKY_PUBLIC_API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(src.handle)}&filter=posts_no_replies&limit=30`;
  const json = await getJson(url);
  const items = normalizeBlueskyFeed(json, { max: src.max ?? limits.perBlueskyAccount, maxTextChars: limits.maxTextChars, blockWords });
  return { name: src.label || src.handle, items, raw: json };
}

async function verify(cfg, limits) {
  console.log('YouTube');
  for (const y of cfg.youtube ?? []) {
    try {
      const r = await fetchYoutube(y, limits);
      console.log(`  OK   ${y.channelId}  "${r.name}"  latest ${r.items[0]?.publishedAt ?? '—'}  (${r.items.length} items)`);
    } catch (e) {
      console.log(`  FAIL ${y.channelId}  ${y.name}: ${e.message}`);
    }
  }
  console.log('Bluesky');
  for (const b of cfg.bluesky ?? []) {
    try {
      const prof = await getJson(`${BSKY_PUBLIC_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(b.handle)}`);
      const r = await fetchBluesky(b, limits, cfg.blockWords);
      console.log(`  OK   ${b.handle}  "${prof.displayName || ''}"  posts ${prof.postsCount ?? '?'}  followers ${prof.followersCount ?? '?'}  latest original ${r.items[0]?.publishedAt ?? '— none in last 30'}`);
    } catch (e) {
      console.log(`  FAIL ${b.handle}: ${e.message}`);
    }
  }
}

async function main() {
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const v = validateSources(cfg);
  if (!v.ok) throw new Error(`news-sources.json invalid: ${v.errors.join('; ')}`);
  const limits = { ...DEFAULT_LIMITS, ...(cfg.limits ?? {}) };
  if (flag('--verify')) return verify(cfg, limits);

  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;

  const all = [];
  const status = [];
  let okCount = 0;
  const jobs = [
    ...(cfg.youtube ?? []).map((s) => ({ kind: 'youtube', id: s.channelId, run: () => fetchYoutube(s, limits) })),
    ...(cfg.bluesky ?? []).map((s) => ({ kind: 'bluesky', id: s.handle, run: () => fetchBluesky(s, limits, cfg.blockWords) })),
  ];
  for (const job of jobs) {
    try {
      const r = await job.run();
      all.push(...r.items.map((it) => ({ ...it, source: job.id })));
      okCount += 1;
      status.push({ kind: job.kind, id: job.id, ok: true, items: r.items.length });
    } catch (e) {
      // a failed source keeps what it published last time (mergeNews still ages them out)
      const keep = (prev?.items ?? []).filter((it) => it.source === job.id);
      all.push(...keep);
      status.push({ kind: job.kind, id: job.id, ok: false, error: String(e.message).slice(0, 80), kept: keep.length });
      console.warn(`news: ${job.kind} ${job.id} failed: ${e.message} (kept ${keep.length} previous items)`);
    }
  }
  if (okCount === 0) throw new Error('every news source failed');

  const items = mergeNews(all, { maxItems: limits.maxItems, maxAgeDays: limits.maxAgeDays });
  const doc = {
    schema_version: NEWS_SCHEMA_VERSION,
    generatedAt: irelandIso(),
    attribution: 'Posts from Bluesky, videos from YouTube — tap to open the original.',
    items,
    sources: status,
  };
  console.log(`news: ${items.length} items (${items.filter((i) => i.type === 'youtube').length} videos, ${items.filter((i) => i.type === 'bluesky').length} posts); ${okCount}/${jobs.length} sources ok`);
  if (sameNewsContent(prev, doc)) return console.log('news unchanged');
  if (flag('--dry-run')) return console.log(`[dry-run] would write ${path.relative(ROOT, OUT)}`);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
  console.log(`news written → ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => {
  console.error(`news-feed failed: ${e.message}`);
  process.exitCode = 1;
});
