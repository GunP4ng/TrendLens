const fs = require('node:fs');
const path = require('node:path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data', 'guild_configs');

const defaults = {
  time: '09:00',
  channel: '',
  sources: { hackernews: true, reddit: true, github: true, huggingface: true },
  cooldown: 300,
  language: 'ko',
  geminiRpd: 50,
};

const guildConfigs = new Map();

function ensureGuild(guildId) {
  if (!guildConfigs.has(guildId)) {
    guildConfigs.set(guildId, { ...defaults, sources: { ...defaults.sources } });
  }
  return guildConfigs.get(guildId);
}

function load() {
  try {
    if (!fs.existsSync(DATA_DIR)) return;
    for (const file of fs.readdirSync(DATA_DIR)) {
      if (!file.endsWith('.json')) continue;
      const guildId = file.replace('.json', '');
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
        const overrides = JSON.parse(raw);
        const cfg = { ...defaults, sources: { ...defaults.sources } };
        if (overrides.sources) {
          overrides.sources = { ...cfg.sources, ...overrides.sources };
        }
        Object.assign(cfg, overrides);
        guildConfigs.set(guildId, cfg);
        logger.info(`[config] 길드 ${guildId} 설정 로드 완료`);
      } catch (err) {
        logger.warn(`[config] 길드 ${guildId} 설정 로드 실패: ${err.message}`);
      }
    }
  } catch (err) {
    logger.warn(`[config] 설정 디렉토리 로드 실패: ${err.message}`);
  }
}

function get(guildId, key) {
  const cfg = ensureGuild(guildId);
  return cfg[key];
}

function set(guildId, key, value) {
  const cfg = ensureGuild(guildId);
  cfg[key] = value;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(DATA_DIR, `${guildId}.json`),
      JSON.stringify(cfg, null, 2),
      'utf-8',
    );
  } catch (err) {
    logger.error(`[config] 길드 ${guildId} 설정 저장 실패: ${err.message}`);
  }
}

function getAll(guildId) {
  const cfg = ensureGuild(guildId);
  return { ...cfg, sources: { ...cfg.sources } };
}

module.exports = { load, get, set, getAll };
