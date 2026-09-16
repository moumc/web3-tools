/**
 * SQL schema 工具：根据 tokens-export.json 动态生成 balance_export_<session> 表的 DDL 与 DML。
 *
 * 设计要点：
 * - 所有 SQL 标识符（sessionId、列名、表名）必须经过 isValidIdentifier 校验，杜绝拼接注入。
 * - 所有动态值（地址、金额、错误信息）走 ? 占位符，由 mysql2 prepared statement 处理。
 * - 列名格式：<symbol 小写 + 仅 [a-z0-9_]>_<地址前 4 位 hex 小写>_balance。
 */

// SQL 关键字（不全，按风险最高的子集；MySQL 关键字总数 800+，但 DDL/DML 注入攻击面就这些）
const SQL_KEYWORDS = new Set([
  'select', 'insert', 'update', 'delete', 'drop', 'truncate', 'alter', 'create',
  'replace', 'rename', 'grant', 'revoke', 'union', 'where', 'from', 'into',
  'table', 'index', 'view', 'database', 'schema', 'column', 'primary',
  'foreign', 'key', 'constraint', 'default', 'null', 'not', 'and', 'or',
  'true', 'false', 'in', 'exists', 'between', 'like', 'is', 'as', 'on',
  'join', 'left', 'right', 'inner', 'outer', 'cross', 'group', 'order',
  'by', 'having', 'limit', 'offset', 'case', 'when', 'then', 'else', 'end',
  'set', 'values', 'distinct', 'all', 'any', 'some', 'with', 'recursive',
  'returning', 'into', 'lock', 'unlock', 'show', 'describe', 'explain',
  'use', 'commit', 'rollback', 'savepoint', 'transaction', 'begin', 'start',
  'if', 'while', 'loop', 'function', 'procedure', 'return', 'declare',
  'cursor', 'fetch', 'open', 'close', 'handler', 'condition', 'resignal',
  'signal', 'do', 'call', 'execute', 'prepare', 'deallocate', 'analyze',
  'optimize', 'check', 'checksum', 'backup', 'restore', 'load', 'cache',
  'flush', 'kill', 'shutdown', 'restart', 'sleep', 'benchmark', 'force'
]);

// 标识符最大长度（MySQL 8 默认 64）
const MAX_IDENTIFIER_LEN = 64;

// balance_export_<sessionId> 表名前缀
const TABLE_PREFIX = 'balance_export';

/**
 * 校验 SQL 标识符是否安全（表别名 / 列名等）
 * 规则：仅 [a-zA-Z0-9_]，不能以数字开头，长度 1..64，不能是 SQL 关键字
 * @param {string} name
 * @returns {boolean}
 */
function isValidIdentifier(name) {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > MAX_IDENTIFIER_LEN) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  if (SQL_KEYWORDS.has(name.toLowerCase())) return false;
  return true;
}

/**
 * 校验 sessionId：业务上是时间戳，必须允许数字开头（如 20260916_124057）
 * 规则：仅 [a-zA-Z0-9_]，长度 1..64，不能是 SQL 关键字
 * @param {string} sessionId
 * @returns {boolean}
 */
function isValidSessionId(sessionId) {
  if (typeof sessionId !== 'string') return false;
  if (sessionId.length === 0 || sessionId.length > MAX_IDENTIFIER_LEN) return false;
  if (!/^[A-Za-z0-9_]+$/.test(sessionId)) return false;
  if (SQL_KEYWORDS.has(sessionId.toLowerCase())) return false;
  return true;
}

/**
 * 生成表名 `balance_export_<sessionId>`
 * @param {string} sessionId
 * @returns {string}
 */
function tableNameFor(sessionId) {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`sessionId 不合法: ${JSON.stringify(sessionId)}`);
  }
  return `${TABLE_PREFIX}_${sessionId}`;
}

/**
 * 根据 token 元数据计算列名
 * - symbol 转小写，仅保留 [a-z0-9_]
 * - address 取 0x 后前 4 位 hex（避免 symbol 重复时撞列名）
 * - 格式：`<symbol>_<addr4hex>_balance`
 * @param {{symbol: string, address: string, decimals: number}} token
 * @returns {string}
 */
function getTokenColumnName(token) {
  if (!token || typeof token.symbol !== 'string') {
    throw new Error('token.symbol 必填');
  }
  if (typeof token.address !== 'string'
      || !/^0x[0-9a-fA-F]{40}$/.test(token.address)) {
    throw new Error(`token.address 必须为 0x + 40 位 hex: ${token && token.address}`);
  }
  const symBase = token.symbol.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (symBase.length === 0) {
    throw new Error(`token.symbol 清洗后为空: ${JSON.stringify(token.symbol)}`);
  }
  if (SQL_KEYWORDS.has(symBase)) {
    throw new Error(`token.symbol 与 SQL 关键字冲突: ${symBase}`);
  }
  const addr4 = token.address.slice(2, 6).toLowerCase();
  const col = `${symBase}_${addr4}_balance`;
  if (!isValidIdentifier(col)) {
    throw new Error(`列名非法或与关键字冲突: ${col}`);
  }
  if (col.length > MAX_IDENTIFIER_LEN) {
    throw new Error(`列名过长: ${col} (${col.length} > ${MAX_IDENTIFIER_LEN})`);
  }
  return col;
}

