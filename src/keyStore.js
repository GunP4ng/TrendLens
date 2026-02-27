const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const logger = require('./logger');

const SALT = process.env.USAGE_SALT || 'trendlens-usage-salt-v1';
const LOGS_DIR = path.join(__dirname, '..', 'logs');

const guildKeys = new Map();
const guildReddit = new Map();
const guildUsage = new Map();
let diskUsageCache = null;

function hashId(id) {
  return crypto.createHash('sha256').update(id + SALT).digest('hex').slice(0, 16);
}

// ─── API Key ────────────────────────────────────────────────────────────────

function setGuildKey(guildId, apiKey) {
  guildKeys.set(guildId, apiKey);
  logger.info(`[KeyStore] guild:${hashId(guildId)} 키 등록`);
}

function getGuildKey(guildId) {
  return guildKeys.get(guildId) || null;
}

function removeGuildKey(guildId) {
  const had = guildKeys.delete(guildId);
  if (had) logger.info(`[KeyStore] guild:${hashId(guildId)} 키 삭제`);
  return had;
}

function hasGuildKey(guildId) {
  return guildKeys.has(guildId);
}

function getGuildKeyPreview(guildId) {
  const key = guildKeys.get(guildId);
  if (!key) return null;
  return '****' + key.slice(-4);
}

function getGuildKeyCount() {
  return guildKeys.size;
}

// ─── Usage ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getUsageEntry(guildId) {
  if (!guildUsage.has(guildId)) {
    if (diskUsageCache) {
      const hashed = hashId(guildId);
      const diskEntry = diskUsageCache[hashed];
      if (diskEntry && diskEntry.count > 0) {
        guildUsage.set(guildId, {
          count: diskEntry.count,
          lastUsedAt: diskEntry.lastUsedAt || null,
          lastCommand: diskEntry.lastCommand || null,
          date: todayStr(),
        });
        logger.info(`[KeyStore] guild:${hashed} 디스크에서 사용량 복원 (${diskEntry.count}건)`);
        return guildUsage.get(guildId);
      }
    }
    guildUsage.set(guildId, { count: 0, lastUsedAt: null, lastCommand: null, date: todayStr() });
  }
  const entry = guildUsage.get(guildId);
  if (entry.date !== todayStr()) {
    entry.count = 0;
    entry.lastUsedAt = null;
    entry.lastCommand = null;
    entry.date = todayStr();
  }
  return entry;
}

function incrementGuildUsage(guildId, command) {
  const entry = getUsageEntry(guildId);
  entry.count++;
  entry.lastUsedAt = new Date().toISOString();
  entry.lastCommand = command;

  const rpd = config.get(guildId, 'geminiRpd') || 50;
  const pct = Math.round((entry.count / rpd) * 100);
  logger.info(`[guild:${hashId(guildId)}] Gemini API 사용량: ${entry.count}/${rpd} RPD (${pct}%)`);

  appendUsageToDisk(guildId, entry);
}

function appendUsageToDisk(guildId, entry) {
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    const filePath = path.join(LOGS_DIR, `gemini_usage_${todayStr()}.json`);

    let data = {};
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    data[hashId(guildId)] = { count: entry.count, lastUsedAt: entry.lastUsedAt, lastCommand: entry.lastCommand };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`[KeyStore] 사용량 디스크 기록 실패: ${err.message}`);
  }
}

function getGuildUsage(guildId) {
  const entry = getUsageEntry(guildId);
  return { count: entry.count, lastUsedAt: entry.lastUsedAt, lastCommand: entry.lastCommand };
}

function isGuildQuotaExceeded(guildId) {
  const entry = getUsageEntry(guildId);
  return entry.count >= (config.get(guildId, 'geminiRpd') || 50);
}

function getGuildQuotaWarningLevel(guildId) {
  const entry = getUsageEntry(guildId);
  const rpd = config.get(guildId, 'geminiRpd') || 50;
  const pct = (entry.count / rpd) * 100;
  if (pct >= 100) return 'exceeded';
  if (pct >= 80) return 'warning';
  return 'normal';
}

function resetDailyUsage() {
  for (const [, entry] of guildUsage.entries()) {
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

// ─── Reddit ─────────────────────────────────────────────────────────────────

function setGuildReddit(guildId, clientId, clientSecret) {
  guildReddit.set(guildId, { clientId, clientSecret });
  logger.info(`[KeyStore] guild:${hashId(guildId)} Reddit OAuth 등록`);
}

function getGuildReddit(guildId) {
  return guildReddit.get(guildId) || null;
}

function removeGuildReddit(guildId) {
  const had = guildReddit.delete(guildId);
  if (had) logger.info(`[KeyStore] guild:${hashId(guildId)} Reddit OAuth 삭제`);
  return had;
}

function hasGuildReddit(guildId) {
  return guildReddit.has(guildId);
}

function getGuildRedditPreview(guildId) {
  const cred = guildReddit.get(guildId);
  if (!cred) return null;
  return cred.clientId.slice(0, 4) + '****';
}

module.exports = {
  setGuildKey, getGuildKey, removeGuildKey, hasGuildKey, getGuildKeyPreview, getGuildKeyCount,
  setGuildReddit, getGuildReddit, removeGuildReddit, hasGuildReddit, getGuildRedditPreview,
  incrementGuildUsage, getGuildUsage, isGuildQuotaExceeded, getGuildQuotaWarningLevel,
  resetDailyUsage, restoreFromDisk, hashId,
};
