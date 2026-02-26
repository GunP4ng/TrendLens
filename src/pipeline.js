const config = require('./config');
const logger = require('./logger');
const formatter = require('./formatter');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeUrl, dedup: dedupCore } = require('./urlUtils');

const hn = require('./fetchers/hackernews');
const reddit = require('./fetchers/reddit');
const github = require('./fetchers/github-trending');
const hf = require('./fetchers/huggingface');

function dedup(items) {
  return dedupCore(items, logger);
}

const FETCHER_MAP = {
  hackernews: hn,
  reddit,
  github,
  huggingface: hf,
};

async function runPipeline({ date, sources, userId, apiKey, redditCredentials } = {}) {
  const raw = sources || config.get('sources');
  const activeSources = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const startTime = Date.now();

  const fetcherEntries = Object.entries(FETCHER_MAP).filter(
    ([name]) => activeSources[name],
  );

  const results = await Promise.allSettled(
    fetcherEntries.map(async ([name, mod]) => {
      const t = Date.now();
      const fetchOpts = { date };
      if (name === 'reddit' && redditCredentials) {
        fetchOpts.credentials = redditCredentials;
      }
      const items = await mod.fetch(fetchOpts);
      const elapsed = ((Date.now() - t) / 1000).toFixed(1);
      logger.info(`[${name}] ${items.length}건 수집 (소요: ${elapsed}s)`);
      return { name, items, elapsed: parseFloat(elapsed) };
    }),
  );

  const sourceMeta = {};
  let allItems = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { name, items, elapsed } = r.value;
      sourceMeta[name] = { collected: items.length, elapsed_sec: elapsed };
      allItems.push(...items);
    } else {
      logger.warn(`Fetcher 실패: ${r.reason?.message}`);
    }
  }

  const beforeDedup = allItems.length;
  allItems = dedup(allItems);
  logger.info(`중복 제거: ${beforeDedup}건 → ${allItems.length}건`);

  let parsedData = null;
  let geminiUsed = false;
  let geminiSkipReason = null;

  // score 상위 20건 선별 + 원래 allItems 인덱스 보존
  const MAX_SUMMARY_ITEMS = 20;
  const topByScore = allItems
    .map((item, originalIdx) => ({ item, originalIdx }))
    .sort((a, b) => b.item.score - a.item.score)
    .slice(0, MAX_SUMMARY_ITEMS);
  const itemsForSummary = topByScore.map(({ item }) => item);

  if (apiKey) {
    try {
      const summarizer = require('./summarizer');
      parsedData = await summarizer.summarizeTrends(itemsForSummary, apiKey, config.get('language'));
      geminiUsed = !!parsedData;
      if (!parsedData) geminiSkipReason = 'api_error';
    } catch (err) {
      geminiSkipReason = err.code === 'QUOTA_EXCEEDED' ? 'quota_exceeded' : 'api_error';
      logger.warn(`요약 실패: ${err.message}`);
    }
  } else {
    geminiSkipReason = 'no_personal_key';
    logger.info('요약 생략: 개인 키 미등록');
  }

  // item_summaries를 allItems에 정확하게 매핑
  // promptIdx(0~N)는 topByScore 순서 기준, originalIdx로 역추적하여 allItems에 반영
  if (parsedData && typeof parsedData === 'object' && parsedData.item_summaries) {
    let mapped = 0;
    topByScore.forEach(({ originalIdx }, promptIdx) => {
      const aiSummary = parsedData.item_summaries[String(promptIdx)];
      if (aiSummary) {
        allItems[originalIdx] = { ...allItems[originalIdx], aiSummary };
        mapped++;
      }
    });
    logger.info(`[Pipeline] aiSummary 매핑: ${mapped}/${topByScore.length}건`);
  }

  const dateStr = date || new Date().toISOString().slice(0, 10);
  const messages = formatter.formatTrendMessage(allItems, parsedData, dateStr);

  const meta = {
    executed_at: new Date().toISOString(),
    sources: sourceMeta,
    after_dedup: allItems.length,
    triggered_by: userId ? '/trend' : 'schedule',
    user_id: userId || null,
    gemini_used: geminiUsed,
    gemini_skip_reason: geminiSkipReason,
    gemini_parsed_json: parsedData !== null && typeof parsedData === 'object',
    discord_messages_sent: messages.length,
    errors: [],
    elapsed_sec: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
  };

  try {
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
      path.join(logsDir, `result_${dateStr}.json`),
      JSON.stringify(meta, null, 2),
      'utf-8',
    );
  } catch (err) {
    logger.warn(`결과 로그 저장 실패: ${err.message}`);
  }

  return { items: allItems, messages, parsedData, meta };
}

module.exports = { runPipeline, normalizeUrl, dedup };
