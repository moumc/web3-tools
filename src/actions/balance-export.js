import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { ethers } from 'ethers';
import { queryTokenBalance } from './balance.js';

// SheetJS ESM 构建需要 fs 注入（与 src/core/xlsx.js 保持一致）
if (typeof XLSX.set_fs === 'function') {
  XLSX.set_fs(fs);
}

// 占位符：某单元格的余额查询失败时写入此值
const PLACEHOLDER = '--';

/**
 * @typedef {Object} ExtractedAddress
 * @property {string} address - checksum 形式
 * @property {number} rowNumber - 在 xlsx 中的行号（含表头，从 1 开始）
 * @property {number} colNumber - 列号（从 1 开始）
 */

/**
 * @typedef {Object} SkippedCell
 * @property {string} raw - 原始单元格内容
 * @property {number} rowNumber - 行号
 * @property {number} colNumber - 列号
 */

/**
 * 从 xlsx 文件中提取所有地址
 * 约定：无表头，所有非空单元格均视为地址候选
 * @param {string} filePath
 * @returns {{addresses: string[], skipped: SkippedCell[], duplicates: Array<{address: string, rowNumber: number, colNumber: number}>}}
 */
function extractAddressesFromSheet(filePath) {
  const fullPath = path.resolve(filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`文件不存在: ${fullPath}`);
  }

  const buffer = fs.readFileSync(fullPath);

  // xlsx 魔数校验（与 src/core/xlsx.js 一致）
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('文件不是有效的 xlsx 格式');
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (error) {
    throw new Error(`读取 xlsx 失败: ${error.message}`);
  }

  // SheetJS 保证新建的工作簿至少有一个空 sheet，因此 SheetNames[0] 与 Sheets[...] 始终存在
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

/**
 * 取代币显示符号：独立配置用 `symbol`，全局 config.tokens 用 `name`，都没有时回退 'TOKEN'
 * @param {Object} info
 * @returns {string}
 */
function getTokenSymbol(info) {
  return info.symbol || info.name || 'TOKEN';
}

/**
 * 把代币配置规范化为数组形式（兼容对象与数组输入）
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
 * 从 JSON 文件读取代币列表
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
 * 解析代币列表：
 * 1) --tokens 指定的文件（不存在报错）
 * 2) 默认 config/tokens-export.json
 * 3) 回退到 fallbackTokens（来自 config.tokens），并 warn
 * @param {string|undefined} tokensPath - --tokens 路径
 * @param {Array|Object|null} fallbackTokens - config.tokens
 * @param {Object} logger
 * @returns {Array}
 */
function loadTokenList(tokensPath, fallbackTokens, logger) {
  if (tokensPath) {
    return readTokenListFile(tokensPath);
  }
  const defaultPath = path.resolve('config/tokens-export.json');
  if (fs.existsSync(defaultPath)) {
    logger.info(`读取代币列表: ${defaultPath}`);
    return readTokenListFile(defaultPath);
  }
  logger.warn(`config/tokens-export.json 不存在，回退使用 config.tokens`);
  return normalizeTokens(fallbackTokens);
}

/**
 * 构建输出 xlsx 的表头
 * @param {string} nativeSymbol - 原生币符号
 * @param {Array} tokenList - 代币列表（数组形式）
 * @returns {string[]}
 */
function buildHeader(nativeSymbol, tokenList) {
  const header = ['地址', `原生币(${nativeSymbol})`];
  for (const info of tokenList) {
    const symbol = getTokenSymbol(info);
    // 取 '0x' + 后续 4 位十六进制字符
    const prefix = info.address.slice(0, 6);
    header.push(`${symbol}(${prefix})`);
  }
  return header;
}

/**
 * 查询单个地址的某代币余额（人类可读字符串，失败返回占位符）
 * @param {Object} rpcClient
 * @param {string} address
 * @param {Object} tokenInfo
 * @returns {Promise<string>}
 */
async function readTokenBalanceCell(rpcClient, address, tokenInfo) {
  try {
    const raw = await queryTokenBalance(rpcClient, address, tokenInfo.address);
    const decimals = tokenInfo.decimals ?? 18;
    return ethers.formatUnits(raw, decimals);
  } catch (error) {
    return { ok: false, error: error.message, tokenName: getTokenSymbol(tokenInfo) };
  }
}

