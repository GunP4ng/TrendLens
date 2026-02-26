const cheerio = require('cheerio');
const logger = require('../logger');

const TRENDING_URL = 'https://github.com/trending/python?since=daily';
const TIMEOUT = 10_000;
const MAX_ITEMS = 5;

function parseStarCount(text) {
  if (!text) return 0;
  const cleaned = text.trim().replace(/,/g, '');
  return parseInt(cleaned, 10) || 0;
}

function parseTrendingHtml(html) {
  const $ = cheerio.load(html);
  const rows = $('article.Box-row');

  if (rows.length === 0) return [];

  const items = [];
  rows.each((i, el) => {
    if (items.length >= MAX_ITEMS) return false;

    const $el = $(el);
    const repoLink = $el.find('h2 a').attr('href');
    if (!repoLink) return;

    const fullName = repoLink.replace(/^\//, '').trim();
    const description = $el.find('p').first().text().trim() || '';
    const language = $el.find('[itemprop="programmingLanguage"]').text().trim() || '';

    const starTexts = $el.find('a.Link--muted').map((_, a) => $(a).text().trim()).get();
    const stars = parseStarCount(starTexts[0]);
    const todayStarsText = $el.find('.d-inline-block.float-sm-right').text().trim();
    const todayStars = parseStarCount(todayStarsText);

    items.push({
      title: fullName,
      url: `https://github.com/${fullName}`,
      source: 'github',
      score: stars,
      summary: description || null,
      createdAt: new Date(),
      metadata: { language, stars, todayStars },
    });
  });

  return items;
}

function getYesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function fetchFromSearchApi() {
  const yesterday = getYesterday();
  const url = `https://api.github.com/search/repositories?q=language:python+created:>=${yesterday}&sort=stars&order=desc&per_page=${MAX_ITEMS}`;

  const res = await fetch(url, {
    headers: { 'Accept': 'application/vnd.github+json' },
    signal: AbortSignal.timeout(TIMEOUT),
  });

  if (!res.ok) {
    logger.warn(`[GitHub] Search API fallback 실패: HTTP ${res.status}`);
    return [];
  }

  const data = await res.json();
  return (data.items || []).slice(0, MAX_ITEMS).map((repo) => ({
    title: repo.full_name,
    url: repo.html_url,
    source: 'github',
    score: repo.stargazers_count ?? 0,
    summary: repo.description || null,
    createdAt: new Date(),
    metadata: {
      language: repo.language || '',
      stars: repo.stargazers_count ?? 0,
      todayStars: 0,
    },
  }));
}

async function fetchGithubTrending() {
  try {
    const res = await fetch(TRENDING_URL, { signal: AbortSignal.timeout(TIMEOUT) });

    if (res.ok) {
      const html = await res.text();
      const items = parseTrendingHtml(html);

      if (items.length > 0) {
        logger.info(`[GitHub] ${items.length}건 수집 (Trending)`);
        return items;
      }
      logger.info('[GitHub] Trending 파싱 결과 0건, Search API fallback 시도');
    } else {
      logger.warn(`[GitHub] Trending HTTP ${res.status}, Search API fallback 시도`);
    }
  } catch (err) {
    logger.warn(`[GitHub] Trending 수집 실패: ${err.message}, Search API fallback 시도`);
  }

  try {
    return await fetchFromSearchApi();
  } catch (fbErr) {
    logger.warn(`[GitHub] Search API fallback도 실패: ${fbErr.message}`);
    return [];
  }
}

module.exports = { fetch: fetchGithubTrending };
