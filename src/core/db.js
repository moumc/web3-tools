import fs from 'fs';
import path from 'path';
import mysql2 from 'mysql2/promise.js';

/**
 * 数据库配置加载（独立于 config.json，便于敏感信息隔离）
 * @typedef {Object} DatabaseConfig
 * @property {string} host
 * @property {number} port
 * @property {string} user
 * @property {string} password
 * @property {string} database
 * @property {number} [connectionLimit]
 */

/**
 * 加载 config/database.json
 * @param {{cwd?: string, fsOverride?: Object}} [opts] - 注入式依赖，便于测试
 * @returns {DatabaseConfig|null} 文件不存在返回 null；存在但非法抛错
 */
function loadDatabaseConfig(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const fsLib = opts.fsOverride || fs;
  const configPath = path.resolve(cwd, 'config', 'database.json');

  if (!fsLib.existsSync(configPath)) {
    return null;
  }

  let raw;
  try {
    raw = fsLib.readFileSync(configPath, 'utf-8');
  } catch (error) {
    throw new Error(`读取数据库配置失败: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`数据库配置 JSON 解析失败: ${error.message}`);
  }

  validateDatabaseConfig(parsed);
  return parsed;
}

/**
 * 校验数据库配置必填字段
 * @param {Object} cfg
 */
function validateDatabaseConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('数据库配置必须为对象');
  }
  const required = ['host', 'port', 'user', 'password', 'database'];
  const missing = required.filter(k => cfg[k] === undefined || cfg[k] === null);
  if (missing.length > 0) {
    throw new Error(`数据库配置缺少字段: ${missing.join(', ')}`);
  }
  if (typeof cfg.host !== 'string' || cfg.host.length === 0) {
    throw new Error('host 必须为非空字符串');
  }
  if (typeof cfg.user !== 'string' || cfg.user.length === 0) {
    throw new Error('user 必须为非空字符串');
  }
  if (typeof cfg.database !== 'string' || cfg.database.length === 0) {
    throw new Error('database 必须为非空字符串');
  }
  if (!Number.isInteger(cfg.port) || cfg.port <= 0 || cfg.port > 65535) {
    throw new Error('port 必须是 1..65535 的整数');
  }
  if (cfg.connectionLimit !== undefined &&
      (!Number.isInteger(cfg.connectionLimit) || cfg.connectionLimit <= 0)) {
    throw new Error('connectionLimit 必须是正整数');
  }
}

/**
 * 创建 mysql2 连接池
 * @param {DatabaseConfig} cfg
 * @returns {import('mysql2/promise').Pool}
 */
function createPool(cfg) {
  validateDatabaseConfig(cfg);
  return mysql2.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: cfg.connectionLimit || 10,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    multipleStatements: false,
    namedPlaceholders: false,
    dateStrings: true
  });
}

/**
 * 在事务中执行回调；自动 begin / commit / rollback / release
 * @template T
 * @param {import('mysql2/promise').Pool} pool
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(pool, fn) {
  const conn = await pool.getConnection();
  let committed = false;
  let thrown = null;
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    committed = true;
    return result;
  } catch (err) {
    thrown = err;
    throw err;
  } finally {
    if (!committed) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        // rollback 失败时，原始错误优先
        if (!thrown) throw rollbackErr;
      }
    }
    try {
      conn.release();
    } catch (_) {
      // release 失败不影响结果
    }
  }
}

/**
 * 关闭连接池
 * @param {import('mysql2/promise').Pool} pool
 */
async function closePool(pool) {
  if (pool && typeof pool.end === 'function') {
    await pool.end();
  }
}

export {
  loadDatabaseConfig,
  createPool,
  withTransaction,
  closePool,
  validateDatabaseConfig
};
