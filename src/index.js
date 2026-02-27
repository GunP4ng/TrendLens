require('dotenv').config();

// ──────────────────────────────────────────────
// 필수 환경변수 검증 (시작 시 즉시 실패)
// ──────────────────────────────────────────────
const REQUIRED_ENV = ['DISCORD_BOT_TOKEN'];
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
const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');
const logger = require('./logger');
const keyStore = require('./keyStore');
const { runPipeline } = require('./pipeline');
const summarizer = require('./summarizer');
const formatter = require('./formatter');
const { getKstIsoDate } = formatter;
const {
  safePayload, safeContent, withTimeout,
  isSafeUrl,
  toCronExpr, formatUptime, validateDate,
} = require('./utils');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const BOT_START_TIME = Date.now();

// 서버별 상태 관리
const runningGuilds = new Set();        // guildId 단위 실행 잠금
const guildCronJobs = new Map();        // guildId → CronJob
const lastGuildPipelineRun = new Map(); // guildId → ISO timestamp

let dailyResetCronJob = null;

const cooldowns = new Map();            // `${guildId}:${userId}` → timestamp
const URL_EXTRACT_TIMEOUT_MS = 10_000;

// cooldowns Map에서 만료된 항목 정리 (메모리 누수 방지)
function cleanupCooldowns() {
  const now = Date.now();
  const maxCdMs = 600 * 1000; // 최대 쿨다운 값
  for (const [key, lastUsed] of cooldowns.entries()) {
    if (now - lastUsed >= maxCdMs) {
      cooldowns.delete(key);
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
    .setDescription('Gemini API 키 관리 (등록/삭제는 관리자 전용)')
    .addSubcommand((s) => s.setName('set').setDescription('API 키 등록 [관리자]').addStringOption((o) => o.setName('key').setDescription('Gemini API 키').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('키 등록 상태 확인'))
    .addSubcommand((s) => s.setName('remove').setDescription('등록된 키 삭제 [관리자]')),
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
    .setDescription('Reddit OAuth 인증 관리 (등록/해제는 관리자 전용)')
    .addSubcommand((s) =>
      s.setName('login').setDescription('Reddit OAuth 등록 [관리자]')
        .addStringOption((o) => o.setName('client_id').setDescription('Reddit App Client ID').setRequired(true))
        .addStringOption((o) => o.setName('client_secret').setDescription('Reddit App Secret').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Reddit OAuth 상태 확인'))
    .addSubcommand((s) => s.setName('remove').setDescription('Reddit OAuth 인증 해제 [관리자]')),
  new SlashCommandBuilder().setName('help').setDescription('명령어 목록 및 사용법 안내'),
];

// ──────────────────────────────────────────────
// Cooldown
// ──────────────────────────────────────────────

const COOLDOWN_COMMANDS = new Set(['trend', 'source']);

function checkCooldown(userId, guildId, commandName) {
  if (!COOLDOWN_COMMANDS.has(commandName)) return null;

  const now = Date.now();
  const key = `${guildId}:${userId}`;
  const lastUsed = cooldowns.get(key);
  const cdMs = (config.get(guildId, 'cooldown') || 300) * 1000;

  if (lastUsed && now - lastUsed < cdMs) {
    const remaining = Math.ceil((cdMs - (now - lastUsed)) / 1000);
    return remaining;
  }

  cooldowns.set(key, now);
  return null;
}

// ──────────────────────────────────────────────
// Log Rotation
// ──────────────────────────────────────────────

function cleanupOldLogs(retentionDays = 30) {
  try {
    if (!fs.existsSync(LOGS_DIR)) return;
    const cutoff = Date.now() - retentionDays * 86_400_000;
    // result 파일: result_{date}_{guildId}.json 또는 result_{date}.json (레거시)
    const patterns = [
      /^result_(\d{4}-\d{2}-\d{2})(?:_.+)?\.json$/,
      /^gemini_usage_(\d{4}-\d{2}-\d{2})\.json$/,
    ];
    const parseLogDate = (dateStr) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
      const ts = new Date(`${dateStr}T00:00:00Z`).getTime();
      return Number.isNaN(ts) ? null : ts;
    };
    for (const file of fs.readdirSync(LOGS_DIR)) {
      for (const re of patterns) {
        const match = file.match(re);
        const fileTime = match ? parseLogDate(match[1]) : null;
        if (fileTime && fileTime < cutoff) {
          try { fs.unlinkSync(path.join(LOGS_DIR, file)); } catch (e) { logger.warn(`로그 파일 삭제 실패 (${file}): ${e.message}`); }
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
  } catch (e) { logger.warn(`재시작 공지 상태 읽기 실패: ${e.message}`); }

  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.writeFileSync(noticePath, String(Date.now()), 'utf-8');
  } catch (e) { logger.warn(`재시작 공지 상태 기록 실패: ${e.message}`); }

  return true;
}

// ──────────────────────────────────────────────
// Command Handlers
// ──────────────────────────────────────────────

async function handleTrend(interaction) {
  const guildId = interaction.guildId;
  const dateOpt = interaction.options.getString('date');

  if (dateOpt) {
    const v = validateDate(dateOpt, getKstIsoDate());
    if (!v.valid) return interaction.reply(safePayload({ content: v.error, ephemeral: true }));
  }

  if (runningGuilds.has(guildId)) {
    return interaction.reply(safePayload({ content: '🔄 현재 트렌드 수집이 진행 중입니다. 완료 후 다시 시도해주세요.', ephemeral: true }));
  }

  // deferReply 이전에 잠금 설정하여 레이스 컨디션 방지
  runningGuilds.add(guildId);
  try {
    await interaction.deferReply();

    const apiKey = keyStore.getGuildKey(guildId);
    const date = dateOpt || undefined;
    const todayKst = getKstIsoDate();
    const isPast = !!dateOpt && dateOpt < todayKst;

    const sources = isPast
      ? { hackernews: true, reddit: false, github: false, huggingface: true }
      : config.get(guildId, 'sources');

    const redditCred = keyStore.getGuildReddit(guildId);
    const result = await runPipeline({ date, sources, guildId, apiKey, redditCredentials: redditCred, triggeredBy: 'command' });
    lastGuildPipelineRun.set(guildId, new Date().toISOString());

    for (let i = 0; i < result.messages.length; i++) {
      const msgOpts = safePayload({ content: result.messages[i], flags: MessageFlags.SuppressEmbeds });
      if (i === 0) await interaction.editReply(msgOpts);
      else await interaction.channel.send(msgOpts);
    }

    if (isPast) {
      await interaction.followUp(safeContent('ℹ️ Reddit, GitHub Trending은 과거 날짜 조회를 지원하지 않아 생략되었습니다.'));
    }

    if (!apiKey) {
      await interaction.followUp(safeContent('🔑 AI 요약을 사용하려면 서버 관리자에게 /apikey set 등록을 요청해주세요.'));
    } else {
      keyStore.incrementGuildUsage(guildId, '/trend');
      const warnLevel = keyStore.getGuildQuotaWarningLevel(guildId);
      if (warnLevel === 'warning') {
        const u = keyStore.getGuildUsage(guildId);
        await interaction.followUp(safePayload({ content: `⚠️ 오늘 Gemini API 사용량 80% 도달 (${u.count}/${config.get(guildId, 'geminiRpd')} RPD)`, ephemeral: true }));
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
    } catch (replyErr) { logger.warn(`/trend 오류 응답 전송 실패: ${replyErr.message}`); }
  } finally {
    runningGuilds.delete(guildId);
  }
}

async function handleSource(interaction) {
  const guildId = interaction.guildId;
  const urlStr = interaction.options.getString('url');

  if (!keyStore.hasGuildKey(guildId)) {
    return interaction.reply(safePayload({ content: '🔑 URL 요약을 사용하려면 서버 관리자에게 /apikey set 등록을 요청해주세요.', ephemeral: true }));
  }
  if (keyStore.isGuildQuotaExceeded(guildId)) {
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
    const apiKey = keyStore.getGuildKey(guildId);
    const report = await summarizer.summarizeUrl(text, apiKey, config.get(guildId, 'language'));

    keyStore.incrementGuildUsage(guildId, '/source');

    const reportMessages = formatter.formatSummarizeReport(report);
    for (let i = 0; i < reportMessages.length; i++) {
      const msgOpts = safePayload({ content: reportMessages[i], flags: MessageFlags.SuppressEmbeds });
      if (i === 0) await interaction.editReply(msgOpts);
      else await interaction.channel.send(msgOpts);
    }

    const warnLevel = keyStore.getGuildQuotaWarningLevel(guildId);
    if (warnLevel === 'warning') {
      const u = keyStore.getGuildUsage(guildId);
      await interaction.followUp(safePayload({ content: `⚠️ 오늘 Gemini API 사용량 80% 도달 (${u.count}/${config.get(guildId, 'geminiRpd')} RPD)`, ephemeral: true }));
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
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  if (sub === 'set') {
    if (!isAdmin) {
      return interaction.reply(safePayload({ content: '🔒 API 키 등록은 서버 관리자만 사용할 수 있습니다.', ephemeral: true }));
    }
    const apiKeyVal = interaction.options.getString('key');
    await interaction.deferReply({ ephemeral: true });

    const valid = await summarizer.validateKey(apiKeyVal);
    if (!valid) {
      return interaction.editReply(safeContent('❌ 유효하지 않은 API 키입니다. AI Studio에서 키를 확인해주세요.'));
    }

    keyStore.setGuildKey(guildId, apiKeyVal);
    return interaction.editReply(safeContent('✅ 서버 Gemini API 키가 등록되었습니다. 이 서버의 모든 멤버가 /trend, /source 명령어를 사용할 수 있습니다.'));
  }

  if (sub === 'status') {
    if (keyStore.hasGuildKey(guildId)) {
      const u = keyStore.getGuildUsage(guildId);
      const preview = keyStore.getGuildKeyPreview(guildId);
      const lastUsed = u.lastUsedAt
        ? new Date(u.lastUsedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) + ' KST'
        : '없음';
      const lastCmd = u.lastCommand || '';
      return interaction.reply(safePayload({ content: `🔑 서버 API 키 등록됨 | 오늘 사용: ${u.count}회 | 마지막: ${lastUsed} (${lastCmd}) | 키: ${preview}`, ephemeral: true }));
    }
    return interaction.reply(safePayload({ content: '🔑 서버 API 키 미등록 | 관리자에게 /apikey set 등록을 요청하세요.', ephemeral: true }));
  }

  if (sub === 'remove') {
    if (!isAdmin) {
      return interaction.reply(safePayload({ content: '🔒 API 키 삭제는 서버 관리자만 사용할 수 있습니다.', ephemeral: true }));
    }
    if (keyStore.removeGuildKey(guildId)) {
      return interaction.reply(safePayload({ content: '🗑️ 서버 API 키가 삭제되었습니다.', ephemeral: true }));
    }
    return interaction.reply(safePayload({ content: '🔑 등록된 서버 API 키가 없습니다.', ephemeral: true }));
  }
}

async function handleStatus(interaction) {
  const guildId = interaction.guildId;
  const ping = interaction.client.ws.ping;
  const uptime = formatUptime(Date.now() - BOT_START_TIME);

  const sources = config.get(guildId, 'sources') || {};
  const activeSources = Object.entries(sources)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ');

  const channelId = config.get(guildId, 'channel');
  const channelStatus = channelId ? `<#${channelId}>` : '⚠️ 미설정 (/config channel로 설정)';

  const lastRun = lastGuildPipelineRun.get(guildId) || '없음';

  const msg = formatter.formatStatusMessage({
    ping,
    uptime,
    lastRun,
    activeSources: activeSources || '없음',
    keyCount: keyStore.hasGuildKey(guildId) ? 1 : 0,
    channel: channelStatus,
  });
  return interaction.reply(safeContent(msg));
}

async function handleLogs(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(safePayload({ content: '🔒 관리자만 사용할 수 있는 명령어입니다.', ephemeral: true }));
  }

  const guildId = interaction.guildId;
  const today = getKstIsoDate();
  const filePath = path.join(LOGS_DIR, `result_${today}_${guildId}.json`);

  if (!fs.existsSync(filePath)) {
    return interaction.reply(safePayload({ content: '📭 오늘의 로그가 없습니다.', ephemeral: true }));
  }

  const attachment = new AttachmentBuilder(filePath, { name: `result_${today}.json` });
  return interaction.reply(safePayload({ files: [attachment] }));
}

async function handleQuota(interaction) {
  const guildId = interaction.guildId;

  if (!keyStore.hasGuildKey(guildId)) {
    return interaction.reply(safePayload({ content: '🔑 이 서버에 API 키가 등록되지 않았습니다. 관리자에게 문의하세요.', ephemeral: true }));
  }

  const u = keyStore.getGuildUsage(guildId);
  const rpd = config.get(guildId, 'geminiRpd') || 50;
  const remaining = Math.max(0, rpd - u.count);
  const lastCall = u.lastUsedAt
    ? new Date(u.lastUsedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) + ` KST (${u.lastCommand})`
    : '없음';

  return interaction.reply(safePayload({
    content: `📊 서버 Gemini API 사용량 (오늘)\n• 호출: ${u.count} / ${rpd} RPD\n• 잔여: ${remaining}회\n• 마지막 호출: ${lastCall}`,
    ephemeral: true,
  }));
}

async function handleConfig(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(safePayload({ content: '🔒 관리자만 사용할 수 있는 명령어입니다.', ephemeral: true }));
  }

  const guildId = interaction.guildId;
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
      const oldVal = config.get(guildId, 'time');
      config.set(guildId, 'time', value);
      restartGuildCron(guildId);
      return interaction.reply(safeContent(`⚙️ 설정 변경 완료: time ${oldVal} → ${value}`));
    }

    case 'channel': {
      const ch = interaction.options.getChannel('target');
      const oldCh = config.get(guildId, 'channel');
      config.set(guildId, 'channel', ch.id);
      startGuildCron(guildId);
      return interaction.reply(safeContent(`⚙️ 전송 채널 설정 완료: ${oldCh ? `<#${oldCh}>` : '(미설정)'} → <#${ch.id}>`));
    }

    case 'sources': {
      const srcName = interaction.options.getString('name');
      const toggle = interaction.options.getString('toggle');
      const sources = config.get(guildId, 'sources');
      const oldState = sources[srcName] ? 'on' : 'off';
      sources[srcName] = toggle === 'on';
      config.set(guildId, 'sources', sources);
      return interaction.reply(safeContent(`⚙️ 설정 변경 완료: ${srcName} ${oldState} → ${toggle}`));
    }

    case 'cooldown': {
      const seconds = interaction.options.getInteger('seconds');
      const oldCd = config.get(guildId, 'cooldown');
      config.set(guildId, 'cooldown', seconds);
      return interaction.reply(safeContent(`⚙️ 설정 변경 완료: cooldown ${oldCd} → ${seconds}초`));
    }

    case 'language': {
      const lang = interaction.options.getString('lang');
      const oldLang = config.get(guildId, 'language');
      config.set(guildId, 'language', lang);
      return interaction.reply(safeContent(`⚙️ 설정 변경 완료: language ${oldLang} → ${lang}`));
    }

    case 'gemini_rpd': {
      const limit = interaction.options.getInteger('limit');
      const oldRpd = config.get(guildId, 'geminiRpd');
      config.set(guildId, 'geminiRpd', limit);
      return interaction.reply(safeContent(`⚙️ 설정 변경 완료: gemini_rpd ${oldRpd} → ${limit}`));
    }

    default:
      return interaction.reply(safePayload({ content: '⚙️ 알 수 없는 설정 항목입니다.', ephemeral: true }));
  }
}

async function handleReddit(interaction) {
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  if (sub === 'login') {
    if (!isAdmin) {
      return interaction.reply(safePayload({ content: '🔒 Reddit OAuth 등록은 서버 관리자만 사용할 수 있습니다.', ephemeral: true }));
    }
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

      keyStore.setGuildReddit(guildId, clientId, clientSecret);
      return interaction.editReply(safeContent('✅ 서버 Reddit OAuth 인증이 등록되었습니다. /trend 명령어에서 안정적인 수집이 가능합니다.'));
    } catch (err) {
      logger.warn(`[Reddit] OAuth 검증 실패: ${err.message}`);
      return interaction.editReply(safeContent(`❌ Reddit 인증 검증 중 오류: ${err.message}`));
    }
  }

  if (sub === 'status') {
    if (keyStore.hasGuildReddit(guildId)) {
      const preview = keyStore.getGuildRedditPreview(guildId);
      return interaction.reply(safePayload({ content: `🔗 서버 Reddit OAuth 등록됨 | Client ID: ${preview}`, ephemeral: true }));
    }
    return interaction.reply(safePayload({ content: '🔗 서버 Reddit OAuth 미등록 | 관리자에게 `/reddit login` 등록을 요청하세요.\n비인증 모드에서도 동작하지만 429 차단 가능성이 있습니다.', ephemeral: true }));
  }

  if (sub === 'remove') {
    if (!isAdmin) {
      return interaction.reply(safePayload({ content: '🔒 Reddit OAuth 해제는 서버 관리자만 사용할 수 있습니다.', ephemeral: true }));
    }
    if (keyStore.removeGuildReddit(guildId)) {
      return interaction.reply(safePayload({ content: '🗑️ 서버 Reddit OAuth 인증이 해제되었습니다.', ephemeral: true }));
    }
    return interaction.reply(safePayload({ content: '🔗 등록된 서버 Reddit 인증이 없습니다.', ephemeral: true }));
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
    '`/source <url>` — URL 상세 분석 리포트 생성 (서버 API 키 필요)',
    '',
    '**🔑 API 키 관리**',
    '`/apikey set <key>` — 서버 Gemini API 키 등록 **[관리자 전용]**',
    '`/apikey status` — 서버 키 등록 상태 및 오늘 사용량 확인',
    '`/apikey remove` — 서버 API 키 삭제 **[관리자 전용]**',
    '',
    '**🔗 Reddit 인증**',
    '`/reddit login <id> <secret>` — 서버 Reddit OAuth 등록 **[관리자 전용]**',
    '`/reddit status` — 인증 상태 확인',
    '`/reddit remove` — 인증 해제 **[관리자 전용]**',
    '',
    '**📊 모니터링**',
    '`/status` — 봇 상태 (핑, 업타임, 채널 등)',
    '`/quota` — 서버 Gemini API 오늘 사용량 확인',
    '`/logs` — 오늘의 실행 로그 조회 **[관리자 전용]**',
    '',
    '**⚙️ 설정 (관리자 전용)**',
    '`/config time <HH:MM>` — 자동 전송 시간 변경',
    '`/config channel <#채널>` — 전송 채널 지정',
    '`/config sources <소스> <ON|OFF>` — 소스 ON/OFF',
    '`/config cooldown <초>` — 쿨다운 60~600초',
    '`/config language <언어>` — 요약 언어 (한국어/English)',
    '`/config gemini_rpd <한도>` — 일일 쿼터 10~500',
    '',
    SEPARATOR,
    '💡 처음 사용 시: `/config channel` → `/apikey set` → `/trend`',
    '💡 API 키 하나로 서버 전체 멤버가 /trend, /source를 사용할 수 있습니다.',
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

  // 명령어 등록: DISCORD_GUILD_ID 있으면 개발용(즉시), 없으면 전역(최대 1시간)
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    const devGuildId = process.env.DISCORD_GUILD_ID;
    const route = devGuildId
      ? Routes.applicationGuildCommands(client.user.id, devGuildId)
      : Routes.applicationCommands(client.user.id);
    await rest.put(route, { body: commands.map((c) => c.toJSON()) });
    logger.info(`슬래시 명령어 등록 완료 (${devGuildId ? `개발 서버: ${devGuildId}` : '전역'})`);
  } catch (err) {
    logger.error(`명령어 등록 실패: ${err.message}`);
  }

  config.load();
  keyStore.restoreFromDisk();
  cleanupOldLogs();

  // 설정된 모든 서버에 대해 크론 시작
  for (const [guildId] of client.guilds.cache) {
    startGuildCron(guildId);
  }

  startDailyResetCron();

  // 재시작 공지: 채널이 설정된 모든 서버에 전송
  if (shouldSendRestartNotice()) {
    for (const [guildId] of client.guilds.cache) {
      try {
        const channelId = config.get(guildId, 'channel');
        if (!channelId) continue;
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) {
          await ch.send(safeContent('🔄 봇이 재시작되었습니다. API 키를 재등록해야 하는 경우 관리자에게 /apikey set 등록을 요청하세요.'));
        }
      } catch (err) {
        logger.warn(`재시작 공지 전송 실패 (guild: ${guildId}): ${err.message}`);
      }
    }
  }
});

client.on(Events.GuildCreate, async (guild) => {
  logger.info(`새 서버 참가: ${guild.name} (${guild.id})`);
  startGuildCron(guild.id);

  try {
    const systemChannel = guild.systemChannel;
    if (systemChannel) {
      const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━━━━━';
      await systemChannel.send(safeContent([
        `👋 **TrendLens**가 ${guild.name} 서버에 참가했습니다!`,
        SEPARATOR,
        '시작하려면 서버 관리자가 아래 순서로 설정하세요:',
        '1️⃣ `/config channel #채널` — 트렌드를 받을 채널 지정',
        '2️⃣ `/apikey set <Gemini-API-키>` — AI 요약 키 등록 (선택)',
        '3️⃣ `/trend` — 즉시 트렌드 조회 테스트',
        '',
        '`/help` 명령어로 전체 사용법을 확인할 수 있습니다.',
      ].join('\n')));
    }
  } catch (err) {
    logger.warn(`GuildCreate 안내 메시지 전송 실패: ${err.message}`);
  }
});

client.on(Events.GuildDelete, (guild) => {
  const guildId = guild.id;
  logger.info(`서버 탈퇴: ${guild.name} (${guildId}) — 메모리 데이터 정리`);
  stopGuildCron(guildId);
  runningGuilds.delete(guildId);
  lastGuildPipelineRun.delete(guildId);
  keyStore.removeGuildData(guildId);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmdName = interaction.commandName;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  if (!guildId) {
    return interaction.reply(safePayload({ content: '이 봇은 서버 내에서만 사용할 수 있습니다.', ephemeral: true }));
  }

  const cdRemaining = checkCooldown(userId, guildId, cmdName);
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
      } catch (replyErr) { logger.warn(`[${cmdName}] 오류 응답 전송 실패: ${replyErr.message}`); }
    }
  }
});

// ──────────────────────────────────────────────
// Scheduled Pipeline Runner
// ──────────────────────────────────────────────

async function runScheduledPipeline(guildId) {
  if (runningGuilds.has(guildId)) return;
  runningGuilds.add(guildId);

  const timeStr = config.get(guildId, 'time') || '09:00';
  let progressMessage = null;

  try {
    const channelId = config.get(guildId, 'channel');
    if (!channelId) {
      logger.warn(`[guild:${guildId}] 스케줄 실행 생략: 전송 채널 미설정`);
      return;
    }
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      logger.warn(`[guild:${guildId}] 스케줄 전송 실패: 채널 ${channelId}을 찾을 수 없습니다`);
      return;
    }

    progressMessage = await channel.send(safeContent(`🔄 자동 트렌드 수집을 시작합니다. (설정 시간: ${timeStr} KST)`));

    const apiKey = keyStore.getGuildKey(guildId);
    const redditCred = keyStore.getGuildReddit(guildId);
    const result = await runPipeline({
      sources: config.get(guildId, 'sources'),
      guildId,
      apiKey,
      redditCredentials: redditCred,
      triggeredBy: 'schedule',
    });
    lastGuildPipelineRun.set(guildId, new Date().toISOString());

    if (result.messages.length > 0) {
      await progressMessage.edit(safePayload({ content: result.messages[0], flags: MessageFlags.SuppressEmbeds }));
      for (let i = 1; i < result.messages.length; i++) {
        await channel.send(safePayload({ content: result.messages[i], flags: MessageFlags.SuppressEmbeds }));
      }
    } else {
      await progressMessage.edit(safeContent('📭 자동 트렌드 수집 결과가 없습니다.'));
    }

    if (!result.meta?.gemini_used && result.meta?.gemini_skip_reason === 'no_server_key') {
      await channel.send(safeContent('ℹ️ 자동 알림은 서버 Gemini API 키가 없어 AI 요약이 생략되었습니다. 관리자에게 /apikey set 등록을 요청하세요.'));
    }
  } catch (err) {
    logger.error(`[guild:${guildId}] 스케줄 실행 실패: ${err.message}`);
    try {
      if (progressMessage) {
        await progressMessage.edit(safeContent(`❌ 자동 트렌드 수집에 실패했습니다: ${err.message}`));
      } else {
        const channelId = config.get(guildId, 'channel');
        const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
        if (channel) await channel.send(safeContent(`❌ 자동 트렌드 수집에 실패했습니다: ${err.message}`));
      }
    } catch (notifyErr) { logger.warn(`[guild:${guildId}] 스케줄 오류 알림 전송 실패: ${notifyErr.message}`); }
  } finally {
    runningGuilds.delete(guildId);
  }
}

