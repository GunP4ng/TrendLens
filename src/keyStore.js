const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const logger = require('./logger');

const SALT = process.env.USAGE_SALT || 'trendlens-usage-salt-v1';
const LOGS_DIR = path.join(__dirname, 'logs');

const keys = new Map();
const redditCredentials = new Map();
const usage = new Map();
const restartNotified = new Set();
let diskUsageCache = null;

function hashUserId(userId) {
  return crypto.createHash('sha256').update(userId + SALT).digest('hex').slice(0, 16);
}

function setKey(userId, apiKey) {
  keys.set(userId, apiKey);
  logger.info(`[KeyStore] user:${hashUserId(userId)} 키 등록`);
}

function getKey(userId) {
  return keys.get(userId) || null;
}

function removeKey(userId) {
  const had = keys.delete(userId);
  if (had) logger.info(`[KeyStore] user:${hashUserId(userId)} 키 삭제`);
  return had;
}

function hasKey(userId) {
  return keys.has(userId);
}

function getKeyPreview(userId) {
  const key = keys.get(userId);
  if (!key) return null;
  return '****' + key.slice(-4);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getUsageEntry(userId) {
  if (!usage.has(userId)) {
    if (diskUsageCache) {
      const hashed = hashUserId(userId);
      const diskEntry = diskUsageCache[hashed];
      if (diskEntry && diskEntry.count > 0) {
        usage.set(userId, {
          count: diskEntry.count,
          lastUsedAt: diskEntry.lastUsedAt || null,
          lastCommand: diskEntry.lastCommand || null,
          date: todayStr(),
        });
        logger.info(`[KeyStore] user:${hashed} 디스크에서 사용량 복원 (${diskEntry.count}건)`);
        return usage.get(userId);
      }
    }
    usage.set(userId, { count: 0, lastUsedAt: null, lastCommand: null, date: todayStr() });
  }
  const entry = usage.get(userId);
  if (entry.date !== todayStr()) {
    entry.count = 0;
    entry.lastUsedAt = null;
    entry.lastCommand = null;
    entry.date = todayStr();
  }
  return entry;
}

function incrementUsage(userId, command) {
  const entry = getUsageEntry(userId);
  entry.count++;
  entry.lastUsedAt = new Date().toISOString();
  entry.lastCommand = command;

  const rpd = config.get('geminiRpd') || 50;
  const pct = Math.round((entry.count / rpd) * 100);
  logger.info(`[user:${hashUserId(userId)}] Gemini API 사용량: ${entry.count}/${rpd} RPD (${pct}%)`);

  appendUsageToDisk(userId, entry);
}

function appendUsageToDisk(userId, entry) {
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    const filePath = path.join(LOGS_DIR, `gemini_usage_${todayStr()}.json`);

    let data = {};
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    data[hashUserId(userId)] = { count: entry.count, lastUsedAt: entry.lastUsedAt, lastCommand: entry.lastCommand };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`[KeyStore] 사용량 디스크 기록 실패: ${err.message}`);
  }
}

function getUsage(userId) {
  const entry = getUsageEntry(userId);
  return { count: entry.count, lastUsedAt: entry.lastUsedAt, lastCommand: entry.lastCommand };
}

function isQuotaExceeded(userId) {
  const entry = getUsageEntry(userId);
  return entry.count >= (config.get('geminiRpd') || 50);
}

function getQuotaWarningLevel(userId) {
  const entry = getUsageEntry(userId);
  const rpd = config.get('geminiRpd') || 50;
  const pct = (entry.count / rpd) * 100;
  if (pct >= 100) return 'exceeded';
  if (pct >= 80) return 'warning';
  return 'normal';
}

function resetDailyUsage() {
  for (const [userId, entry] of usage.entries()) {
    entry.count = 0;
    entry.lastUsedAt = null;
    entry.lastCommand = null;
    entry.date = todayStr();
  }
  logger.info('[KeyStore] 일일 사용량 리셋 완료');
}

function restoreFromDisk() {
  try {
    const filePath = path.join(LOGS_DIR, `gemini_usage_${todayStr()}.json`);
    if (!fs.existsSync(filePath)) return;
    diskUsageCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const entries = Object.keys(diskUsageCache).length;
    logger.info(`[KeyStore] 디스크 사용량 캐시 로드 완료 (${entries}건, 지연 복원 대기)`);
  } catch (err) {
    logger.warn(`[KeyStore] 디스크 복원 실패: ${err.message}`);
  }
}

function shouldNotifyRestart(userId) {
  if (restartNotified.has(userId)) return false;
  restartNotified.add(userId);
  return true;
}

function setReddit(userId, clientId, clientSecret) {
  redditCredentials.set(userId, { clientId, clientSecret });
  logger.info(`[KeyStore] user:${hashUserId(userId)} Reddit OAuth 등록`);
}

function getReddit(userId) {
  return redditCredentials.get(userId) || null;
}

function removeReddit(userId) {
  const had = redditCredentials.delete(userId);
  if (had) logger.info(`[KeyStore] user:${hashUserId(userId)} Reddit OAuth 삭제`);
  return had;
}

function hasReddit(userId) {
  return redditCredentials.has(userId);
}

function getRedditPreview(userId) {
  const cred = redditCredentials.get(userId);
  if (!cred) return null;
  return cred.clientId.slice(0, 4) + '****';
}

function getAnyRedditCredentials() {
  for (const cred of redditCredentials.values()) {
    return cred;
  }
  return null;
}

function getAnyKey() {
  for (const key of keys.values()) return key;
  return null;
}

module.exports = {
  setKey, getKey, removeKey, hasKey, getKeyPreview, getAnyKey,
  setReddit, getReddit, removeReddit, hasReddit, getRedditPreview, getAnyRedditCredentials,
  incrementUsage, getUsage, isQuotaExceeded, getQuotaWarningLevel,
  resetDailyUsage, restoreFromDisk, shouldNotifyRestart, hashUserId,
};
