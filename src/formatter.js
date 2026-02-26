const DISCORD_MAX = 1900;
const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━━━━━';

const KST_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${day} (${KST_DAYS[d.getUTCDay()]})`;
}

/**
 * 현재 한국 시간(KST, UTC+9) 기준으로 날짜 문자열 반환
 * @returns {string} "YYYY.MM.DD (요일)"
 */
function getKstDateString() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const dayName = KST_DAYS[kst.getUTCDay()];
  return `${y}.${m}.${d} (${dayName})`;
}

/**
 * summary 텍스트를 maxLen자로 자르고 '...' 추가
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function truncateSummary(text, maxLen = 150) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen)}...`;
}

/**
 * 항목의 표시용 요약 결정 (aiSummary만 사용, 없으면 null)
 * - 영문 원문(Abstract) fallback은 의도적으로 제거: 수천 자짜리 영어 원문이 출력되는 부작용 방지
 * @param {Object} item
 * @returns {string|null}
 */
function resolveItemSummary(item) {
  if (item.aiSummary) return item.aiSummary.trim();
  return null;
}

/**
 * 스마트 청킹: \n\n 단락 단위로 먼저 묶은 뒤 1900자 초과 시 줄 단위 fallback
 * 헤더와 내용이 분리되지 않도록 보장
 */
function chunkText(text, limit = DISCORD_MAX) {
  if (text.length <= limit) return [text];

  const messages = [];
  const blocks = text.split('\n\n');
  let current = '';

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;

    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    if (current) messages.push(current);

    if (block.length <= limit) {
      current = block;
      continue;
    }

    // 단락 자체가 초과 → 줄 단위 분할
    for (const line of block.split('\n')) {
      const lineCandidate = current ? `${current}\n${line}` : line;
      if (lineCandidate.length <= limit) {
        current = lineCandidate;
      } else {
        if (current) messages.push(current);
        if (line.length > limit) {
          messages.push(line.slice(0, limit));
          current = line.slice(limit);
        } else {
          current = line;
        }
      }
    }
  }

  if (current) messages.push(current);

  // 2번째 이후 청크에 구분자를 붙여 Discord 연속 메시지 시각적 병합 방지
  return messages.map((msg, i) => (i === 0 ? msg : `${SEPARATOR}\n${msg}`));
}

/**
 * 트렌드 메시지 포맷팅
 *
 * @param {Object[]} items    - pipeline에서 aiSummary 매핑 완료된 rawItems
 * @param {Object|string|null} parsedData - Gemini 파싱 결과 (object) 또는 fallback 텍스트 (string) 또는 null
 * @param {string} dateStr   - "YYYY-MM-DD" 형태 날짜 (KST 기준)
 * @returns {string[]} Discord 전송용 청크 배열
 */
