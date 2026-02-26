const { createLogger, format, transports } = require('winston');
const path = require('node:path');
const fs = require('node:fs');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const sensitivePattern = /(Authorization|Bearer|api[_-]?key|token|secret|cookie)\s*[:=]\s*\S+/gi;

const maskSensitive = format((info) => {
  if (typeof info.message === 'string') {
    info.message = info.message.replace(sensitivePattern, '$1=***MASKED***');
  }
  return info;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    maskSensitive(),
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`),
  ),
  transports: [
    new transports.Console(),
    new transports.File({
      filename: path.join(LOGS_DIR, 'trendlens.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
