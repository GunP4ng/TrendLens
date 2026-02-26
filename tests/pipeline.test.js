/* globals: describe, it, expect */

const { normalizeUrl, dedup } = require('../src/urlUtils');

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
