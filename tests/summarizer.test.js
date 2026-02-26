/* globals: describe, it, expect, vi, beforeEach, afterEach */

vi.mock('../src/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const { validateKey, summarizeTrends, summarizeUrl } = require('../src/summarizer');

const MOCK_ITEMS = [
  { title: 'AI Agent Framework', url: 'https://example.com/1', source: 'hackernews', score: 200 },
  { title: 'Open Source LLM', url: 'https://example.com/2', source: 'reddit', score: 100 },
];

const VALID_PARSED = {
  core_summary: ['AI 에이전트 급성장', 'LLM 오픈소스 경쟁', 'RAG 패턴 확산'],
  item_summaries: { '0': 'AI 에이전트 프레임워크 소개', '1': '오픈소스 LLM 릴리즈' },
  analysis: '- 인사이트1\n- 인사이트2',
};

// Gemini REST API 응답 형식
function makeGeminiResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    }),
  };
}

function makeGeminiError(status) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'rate limit' } }),
    text: async () => JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }),
  };
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('validateKey', () => {
  it('API 응답 성공 시 true 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGeminiResponse('pong'));
    const result = await validateKey('valid-key');
    expect(result).toBe(true);
  });

  it('API 오류 시 false 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: {} }) });
    const result = await validateKey('bad-key');
    expect(result).toBe(false);
  });

  it('네트워크 오류 시 false 반환', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await validateKey('any-key');
    expect(result).toBe(false);
  });
});

describe('summarizeTrends', () => {
  it('빈 items 배열이면 null 반환 (API 미호출)', async () => {
    global.fetch = vi.fn();
    const result = await summarizeTrends([], 'key');
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('null items이면 null 반환', async () => {
    global.fetch = vi.fn();
    const result = await summarizeTrends(null, 'key');
    expect(result).toBeNull();
  });

  it('유효한 JSON 응답을 파싱하여 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGeminiResponse(JSON.stringify(VALID_PARSED)));
    const result = await summarizeTrends(MOCK_ITEMS, 'valid-key', 'ko');
    expect(result).not.toBeNull();
    expect(Array.isArray(result.core_summary)).toBe(true);
    expect(result.core_summary).toHaveLength(3);
    expect(typeof result.item_summaries).toBe('object');
  });

  it('analysis가 배열로 반환된 경우 문자열로 정규화', async () => {
    const dataWithArrayAnalysis = { ...VALID_PARSED, analysis: ['인사이트1', '인사이트2'] };
    global.fetch = vi.fn().mockResolvedValue(makeGeminiResponse(JSON.stringify(dataWithArrayAnalysis)));
    const result = await summarizeTrends(MOCK_ITEMS, 'valid-key', 'ko');
    expect(typeof result.analysis).toBe('string');
    expect(result.analysis).toContain('인사이트1');
  });

  it('JSON 파싱 실패 시 원본 텍스트 fallback 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGeminiResponse('not a json'));
    const result = await summarizeTrends(MOCK_ITEMS, 'valid-key', 'ko');
    expect(typeof result).toBe('string');
    expect(result).toBe('not a json');
  });

  it('JSON 구조 불일치 시 원본 텍스트 fallback 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGeminiResponse(JSON.stringify({ wrong: 'structure' })));
    const result = await summarizeTrends(MOCK_ITEMS, 'valid-key', 'ko');
    expect(typeof result).toBe('string');
  });

  it('429 에러 시 QUOTA_EXCEEDED 코드로 throw', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGeminiError(429));
    await expect(summarizeTrends(MOCK_ITEMS, 'valid-key', 'ko')).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
  });

  it('기타 API 에러 시 null 반환', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await summarizeTrends(MOCK_ITEMS, 'valid-key', 'ko');
    expect(result).toBeNull();
  });
});

describe('summarizeUrl', () => {
  it('정상적으로 리포트 텍스트 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGeminiResponse('## 핵심 내용\n요약 내용입니다.'));
    const result = await summarizeUrl('본문 내용', 'valid-key', 'ko');
    expect(typeof result).toBe('string');
    expect(result).toContain('핵심 내용');
  });

  it('429 에러 시 QUOTA_EXCEEDED 코드로 throw', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGeminiError(429));
    await expect(summarizeUrl('텍스트', 'valid-key', 'ko')).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
  });

  it('기타 에러는 그대로 throw', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('internal error'));
    await expect(summarizeUrl('텍스트', 'valid-key', 'ko')).rejects.toThrow();
  });
});
