require('dotenv').config();

// ──────────────────────────────────────────────
// 필수 환경변수 검증 (시작 시 즉시 실패)
// ──────────────────────────────────────────────
const REQUIRED_ENV = ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[Fatal] 필수 환경변수 ${key}가 설정되지 않았습니다. .env 파일을 확인해주세요.`);
    process.exit(1);
  }
}

const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, AttachmentBuilder, ChannelType, MessageFlags, Events,
} = require('discord.js');
const cron = require('node-cron');
const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');
const logger = require('./logger');
const keyStore = require('./keyStore');
const { runPipeline } = require('./pipeline');
const summarizer = require('./summarizer');
const formatter = require('./formatter');
const { getKstIsoDate } = formatter;

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const BOT_START_TIME = Date.now();
let lastPipelineRun = null;
let isRunning = false;
let cronJob = null;
let dailyResetCronJob = null;

const cooldowns = new Map();
const SAFE_ALLOWED_MENTIONS = { parse: [] };
const URL_EXTRACT_TIMEOUT_MS = 10_000;

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

// cooldowns Map에서 만료된 항목을 정리하는 함수 (메모리 누수 방지)
function cleanupCooldowns() {
  const now = Date.now();
  const cdMs = (config.get('cooldown') || 300) * 1000;
  for (const [userId, lastUsed] of cooldowns.entries()) {
    if (now - lastUsed >= cdMs) {
      cooldowns.delete(userId);
    }
  }
}

// ──────────────────────────────────────────────
// Slash Command Definitions
// ──────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('trend')
    .setDescription('전체 소스 트렌드 수집+요약')
    .addStringOption((o) => o.setName('date').setDescription('조회 날짜 (YYYY-MM-DD)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('source')
    .setDescription('URL 분석 리포트 생성')
    .addStringOption((o) =>
      o.setName('url').setDescription('요약할 URL').setRequired(true)),
  new SlashCommandBuilder()
    .setName('apikey')
    .setDescription('Gemini API 키 관리')
    .addSubcommand((s) => s.setName('set').setDescription('API 키 등록').addStringOption((o) => o.setName('key').setDescription('Gemini API 키').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('키 등록 상태 확인'))
    .addSubcommand((s) => s.setName('remove').setDescription('등록된 키 삭제')),
  new SlashCommandBuilder().setName('status').setDescription('봇 상태 확인'),
  new SlashCommandBuilder().setName('logs').setDescription('최근 로그 조회 (관리자 전용)'),
  new SlashCommandBuilder().setName('quota').setDescription('Gemini API 사용량 확인'),
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('봇 설정 변경 (관리자 전용)')
    .addSubcommand((s) =>
      s.setName('time').setDescription('자동 전송 시간 변경')
        .addStringOption((o) => o.setName('value').setDescription('시간 (예: 09:00)').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('channel').setDescription('전송 채널 지정')
        .addChannelOption((o) => o.setName('target').setDescription('트렌드를 전송할 채널').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) =>
      s.setName('sources').setDescription('소스 ON/OFF')
        .addStringOption((o) => o.setName('name').setDescription('소스').setRequired(true)
          .addChoices(
            { name: 'HackerNews', value: 'hackernews' },
            { name: 'Reddit', value: 'reddit' },
            { name: 'GitHub', value: 'github' },
            { name: 'HuggingFace', value: 'huggingface' },
          ))
        .addStringOption((o) => o.setName('toggle').setDescription('상태').setRequired(true)
          .addChoices({ name: 'ON', value: 'on' }, { name: 'OFF', value: 'off' })))
    .addSubcommand((s) =>
      s.setName('cooldown').setDescription('쿨다운 설정 (초)')
        .addIntegerOption((o) => o.setName('seconds').setDescription('60~600초').setRequired(true).setMinValue(60).setMaxValue(600)))
    .addSubcommand((s) =>
      s.setName('language').setDescription('요약 언어 변경')
        .addStringOption((o) => o.setName('lang').setDescription('언어').setRequired(true)
          .addChoices({ name: '한국어', value: 'ko' }, { name: 'English', value: 'en' })))
    .addSubcommand((s) =>
      s.setName('gemini_rpd').setDescription('Gemini 일일 쿼터 한도')
        .addIntegerOption((o) => o.setName('limit').setDescription('10~500').setRequired(true).setMinValue(10).setMaxValue(500))),
  new SlashCommandBuilder()
    .setName('reddit')
    .setDescription('Reddit OAuth 인증 관리')
    .addSubcommand((s) =>
      s.setName('login').setDescription('Reddit OAuth 등록')
        .addStringOption((o) => o.setName('client_id').setDescription('Reddit App Client ID').setRequired(true))
        .addStringOption((o) => o.setName('client_secret').setDescription('Reddit App Secret').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Reddit OAuth 상태 확인'))
    .addSubcommand((s) => s.setName('remove').setDescription('Reddit OAuth 인증 해제')),
  new SlashCommandBuilder().setName('help').setDescription('명령어 목록 및 사용법 안내'),
];

// ──────────────────────────────────────────────
// SSRF Prevention
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// Cooldown
// ──────────────────────────────────────────────

const COOLDOWN_COMMANDS = new Set(['trend', 'source']);

function checkCooldown(userId, commandName) {
  if (!COOLDOWN_COMMANDS.has(commandName)) return null;

  const now = Date.now();
  const lastUsed = cooldowns.get(userId);
  const cdMs = (config.get('cooldown') || 300) * 1000;

  if (lastUsed && now - lastUsed < cdMs) {
    const remaining = Math.ceil((cdMs - (now - lastUsed)) / 1000);
    return remaining;
  }

  cooldowns.set(userId, now);
  return null;
}

// ──────────────────────────────────────────────
// Date Validation
// ──────────────────────────────────────────────

function validateDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { valid: false, error: '📅 날짜 형식이 올바르지 않습니다. 예: 2026-02-25' };
  }
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) {
    return { valid: false, error: '📅 날짜 형식이 올바르지 않습니다. 예: 2026-02-25' };
  }

  const today = new Date(`${getKstIsoDate()}T00:00:00Z`);

  if (d.getTime() > today.getTime()) {
    return { valid: false, error: '📅 미래 날짜는 조회할 수 없습니다. 오늘 또는 과거 날짜를 입력해주세요.' };
  }

  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000);
  if (d.getTime() < thirtyDaysAgo.getTime()) {
    return { valid: false, error: '📅 최대 30일 전까지만 조회할 수 있습니다.' };
  }

  return { valid: true };
}

// ──────────────────────────────────────────────
// Cron Helpers
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// Log Rotation
// ──────────────────────────────────────────────

function cleanupOldLogs(retentionDays = 30) {
  try {
    if (!fs.existsSync(LOGS_DIR)) return;
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const patterns = [/^result_(.+)\.json$/, /^gemini_usage_(.+)\.json$/];
    const parseLogDate = (raw) => {
      const normalized = raw.replace(/\./g, '-');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
      const ts = new Date(`${normalized}T00:00:00Z`).getTime();
      return Number.isNaN(ts) ? null : ts;
    };
    for (const file of fs.readdirSync(LOGS_DIR)) {
      for (const re of patterns) {
        const match = file.match(re);
        const fileTime = match ? parseLogDate(match[1]) : null;
        if (fileTime && fileTime < cutoff) {
          try { fs.unlinkSync(path.join(LOGS_DIR, file)); } catch { /* ignore */ }
        }
      }
    }
  } catch (err) {
    logger.warn(`로그 로테이션 실패: ${err.message}`);
  }
}

// ──────────────────────────────────────────────
// Restart Notice
// ──────────────────────────────────────────────

function shouldSendRestartNotice() {
  const noticePath = path.join(LOGS_DIR, 'last_restart_notice.txt');
  try {
    if (fs.existsSync(noticePath)) {
      const lastNotice = parseInt(fs.readFileSync(noticePath, 'utf-8').trim(), 10);
      if (Date.now() - lastNotice < 10 * 60 * 1000) return false;
    }
  } catch { /* proceed */ }

  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.writeFileSync(noticePath, String(Date.now()), 'utf-8');
  } catch { /* ignore */ }

  return true;
}

// ──────────────────────────────────────────────
// Command Handlers
// ──────────────────────────────────────────────

async function handleTrend(interaction) {
  const dateOpt = interaction.options.getString('date');
  const userId = interaction.user.id;

  if (dateOpt) {
    const v = validateDate(dateOpt);
    if (!v.valid) return interaction.reply(safePayload({ content: v.error, ephemeral: true }));
  }

  if (isRunning) {
    return interaction.reply(safePayload({ content: '🔄 현재 트렌드 수집이 진행 중입니다. 완료 후 다시 시도해주세요.', ephemeral: true }));
  }

  // isRunning을 deferReply 이전에 설정하여 레이스 컨디션 방지
  isRunning = true;
  try {
    await interaction.deferReply();

    const apiKey = keyStore.getKey(userId);
    const date = dateOpt || undefined;
    const todayKst = getKstIsoDate();
    const isPast = !!dateOpt && dateOpt < todayKst;

    const sources = isPast
      ? { hackernews: true, reddit: false, github: false, huggingface: true }
      : config.get('sources');

    const redditCred = keyStore.getReddit(userId);
    const result = await runPipeline({ date, sources, userId, apiKey, redditCredentials: redditCred });
    lastPipelineRun = new Date().toISOString();

    for (let i = 0; i < result.messages.length; i++) {
      const msgOpts = safePayload({ content: result.messages[i], flags: MessageFlags.SuppressEmbeds });
      if (i === 0) await interaction.editReply(msgOpts);
      else await interaction.channel.send(msgOpts);
    }

    if (isPast) {
      await interaction.followUp(safeContent('ℹ️ Reddit, GitHub Trending은 과거 날짜 조회를 지원하지 않아 생략되었습니다.'));
    }

    if (!apiKey) {
      await interaction.followUp(safeContent('🔑 Gemini 요약을 사용하려면 /apikey set으로 API 키를 등록해주세요.'));
    } else {
      keyStore.incrementUsage(userId, '/trend');
      const warnLevel = keyStore.getQuotaWarningLevel(userId);
      if (warnLevel === 'warning') {
        const u = keyStore.getUsage(userId);
        await interaction.followUp(safePayload({ content: `⚠️ 오늘 Gemini API 사용량 80% 도달 (${u.count}/${config.get('geminiRpd')} RPD)`, ephemeral: true }));
      } else if (warnLevel === 'exceeded') {
        await interaction.followUp(safePayload({ content: '⚠️ Gemini API 일일 한도에 도달했습니다. 내일 재시도해주세요.', ephemeral: true }));
      }
    }
  } catch (err) {
    logger.error(`/trend 실패: ${err.message}`);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(safeContent(`❌ 트렌드 수집에 실패했습니다: ${err.message}`));
      } else {
        await interaction.reply(safePayload({ content: `❌ 트렌드 수집에 실패했습니다: ${err.message}`, ephemeral: true }));
      }
    } catch { /* ignore response error */ }
  } finally {
    isRunning = false;
  }
}

async function handleSource(interaction) {
  const urlStr = interaction.options.getString('url');
  const userId = interaction.user.id;

  if (!keyStore.hasKey(userId)) {
    return interaction.reply(safePayload({ content: '🔑 URL 요약을 사용하려면 /apikey set으로 Gemini API 키를 등록해주세요.', ephemeral: true }));
  }
  if (keyStore.isQuotaExceeded(userId)) {
    return interaction.reply(safePayload({ content: '⚠️ Gemini API 일일 한도에 도달했습니다. 내일 재시도해주세요.', ephemeral: true }));
  }
  if (!/^https?:\/\//i.test(urlStr)) {
    return interaction.reply(safePayload({ content: '🔗 유효한 URL을 입력해주세요. (http:// 또는 https://)', ephemeral: true }));
  }

  await interaction.deferReply();

  try {
    const safe = await isSafeUrl(urlStr);
    if (!safe) {
      return interaction.editReply(safeContent('🔒 내부 네트워크 주소는 접근할 수 없습니다.'));
    }

    const { extract } = require('@extractus/article-extractor');
    const article = await withTimeout(extract(urlStr), URL_EXTRACT_TIMEOUT_MS, 'URL 본문 추출 시간 초과');

    if (!article || !article.content) {
      return interaction.editReply(safeContent('📄 페이지 본문을 추출할 수 없습니다. 다른 URL을 시도해주세요.'));
    }

    const text = article.content.replace(/<[^>]+>/g, '').slice(0, 10_000);
    const apiKey = keyStore.getKey(userId);
    const report = await summarizer.summarizeUrl(text, apiKey, config.get('language'));

    keyStore.incrementUsage(userId, '/source');

    const reportMessages = formatter.formatSummarizeReport(report);
    for (let i = 0; i < reportMessages.length; i++) {
      const msgOpts = safePayload({ content: reportMessages[i], flags: MessageFlags.SuppressEmbeds });
      if (i === 0) await interaction.editReply(msgOpts);
      else await interaction.channel.send(msgOpts);
    }

    const warnLevel = keyStore.getQuotaWarningLevel(userId);
    if (warnLevel === 'warning') {
      const u = keyStore.getUsage(userId);
      await interaction.followUp(safePayload({ content: `⚠️ 오늘 Gemini API 사용량 80% 도달 (${u.count}/${config.get('geminiRpd')} RPD)`, ephemeral: true }));
    } else if (warnLevel === 'exceeded') {
      await interaction.followUp(safePayload({ content: '⚠️ Gemini API 일일 한도에 도달했습니다. 내일 재시도해주세요.', ephemeral: true }));
    }
  } catch (err) {
    if (err.code === 'QUOTA_EXCEEDED') {
      return interaction.editReply(safeContent('⚠️ Gemini API 일일 한도에 도달했습니다. 내일 재시도해주세요.'));
    }
    logger.error(`/source 실패: ${err.message}`);
    await interaction.editReply(safeContent(`❌ URL 분석에 실패했습니다: ${err.message}`));
  }
}

async function handleApiKey(interaction) {
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  if (sub === 'set') {
    const apiKeyVal = interaction.options.getString('key');
    await interaction.deferReply({ ephemeral: true });

    const valid = await summarizer.validateKey(apiKeyVal);
    if (!valid) {
      return interaction.editReply(safeContent('❌ 유효하지 않은 API 키입니다. AI Studio에서 키를 확인해주세요.'));
    }

    keyStore.setKey(userId, apiKeyVal);
    return interaction.editReply(safeContent('✅ Gemini API 키가 등록되었습니다. /trend, /source 명령어를 사용할 수 있습니다.'));
  }

  if (sub === 'status') {
    if (keyStore.hasKey(userId)) {
      const u = keyStore.getUsage(userId);
      const preview = keyStore.getKeyPreview(userId);
      const lastUsed = u.lastUsedAt ? new Date(u.lastUsedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) + ' KST' : '없음';
      const lastCmd = u.lastCommand || '';
      return interaction.reply(safePayload({ content: `🔑 API 키 등록됨 | 마지막 사용: ${lastUsed} (${lastCmd}) | 키: ${preview}`, ephemeral: true }));
    }
    return interaction.reply(safePayload({ content: '🔑 API 키 미등록 | /apikey set으로 등록해주세요.', ephemeral: true }));
  }

  if (sub === 'remove') {
    if (keyStore.removeKey(userId)) {
      return interaction.reply(safePayload({ content: '🗑️ API 키가 삭제되었습니다.', ephemeral: true }));
    }
    return interaction.reply(safePayload({ content: '🔑 등록된 API 키가 없습니다.', ephemeral: true }));
  }
}

async function handleStatus(interaction) {
  const ping = interaction.client.ws.ping;
  const uptime = formatUptime(Date.now() - BOT_START_TIME);

  const activeSources = Object.entries(config.get('sources'))
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ');

  const channelId = config.get('channel');
  const channelStatus = channelId ? `<#${channelId}>` : '⚠️ 미설정 (/config channel로 설정)';

  const msg = formatter.formatStatusMessage({
    ping,
    uptime,
    lastRun: lastPipelineRun || '없음',
    activeSources: activeSources || '없음',
    keyCount: keyStore.getKeyCount(),
    channel: channelStatus,
  });
  return interaction.reply(safeContent(msg));
}