function formatTrendMessage(items, parsedData, dateStr) {
  if (!items || items.length === 0) {
    return [`📡 **TrendLens — ${formatDate(dateStr)}**\n${SEPARATOR}\n\n수집된 트렌드 항목이 없습니다.`];
  }

  const isParsed = parsedData !== null && typeof parsedData === 'object';

  const parts = [];

  // ── 헤더 ────────────────────────────────────────────────
  parts.push(`📡 **TrendLens — ${formatDate(dateStr)}**\n${SEPARATOR}`);

  // ── 핵심 3줄 요약 ────────────────────────────────────────
  if (isParsed && Array.isArray(parsedData.core_summary) && parsedData.core_summary.length > 0) {
    const bullets = parsedData.core_summary.map(s => `• ${s}`).join('\n');
    parts.push(`🔥 **오늘의 핵심 3줄 요약**\n${bullets}`);
    parts.push(SEPARATOR);
  } else if (typeof parsedData === 'string' && parsedData) {
    // fallback: AI가 plain text를 반환한 경우
    parts.push(parsedData);
    parts.push(SEPARATOR);
  }

  // ── 소스별 항목 ─────────────────────────────────────────
  const hnItems = items.filter(i => i.source === 'hackernews');
  const redditItems = items.filter(i => i.source === 'reddit');
  const githubItems = items.filter(i => i.source === 'github');
  const hfItems = items.filter(i => i.source === 'huggingface');

  if (hnItems.length > 0) {
    let section = `📰 **HackerNews (${hnItems.length}건)**\n`;
    hnItems.forEach(item => {
      section += `[${item.score}pt] ${item.title}\n`;
      section += `<${item.url}>\n`;
      const displaySummary = resolveItemSummary(item);
      if (displaySummary) section += `↳ 💡 ${displaySummary}\n`;
      section += '\n';
    });
    parts.push(section.trimEnd());
  }

  if (redditItems.length > 0) {
    let section = `💬 **Reddit (${redditItems.length}건)**\n`;
    redditItems.forEach(item => {
      const sub = item.metadata?.subreddit || 'unknown';
      section += `[r/${sub}] ${item.title}\n`;
      section += `<${item.url}>\n`;
      const displaySummary = resolveItemSummary(item);
      if (displaySummary) section += `↳ 💡 ${displaySummary}\n`;
      section += '\n';
    });
    parts.push(section.trimEnd());
  }

  if (githubItems.length > 0) {
    let section = `⭐ **GitHub Trending (${githubItems.length}건)**\n`;
    githubItems.forEach(item => {
      const stars = item.metadata?.stars ?? item.score;
      section += `📦 ${item.title} (★ ${stars})\n`;
      section += `<${item.url}>\n`;
      const displaySummary = resolveItemSummary(item);
      if (displaySummary) section += `↳ ✨ ${displaySummary}\n`;
      section += '\n';
    });
    parts.push(section.trimEnd());
  }

  if (hfItems.length > 0) {
    let section = `📄 **HuggingFace Papers (${hfItems.length}건)**\n`;
    hfItems.forEach(item => {
      const upvotes = item.metadata?.upvotes ?? item.score;
      section += `📜 ${item.title} (↑ ${upvotes})\n`;
      section += `<${item.url}>\n`;
      const displaySummary = resolveItemSummary(item);
      if (displaySummary) section += `↳ 💡 ${displaySummary}\n`;
      section += '\n';
    });
    parts.push(section.trimEnd());
  }

  // ── AI 트렌드 분석 ──────────────────────────────────────
  if (isParsed && parsedData.analysis) {
    const analysisText = Array.isArray(parsedData.analysis)
      ? parsedData.analysis.join('\n')
      : parsedData.analysis;
    parts.push(SEPARATOR);
    parts.push(`🤖 **AI 트렌드 분석 (by Gemini)**\n${analysisText}`);
  }

  return chunkText(parts.join('\n\n'));
}

/**
 * 단일 소스 메시지 포맷팅
 */
function formatSourceMessage(items, sourceName) {
  if (!items || items.length === 0) {
    return [`📡 **${sourceName}** — 수집 결과 없음`];
  }

  const sourceLabels = {
    hackernews: 'HackerNews',
    reddit: 'Reddit',
    github: 'GitHub Trending',
    huggingface: 'HuggingFace Papers',
  };
  const label = sourceLabels[sourceName] || sourceName;

  let fullText = `📡 **${label} (${items.length}건)**\n${SEPARATOR}\n\n`;

  if (sourceName === 'hackernews') {
    items.forEach(item => {
      fullText += `[${item.score}pt] ${item.title}\n<${item.url}>\n\n`;
    });
  } else if (sourceName === 'reddit') {
    items.forEach(item => {
      const sub = item.metadata?.subreddit || 'unknown';
      fullText += `[r/${sub}] ${item.title}\n<${item.url}>\n\n`;
    });
  } else if (sourceName === 'github') {
    items.forEach(item => {
      const stars = item.metadata?.stars ?? item.score;
      fullText += `📦 ${item.title} (★ ${stars})\n<${item.url}>\n`;
      if (item.summary) fullText += `↳ ✨ ${item.summary}\n`;
      fullText += `\n`;
    });
  } else if (sourceName === 'huggingface') {
    items.forEach(item => {
      const upvotes = item.metadata?.upvotes ?? item.score;
      fullText += `📜 ${item.title} (↑ ${upvotes})\n<${item.url}>\n`;
      if (item.summary) fullText += `↳ 💡 ${item.summary}\n`;
      fullText += `\n`;
    });
  } else {
    items.forEach(item => {
      fullText += `• ${item.title}\n<${item.url}>\n\n`;
    });
  }

  return chunkText(fullText.trimEnd());
}

/**
 * URL 분석 리포트 포맷팅
 */
function formatSummarizeReport(report) {
  const text = `🔍 **URL 분석 리포트**\n${SEPARATOR}\n\n${report}`;
  return chunkText(text);
}

/**
 * 상태 메시지 포맷팅
 */
function formatStatusMessage(stats) {
  return [
    '📊 **TrendLens 상태**',
    SEPARATOR,
    `🏓 Ping: ${stats.ping}ms`,
    `⏱️ Uptime: ${stats.uptime}`,
    `📅 마지막 실행: ${stats.lastRun || '없음'}`,
    `📡 활성 소스: ${stats.activeSources}`,
    `📢 전송 채널: ${stats.channel || '미설정'}`,
    `🔑 등록된 키: ${stats.keyCount}개`,
  ].join('\n');
}

