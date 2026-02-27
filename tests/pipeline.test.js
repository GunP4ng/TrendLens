/* globals: describe, it, expect, vi, beforeEach, afterEach */

vi.mock('../src/config', () => ({
  get: vi.fn((guildId, key) => {
    if (key === 'sources') return { hackernews: true, reddit: false, github: false, huggingface: false };
    if (key === 'language') return 'ko';
    if (key === 'geminiRpd') return 50;
    return undefined;
  }),
}));
vi.mock('../src/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const hn = require('../src/fetchers/hackernews');
const reddit = require('../src/fetchers/reddit');
const summarizer = require('../src/summarizer');
const fs = require('node:fs');
const { runPipeline } = require('../src/pipeline');
const { normalizeUrl, dedup } = require('../src/urlUtils');

const MOCK_ITEMS = [
  { title: 'AI Framework', url: 'https://example.com/ai', source: 'hackernews', score: 200, summary: null, createdAt: new Date(), metadata: {} },
  { title: 'Open LLM', url: 'https://example.com/llm', source: 'hackernews', score: 150, summary: null, createdAt: new Date(), metadata: {} },
];

beforeEach(() => {
  vi.spyOn(fs, 'existsSync').mockReturnValue(false);
  vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
  vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runPipeline', () => {
  it('fetcher 결과를 수집하여 messages 반환', async () => {
    vi.spyOn(hn, 'fetch').mockResolvedValue(MOCK_ITEMS);

    const result = await runPipeline({
      sources: { hackernews: true },
      guildId: 'guild-1',
    });

    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('meta');
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.items.length).toBe(2);
  });

  it('소스가 비어 있으면 빈 결과 반환', async () => {
    const result = await runPipeline({
      sources: { hackernews: false, reddit: false, github: false, huggingface: false },
      guildId: 'guild-2',
    });

    expect(result.items).toHaveLength(0);
    expect(result.meta.after_dedup).toBe(0);
  });

  it('apiKey 없으면 summarizer 호출하지 않음', async () => {
    vi.spyOn(hn, 'fetch').mockResolvedValue(MOCK_ITEMS);
    const summarizeSpy = vi.spyOn(summarizer, 'summarizeTrends');

    await runPipeline({
      sources: { hackernews: true },
      guildId: 'guild-3',
    });

    expect(summarizeSpy).not.toHaveBeenCalled();
  });

  it('apiKey 있으면 summarizeTrends 호출', async () => {
    vi.spyOn(hn, 'fetch').mockResolvedValue(MOCK_ITEMS);
    vi.spyOn(summarizer, 'summarizeTrends').mockResolvedValue({
      core_summary: ['요약1', '요약2'],
      item_summaries: { '0': 'AI 프레임워크 요약', '1': '오픈 LLM 요약' },
      analysis: '- 인사이트',
    });

    const result = await runPipeline({
      sources: { hackernews: true },
      guildId: 'guild-4',
      apiKey: 'test-api-key',
    });

    expect(summarizer.summarizeTrends).toHaveBeenCalledWith(
      expect.any(Array),
      'test-api-key',
      'ko',
    );
    expect(result.meta.gemini_used).toBe(true);
  });

  it('fetcher 실패 시 다른 소스는 계속 수집', async () => {
    vi.spyOn(hn, 'fetch').mockRejectedValue(new Error('HN fetch failed'));
    vi.spyOn(reddit, 'fetch').mockResolvedValue([
      { title: 'Reddit Post', url: 'https://reddit.com/r/test', source: 'reddit', score: 80, summary: null, createdAt: new Date(), metadata: {} },
    ]);

    const result = await runPipeline({
      sources: { hackernews: true, reddit: true },
      guildId: 'guild-5',
    });

    expect(result.items.length).toBe(1);
    expect(result.items[0].source).toBe('reddit');
  });

  it('summarizer QUOTA_EXCEEDED 에러 시 gemini_skip_reason 설정', async () => {
    vi.spyOn(hn, 'fetch').mockResolvedValue(MOCK_ITEMS);
    const quotaError = new Error('quota exceeded');
    quotaError.code = 'QUOTA_EXCEEDED';
    vi.spyOn(summarizer, 'summarizeTrends').mockRejectedValue(quotaError);

    const result = await runPipeline({
      sources: { hackernews: true },
      guildId: 'guild-6',
      apiKey: 'test-key',
    });

    expect(result.meta.gemini_used).toBe(false);
    expect(result.meta.gemini_skip_reason).toBe('quota_exceeded');
  });

  it('meta에 triggered_by, guild_id, elapsed_sec 포함', async () => {
    vi.spyOn(hn, 'fetch').mockResolvedValue([]);

    const result = await runPipeline({
      sources: { hackernews: true },
      guildId: 'guild-7',
      triggeredBy: 'command',
    });

    expect(result.meta.triggered_by).toBe('command');
    expect(result.meta.guild_id).toBe('guild-7');
    expect(typeof result.meta.elapsed_sec).toBe('number');
  });

  it('aiSummary가 올바르게 items에 매핑됨', async () => {
    vi.spyOn(hn, 'fetch').mockResolvedValue(MOCK_ITEMS);
    vi.spyOn(summarizer, 'summarizeTrends').mockResolvedValue({
      core_summary: [],
      item_summaries: { '0': 'AI 요약', '1': 'LLM 요약' },
      analysis: '',
    });

    const result = await runPipeline({
      sources: { hackernews: true },
      guildId: 'guild-8',
      apiKey: 'test-key',
    });

    const withSummary = result.items.filter((item) => item.aiSummary);
    expect(withSummary.length).toBeGreaterThan(0);
  });

  it('sources 미전달 시 빈 결과 반환', async () => {
    vi.spyOn(hn, 'fetch').mockResolvedValue([]);
    const result = await runPipeline({});
    expect(result.items).toHaveLength(0);
  });
});

