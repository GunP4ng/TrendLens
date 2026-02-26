/* globals: describe, it, expect, beforeEach, vi */

vi.mock('../src/config', () => ({
  get: vi.fn((key) => {
    if (key === 'geminiRpd') return 50;
    return undefined;
  }),
  set: vi.fn(),
  load: vi.fn(),
}));

vi.mock('../src/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const keyStore = require('../src/keyStore');

const TEST_USER = 'test-user-' + Date.now();
let userCounter = 0;

function uniqueUser() {
  return `${TEST_USER}-${++userCounter}`;
}

describe('KeyStore', () => {
  it('키 등록/조회/삭제', () => {
    const userId = uniqueUser();
    expect(keyStore.hasKey(userId)).toBe(false);

    keyStore.setKey(userId, 'test-api-key-1234');
    expect(keyStore.hasKey(userId)).toBe(true);
    expect(keyStore.getKey(userId)).toBe('test-api-key-1234');
    expect(keyStore.getKeyPreview(userId)).toBe('****1234');

    keyStore.removeKey(userId);
    expect(keyStore.hasKey(userId)).toBe(false);
    expect(keyStore.getKey(userId)).toBeNull();
  });

  it('사용량 추적', () => {
    const userId = uniqueUser();
    keyStore.setKey(userId, 'key');
    keyStore.incrementUsage(userId, '/trend');

    const usage = keyStore.getUsage(userId);
    expect(usage.count).toBe(1);
    expect(usage.lastCommand).toBe('/trend');
    expect(usage.lastUsedAt).toBeTruthy();
  });

  it('쿼터 초과 판별', () => {
    const userId = uniqueUser();
    keyStore.setKey(userId, 'key');
    expect(keyStore.isQuotaExceeded(userId)).toBe(false);

    for (let i = 0; i < 50; i++) {
      keyStore.incrementUsage(userId, '/trend');
    }
    expect(keyStore.isQuotaExceeded(userId)).toBe(true);
  });

  it('경고 레벨: normal → warning → exceeded', () => {
    const userId = uniqueUser();
    keyStore.setKey(userId, 'key');
    expect(keyStore.getQuotaWarningLevel(userId)).toBe('normal');

    for (let i = 0; i < 40; i++) {
      keyStore.incrementUsage(userId, '/trend');
    }
    expect(keyStore.getQuotaWarningLevel(userId)).toBe('warning');

    for (let i = 0; i < 10; i++) {
      keyStore.incrementUsage(userId, '/trend');
    }
    expect(keyStore.getQuotaWarningLevel(userId)).toBe('exceeded');
  });

  it('재시작 알림 1회성', () => {
    const userId = uniqueUser();
    expect(keyStore.shouldNotifyRestart(userId)).toBe(true);
    expect(keyStore.shouldNotifyRestart(userId)).toBe(false);
  });

  it('userId 해시 일관성 및 길이', () => {
    const userId = uniqueUser();
    const h1 = keyStore.hashUserId(userId);
    const h2 = keyStore.hashUserId(userId);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
  });

  it('미등록 키 삭제 시 false', () => {
    const userId = uniqueUser();
    expect(keyStore.removeKey(userId)).toBe(false);
  });

  it('미등록 키 프리뷰 null', () => {
    const userId = uniqueUser();
    expect(keyStore.getKeyPreview(userId)).toBeNull();
  });
});