/**
 * 소스별 섹션 문자열 생성
 * @param {Object[]} items - 해당 소스의 rawItems
 * @returns {string}
 */
function renderHackerNews(items) {
  if (items.length === 0) return '';
  let section = `📰 HackerNews (${items.length}건)\n`;
  for (const item of items) {
    section += `[${item.score}pt] ${item.title}\n`;
    section += `<${item.url}>\n`;
    if (item.summary) section += `↳ 💡 ${item.summary}\n`;
    section += '\n';
  }
  return section.trimEnd();
}

function renderReddit(items) {
  if (items.length === 0) return '';
  let section = `💬 Reddit (${items.length}건)\n`;
  for (const item of items) {
    const sub = item.metadata?.subreddit || 'unknown';
    section += `[r/${sub}] ${item.title}\n`;
    section += `<${item.url}>\n`;
    if (item.summary) section += `↳ 💡 ${item.summary}\n`;
    section += '\n';
  }
  return section.trimEnd();
}

function renderGitHub(items) {
  if (items.length === 0) return '';
  let section = `⭐ GitHub Trending (${items.length}건)\n`;
  for (const item of items) {
    const stars = item.metadata?.stars ?? item.score;
    section += `📦 ${item.title} (★ ${stars})\n`;
    section += `<${item.url}>\n`;
    if (item.summary) section += `↳ ✨ ${item.summary}\n`;
    section += '\n';
  }
  return section.trimEnd();
}

function renderHuggingFace(items) {
  if (items.length === 0) return '';
  let section = `📄 HuggingFace Papers (${items.length}건)\n`;
  for (const item of items) {
    const upvotes = item.metadata?.upvotes ?? item.score;
    section += `📜 ${item.title} (↑ ${upvotes})\n`;
    section += `<${item.url}>\n`;
    if (item.summary) section += `↳ 💡 ${item.summary}\n`;
    section += '\n';
  }
  return section.trimEnd();
}

/**
 * AI 요약 + 소스별 트렌드 항목 + AI 분석을 하나의 포맷으로 조합하여
 * Discord 전송 가능한 1900자 이하 청크 배열로 반환합니다.
 *
 * @param {string|null} aiSummary   - 핵심 3줄 요약 텍스트
 * @param {string|null} aiAnalysis  - 전체 트렌드 분석 텍스트 (by Gemini)
 * @param {Object[]}    rawItems    - 수집된 트렌드 항목 배열
 * @returns {string[]} Discord 메시지 청크 배열
 */
function formatAndChunkMessage(aiSummary, aiAnalysis, rawItems) {
  const dateStr = getKstDateString();

  const parts = [];

  // ── 헤더 ──────────────────────────────────────────────
  parts.push(`📡 TrendLens — ${dateStr}\n${SEPARATOR}`);

  // ── 핵심 요약 ─────────────────────────────────────────
  if (aiSummary) {
    parts.push(`🔥 오늘의 핵심 3줄 요약\n${aiSummary}`);
    parts.push(SEPARATOR);
  }

  // ── 소스별 항목 ───────────────────────────────────────
  const bySource = {
    hackernews: [],
    reddit: [],
    github: [],
    huggingface: [],
  };

  for (const item of rawItems ?? []) {
    if (bySource[item.source]) {
      bySource[item.source].push(item);
    }
  }

  const hn = renderHackerNews(bySource.hackernews);
  const reddit = renderReddit(bySource.reddit);
  const github = renderGitHub(bySource.github);
  const hf = renderHuggingFace(bySource.huggingface);

  if (hn) parts.push(hn);
  if (reddit) parts.push(reddit);
  if (github) parts.push(github);
  if (hf) parts.push(hf);

  // ── AI 분석 ───────────────────────────────────────────
  if (aiAnalysis) {
    const analysisText = Array.isArray(aiAnalysis) ? aiAnalysis.join('\n') : aiAnalysis;
    parts.push(SEPARATOR);
    parts.push(`🤖 AI 트렌드 분석 (by Gemini)\n${analysisText}`);
  }

  const fullText = parts.join('\n\n');
  return chunkText(fullText);
}

module.exports = {
  formatTrendMessage,
  formatSourceMessage,
  formatSummarizeReport,
  formatStatusMessage,
  formatAndChunkMessage,
  chunkText,
  truncateSummary,
};