async function handleLogs(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(safePayload({ content: '🔒 관리자만 사용할 수 있는 명령어입니다.', ephemeral: true }));
  }

  const today = getKstIsoDate();
  const filePath = path.join(LOGS_DIR, `result_${today}.json`);

  if (!fs.existsSync(filePath)) {
    return interaction.reply(safePayload({ content: '📭 오늘의 로그가 없습니다.', ephemeral: true }));
  }

  const attachment = new AttachmentBuilder(filePath, { name: `result_${today}.json` });
  return interaction.reply(safePayload({ files: [attachment] }));
}

async function handleQuota(interaction) {
  const userId = interaction.user.id;

  if (!keyStore.hasKey(userId)) {
    return interaction.reply(safePayload({ content: '🔑 API 키가 등록되지 않았습니다. /apikey set으로 등록해주세요.', ephemeral: true }));
  }

  const u = keyStore.getUsage(userId);
  const rpd = config.get('geminiRpd') || 50;
  const remaining = Math.max(0, rpd - u.count);
  const lastCall = u.lastUsedAt
    ? new Date(u.lastUsedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) + ` KST (${u.lastCommand})`
    : '없음';

  return interaction.reply(safePayload({
    content: `📊 내 Gemini API 사용량 (오늘)\n• 호출: ${u.count} / ${rpd} RPD\n• 잔여: ${remaining}회\n• 마지막 호출: ${lastCall}`,
    ephemeral: true,
  }));
}

