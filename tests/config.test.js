/* globals: describe, it, expect, beforeEach, afterEach, vi */

vi.mock('../src/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// config는 모듈 수준에서 require (vi.resetModules 없이 단일 인스턴스 테스트)
const config = require('../src/config');
const fs = require('node:fs');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config > get', () => {
  it('기본값 반환', () => {
    expect(config.get('time')).toBe('09:00');
    expect(config.get('cooldown')).toBe(300);
    expect(config.get('language')).toBe('ko');
    expect(config.get('geminiRpd')).toBe(50);
  });

  it('기본 sources 구조 반환', () => {
    const sources = config.get('sources');
    expect(sources.hackernews).toBe(true);
    expect(sources.reddit).toBe(true);
    expect(sources.github).toBe(true);
    expect(sources.huggingface).toBe(true);
  });
});

describe('config > load', () => {
  it('config_override.json 없으면 기본값 유지', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    config.load();
    // 파일 없을 때 기존 값 유지
    expect(config.get('cooldown')).toBe(300);
  });

  it('override 파일 존재 시 값을 덮어씀', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ time: '10:00', cooldown: 600 }),
    );
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    config.load();
    expect(config.get('time')).toBe('10:00');
    expect(config.get('cooldown')).toBe(600);
    // 상태 복원
    config.set('time', '09:00');
    config.set('cooldown', 300);
  });

  it('sources override는 기존 sources와 병합됨', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ sources: { reddit: false } }),
    );
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    config.load();
    const sources = config.get('sources');
    expect(sources.hackernews).toBe(true);
    expect(sources.reddit).toBe(false);
    expect(sources.github).toBe(true);
    // 상태 복원
    config.set('sources', { hackernews: true, reddit: true, github: true, huggingface: true });
  });

  it('JSON 파싱 실패 시 기본값 유지 (경고 로그)', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{ invalid json }');
    expect(() => config.load()).not.toThrow();
  });
});

describe('config > set', () => {
  it('값을 변경하고 파일에 저장', () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    config.set('cooldown', 120);
    expect(config.get('cooldown')).toBe(120);
    expect(fs.writeFileSync).toHaveBeenCalled();
    config.set('cooldown', 300);
  });

  it('writeFileSync 실패 시 에러 throw하지 않음', () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => config.set('language', 'en')).not.toThrow();
    config.set('language', 'ko');
  });
});

describe('config > getAll', () => {
  it('전체 설정 객체 반환 (깊은 복사)', () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const all = config.getAll();
    expect(all).toHaveProperty('time');
    expect(all).toHaveProperty('sources');
    all.time = 'mutated';
    expect(config.get('time')).not.toBe('mutated');
  });
});
