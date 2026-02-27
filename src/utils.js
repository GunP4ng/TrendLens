const dns = require('node:dns');
const net = require('node:net');

const SAFE_ALLOWED_MENTIONS = { parse: [] };

function safePayload(payload = {}) {
  return { ...payload, allowedMentions: SAFE_ALLOWED_MENTIONS };
}

function safeContent(content, extra = {}) {
  return safePayload({ content, ...extra });
}

async function withTimeout(promise, ms, errorMessage) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMessage)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    return false;
  }
  return false;
}

async function isSafeUrl(urlString) {
  try {
    const { hostname } = new URL(urlString);

    if (net.isIP(hostname)) {
      return !isPrivateIP(hostname);
    }

    const [aRecords, aaaaRecords] = await Promise.all([
      dns.promises.resolve4(hostname).catch(() => []),
      dns.promises.resolve6(hostname).catch(() => []),
    ]);

    let allRecords = [...aRecords, ...aaaaRecords];
    if (allRecords.length === 0) {
      const lookedUp = await dns.promises.lookup(hostname, { all: true }).catch(() => []);
      allRecords = lookedUp.map((entry) => entry.address);
    }

    if (allRecords.length === 0) return false;
    return allRecords.every((addr) => !isPrivateIP(addr));
  } catch {
    return false;
  }
}

function toCronExpr(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return `${m} ${h} * * *`;
}

function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}일`);
  if (h > 0) parts.push(`${h}시간`);
  parts.push(`${m}분`);
  return parts.join(' ');
}

/**
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} [todayKst] - 테스트 주입용 오늘 날짜 (YYYY-MM-DD). 기본값: KST 현재 날짜
 */
function validateDate(dateStr, todayKst) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { valid: false, error: '📅 날짜 형식이 올바르지 않습니다. 예: 2026-02-25' };
  }
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) {
    return { valid: false, error: '📅 날짜 형식이 올바르지 않습니다. 예: 2026-02-25' };
  }

  const todayStr = todayKst || (() => {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  })();

  const today = new Date(`${todayStr}T00:00:00Z`);

  if (d.getTime() > today.getTime()) {
    return { valid: false, error: '📅 미래 날짜는 조회할 수 없습니다. 오늘 또는 과거 날짜를 입력해주세요.' };
  }

  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000);
  if (d.getTime() < thirtyDaysAgo.getTime()) {
    return { valid: false, error: '📅 최대 30일 전까지만 조회할 수 있습니다.' };
  }

  return { valid: true };
}

module.exports = {
  safePayload,
  safeContent,
  withTimeout,
  isPrivateIP,
  isSafeUrl,
  toCronExpr,
  formatUptime,
  validateDate,
};