async function handleConfig(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(safePayload({ content: '🔒 관리자만 사용할 수 있는 명령어입니다.', ephemeral: true }));
  }

  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'time': {
      const value = interaction.options.getString('value');
      if (!/^\d{2}:\d{2}$/.test(value)) {
        return interaction.reply(safePayload({ content: '⚙️ HH:MM 형식으로 입력해주세요. (예: 09:00)', ephemeral: true }));
      }
      const [h, m] = value.split(':').map(Number);
      if (h < 0 || h > 23 || m < 0 || m > 59) {
        return interaction.reply(safePayload({ content: '⚙️ 시간: 00-23, 분: 00-59 범위로 입력해주세요.', ephemeral: true }));
      }
      const oldVal = config.get('time');
      config.set('time', value);
      restartCron();
      return interaction.reply(safeContent(`⚙️ 설정 변경 완료: time ${oldVal} → ${value}`));
    }

    case 'channel': {
      const ch = interaction.options.getChannel('target');
      const oldCh = config.get('channel');
      config.set('channel', ch.id);
      return interaction.reply(safeContent(`⚙️ 전송 채널 설정 완료: ${oldCh ? `<#${oldCh}>` : '(미설정)'} → <#${ch.id}>`));
    }

    case 'sources': {
      const srcName = interaction.options.getString('name');
      const toggle = interaction.options.getString('toggle');
      const sources = config.get('sources');
      const oldState = sources[srcName] ? 'on' : 'off';
      sources[srcName] = toggle === 'on';
      config.set('sources', sources);
      return interaction.reply(safeContent(`⚙️ 설정 변경 완료: ${srcName} ${oldState} → ${toggle}`));
    }

    case 'cooldown': {
      const seconds = interaction.options.getInteger('seconds');
      const oldCd = config.get('cooldown');
      config.set('cooldown', seconds);
      return interaction.reply(safeContent(`⚙️ 설정 변경 완료: cooldown ${oldCd} → ${seconds}초`));
    }

    case 'language': {
      const lang = interaction.options.getString('lang');
      const oldLang = config.get('language');
      config.set('language', lang);
      return interaction.reply(safeContent(`⚙️ 설정 변경 완료: language ${oldLang} → ${lang}`));
    }

    case 'gemini_rpd': {
      const limit = interaction.options.getInteger('limit');
      const oldRpd = config.get('geminiRpd');
      config.set('geminiRpd', limit);
      return interaction.reply(safeContent(`⚙️ 설정 변경 완료: gemini_rpd ${oldRpd} → ${limit}`));
    }

    default:
      return interaction.reply(safePayload({ content: '⚙️ 알 수 없는 설정 항목입니다.', ephemeral: true }));
  }
}