// ──────────────────────────────────────────────
// Cron Scheduler
// ──────────────────────────────────────────────

function stopGuildCron(guildId) {
  const job = guildCronJobs.get(guildId);
  if (job) {
    job.stop();
    guildCronJobs.delete(guildId);
  }
}

function startGuildCron(guildId) {
  stopGuildCron(guildId);

  const channelId = config.get(guildId, 'channel');
  if (!channelId) return; // 채널 미설정 서버는 크론 등록 안 함

  const timeStr = config.get(guildId, 'time') || '09:00';
  const job = cron.schedule(toCronExpr(timeStr), () => runScheduledPipeline(guildId), { timezone: 'Asia/Seoul' });
  guildCronJobs.set(guildId, job);
  logger.info(`[guild:${guildId}] 크론 스케줄러 시작: ${timeStr} KST`);
}

function restartGuildCron(guildId) {
  startGuildCron(guildId);
}

function startDailyResetCron() {
  if (dailyResetCronJob) return;
  dailyResetCronJob = cron.schedule('0 0 * * *', () => {
    keyStore.resetDailyUsage();
    cleanupOldLogs();
    cleanupCooldowns();
  }, { timezone: 'UTC' });
}

// ──────────────────────────────────────────────
// Graceful Shutdown
// ──────────────────────────────────────────────

async function shutdown(signal) {
  logger.info(`${signal} 수신 — 봇 종료 중...`);
  try {
    // Map 순회 중 수정(delete) 충돌 방지를 위해 키 목록을 스냅샷으로 복사
    for (const guildId of [...guildCronJobs.keys()]) {
      stopGuildCron(guildId);
    }
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
