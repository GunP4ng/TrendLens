const STRIP_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'source', 'fbclid', 'gclid', 'si',
]);
const MOBILE_DOMAINS = {
  'm.reddit.com': 'reddit.com',
  'mobile.twitter.com': 'twitter.com',
  'm.youtube.com': 'youtube.com',
};

const SOURCE_PRIORITY = ['hackernews', 'reddit', 'huggingface', 'github'];

function normalizeUrl(raw) {
  try {
    const parsed = new URL(raw.trim());
    const host = MOBILE_DOMAINS[parsed.hostname.toLowerCase()] ?? parsed.hostname.toLowerCase();
    for (const key of [...parsed.searchParams.keys()]) {
      if (STRIP_PARAMS.has(key)) parsed.searchParams.delete(key);
    }
    const p = parsed.pathname.replace(/\/+$/, '') || '/';
    const port = parsed.port ? `:${parsed.port}` : '';
    parsed.hash = '';
    return `${parsed.protocol}//${host}${port}${p}${parsed.search}`;
  } catch {
    return raw;
  }
}

function dedup(items, logger) {
  const seen = new Map();

  for (const item of items) {
    const key = normalizeUrl(item.url);
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, item);
      continue;
    }

    const safePri = (p) => (p === -1 ? SOURCE_PRIORITY.length : p);
    const existingPri = safePri(SOURCE_PRIORITY.indexOf(existing.source));
    const newPri = safePri(SOURCE_PRIORITY.indexOf(item.source));

    if (newPri < existingPri) {
      if (logger) logger.info(`중복 제거: ${key} — ${existing.source} → ${item.source}`);
      seen.set(key, item);
    } else {
      if (logger) logger.info(`중복 제거: ${key} — ${item.source} → ${existing.source}`);
    }
  }

  return [...seen.values()];
}

module.exports = { normalizeUrl, dedup, SOURCE_PRIORITY };