async function handleReddit(interaction) {
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  if (sub === 'login') {
    const clientId = interaction.options.getString('client_id');
    const clientSecret = interaction.options.getString('client_secret');

    await interaction.deferReply({ ephemeral: true });

    try {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const res = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'TrendLens/1.0',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return interaction.editReply(safeContent('❌ Reddit 인증 실패: Client ID 또는 Secret이 올바르지 않습니다.'));
      }

      const data = await res.json();
      if (!data.access_token) {
        return interaction.editReply(safeContent('❌ Reddit 인증 실패: 토큰을 발급받지 못했습니다.'));
      }

      keyStore.setReddit(userId, clientId, clientSecret);
      return interaction.editReply(safeContent('✅ Reddit OAuth 인증이 등록되었습니다. /trend 명령어에서 안정적인 수집이 가능합니다.'));
    } catch (err) {
      logger.warn(`[Reddit] OAuth 검증 실패: ${err.message}`);
      return interaction.editReply(safeContent(`❌ Reddit 인증 검증 중 오류: ${err.message}`));
    }
  }

  if (sub === 'status') {
    if (keyStore.hasReddit(userId)) {
      const preview = keyStore.getRedditPreview(userId);
      return interaction.reply(safePayload({ content: `🔗 Reddit OAuth 등록됨 | Client ID: ${preview}`, ephemeral: true }));
    }
    return interaction.reply(safePayload({ content: '🔗 Reddit OAuth 미등록 | `/reddit login`으로 등록해주세요.\n비인증 모드에서도 동작하지만 429 차단 가능성이 있습니다.', ephemeral: true }));
  }

  if (sub === 'remove') {
    if (keyStore.removeReddit(userId)) {
      return interaction.reply(safePayload({ content: '🗑️ Reddit OAuth 인증이 해제되었습니다.', ephemeral: true }));
    }
    return interaction.reply(safePayload({ content: '🔗 등록된 Reddit 인증이 없습니다.', ephemeral: true }));
  }
}

