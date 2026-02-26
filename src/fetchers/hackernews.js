const logger = require('../logger');

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1/search';
const KEYWORDS = ['AI', 'LLM', 'GPT', 'Claude', 'Gemini', 'agent', 'RAG', 'fine-tune', 'open-source model'];
const TIMEOUT = 10_000;
const MAX_ITEMS = 10;
const SCORE_THRESHOLD = 100;

function buildQuery(keywords) {
  // 단일 단어는 quotes 없이, 공백 포함 구문만 quotes로 묶음
  return keywords.map((k) => (k.includes(' ') ? `"${k}"` : k)).join(' OR ');
}

function toUnixRange(date) {
  if (date) {
    const d = new Date(date);
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const end = new Date(start.getTime() + 86_400_000);
    return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
  }
  const now = Math.floor(Date.now() / 1000);
  return { start: now - 86_400, end: now };
}

function mapToTrendItem(hit) {
  return {
    title: hit.title || '(제목 없음)',
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    source: 'hackernews',
    score: hit.points ?? 0,
    summary: null,
    createdAt: new Date(),
    metadata: { hnId: hit.objectID, commentCount: hit.num_comments ?? 0 },
  };
}

async function fetchHackerNews({ date } = {}) {
  const { start, end } = toUnixRange(date);
  const query = buildQuery(KEYWORDS);

  try {
    const params = new URLSearchParams({
      query,
      tags: 'story',
      numericFilters: `created_at_i>${start},created_at_i<${end},points>=${SCORE_THRESHOLD}`,
      hitsPerPage: String(MAX_ITEMS),
    });

    const res = await fetch(`${ALGOLIA_BASE}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!res.ok) {
      logger.warn(`[HackerNews] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    let hits = data.hits || [];

    if (hits.length === 0) {
      // 1차 fallback: 날짜 범위 유지, score 제한 해제
      logger.info('[HackerNews] score >= 100 결과 없음, fallback-1 (날짜 범위 내 상위 10건)');
      const fb1Params = new URLSearchParams({
        query,
        tags: 'story',
        numericFilters: `created_at_i>${start},created_at_i<${end}`,
        hitsPerPage: String(MAX_ITEMS * 2),
      });

      const fb1Res = await fetch(`${ALGOLIA_BASE}?${fb1Params}`, {
        signal: AbortSignal.timeout(TIMEOUT),
      });

      if (fb1Res.ok) {
        const fb1Data = await fb1Res.json();
        hits = (fb1Data.hits || [])
          .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
          .slice(0, MAX_ITEMS);
      }

      // 2차 fallback: 날짜 제한도 해제 — 최근 7일 인기 AI 스토리
      if (hits.length === 0) {
        logger.info('[HackerNews] 날짜 범위 내 결과 없음, fallback-2 (7일 내 인기 상위 10건)');
        const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86_400;
        const fb2Params = new URLSearchParams({
          query,
          tags: 'story',
          numericFilters: `created_at_i>${sevenDaysAgo}`,
          hitsPerPage: String(MAX_ITEMS * 2),
        });

        const fb2Res = await fetch(`${ALGOLIA_BASE}?${fb2Params}`, {
          signal: AbortSignal.timeout(TIMEOUT),
        });

        if (fb2Res.ok) {
          const fb2Data = await fb2Res.json();
          hits = (fb2Data.hits || [])
            .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
            .slice(0, MAX_ITEMS);
        }
      }
    }

    const items = hits.map(mapToTrendItem);
    logger.info(`[HackerNews] ${items.length}건 수집`);
    return items;
  } catch (err) {
    logger.warn(`[HackerNews] 수집 실패: ${err.message}`);
    return [];
  }
}

module.exports = { fetch: fetchHackerNews };
