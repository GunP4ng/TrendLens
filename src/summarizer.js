const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');

const MODEL_NAME = 'gemini-3-flash-preview';
const MAX_INPUT_ITEMS = 20;
const MAX_URL_TEXT_LEN = 10_000;

function buildTrendPrompt(items, language) {
  const isKo = language !== 'en';
  const langInstruction = isKo
    ? '모든 출력은 반드시 한국어로 작성하세요. 영어 제목은 한국어로 번역하여 표기하세요. 단, 모델명·라이브러리명·고유명사는 원문 그대로 유지해도 됩니다.'
    : 'Write all output in English.';

  const itemsText = items
    .map((item, i) => `${i}. [${item.source}] ${item.title} (score: ${item.score})\n   URL: ${item.url}`)
    .join('\n');

  const lang = isKo ? '한국어' : 'English';

  return `${langInstruction}

아래는 오늘 수집된 AI/ML 트렌드 항목입니다. 각 항목의 인덱스는 0부터 시작합니다.

${itemsText}

위 항목들을 분석하여 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트는 절대 출력하지 마세요.

{
  "core_summary": [
    "오늘 가장 중요한 흐름 1문장 (${lang}, 관련 항목 제목 인용 가능)",
    "두 번째로 중요한 흐름 1문장",
    "세 번째로 중요한 흐름 1문장"
  ],
  "item_summaries": {
    "0": "${lang} 1줄 요약 (50자 이내)",
    "1": "${lang} 1줄 요약 (50자 이내)"
  },
  "analysis": "- 인사이트1\n- 인사이트2\n- 인사이트3"
}

제약사항:
- ${isKo ? '반드시 한국어로만 작성.' : 'Write in English only.'}
- item_summaries의 키는 위 항목 인덱스(숫자 문자열)와 정확히 일치해야 합니다.
- item_summaries는 각 항목의 핵심을 ${lang} 1줄로 요약한 것입니다 (원문 그대로 복사 금지).
- core_summary는 반드시 배열 3개 원소.
- analysis는 반드시 문자열(string)이어야 합니다. 배열이 아닌, "- 항목1\\n- 항목2" 형태의 단일 문자열로 작성하세요.
- 입력에 없는 정보를 생성하지 마세요 (hallucination 방지).
- 유효한 JSON만 출력하세요. 마크다운 코드 블록(\`\`\`) 금지.`;
}

function buildUrlPrompt(text, language) {
  const isKo = language !== 'en';
  const langInstruction = isKo
    ? '모든 출력은 반드시 한국어로 작성하세요. 영어 내용은 한국어로 번역하세요. 단, 모델명·라이브러리명·고유명사는 원문 그대로 유지해도 됩니다.'
    : 'Write all output in English.';

  return `${langInstruction}

아래는 웹페이지에서 추출한 본문입니다. 1장짜리 리포트를 작성해주세요.

본문:
${text}

출력 형식:
1. **핵심 내용 요약** (3~5줄)
2. **기술적 의의 및 영향**
3. **한계점 또는 주의사항**

제약사항:
- ${isKo ? '반드시 한국어로만 작성.' : 'Write in English only.'}
- 입력 본문에 없는 정보를 생성하지 마세요 (hallucination 방지).`;
}

async function validateKey(apiKey) {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    await model.generateContent('ping');
    return true;
  } catch (err) {
    logger.warn(`[Summarizer] 키 검증 실패: ${err.message}`);
    return false;
  }
}

/**
 * @returns {Object|null} parsedData { core_summary, item_summaries, analysis } 또는 null
 */
async function summarizeTrends(items, apiKey, language = 'ko') {
  if (!items || items.length === 0) return null;

  // 호출자(pipeline)가 이미 선별·정렬한 items를 그대로 사용
  // 내부에서 재정렬하면 prompt 인덱스와 allItems 인덱스가 불일치함
  const prompt = buildTrendPrompt(items, language);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel(
      { model: MODEL_NAME },
      { apiVersion: 'v1beta' },
    );
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    const text = result.response.text().trim();
    logger.info(`[Summarizer] 트렌드 요약 생성 완료 (입력: ${items.length}건)`);

    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.core_summary)) {
        // Gemini가 analysis를 배열로 반환하는 경우 방어적 정규화
        if (Array.isArray(parsed.analysis)) {
          parsed.analysis = parsed.analysis.join('\n');
        }
        return parsed;
      }
      logger.warn('[Summarizer] JSON 구조 불일치 — 텍스트 fallback');
      return text;
    } catch {
      logger.warn('[Summarizer] JSON 파싱 실패 — 텍스트 fallback');
      return text;
    }
  } catch (err) {
    if (err.status === 429 || err.message?.includes('429')) {
      const quotaErr = new Error('Gemini API rate limit 초과');
      quotaErr.code = 'QUOTA_EXCEEDED';
      throw quotaErr;
    }
    logger.warn(`[Summarizer] 트렌드 요약 실패: ${err.message}`);
    return null;
  }
}

async function summarizeUrl(text, apiKey, language = 'ko') {
  const truncated = text.slice(0, MAX_URL_TEXT_LEN);
  const prompt = buildUrlPrompt(truncated, language);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    if (err.status === 429 || err.message?.includes('429')) {
      const quotaErr = new Error('Gemini API rate limit 초과');
      quotaErr.code = 'QUOTA_EXCEEDED';
      throw quotaErr;
    }
    throw err;
  }
}

module.exports = { validateKey, summarizeTrends, summarizeUrl };