async function handleHelp(interaction) {
  const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━━━━━';
  const text = [
    '📖 TrendLens 명령어 안내',
    SEPARATOR,
    '',
    '**🔥 트렌드**',
    '`/trend [date]` — 전체 소스 트렌드 수집 + AI 요약',
    '`/source <url>` — URL 상세 분석 리포트 생성 (API 키 필요)',
    '',
    '**🔑 API 키 관리**',
    '`/apikey set <key>` — Gemini API 키 등록',
    '`/apikey status` — 키 등록 상태 확인',
    '`/apikey remove` — 등록된 키 삭제',
    '',
    '**🔗 Reddit 인증**',
    '`/reddit login <id> <secret>` — 내 Reddit OAuth 등록',
    '`/reddit status` — 인증 상태 확인',
    '`/reddit remove` — 인증 해제',
    '',
    '**📊 모니터링**',
    '`/status` — 봇 상태 (핑, 업타임, 채널 등)',
    '`/quota` — 내 Gemini API 사용량 확인',
    '`/logs` — 오늘의 실행 로그 조회 (관리자)',
    '',
    '**⚙️ 설정 (관리자)**',
    '`/config time <HH:MM>` — 자동 전송 시간 변경',
    '`/config channel <#채널>` — 전송 채널 지정 (채널 선택 UI)',
    '`/config sources <소스> <ON|OFF>` — 소스 ON/OFF',
    '`/config cooldown <초>` — 쿨다운 60~600초',
    '`/config language <언어>` — 요약 언어 (한국어/English)',
    '`/config gemini_rpd <한도>` — 일일 쿼터 10~500',
    '',
    SEPARATOR,
    '💡 처음 사용 시: `/config channel` → `/apikey set` → `/trend`',
  ].join('\n');

  return interaction.reply(safePayload({ content: text, ephemeral: true }));
}

