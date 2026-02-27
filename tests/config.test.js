/* globals: describe, it, expect, beforeEach, afterEach, vi */

vi.mock('../src/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const config = require('../src/config');
const fs = require('node:fs');

const TEST_GUILD = 'test-guild-12345';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config > get', () => {
  it('기본값 반환', () => {
    expect(config.get(TEST_GUILD, 'time')).toBe('09:00');
    expect(config.get(TEST_GUILD, 'cooldown')).toBe(300);
    expect(config.get(TEST_GUILD, 'language')).toBe('ko');
    expect(config.get(TEST_GUILD, 'geminiRpd')).toBe(50);
  });

  it('기본 sources 구조 반환', () => {
    const sources = config.get(TEST_GUILD, 'sources');
    expect(sources.hackernews).toBe(true);
    expect(sources.reddit).toBe(true);
    expect(sources.github).toBe(true);
    expect(sources.huggingface).toBe(true);
  });

  it('서로 다른 guildId는 독립적인 설정을 가짐', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    config.set('guild-a', 'cooldown', 120);
    config.set('guild-b', 'cooldown', 600);

    expect(config.get('guild-a', 'cooldown')).toBe(120);
    expect(config.get('guild-b', 'cooldown')).toBe(600);
  });
});

describe('config > load', () => {
  it('data 디렉토리 없으면 아무것도 안 함', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(() => config.load()).not.toThrow();
  });

  it('빈 디렉토리이면 기존 기본값 유지', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([]);
    config.load();
    expect(config.get(TEST_GUILD, 'cooldown')).toBe(300);
  });

  it('JSON 파일 로드 시 설정 덮어씀', () => {
    const guildId = 'guild-load-test';
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([`${guildId}.json`]);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ time: '10:00', cooldown: 600 }),
    );
    config.load();
    expect(config.get(guildId, 'time')).toBe('10:00');
    expect(config.get(guildId, 'cooldown')).toBe(600);
  });

  it('sources override는 기존 sources와 병합됨', () => {
    const guildId = 'guild-sources-merge';
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([`${guildId}.json`]);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ sources: { reddit: false } }),
    );
    config.load();
    const sources = config.get(guildId, 'sources');
    expect(sources.hackernews).toBe(true);
    expect(sources.reddit).toBe(false);
    expect(sources.github).toBe(true);
  });

  it('JSON 파싱 실패 시 에러 throw하지 않음', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['bad-guild.json']);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{ invalid json }');
    expect(() => config.load()).not.toThrow();
  });
});

describe('config > set', () => {
  it('값을 변경하고 파일에 저장', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    config.set(TEST_GUILD, 'cooldown', 120);
    expect(config.get(TEST_GUILD, 'cooldown')).toBe(120);
    expect(fs.writeFileSync).toHaveBeenCalled();
    config.set(TEST_GUILD, 'cooldown', 300);
  });

  it('writeFileSync 실패 시 에러 throw하지 않음', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => config.set(TEST_GUILD, 'language', 'en')).not.toThrow();
    vi.restoreAllMocks();
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    config.set(TEST_GUILD, 'language', 'ko');
  });
});

describe('config > getAll', () => {
  it('전체 설정 객체 반환 (깊은 복사)', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const all = config.getAll(TEST_GUILD);
    expect(all).toHaveProperty('time');
    expect(all).toHaveProperty('sources');
    all.time = 'mutated';
    expect(config.get(TEST_GUILD, 'time')).not.toBe('mutated');
  });
});
