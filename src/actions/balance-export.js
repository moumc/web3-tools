import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { ethers } from 'ethers';
import { batchRpcCall, encodeBalanceOfData } from '../core/batch-rpc.js';
import {
  tableNameFor,
  getTokenColumnName,
  buildCreateTableSql,
  buildInsertAddressesSql,
  buildSelectBatchSql,
  buildUpdateBalancesSql,
  buildUpdateBalancesParams
} from '../core/schema.js';

// SheetJS ESM 注入
if (typeof XLSX.set_fs === 'function') {
  XLSX.set_fs(fs);
}

/**
 * @typedef {Object} BalanceExportResult
 * @property {string} sessionId
 * @property {string} tableName
 * @property {number} totalCount - 表里地址总数
 * @property {number} updatedCount - 本轮 UPDATE 写入的行数
 */

// =====================================================================
// xlsx 解析（保留独立函数）
// =====================================================================

/**
 * @typedef {Object} ExtractedAddress
 * @property {string} address - checksum 形式
 * @property {number} rowNumber
 * @property {number} colNumber
 */

/**
 * @typedef {Object} SkippedCell
 * @property {string} raw
 * @property {number} rowNumber
 * @property {number} colNumber
 */

/**
 * 从 xlsx 中提取所有地址
 * @param {string} filePath
 * @returns {{
 *   addresses: string[],
 *   skipped: SkippedCell[],
 *   duplicates: Array<{address: string, rowNumber: number, colNumber: number}>,
 *   totalNonEmpty: number
 * }}
 */
function extractAddressesFromSheet(filePath) {
  const fullPath = path.resolve(filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`文件不存在: ${fullPath}`);
  }

  const buffer = fs.readFileSync(fullPath);

  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('文件不是有效的 xlsx 格式');
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (error) {
    throw new Error(`读取 xlsx 失败: ${error.message}`);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true, raw: true });

  /** @type {string[]} */
  const addresses = [];
  /** @type {SkippedCell[]} */
  const skipped = [];
  /** @type {Array<{address: string, rowNumber: number, colNumber: number}>} */
  const duplicates = [];
  const seen = new Set();
  let totalNonEmpty = 0;

  rows.forEach((row, rowIdx) => {
    if (!Array.isArray(row)) return;
    row.forEach((cell, colIdx) => {
      if (cell === undefined || cell === null) return;
      const raw = String(cell).trim();
      if (raw === '') return;
      totalNonEmpty += 1;

      if (!ethers.isAddress(raw)) {
        skipped.push({ raw, rowNumber: rowIdx + 1, colNumber: colIdx + 1 });
        return;
      }

      const checksum = ethers.getAddress(raw);
      if (seen.has(checksum)) {
        duplicates.push({ address: checksum, rowNumber: rowIdx + 1, colNumber: colIdx + 1 });
        return;
      }
      seen.add(checksum);
      addresses.push(checksum);
    });
  });

  return { addresses, skipped, duplicates, totalNonEmpty };
}

// =====================================================================
// 代币列表加载（保留）
// =====================================================================

/**
 * @param {Object} info
 * @returns {string}
 */
function getTokenSymbol(info) {
  return info.symbol || info.name || 'TOKEN';
}

/**
 * 兼容对象 / 数组输入
 * @param {Array|Object|null|undefined} tokens
 * @returns {Array<{symbol: string, address: string, decimals: number}>}
 */
function normalizeTokens(tokens) {
  if (!tokens) return [];
  if (Array.isArray(tokens)) {
    return tokens.filter(t => t && t.address);
  }
  return Object.values(tokens).filter(t => t && t.address);
}

/**
 * @param {string} filePath
 * @returns {Array}
 */
function readTokenListFile(filePath) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`代币列表文件不存在: ${fullPath}`);
  }
  const raw = fs.readFileSync(fullPath, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`代币列表 JSON 解析失败: ${error.message}`);
  }
  const list = normalizeTokens(parsed);
  if (list.length === 0) {
    throw new Error(`代币列表为空或字段缺失: ${fullPath}`);
  }
  return list;
}