// ──────────────────────────────────────────────
// Command Dispatcher
// ──────────────────────────────────────────────

const handlers = {
  trend: handleTrend,
  source: handleSource,
  apikey: handleApiKey,
  status: handleStatus,
  logs: handleLogs,
  quota: handleQuota,
  config: handleConfig,
  reddit: handleReddit,
  help: handleHelp,
};

// ──────────────────────────────────────────────
// Bot Client
// ──────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  logger.info(`봇 로그인 완료: ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID),
      { body: commands.map((c) => c.toJSON()) },
    );
    logger.info('슬래시 명령어 등록 완료');
  } catch (err) {
    logger.error(`명령어 등록 실패: ${err.message}`);
  }

  config.load();
  keyStore.restoreFromDisk();
  cleanupOldLogs();

  if (shouldSendRestartNotice()) {
    try {
      const channelId = config.get('channel');
      if (channelId) {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) {
          await ch.send(safeContent('🔄 봇이 재시작되었습니다. API 키를 등록하신 분은 /apikey set으로 재등록해주세요.'));
        }
      }
    } catch (err) {
      logger.warn(`재시작 공지 전송 실패: ${err.message}`);
    }
  }

  startCron();
  startDailyResetCron();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmdName = interaction.commandName;
  const userId = interaction.user.id;

  const cdRemaining = checkCooldown(userId, cmdName);
  if (cdRemaining !== null) {
    return interaction.reply(safePayload({ content: `⏳ 쿨다운 중입니다. ${cdRemaining}초 후 다시 시도해주세요.`, ephemeral: true }));
  }

  const handler = handlers[cmdName];
  if (handler) {
    try {
      await handler(interaction);
    } catch (err) {
      logger.error(`[${cmdName}] 처리 실패: ${err.message}`);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(safeContent(`❌ 오류가 발생했습니다: ${err.message}`));
        } else {
          await interaction.reply(safePayload({ content: `❌ 오류가 발생했습니다: ${err.message}`, ephemeral: true }));
        }
      } catch { /* ignore response error */ }
    }
  }
});

