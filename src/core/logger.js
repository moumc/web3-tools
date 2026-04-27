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

    // 延迟初始化：logStream 在首次写入时才创建
    this._logStream = null;
  }

  // 懒加载 logStream，确保 I/O 操作延迟到首次写入时
  _getLogStream() {
    if (!this._logStream) {
      // 确保日志目录存在
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      const logFile = path.join(this.logDir, 'app.log');
      this._logStream = fs.createWriteStream(logFile, { flags: 'a' });
    }
    return this._logStream;
  }

  // 关闭日志流，释放资源
  close() {
    if (this._logStream) {
      this._logStream.end();
      this._logStream = null;
    }
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
    this._getLogStream().write(formatted + '\n');
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