/**
 * @param {string|undefined} tokensPath
 * @param {Array|Object|null} fallbackTokens
 * @param {Object} logger
 * @returns {Array}
 */
function loadTokenList(tokensPath, fallbackTokens, logger) {
  let raw;
  if (tokensPath) {
    raw = readTokenListFile(tokensPath);
  } else {
    const defaultPath = path.resolve('config/tokens-export.json');
    if (fs.existsSync(defaultPath)) {
      logger.info(`读取代币列表: ${defaultPath}`);
      raw = readTokenListFile(defaultPath);
    } else {
      logger.warn(`config/tokens-export.json 不存在，回退使用 config.tokens`);
      raw = normalizeTokens(fallbackTokens);
    }
  }
  // 校验每个 token 的 address 必须是合法以太坊地址；否则跳过并 warn
  // 同时按 address 去重（同地址只保留首次出现）
  const valid = [];
  const seen = new Set();
  for (const t of raw) {
    if (!t.address || !ethers.isAddress(t.address)) {
      logger.warn(`代币 ${t.symbol || '(未知)'} 的合约地址无效: ${t.address}，已跳过`);
      continue;
    }
    const checksum = ethers.getAddress(t.address);
    if (seen.has(checksum.toLowerCase())) {
      logger.warn(`代币地址重复: ${checksum} (symbol=${t.symbol || '(未知)'})，已跳过`);
      continue;
    }
    seen.add(checksum.toLowerCase());
    valid.push({ ...t, address: checksum });
  }
  return valid;
}

/**
 * 校验并 checksum 化代币列表，过滤无效地址；按 address 去重（同地址只保留首次出现）
 * - 过滤：address 非法 → warn 并跳过
 * - 去重：同 address（checksum 后）→ warn 并跳过；因为同地址 = 同代币 = 同列，二次出现要么是用户误配
 * @param {Array} tokens
 * @param {Object} logger
 * @returns {Array}
 */
function sanitizeTokens(tokens, logger) {
  const valid = [];
  const seen = new Set();
  for (const t of tokens) {
    if (!t || !t.address || !ethers.isAddress(t.address)) {
      logger.warn(`代币 ${(t && t.symbol) || '(未知)'} 的合约地址无效: ${t && t.address}，已跳过`);
      continue;
    }
    const checksum = ethers.getAddress(t.address);
    if (seen.has(checksum.toLowerCase())) {
      logger.warn(`代币地址重复: ${checksum} (symbol=${t.symbol || '(未知)'})，已跳过`);
      continue;
    }
    seen.add(checksum.toLowerCase());
    valid.push({ ...t, address: checksum });
  }
  return valid;
}

/**
 * 生成默认 sessionId：YYYYMMDD_HHMMSS（本地时区）
 * @returns {string}
 */
function defaultSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

// =====================================================================
// 余额查询 helpers
// =====================================================================

/**
 * 把 wei 字符串转为十进制字符串（保留精度，去除 trailing zeros）
 * @param {string|bigint} raw
 * @param {number} decimals
 * @returns {string|null}
 */
function formatBalance(raw, decimals) {
  if (raw === null || raw === undefined) return null;
  try {
    return ethers.formatUnits(raw, decimals);
  } catch (_) {
    return null;
  }
}

// =====================================================================
// 主流程
// =====================================================================

/**
 * 计算进度日志间隔
 * @param {number} total
 * @returns {number}
 */
function calcProgressInterval(total) {
  return Math.max(50, Math.floor(total / 10));
}

/**
 * 把代币余额结果按 address 聚合
 * @param {Array} tokenResults - batchRpcCall 返回（按 input id 顺序）
 * @param {Array<string>} addressesInOrder
 * @param {Array<Object>} tokens
 * @returns {Map<string, Object<string,string|null>>} 每地址一个对象，key 为列名（不是 symbol）
 */
function indexTokenResultsByAddress(tokenResults, addressesInOrder, tokens) {
  // tokenResults 与构造的 calls 顺序一致：先 addressesInOrder × tokens (row-major)
  const out = new Map();
  for (const addr of addressesInOrder) {
    out.set(addr, {});
  }
  let idx = 0;
  for (const addr of addressesInOrder) {
    const bag = out.get(addr);
    for (const t of tokens) {
      const r = tokenResults[idx];
      idx += 1;
      // 用列名作 key，避免 symbol 重复时撞 key
      const col = getTokenColumnName(t);
      if (r && r.ok) {
        bag[col] = formatBalance(r.result, t.decimals);
      } else {
        bag[col] = null;
      }
    }
  }
  return out;
}

