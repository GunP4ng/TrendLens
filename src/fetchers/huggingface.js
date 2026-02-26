const logger = require('../logger');

const BASE_URL = 'https://huggingface.co/api/daily_papers';
const TIMEOUT = 10_000;
const MAX_ITEMS = 5;

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function mapToTrendItem(paper) {
  return {
    title: paper.title || '(제목 없음)',
    url: paper.paper?.id
      ? `https://huggingface.co/papers/${paper.paper.id}`
      : `https://huggingface.co/papers`,
    source: 'huggingface',
    score: paper.paper?.upvotes ?? 0,
    summary: paper.paper?.summary || null,
    createdAt: new Date(),
    metadata: {
      githubRepo: paper.paper?.githubRepo || null,
      upvotes: paper.paper?.upvotes ?? 0,
    },
  };
}

async function fetchHuggingFace({ date } = {}) {
  const dateStr = date || todayDateStr();

  try {
    const url = `${BASE_URL}?date=${dateStr}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });

    if (!res.ok) {
      logger.warn(`[HuggingFace] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      logger.warn('[HuggingFace] 예상치 못한 응답 형식');
      return [];
    }

    const seen = new Map();
    for (const item of data) {
      const id = item.paper?.id ?? `no-id-${seen.size}`;
      if (!seen.has(id)) seen.set(id, item);
    }

    const sorted = [...seen.values()]
      .sort((a, b) => (b.paper?.upvotes ?? 0) - (a.paper?.upvotes ?? 0))
      .slice(0, MAX_ITEMS);

    const items = sorted.map(mapToTrendItem);
    logger.info(`[HuggingFace] ${items.length}건 수집`);
    return items;
  } catch (err) {
    logger.warn(`[HuggingFace] 수집 실패: ${err.message}`);
    return [];
  }
}

module.exports = { fetch: fetchHuggingFace };