// ──────────────────────────────────────────────
// Cron Scheduler
// ──────────────────────────────────────────────

function startCron() {
  const timeStr = config.get('time') || '09:00';
  cronJob = cron.schedule(toCronExpr(timeStr), async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const channelId = config.get('channel');
      if (!channelId) {
        logger.warn('스케줄 실행 생략: 전송 채널 미설정 (/config channel로 설정해주세요)');
        return;
      }
      const cronRedditCred = keyStore.getAnyRedditCredentials();
      const cronApiKey = keyStore.getAnyKey();
      const result = await runPipeline({ sources: config.get('sources'), apiKey: cronApiKey, redditCredentials: cronRedditCred });
      lastPipelineRun = new Date().toISOString();
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        for (const msg of result.messages) {
          await channel.send(safePayload({ content: msg, flags: MessageFlags.SuppressEmbeds }));
        }
      } else {
        logger.warn(`스케줄 전송 실패: 채널 ${channelId}을 찾을 수 없습니다`);
      }
    } catch (err) {
      logger.error(`스케줄 실행 실패: ${err.message}`);
      try {
        const channelId = config.get('channel');
        const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
        if (channel) await channel.send(safeContent(`❌ 자동 트렌드 수집에 실패했습니다: ${err.message}`));
      } catch { /* ignore */ }
    } finally {
      isRunning = false;
    }
  }, { timezone: 'Asia/Seoul' });

  logger.info(`Cron 스케줄러 시작: ${timeStr} KST`);
}

function startDailyResetCron() {
  // 일일 리셋 크론은 봇 시작 시 1회만 등록 (restartCron에서 재등록하지 않음)
  if (dailyResetCronJob) return;
  dailyResetCronJob = cron.schedule('0 0 * * *', () => {
    keyStore.resetDailyUsage();
    cleanupOldLogs();
    cleanupCooldowns();
  }, { timezone: 'UTC' });
}

function restartCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
  startCron();
}

// ──────────────────────────────────────────────
// Graceful Shutdown
// ──────────────────────────────────────────────

async function shutdown(signal) {
  logger.info(`${signal} 수신 — 봇 종료 중...`);
  try {
    if (cronJob) { cronJob.stop(); }
    if (dailyResetCronJob) { dailyResetCronJob.stop(); }
    client.destroy();
  } catch (err) {
    logger.warn(`종료 처리 중 오류: ${err.message}`);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────

client.login(process.env.DISCORD_BOT_TOKEN);
