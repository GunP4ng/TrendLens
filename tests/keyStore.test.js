/* globals: describe, it, expect, beforeEach, afterEach, vi */

vi.mock('../src/config', () => ({
  get: vi.fn((guildId, key) => {
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

const TEST_GUILD_PREFIX = 'test-guild-' + Date.now();
let guildCounter = 0;
const createdGuilds = [];

function uniqueGuild() {
  const guildId = `${TEST_GUILD_PREFIX}-${++guildCounter}`;
  createdGuilds.push(guildId);
  return guildId;
}

afterEach(() => {
  for (const guildId of createdGuilds.splice(0)) {
    keyStore.removeGuildKey(guildId);
    keyStore.removeGuildReddit(guildId);
  }
});

describe('KeyStore', () => {
  it('키 등록/조회/삭제', () => {
    const guildId = uniqueGuild();
    expect(keyStore.hasGuildKey(guildId)).toBe(false);

    keyStore.setGuildKey(guildId, 'test-api-key-1234');
    expect(keyStore.hasGuildKey(guildId)).toBe(true);
    expect(keyStore.getGuildKey(guildId)).toBe('test-api-key-1234');
    expect(keyStore.getGuildKeyPreview(guildId)).toBe('****1234');

    keyStore.removeGuildKey(guildId);
    expect(keyStore.hasGuildKey(guildId)).toBe(false);
    expect(keyStore.getGuildKey(guildId)).toBeNull();
  });

  it('사용량 추적', () => {
    const guildId = uniqueGuild();
    keyStore.setGuildKey(guildId, 'key');
    keyStore.incrementGuildUsage(guildId, '/trend');

    const usage = keyStore.getGuildUsage(guildId);
    expect(usage.count).toBe(1);
    expect(usage.lastCommand).toBe('/trend');
    expect(usage.lastUsedAt).toBeTruthy();
  });

  it('쿼터 초과 판별', () => {
    const guildId = uniqueGuild();
    keyStore.setGuildKey(guildId, 'key');
    expect(keyStore.isGuildQuotaExceeded(guildId)).toBe(false);

    for (let i = 0; i < 50; i++) {
      keyStore.incrementGuildUsage(guildId, '/trend');
    }
    expect(keyStore.isGuildQuotaExceeded(guildId)).toBe(true);
  });

  it('경고 레벨: normal → warning → exceeded', () => {
    const guildId = uniqueGuild();
    keyStore.setGuildKey(guildId, 'key');
    expect(keyStore.getGuildQuotaWarningLevel(guildId)).toBe('normal');

    for (let i = 0; i < 40; i++) {
      keyStore.incrementGuildUsage(guildId, '/trend');
    }
    expect(keyStore.getGuildQuotaWarningLevel(guildId)).toBe('warning');

    for (let i = 0; i < 10; i++) {
      keyStore.incrementGuildUsage(guildId, '/trend');
    }
    expect(keyStore.getGuildQuotaWarningLevel(guildId)).toBe('exceeded');
  });

  it('서버 키 미등록 시 getGuildKey는 null 반환', () => {
    const guildId = uniqueGuild();
    expect(keyStore.getGuildKey(guildId)).toBeNull();
  });

  it('서버 키 미등록 삭제 시 false 반환', () => {
    const guildId = uniqueGuild();
    expect(keyStore.removeGuildKey(guildId)).toBe(false);
  });

  it('서버 키 미등록 프리뷰는 null', () => {
    const guildId = uniqueGuild();
    expect(keyStore.getGuildKeyPreview(guildId)).toBeNull();
  });

  it('getGuildKeyCount는 등록된 서버 수 반환', () => {
    const guildA = uniqueGuild();
    const guildB = uniqueGuild();
    const before = keyStore.getGuildKeyCount();

    keyStore.setGuildKey(guildA, 'key-a');
    keyStore.setGuildKey(guildB, 'key-b');
    expect(keyStore.getGuildKeyCount()).toBe(before + 2);
  });

  it('hashId 일관성 및 길이', () => {
    const guildId = uniqueGuild();
    const h1 = keyStore.hashId(guildId);
    const h2 = keyStore.hashId(guildId);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
  });

  it('Reddit OAuth 등록/조회/삭제', () => {
    const guildId = uniqueGuild();
    expect(keyStore.hasGuildReddit(guildId)).toBe(false);

    keyStore.setGuildReddit(guildId, 'client-id-abcd', 'secret-xyz');
    expect(keyStore.hasGuildReddit(guildId)).toBe(true);
    expect(keyStore.getGuildReddit(guildId)).toEqual({ clientId: 'client-id-abcd', clientSecret: 'secret-xyz' });
    expect(keyStore.getGuildRedditPreview(guildId)).toBe('clie****');

    keyStore.removeGuildReddit(guildId);
    expect(keyStore.hasGuildReddit(guildId)).toBe(false);
    expect(keyStore.getGuildReddit(guildId)).toBeNull();
  });

  it('미등록 Reddit 삭제 시 false 반환', () => {
    const guildId = uniqueGuild();
    expect(keyStore.removeGuildReddit(guildId)).toBe(false);
  });
});
