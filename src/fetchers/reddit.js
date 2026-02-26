const logger = require('../logger');

const SUBREDDITS = ['MachineLearning', 'LocalLLaMA', 'artificial'];
const TIMEOUT = 10_000;
const MAX_PER_SUB = 5;
const UPS_THRESHOLD = 50;
const USER_AGENT = 'TrendLens/1.0';
const DELAY_MS = 1500;

const tokenCache = new Map();

async function getOAuthToken(credentials) {
  const clientId = credentials?.clientId;
  const clientSecret = credentials?.clientSecret;
  if (!clientId || !clientSecret) return null;

  const cacheKey = clientId;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!res.ok) {
      logger.warn(`[Reddit] OAuth 토큰 발급 실패: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    });
    logger.info('[Reddit] OAuth 토큰 발급 성공');
    return data.access_token;
  } catch (err) {
    logger.warn(`[Reddit] OAuth 토큰 발급 실패: ${err.message}`);
    return null;
  }
}

function mapToTrendItem(post, subreddit) {
  const d = post.data;
  return {
    title: d.title,
    url: d.url || `https://reddit.com${d.permalink}`,
    source: 'reddit',
    score: d.ups ?? 0,
    summary: null,
    createdAt: new Date(),
    metadata: { subreddit, commentCount: d.num_comments ?? 0 },
  };
}

async function fetchSubreddit(subreddit, headers, baseUrl) {
  const url = `${baseUrl}/r/${subreddit}/hot.json?limit=25`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });

  const remaining = res.headers.get('x-ratelimit-remaining');
  if (remaining) {
    logger.info(`[Reddit] r/${subreddit} x-ratelimit-remaining: ${remaining}`);
  }

  if (res.status === 429 || res.status === 403) {
    logger.warn(`[Reddit] r/${subreddit} HTTP ${res.status} — Reddit 섹션 생략`);
    return null;
  }

  if (!res.ok) {
    logger.warn(`[Reddit] r/${subreddit} HTTP ${res.status}`);
    return [];
  }

  const data = await res.json();
  const posts = (data?.data?.children || []).filter((c) => c.kind === 't3');

  let filtered = posts.filter((c) => (c.data.ups ?? 0) >= UPS_THRESHOLD);
  if (filtered.length === 0) {
    filtered = posts
      .sort((a, b) => (b.data.ups ?? 0) - (a.data.ups ?? 0))
      .slice(0, MAX_PER_SUB);
    logger.info(`[Reddit] r/${subreddit} ups >= 50 미달, fallback 상위 ${filtered.length}건`);
  } else {
    filtered = filtered.slice(0, MAX_PER_SUB);
  }

  return filtered.map((c) => mapToTrendItem(c, subreddit));
}

async function fetchReddit({ credentials } = {}) {
  const token = await getOAuthToken(credentials);
  const isOAuth = !!token;

  const baseUrl = isOAuth ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const headers = { 'User-Agent': USER_AGENT };
  if (isOAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const allItems = [];

  try {
    for (let i = 0; i < SUBREDDITS.length; i++) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }

      const result = await fetchSubreddit(SUBREDDITS[i], headers, baseUrl);
      if (result === null) {
        logger.warn('[Reddit] Rate limit 감지, Reddit 전체 생략');
        return [];
      }

      allItems.push(...result);
    }

    logger.info(`[Reddit] 총 ${allItems.length}건 수집`);
    return allItems;
  } catch (err) {
    logger.warn(`[Reddit] 수집 실패: ${err.message}`);
    return [];
  }
}

module.exports = { fetch: fetchReddit };
