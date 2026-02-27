/* globals: describe, it, expect, vi, beforeEach, afterEach */

const dns = require('node:dns');
const { isPrivateIP, isSafeUrl, withTimeout, toCronExpr, formatUptime, validateDate } = require('../src/utils');

describe('isPrivateIP', () => {
  it('loopback 127.0.0.1 차단', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
  });

  it('127.255.255.255 차단', () => {
    expect(isPrivateIP('127.255.255.255')).toBe(true);
  });

  it('10.x.x.x 사설 IP 차단', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('10.255.255.255')).toBe(true);
  });

  it('172.16-31.x.x 사설 IP 차단', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
  });

  it('172.15.x.x 는 공인 IP (차단 안 함)', () => {
    expect(isPrivateIP('172.15.0.1')).toBe(false);
  });

  it('172.32.x.x 는 공인 IP (차단 안 함)', () => {
    expect(isPrivateIP('172.32.0.1')).toBe(false);
  });

  it('192.168.x.x 사설 IP 차단', () => {
    expect(isPrivateIP('192.168.0.1')).toBe(true);
    expect(isPrivateIP('192.168.255.255')).toBe(true);
  });

  it('169.254.x.x 링크 로컬 차단', () => {
    expect(isPrivateIP('169.254.0.1')).toBe(true);
  });

  it('0.x.x.x 차단', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
  });

  it('공인 IPv4 허용', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('203.0.113.1')).toBe(false);
  });

  it('IPv6 루프백 ::1 차단', () => {
    expect(isPrivateIP('::1')).toBe(true);
  });

  it('IPv6 링크 로컬 fe80:: 차단', () => {
    expect(isPrivateIP('fe80::1')).toBe(true);
  });

  it('IPv6 ULA fc/fd 차단', () => {
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd12:3456:789a::1')).toBe(true);
  });

  it('공인 IPv6 허용', () => {
    expect(isPrivateIP('2001:4860:4860::8888')).toBe(false);
  });
});

describe('isSafeUrl', () => {
  let resolve4Spy;
  let resolve6Spy;
  let lookupSpy;

  beforeEach(() => {
    resolve4Spy = vi.spyOn(dns.promises, 'resolve4');
    resolve6Spy = vi.spyOn(dns.promises, 'resolve6');
    lookupSpy = vi.spyOn(dns.promises, 'lookup');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('공인 IPv4 직접 입력 허용', async () => {
    expect(await isSafeUrl('http://8.8.8.8/path')).toBe(true);
  });

  it('사설 IPv4 직접 입력 차단', async () => {
    expect(await isSafeUrl('http://192.168.1.1/path')).toBe(false);
  });

  it('loopback IP 차단', async () => {
    expect(await isSafeUrl('http://127.0.0.1/')).toBe(false);
  });

  it('잘못된 URL은 false 반환', async () => {
    expect(await isSafeUrl('not-a-url')).toBe(false);
  });

  it('DNS A 레코드가 공인 IP면 허용', async () => {
    resolve4Spy.mockResolvedValue(['8.8.8.8']);
    resolve6Spy.mockResolvedValue([]);
    expect(await isSafeUrl('https://example.com')).toBe(true);
  });

  it('DNS A 레코드가 사설 IP면 차단', async () => {
    resolve4Spy.mockResolvedValue(['10.0.0.1']);
    resolve6Spy.mockResolvedValue([]);
    expect(await isSafeUrl('https://internal.corp')).toBe(false);
  });

  it('DNS AAAA 레코드가 사설 IP면 차단', async () => {
    resolve4Spy.mockResolvedValue([]);
    resolve6Spy.mockResolvedValue(['::1']);
    expect(await isSafeUrl('https://internal.corp')).toBe(false);
  });

  it('DNS 레코드 없으면 false 반환', async () => {
    resolve4Spy.mockResolvedValue([]);
    resolve6Spy.mockResolvedValue([]);
    lookupSpy.mockResolvedValue([]);
    expect(await isSafeUrl('https://nonexistent.invalid')).toBe(false);
  });

  it('lookup fallback에서 공인 IP면 허용', async () => {
    resolve4Spy.mockResolvedValue([]);
    resolve6Spy.mockResolvedValue([]);
    lookupSpy.mockResolvedValue([{ address: '1.2.3.4' }]);
    expect(await isSafeUrl('https://example.com')).toBe(true);
  });

  it('공인+사설 IP 혼합이면 차단 (every 조건)', async () => {
    resolve4Spy.mockResolvedValue(['8.8.8.8', '192.168.1.1']);
    resolve6Spy.mockResolvedValue([]);
    expect(await isSafeUrl('https://mixed.example.com')).toBe(false);
  });
});

describe('withTimeout', () => {
  it('타임아웃 전에 완료되면 값 반환', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000, 'timeout');
    expect(result).toBe('ok');
  });

  it('타임아웃 초과 시 지정 메시지로 에러 throw', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(() => resolve('late'), 500));
    await expect(withTimeout(slowPromise, 10, '시간 초과')).rejects.toThrow('시간 초과');
  });

  it('promise 자체가 reject되면 그 에러 전파', async () => {
    const failing = Promise.reject(new Error('original error'));
    await expect(withTimeout(failing, 1000, 'timeout')).rejects.toThrow('original error');
  });
});

