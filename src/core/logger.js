import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Logger {
  constructor(options = {}) {
    this.logDir = options.logDir || 'logs';
    this.logLevel = options.logLevel || 'info';
    this.levels = { error: 0, warn: 1, info: 2, debug: 3 };

    // 确保日志目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    const logFile = path.join(this.logDir, 'app.log');
    this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
  }

  _formatMessage(level, message) {
    const timestamp = new Date().toISOString();
    return JSON.stringify({ timestamp, level, message });
  }

  _shouldLog(level) {
    return this.levels[level] <= this.levels[this.logLevel];
  }

  _write(level, message) {
    if (!this._shouldLog(level)) return;

    const formatted = this._formatMessage(level, message);

    // 输出到控制台
    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }

    // 输出到文件
    this.logStream.write(formatted + '\n');
  }

  info(message) {
    this._write('info', message);
  }

  warn(message) {
    this._write('warn', message);
  }

  error(message) {
    this._write('error', message);
  }

  debug(message) {
    this._write('debug', message);
  }
}

export { Logger };