const fs = require('node:fs');
const path = require('node:path');
const logger = require('./logger');

const OVERRIDE_PATH = path.join(__dirname, '..', 'config_override.json');

const defaults = {
  time: '09:00',
  channel: '',
  sources: { hackernews: true, reddit: true, github: true, huggingface: true },
  cooldown: 300,
  language: 'ko',
  geminiRpd: 50,
};

let current = { ...defaults, sources: { ...defaults.sources } };

function load() {
  try {
    if (fs.existsSync(OVERRIDE_PATH)) {
      const overrides = JSON.parse(fs.readFileSync(OVERRIDE_PATH, 'utf-8'));
      if (overrides.sources) {
        overrides.sources = { ...current.sources, ...overrides.sources };
      }
      Object.assign(current, overrides);
      logger.info('config_override.json 로드 완료');
    }
  } catch (err) {
    logger.warn(`config_override.json 로드 실패: ${err.message}`);
  }
}

function get(key) {
  return current[key];
}

function set(key, value) {
  current[key] = value;
  try {
    fs.writeFileSync(OVERRIDE_PATH, JSON.stringify(current, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`config_override.json 저장 실패: ${err.message}`);
  }
}

function getAll() {
  return { ...current, sources: { ...current.sources } };
}

module.exports = { load, get, set, getAll };