/**
 * 查询单个地址的原生币余额（人类可读字符串，失败返回占位符）
 * @param {Object} rpcClient
 * @param {string} address
 * @returns {Promise<string|{ok:false, error:string}>}
 */
async function readNativeBalanceCell(rpcClient, address) {
  try {
    const raw = await rpcClient.getNativeBalance(address);
    return ethers.formatUnits(BigInt(raw), 18);
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * 生成默认输出路径 output/balance-<ISO时间>.xlsx
 * @param {string} [cwd=process.cwd()]
 * @returns {string}
 */
function defaultOutputPath(cwd = process.cwd()) {
  const now = new Date();
  // 将 ':' 替换为 '-' 以兼容 Windows 文件名
  const stamp = now.toISOString().replace(/[:]/g, '-');
  return path.join(cwd, 'output', `balance-${stamp}.xlsx`);
}

/**
 * 执行余额导出
 * @param {Object} params
 * @param {Object} params.config - 完整配置（取 network.nativeSymbol 与 fallback tokens）
 * @param {string} params.inputPath - 输入 xlsx 路径
 * @param {string} [params.outputPath] - 输出 xlsx 路径，默认 output/balance-<timestamp>.xlsx
 * @param {string} [params.tokensPath] - --tokens 指定的代币列表文件路径，覆盖默认 config/tokens-export.json
 * @param {Object} params.rpcClient - RPC 客户端
 * @param {Object} params.logger - Logger 实例
 * @returns {Promise<{outputPath: string, addressCount: number, tokenCount: number}>}
 */
async function runBalanceExport({ config, inputPath, outputPath, tokensPath, rpcClient, logger }) {
  const nativeSymbol = config.network?.nativeSymbol || 'ETH';
  const tokenList = loadTokenList(tokensPath, config.tokens, logger);

  logger.info(`=== 开始导出余额 ===`);
  logger.info(`输入文件: ${inputPath}`);

  const { addresses, skipped, duplicates, totalNonEmpty } = extractAddressesFromSheet(inputPath);

  logger.info(`读取统计: 共 ${totalNonEmpty} 个非空单元格，去重后有效地址 ${addresses.length} 个`);
  for (const s of skipped) {
    logger.warn(`第 ${s.rowNumber} 行 第 ${s.colNumber} 列跳过: 地址无效 (${s.raw})`);
  }
  for (const d of duplicates) {
    logger.warn(`第 ${d.rowNumber} 行 第 ${d.colNumber} 列重复地址: ${d.address}（仅查询一次）`);
  }

  if (addresses.length === 0) {
    throw new Error('没有有效地址可查询');
  }

  const header = buildHeader(nativeSymbol, tokenList);

  logger.info(`开始查询余额: ${addresses.length} 个地址 × (1 原生币 + ${tokenList.length} 个 ERC20) = ${addresses.length * (1 + tokenList.length)} 次调用`);

  /** @type {Array<Array<string>>} */
  const dataRows = [];
  for (const address of addresses) {
    /** @type {string[]} */
    const row = [address];

    const native = await readNativeBalanceCell(rpcClient, address);
    if (typeof native === 'string') {
      row.push(native);
    } else {
      logger.warn(`[${address}] 原生币查询失败: ${native.error}`);
      row.push(PLACEHOLDER);
    }

    for (const info of tokenList) {
      const cell = await readTokenBalanceCell(rpcClient, address, info);
      if (typeof cell === 'string') {
        row.push(cell);
      } else {
        logger.warn(`[${address}] ${cell.tokenName} 查询失败: ${cell.error}`);
        row.push(PLACEHOLDER);
      }
    }
    dataRows.push(row);
  }

  const finalOutputPath = outputPath || defaultOutputPath();
  const outputDir = path.dirname(finalOutputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const sheet = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  XLSX.writeFile(workbook, finalOutputPath);

  logger.info(`=== 导出完成 === 输出: ${finalOutputPath}（${dataRows.length} 行 × ${header.length} 列）`);

  return {
    outputPath: finalOutputPath,
    addressCount: dataRows.length,
    tokenCount: tokenList.length
  };
}

export {
  extractAddressesFromSheet,
  buildHeader,
  defaultOutputPath,
  getTokenSymbol,
  loadTokenList,
  normalizeTokens,
  readTokenListFile,
  runBalanceExport
};