/**
 * 构造 CREATE TABLE IF NOT EXISTS SQL
 * 列：id / address / native_balance / 每个代币一列 / created_at / updated_at
 * 不再有 status / error_msg（任务定位简化为「数据已落库」，不再追踪进度）
 * @param {string} sessionId
 * @param {Array<{symbol: string, address: string, decimals: number}>} tokens
 * @returns {string}
 */
function buildCreateTableSql(sessionId, tokens) {
  if (!Array.isArray(tokens)) {
    throw new Error('tokens 必须为数组');
  }
  const tableName = tableNameFor(sessionId);

  const tokenColumns = tokens.map(t => {
    const col = getTokenColumnName(t);
    const decimals = Number.isInteger(t.decimals) ? t.decimals : 18;
    if (decimals < 0 || decimals > 30) {
      throw new Error(`decimals 越界: ${t.symbol} = ${decimals}`);
    }
    return `  \`${col}\` DECIMAL(38,${decimals}) DEFAULT NULL`;
  });

  const columns = [
    '  `id` BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT',
    "  `address` VARCHAR(42) NOT NULL",
    '  `native_balance` DECIMAL(38,18) DEFAULT NULL',
    ...tokenColumns,
    '  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    '  UNIQUE KEY `uk_address` (`address`)',
    '  KEY `idx_id` (`id`)'
  ];

  return [
    `CREATE TABLE IF NOT EXISTS \`${tableName}\` (`,
    columns.join(',\n'),
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;'
  ].join('\n');
}

/**
 * 构造 INSERT IGNORE 多行插入地址 SQL
 * 格式：`VALUES (?), (?), (?), ...`
 * MySQL 9.x 要求：
 *   1. VALUES 列表带括号
 *   2. 多行插入必须每行单独一对括号（逗号分隔）
 * @param {string} sessionId
 * @param {string[]} addresses
 * @returns {string}
 */
function buildInsertAddressesSql(sessionId, addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('addresses 不能为空');
  }
  const tableName = tableNameFor(sessionId);
  const rows = addresses.map(() => '(?)').join(', ');
  return `INSERT IGNORE INTO \`${tableName}\` (\`address\`) VALUES ${rows};`;
}

/**
 * 构造游标分页 SELECT id, address SQL（按 id 升序逐批取出）
 * @param {string} sessionId
 * @param {number} lastId - 上次最后 id，首页传 0
 * @param {number} limit
 * @returns {string}
 */
function buildSelectBatchSql(sessionId, lastId, limit) {
  const tableName = tableNameFor(sessionId);
  if (!Number.isInteger(lastId) || lastId < 0) {
    throw new Error('lastId 必须为非负整数');
  }
  if (!Number.isInteger(limit) || limit <= 0 || limit > 10000) {
    throw new Error('limit 必须在 1..10000');
  }
  return [
    `SELECT \`id\`, \`address\` FROM \`${tableName}\``,
    `WHERE \`id\` > ?`,
    `ORDER BY \`id\``,
    `LIMIT ?;`
  ].join('\n');
}

/**
 * 构造批量 UPDATE balance SQL（单条 SQL，多个 CASE WHEN）
 * 不写 status / error_msg；失败的列保持 NULL（下次跑会再查询）
 * @param {string} sessionId
 * @param {Array<{symbol: string, decimals: number}>} tokens
 * @param {Array<{address: string, nativeBalance: string|null, balances: Object<string,string|null>}>} rows
 * @returns {string}
 */
function buildUpdateBalancesSql(sessionId, tokens, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('rows 不能为空');
  }
  const tableName = tableNameFor(sessionId);

  // 用单行紧凑拼接：MySQL 9 在 SET 子句跨行 + 多 CASE WHEN 时解析异常
  const setClauses = [];

  // native_balance
  const nativeCases = rows.map(() => 'WHEN ? THEN ?').join(' ');
  setClauses.push(`\`native_balance\` = CASE \`address\` ${nativeCases} END`);

  // 每个代币一列
  for (const t of tokens) {
    const col = getTokenColumnName(t);
    const cases = rows.map(() => 'WHEN ? THEN ?').join(' ');
    setClauses.push(`\`${col}\` = CASE \`address\` ${cases} END`);
  }

  const placeholders = rows.map(() => '?').join(',');

  return `UPDATE \`${tableName}\` SET ${setClauses.join(',')} WHERE \`address\` IN(${placeholders});`;
}

/**
 * 计算 UPDATE SQL 的参数顺序（与 buildUpdateBalancesSql 的 ? 顺序对应）
 * 顺序：
 *   1. native_balance: [addr1, val1, addr2, val2, ...]
 *   2. 每个代币列: [addr1, val1, addr2, val2, ...]
 *   3. WHERE IN: [addr1, addr2, ...]
 * 注意：rows[].balances 的 key 用列名（getTokenColumnName(t)）而非 symbol。
 * @param {Array} rows
 * @param {Array} tokens
 * @returns {any[]}
 */
function buildUpdateBalancesParams(rows, tokens) {
  const params = [];
  for (const r of rows) {
    params.push(r.address, r.nativeBalance);
  }
  for (const t of tokens) {
    const col = getTokenColumnName(t);
    for (const r of rows) {
      const v = r.balances && col in r.balances ? r.balances[col] : null;
      params.push(r.address, v);
    }
  }
  for (const r of rows) {
    params.push(r.address);
  }
  return params;
}

export {
  isValidIdentifier,
  isValidSessionId,
  tableNameFor,
  getTokenColumnName,
  buildCreateTableSql,
  buildInsertAddressesSql,
  buildSelectBatchSql,
  buildUpdateBalancesSql,
  buildUpdateBalancesParams
};