describe('toCronExpr', () => {
  it('09:00 → "0 9 * * *"', () => {
    expect(toCronExpr('09:00')).toBe('0 9 * * *');
  });

  it('23:30 → "30 23 * * *"', () => {
    expect(toCronExpr('23:30')).toBe('30 23 * * *');
  });

  it('00:00 → "0 0 * * *"', () => {
    expect(toCronExpr('00:00')).toBe('0 0 * * *');
  });

  it('12:45 → "45 12 * * *"', () => {
    expect(toCronExpr('12:45')).toBe('45 12 * * *');
  });
});

describe('formatUptime', () => {
  it('분만 표시', () => {
    expect(formatUptime(5 * 60 * 1000)).toBe('5분');
  });

  it('0분도 표시', () => {
    expect(formatUptime(0)).toBe('0분');
  });

  it('시간+분 표시', () => {
    expect(formatUptime(2 * 3600 * 1000 + 30 * 60 * 1000)).toBe('2시간 30분');
  });

  it('일+시간+분 표시', () => {
    expect(formatUptime(1 * 86400 * 1000 + 3 * 3600 * 1000 + 15 * 60 * 1000)).toBe('1일 3시간 15분');
  });

  it('정확히 1일은 시간 없이 표시', () => {
    expect(formatUptime(1 * 86400 * 1000 + 5 * 60 * 1000)).toBe('1일 5분');
  });
});

describe('validateDate', () => {
  const TODAY = '2026-02-27';

  it('유효한 오늘 날짜 통과', () => {
    expect(validateDate('2026-02-27', TODAY).valid).toBe(true);
  });

  it('유효한 어제 날짜 통과', () => {
    expect(validateDate('2026-02-26', TODAY).valid).toBe(true);
  });

  it('30일 이내 과거 날짜 통과', () => {
    expect(validateDate('2026-01-28', TODAY).valid).toBe(true);
  });

  it('잘못된 형식 거부 (슬래시)', () => {
    expect(validateDate('2026/02/27', TODAY).valid).toBe(false);
  });

  it('잘못된 형식 거부 (숫자만)', () => {
    expect(validateDate('20260227', TODAY).valid).toBe(false);
  });

  it('잘못된 형식 거부 (텍스트)', () => {
    expect(validateDate('invalid', TODAY).valid).toBe(false);
  });

  it('미래 날짜 거부', () => {
    const result = validateDate('2026-03-01', TODAY);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('미래 날짜');
  });

  it('31일 전 날짜 거부', () => {
    const result = validateDate('2026-01-27', TODAY);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('30일');
  });

  it('정확히 30일 전 날짜 통과', () => {
    expect(validateDate('2026-01-28', TODAY).valid).toBe(true);
  });

  it('유효하지 않은 날짜값 거부 (월 초과)', () => {
    expect(validateDate('2026-13-01', TODAY).valid).toBe(false);
  });
});