/**
 * 执行余额导出（MySQL 模式）：两阶段
 *   Phase 1：解析 xlsx → 全量 INSERT IGNORE 到 balance_export_<session>
 *   Phase 2：游标分批 SELECT id,address → JSON-RPC 批量查余额 → 单条 UPDATE (CASE WHEN) 回写
 * 不写 status / error_msg；失败的列保持 NULL，下次跑会重查。
 * @param {Object} params
 * @param {Object} params.config - 完整 config（取 network.rpcUrl）
 * @param {string} params.inputPath - 输入 xlsx 路径
 * @param {Object} params.pool - mysql2 pool
 * @param {string} [params.sessionId] - 不传则生成时间戳
 * @param {string} [params.tokensPath] - --tokens 覆盖
 * @param {Array} [params.tokens] - 直接传代币列表，跳过文件
 * @param {boolean} [params.fresh=false] - 是否 DROP 旧表
 * @param {number} [params.batchSize=100] - 每批 SELECT 行数
 * @param {number} [params.maxRpcRetries=3] - RPC 失败重试
 * @param {Object} [params.rpcBatchCall] - 注入
 * @param {string} [params.rpcUrl] - 默认 config.network.rpcUrl
 * @param {Object} params.logger
 * @returns {Promise<BalanceExportResult>}
 */
