/* globals: describe, it, expect, vi, beforeEach */

vi.mock('../src/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ──────────────────────────────────────────────
// HackerNews Fetcher
// ──────────────────────────────────────────────

describe('HackerNews fetcher', () => {
  let fetchHN;

  const makeHit = (overrides = {}) => ({
    objectID: '1',
    title: 'AI Agent Framework Released',
    url: 'https://example.com/1',
    points: 250,
    num_comments: 30,
    ...overrides,
  });

  const mockFetch = (hits) =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hits }),
    });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('정상 응답 시 TrendItem 배열 반환', async () => {
    global.fetch = mockFetch([makeHit()]);
    fetchHN = require('../src/fetchers/hackernews');
    const items = await fetchHN.fetch();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].source).toBe('hackernews');
    expect(items[0].title).toBe('AI Agent Framework Released');
    expect(items[0].score).toBe(250);
  });

  it('url 없는 hit는 HN 링크로 대체', async () => {
    global.fetch = mockFetch([makeHit({ url: undefined, objectID: '42' })]);
    fetchHN = require('../src/fetchers/hackernews');
    const items = await fetchHN.fetch();
    expect(items[0].url).toContain('news.ycombinator.com/item?id=42');
  });

  it('HTTP 오류 시 빈 배열 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    fetchHN = require('../src/fetchers/hackernews');
    const items = await fetchHN.fetch();
    expect(items).toEqual([]);
  });

  it('네트워크 오류 시 빈 배열 반환', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    fetchHN = require('../src/fetchers/hackernews');
    const items = await fetchHN.fetch();
    expect(items).toEqual([]);
  });

  it('결과 없으면 fallback 호출', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ hits: callCount === 1 ? [] : [makeHit()] }),
      };
    });
    fetchHN = require('../src/fetchers/hackernews');
    const items = await fetchHN.fetch();
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});

// ──────────────────────────────────────────────
// HuggingFace Fetcher
// ──────────────────────────────────────────────

describe('HuggingFace fetcher', () => {
  let fetchHF;

  const makePaper = (overrides = {}) => ({
    title: 'Attention Is All You Need',
    paper: {
      id: 'arxiv-1706',
      upvotes: 42,
      summary: 'Transformer architecture paper',
      githubRepo: null,
      ...overrides.paper,
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('정상 응답 시 TrendItem 배열 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [makePaper()],
    });
    fetchHF = require('../src/fetchers/huggingface');
    const items = await fetchHF.fetch();
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].source).toBe('huggingface');
    expect(items[0].score).toBe(42);
  });

  it('paper.id 없는 경우 기본 URL 사용', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ title: 'No ID Paper', paper: { upvotes: 5 } }],
    });
    fetchHF = require('../src/fetchers/huggingface');
    const items = await fetchHF.fetch();
    expect(items[0].url).toBe('https://huggingface.co/papers');
  });

  it('HTTP 오류 시 빈 배열 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    fetchHF = require('../src/fetchers/huggingface');
    const items = await fetchHF.fetch();
    expect(items).toEqual([]);
  });

  it('응답이 배열이 아닌 경우 빈 배열 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'unexpected' }),
    });
    fetchHF = require('../src/fetchers/huggingface');
    const items = await fetchHF.fetch();
    expect(items).toEqual([]);
  });

  it('중복 paper.id 제거', async () => {
    const paper = makePaper();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [paper, paper],
    });
    fetchHF = require('../src/fetchers/huggingface');
    const items = await fetchHF.fetch();
    expect(items.length).toBe(1);
  });

  it('업보트 기준 내림차순 정렬 후 MAX_ITEMS까지 반환', async () => {
    const papers = Array.from({ length: 10 }, (_, i) => makePaper({ paper: { id: `p${i}`, upvotes: i * 10 } }));
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => papers,
    });
    fetchHF = require('../src/fetchers/huggingface');
    const items = await fetchHF.fetch();
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items[0].score).toBeGreaterThanOrEqual(items[1]?.score ?? 0);
  });
});

// ──────────────────────────────────────────────
// Reddit Fetcher
// ──────────────────────────────────────────────

describe('Reddit fetcher', () => {
  let fetchReddit;

  const makePost = (overrides = {}) => ({
    kind: 't3',
    data: {
      title: 'New LLM Released',
      url: 'https://example.com/llm',
      permalink: '/r/MachineLearning/comments/abc',
      ups: 120,
      num_comments: 15,
      ...overrides,
    },
  });

  const mockSubredditResponse = (posts) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data: { children: posts } }),
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('인증 없이 정상 수집', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockSubredditResponse([makePost()]));
    fetchReddit = require('../src/fetchers/reddit');
    const items = await fetchReddit.fetch();
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].source).toBe('reddit');
  });

  it('429 응답 시 빈 배열 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
    });
    fetchReddit = require('../src/fetchers/reddit');
    const items = await fetchReddit.fetch();
    expect(items).toEqual([]);
  });

  it('네트워크 오류 시 빈 배열 반환', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    fetchReddit = require('../src/fetchers/reddit');
    const items = await fetchReddit.fetch();
    expect(items).toEqual([]);
  });

  it('ups < 50이면 fallback으로 상위 N건 반환', async () => {
    const lowUpsPosts = Array.from({ length: 10 }, (_, i) =>
      makePost({ ups: 10 + i, title: `Post ${i}` }),
    );
    global.fetch = vi.fn().mockResolvedValue(mockSubredditResponse(lowUpsPosts));
    fetchReddit = require('../src/fetchers/reddit');
    const items = await fetchReddit.fetch();
    expect(items.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────
// GitHub Trending Fetcher
// ──────────────────────────────────────────────

describe('GitHub Trending fetcher', () => {
  let fetchGithub;

  const SAMPLE_HTML = `
    <article class="Box-row">
      <h2><a href="/owner/repo-name">owner/repo-name</a></h2>
      <p>A great AI repository</p>
      <a class="Link--muted">1,234</a>
    </article>
  `;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('HTML 스크래핑 성공 시 TrendItem 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => SAMPLE_HTML,
    });
    fetchGithub = require('../src/fetchers/github-trending');
    const items = await fetchGithub.fetch();
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].source).toBe('github');
    expect(items[0].url).toContain('github.com/owner/repo-name');
  });

  it('HTML 파싱 결과 0건이면 Search API fallback 시도', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async (_url) => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, text: async () => '<html></html>' };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              full_name: 'owner/fallback-repo',
              html_url: 'https://github.com/owner/fallback-repo',
              stargazers_count: 500,
              description: 'Fallback repo',
              language: 'Python',
            },
          ],
        }),
      };
    });
    fetchGithub = require('../src/fetchers/github-trending');
    const items = await fetchGithub.fetch();
    expect(callCount).toBe(2);
    expect(items[0].title).toBe('owner/fallback-repo');
  });

  it('Trending HTTP 오류 시 Search API fallback', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { ok: false, status: 503 };
      return {
        ok: true,
        json: async () => ({
          items: [{
            full_name: 'a/b',
            html_url: 'https://github.com/a/b',
            stargazers_count: 100,
            description: null,
            language: 'Python',
          }],
        }),
      };
    });
    fetchGithub = require('../src/fetchers/github-trending');
    const items = await fetchGithub.fetch();
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('모든 방법 실패 시 빈 배열 반환', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('all failed'));
    fetchGithub = require('../src/fetchers/github-trending');
    const items = await fetchGithub.fetch();
    expect(items).toEqual([]);
  });
});