describe('normalizeUrl', () => {
  it('소문자 호스트 + UTM 제거', () => {
    const result = normalizeUrl('https://Example.COM/path?utm_source=twitter&ref=abc');
    expect(result).toBe('https://example.com/path');
  });

  it('trailing slash 제거', () => {
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
  });

  it('모바일 도메인 변환', () => {
    expect(normalizeUrl('https://m.reddit.com/r/test')).toBe('https://reddit.com/r/test');
  });

  it('fragment 제거', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('루트 경로 유지', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('여러 UTM 파라미터 동시 제거', () => {
    const result = normalizeUrl('https://example.com/page?utm_source=a&utm_medium=b&utm_campaign=c&real=keep');
    expect(result).toBe('https://example.com/page?real=keep');
  });

  it('잘못된 URL은 원본 반환', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('dedup', () => {
  it('동일 URL의 우선순위 높은 소스 유지 (HN > Reddit)', () => {
    const items = [
      { title: 'A', url: 'https://example.com/post', source: 'reddit', score: 50, summary: null, createdAt: new Date(), metadata: {} },
      { title: 'A', url: 'https://example.com/post', source: 'hackernews', score: 200, summary: null, createdAt: new Date(), metadata: {} },
    ];
    const result = dedup(items);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('hackernews');
  });

  it('서로 다른 URL은 모두 유지', () => {
    const items = [
      { title: 'A', url: 'https://a.com', source: 'reddit', score: 50, summary: null, createdAt: new Date(), metadata: {} },
      { title: 'B', url: 'https://b.com', source: 'hackernews', score: 200, summary: null, createdAt: new Date(), metadata: {} },
    ];
    const result = dedup(items);
    expect(result).toHaveLength(2);
  });

  it('HF > GitHub 우선순위 유지', () => {
    const items = [
      { title: 'X', url: 'https://example.com/x', source: 'github', score: 100, summary: null, createdAt: new Date(), metadata: {} },
      { title: 'X', url: 'https://example.com/x', source: 'huggingface', score: 30, summary: null, createdAt: new Date(), metadata: {} },
    ];
    const result = dedup(items);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('huggingface');
  });

  it('URL 정규화 적용하여 중복 감지', () => {
    const items = [
      { title: 'A', url: 'https://example.com/post?utm_source=twitter', source: 'hackernews', score: 100, summary: null, createdAt: new Date(), metadata: {} },
      { title: 'A', url: 'https://example.com/post/', source: 'reddit', score: 50, summary: null, createdAt: new Date(), metadata: {} },
    ];
    const result = dedup(items);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('hackernews');
  });
});