async function runBalanceExport({
  config,
  inputPath,
  pool,
  sessionId,
  tokensPath,
  tokens,  // 可选：直接传代币列表，跳过 loadTokenList
  fresh = false,
  batchSize = 100,
  maxRpcRetries = 3,
  rpcBatchCall = batchRpcCall,
  rpcUrl,
  logger
}) {
  if (!pool) throw new Error('pool 必填');
  if (!inputPath) throw new Error('inputPath 必填');
  if (!logger) throw new Error('logger 必填');

  const sid = sessionId || defaultSessionId();
  const tableName = tableNameFor(sid);
  const finalRpcUrl = rpcUrl || config.network?.rpcUrl;

  // tokens 优先级：显式传入 > tokensPath > 默认文件 > config.tokens
  let tokenList;
  if (Array.isArray(tokens)) {
    tokenList = sanitizeTokens(tokens, logger);
  } else {
    tokenList = loadTokenList(tokensPath, config.tokens, logger);
  }

  logger.info('=== 开始导出余额（MySQL 模式） ===');
  logger.info(`Session: ${tableName}${fresh ? ' (fresh)' : ''}`);
  logger.info(`代币列表: ${tokenList.length} 个`);

  // 1. 解析 xlsx
  const { addresses, skipped, duplicates, totalNonEmpty } = extractAddressesFromSheet(inputPath);
  logger.info(`输入文件: ${inputPath}`);
  logger.info(`读取统计: 共 ${totalNonEmpty} 个非空单元格，去重后有效地址 ${addresses.length} 个`);
  for (const s of skipped) {
    logger.warn(`第 ${s.rowNumber} 行 第 ${s.colNumber} 列跳过: 地址无效 (${s.raw})`);
  }
  for (const d of duplicates) {
    logger.warn(`第 ${d.rowNumber} 行 第 ${d.colNumber} 列重复地址: ${d.address}`);
  }

  if (addresses.length === 0) {
    throw new Error('没有有效地址可查询');
  }

  // 2. fresh → DROP 旧表
  if (fresh) {
    logger.info(`DROP 旧表: ${tableName}`);
    await pool.execute(`DROP TABLE IF EXISTS \`${tableName}\`;`);
  }

  // 3. 建表
  const createSql = buildCreateTableSql(sid, tokenList);
  logger.info(`建表: ${tableName}`);
  await pool.execute(createSql);

  // 4. 插入地址（按批拆分，避开 MySQL prepared statement 占位符上限 ~65535）
  // 用 pool.query 走客户端转义，避免 server-side PREPARE 对占位符数量的限制
  const INSERT_CHUNK = 1000;
  const mysql = await import('mysql2/promise.js');
  for (let i = 0; i < addresses.length; i += INSERT_CHUNK) {
    const chunk = addresses.slice(i, i + INSERT_CHUNK);
    const insertSql = buildInsertAddressesSql(sid, chunk);
    const formatted = mysql.default.format(insertSql, chunk);
    await pool.query(formatted);
  }
  logger.info(`已写入 ${addresses.length} 个地址到表 ${tableName}（按 ${INSERT_CHUNK}/批）`);

  // 5. 统计已写入地址数
  const [totalRows] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM \`${tableName}\`;`
  );
  const totalCount = Number(totalRows[0].cnt);
  logger.info(`开始查询: 总 ${totalCount} 地址`);

  // 6. 游标分批 select + update（无 status，按 id 升序逐批取出全部）
  const progressInterval = calcProgressInterval(totalCount);
  let lastId = 0;
  let processed = 0;
  let updatedThisRun = 0;

  while (true) {
    const selectSql = buildSelectBatchSql(sid, lastId, batchSize);
    const [rows] = await pool.execute(selectSql, [lastId, batchSize]);
    if (rows.length === 0) break;

    const batchAddresses = rows.map(r => r.address);
    lastId = Math.max(...rows.map(r => Number(r.id)));

    // 6.1 构造 RPC calls：每个地址 × (1 原生币 + N 代币)
    const calls = [];
    for (const addr of batchAddresses) {
      calls.push({ id: `native:${addr}`, method: 'eth_getBalance', params: [addr, 'latest'] });
    }
    for (const t of tokenList) {
      const data = encodeBalanceOfData(t.address);
      for (const addr of batchAddresses) {
        calls.push({ id: `token:${t.address}:${addr}`, method: 'eth_call', params: [{ to: t.address, data }, 'latest'] });
      }
    }

    // 6.2 调批量 RPC
    let results;
    try {
      results = await rpcBatchCall({
        rpcUrl: finalRpcUrl,
        calls,
        retries: maxRpcRetries,
        timeoutMs: 30000
      });
    } catch (err) {
      // 整批 HTTP 失败：该批列保持 NULL（下一轮重试时此批地址自然会被重新取出）
      logger.error(`整批 RPC 失败 (${batchAddresses.length} 地址): ${err.message}`);
      processed += batchAddresses.length;
      continue;
    }

    // 6.3 切分 results：前 batchAddresses.length 是 native，剩下是 token
    const nativeResults = results.slice(0, batchAddresses.length);
    const tokenResults = results.slice(batchAddresses.length);
    const tokenByAddr = indexTokenResultsByAddress(tokenResults, batchAddresses, tokenList);

    // 6.4 构造 UPDATE 行：原生币 ok → 转十进制 ETH 单位；否则 NULL
    const updateRows = batchAddresses.map((addr, i) => {
      const nativeR = nativeResults[i];
      // RPC 返回的是 hex wei；DECIMAL 列需要十进制字符串。18 位精度（EVM 原生币标准）
      const nativeBalance = nativeR && nativeR.ok ? formatBalance(nativeR.result, 18) : null;
      const balances = tokenByAddr.get(addr) || {};
      return { address: addr, nativeBalance, balances };
    });

    const updateSql = buildUpdateBalancesSql(sid, tokenList, updateRows);
    const updateParams = buildUpdateBalancesParams(updateRows, tokenList);
    await pool.execute(updateSql, updateParams);
    updatedThisRun += updateRows.length;

    processed += batchAddresses.length;
    if (processed % progressInterval === 0 || processed === totalCount) {
      logger.info(`进度: ${processed}/${totalCount}`);
    }
  }

  logger.info(`=== 完成 === 表: ${tableName} 共更新 ${updatedThisRun} 行`);

  return {
    sessionId: sid,
    tableName,
    totalCount,
    updatedCount: updatedThisRun
  };
}

export {
  extractAddressesFromSheet,
  loadTokenList,
  getTokenSymbol,
  defaultSessionId,
  runBalanceExport
};
