/**
 * News feed helpers (pure, no I/O): URC/club YouTube RSS + curated Bluesky accounts → one small
 * JSON document for the app. Free sources only (YouTube channel RSS, Bluesky public AppView API).
 * The app links out to the originals; nothing is re-hosted or embedded.
 */

export const NEWS_SCHEMA_VERSION = '1.0.0';
export const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc';
export const YT_FEED_URL = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

export const DEFAULT_LIMITS = {
  maxItems: 60,
  perYoutubeChannel: 6,
  perBlueskyAccount: 5,
  maxAgeDays: 21,
  maxTextChars: 400,
};

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
export const decodeXml = (s) =>
  String(s ?? '')
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1].trim()) : '';
};
const attr = (block, name, a) => {
  const m = block.match(new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`));
  return m ? decodeXml(m[1]) : '';
};

const iso = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Parse a YouTube channel Atom feed → { channelTitle, items[] }. Unknown/invalid entries are skipped. */
export function parseYoutubeRss(xml, { max = 6 } = {}) {
  const text = String(xml ?? '');
  const head = text.split('<entry>')[0] ?? '';
  const channelTitle = tag(head, 'title');
  const items = [];
  for (const block of text.split('<entry>').slice(1)) {
    const videoId = tag(block, 'yt:videoId');
    const title = tag(block, 'title');
    const publishedAt = iso(tag(block, 'published'));
    if (!/^[\w-]{11}$/.test(videoId) || !title || !publishedAt) continue;
    const author = tag(block.slice(block.indexOf('<author>')), 'name') || channelTitle;
    items.push({
      type: 'youtube',
      id: `yt:${videoId}`,
      title,
      author,
      avatar: null,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt,
      thumbnail: attr(block, 'media:thumbnail', 'url') || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { channelTitle, items: items.slice(0, max) };
}

const isHttps = (u) => typeof u === 'string' && /^https:\/\//i.test(u);

/**
 * Normalise a Bluesky app.bsky.feed.getAuthorFeed response. Drops replies and reposts, posts with
 * a "!no-unauthenticated" self-label, and posts without text and media.
 */
export function normalizeBlueskyFeed(json, { max = 5, maxTextChars = DEFAULT_LIMITS.maxTextChars, blockWords = [] } = {}) {
  const out = [];
  const block = blockWords.map((w) => String(w).toLowerCase()).filter(Boolean);
  for (const fi of json?.feed ?? []) {
    const post = fi?.post;
    if (!post?.uri || !post?.author?.handle) continue;
    if (fi.reason) continue; // repost / pin marker
    if (fi.reply || post.record?.reply) continue; // reply
    const labels = [...(post.labels ?? []), ...(post.author?.labels ?? [])].map((l) => l?.val);
    if (labels.some((v) => v === '!no-unauthenticated' || v === '!hide' || v === 'porn' || v === 'sexual' || v === 'graphic-media' || v === 'nudity')) continue;
    const rec = post.record ?? {};
    let text = String(rec.text ?? '').replace(/\s+\n/g, '\n').trim();
    const embed = post.embed ?? {};
    const img =
      embed.images?.[0]?.thumb ??
      embed.media?.images?.[0]?.thumb ??
      embed.external?.thumb ??
      embed.media?.external?.thumb ??
      embed.thumbnail ??
      null;
    if (!text && !img) continue;
    if (block.length && block.some((w) => text.toLowerCase().includes(w))) continue;
    if (text.length > maxTextChars) text = `${text.slice(0, maxTextChars - 1).trimEnd()}…`;
    const publishedAt = iso(rec.createdAt) ?? iso(post.indexedAt);
    if (!publishedAt) continue;
    const rkey = String(post.uri).split('/').pop();
    out.push({
      type: 'bluesky',
      id: `bsky:${post.uri}`,
      text,
      author: post.author.displayName?.trim() || post.author.handle,
      handle: post.author.handle,
      avatar: isHttps(post.author.avatar) ? post.author.avatar : null,
      url: `https://bsky.app/profile/${post.author.handle}/post/${rkey}`,
      publishedAt,
      thumbnail: isHttps(img) ? img : null,
    });
  }
  out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return out.slice(0, max);
}

/**
 * Merge items from all sources: dedupe by id and by identical url, drop anything older than
 * maxAgeDays or dated in the future (> 1 h), newest first, capped.
 */
export function mergeNews(items, { now = Date.now(), maxItems = DEFAULT_LIMITS.maxItems, maxAgeDays = DEFAULT_LIMITS.maxAgeDays } = {}) {
  const seenId = new Set();
  const seenUrl = new Set();
  const cutoff = now - maxAgeDays * 86_400_000;
  const out = [];
  for (const it of [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))) {
    const t = Date.parse(it.publishedAt);
    if (!Number.isFinite(t) || t < cutoff || t > now + 3_600_000) continue;
    if (seenId.has(it.id) || seenUrl.has(it.url)) continue;
    seenId.add(it.id);
    seenUrl.add(it.url);
    out.push(it);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Compare ignoring generatedAt (avoid churn when nothing changed). */
export const sameNewsContent = (a, b) =>
  !!a && !!b && JSON.stringify({ ...a, generatedAt: undefined }) === JSON.stringify({ ...b, generatedAt: undefined });

/** Validate the editable config. Returns { ok, errors[] }. */
export function validateSources(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return { ok: false, errors: ['config is not an object'] };
  for (const y of cfg.youtube ?? []) {
    if (!/^UC[\w-]{22}$/.test(y?.channelId ?? '')) errors.push(`youtube ${y?.name ?? '?'}: bad channelId`);
  }
  for (const b of cfg.bluesky ?? []) {
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(b?.handle ?? '')) errors.push(`bluesky ${b?.handle ?? '?'}: bad handle`);
  }
  const handles = (cfg.bluesky ?? []).map((b) => String(b.handle).toLowerCase());
  if (new Set(handles).size !== handles.length) errors.push('duplicate bluesky handle');
  return { ok: errors.length === 0, errors };
}
