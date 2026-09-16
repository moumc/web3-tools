import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { ethers } from 'ethers';

// SheetJS 的 ESM 构建（xlsx.mjs）需要手动注入 fs 才能使用 readFile / writeFile
if (typeof XLSX.set_fs === 'function') {
  XLSX.set_fs(fs);
}

// 代币默认精度（18 位）
export const DEFAULT_DECIMALS = 18;

/**
 * 将科学计数法字符串展开为普通十进制字符串
 * 例如 '1.5e-2' -> '0.015'，'1e3' -> '1000'
 * @param {string} str - 可能含科学计数法的数字字符串（无符号）
 * @returns {string|null} 普通十进制字符串，无法解析时返回 null
 */
function expandScientific(str) {
  if (!/e/i.test(str)) {
    return str;
  }

  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [mantissa, expStr] = unsigned.toLowerCase().split('e');
  const exponent = Number.parseInt(expStr, 10);

  if (Number.isNaN(exponent)) {
    return null;
  }

  const [intPart, fracPart = ''] = mantissa.split('.');
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart)) {
    return null;
  }

  const digits = intPart + fracPart;
  const pointPos = intPart.length + exponent;

  let plain;
  if (pointPos <= 0) {
    // 纯小数，例如 1.5e-3 -> 0.0015
    plain = `0.${'0'.repeat(-pointPos)}${digits}`;
  } else if (pointPos >= digits.length) {
    // 纯整数，例如 1.5e3 -> 1500
    plain = digits + '0'.repeat(pointPos - digits.length);
  } else {
    plain = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
  }

  // 去掉整数部分多余的前导零（保留至少一位）
  const [plainInt, plainFrac] = plain.split('.');
  const trimmedInt = plainInt.replace(/^0+(?=\d)/, '');
  plain = plainFrac !== undefined ? `${trimmedInt}.${plainFrac}` : trimmedInt;

  return negative ? `-${plain}` : plain;
}

/**
 * 把单元格中的数量值规范化为普通十进制字符串
 * 支持数字、数字字符串、千分位逗号、科学计数法
 * @param {string|number} value - 单元格原始值
 * @returns {string|null} 规范化后的十进制字符串，无法解析时返回 null
 */
function toPlainDecimalString(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return expandScientific(String(value));
  }

  if (typeof value !== 'string') {
    return null;
  }

  // 去除空白与千分位逗号，兼容前导 '+'
  const cleaned = value.trim().replace(/,/g, '').replace(/^\+/, '');
  if (cleaned === '') {
    return null;
  }

  return expandScientific(cleaned);
}

/**
 * 将数量值按指定精度转换为最小单位 BigInt
 * @param {string|number} value - 数量（人类可读形式，如 '1.5'）
 * @param {number} [decimals=18] - 代币精度
 * @returns {bigint} 最小单位数量
 * @throws {Error} 格式无效 / 数量不大于 0 / 小数位超过精度
 */
function toTokenUnits(value, decimals = DEFAULT_DECIMALS) {
  const plain = toPlainDecimalString(value);

  if (plain === null || !/^-?\d+(\.\d+)?$/.test(plain)) {
    throw new Error(`数量格式无效: ${String(value)}`);
  }

  // 检查小数位是否超过精度，避免 parseUnits 抛出难以理解的错误
  const fracLen = plain.includes('.') ? plain.split('.')[1].length : 0;
  if (fracLen > decimals) {
    throw new Error(`小数位超过精度: ${plain}（精度 ${decimals} 位）`);
  }

  const units = ethers.parseUnits(plain, decimals);
  if (units <= BigInt(0)) {
    throw new Error(`数量必须大于 0: ${plain}`);
  }

  return units;
}

/**
 * 判断一行是否为完全空白行
 * @param {Array} row - 表格行
 * @returns {boolean}
 */
function isBlankRow(row) {
  if (!Array.isArray(row) || row.length === 0) {
    return true;
  }
  return row.every(cell => cell === undefined || cell === null || String(cell).trim() === '');
}

/**
 * @typedef {Object} TransferEntry
 * @property {number} rowNumber - 在表格中的行号（从 1 开始，含表头）
 * @property {string} address - 收款地址（checksum 格式）
 * @property {string} rawAmount - 原始数量（人类可读）
 * @property {bigint} amountUnits - 最小单位数量
 * @property {boolean} [duplicate] - 该地址是否在表格中重复出现
 */

/**
 * @typedef {Object} SkippedEntry
 * @property {number} rowNumber - 行号
 * @property {string} reason - 跳过原因
 * @property {string} raw - 原始行内容描述
 */

/**
 * 从表格行中提取转账记录
 * 约定：列 1 = 地址，列 2 = 数量；默认第一行为表头
 * @param {Array<Array>} rows - 表格行（sheet_to_json header:1 的输出）
 * @param {Object} [options]
 * @param {number} [options.decimals=18] - 代币精度
 * @param {boolean} [options.skipHeader=true] - 是否跳过表头
 * @returns {{transfers: Array<TransferEntry>, skipped: Array<SkippedEntry>}}
 */
function extractTransfers(rows, options = {}) {
  const { decimals = DEFAULT_DECIMALS, skipHeader = true } = options;

  /** @type {Array<TransferEntry>} */
  const transfers = [];
  /** @type {Array<SkippedEntry>} */
  const skipped = [];
  const seenAddresses = new Set();

  const dataRows = skipHeader ? rows.slice(1) : rows;
  const offset = skipHeader ? 1 : 0;

  dataRows.forEach((row, index) => {
    const rowNumber = index + offset + 1;

    // 完全空白的行静默跳过（xlsx 结尾常见）
    if (isBlankRow(row)) {
      return;
    }

    const rawAddress = row[0];
    const rawAmount = row[1];

    // 校验地址
    const addressStr = rawAddress === undefined || rawAddress === null ? '' : String(rawAddress).trim();
    if (!ethers.isAddress(addressStr)) {
      skipped.push({ rowNumber, reason: `地址无效: ${addressStr || '(空)'}`, raw: addressStr });
      return;
    }
    const address = ethers.getAddress(addressStr);

    // 校验并转换数量
    let amountUnits;
    try {
      amountUnits = toTokenUnits(rawAmount, decimals);
    } catch (error) {
      skipped.push({ rowNumber, reason: error.message, raw: String(rawAmount) });
      return;
    }

    const duplicate = seenAddresses.has(address);
    seenAddresses.add(address);

    transfers.push({
      rowNumber,
      address,
      rawAmount: toPlainDisplay(rawAmount),
      amountUnits,
      ...(duplicate ? { duplicate: true } : {})
    });
  });

  return { transfers, skipped };
}

/**
 * 把原始数量值转为人类可读字符串（数字去掉尾随的 JS 表示问题）
 * @param {string|number} value
 * @returns {string}
 */
function toPlainDisplay(value) {
  const plain = toPlainDecimalString(value);
  return plain === null ? String(value) : plain;
}

/**
 * 读取 xlsx 文件并提取转账记录
 * @param {string} filePath - xlsx 文件路径
 * @param {Object} [options]
 * @param {number} [options.decimals=18] - 代币精度
 * @param {boolean} [options.skipHeader=true] - 是否跳过表头
 * @param {string} [options.sheetName] - 工作表名，默认第一个
 * @returns {{transfers: Array<TransferEntry>, skipped: Array<SkippedEntry>}}
 */
function readTransferSheet(filePath, options = {}) {
  const fullPath = path.resolve(filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`文件不存在: ${fullPath}`);
  }

  let workbook;
  try {
    const buffer = fs.readFileSync(fullPath);

    // xlsx 是 zip 容器（魔数 PK\x03\x04）。SheetJS 对非 xlsx 内容（如纯文本）
    // 会宽容地按 CSV 等格式解析而不报错，这里先校验魔数，明确拒绝非法文件
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
      throw new Error('文件不是有效的 xlsx 格式');
    }

    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (error) {
    throw new Error(`读取 xlsx 失败: ${error.message}`);
  }

  const sheetName = options.sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`工作表不存在: ${sheetName}`);
  }

  // header:1 输出二维数组；保留空白行以维持真实行号（解析阶段会静默跳过空行）；raw 保持数字原样
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true, raw: true });

  return extractTransfers(rows, options);
}

export { toTokenUnits, extractTransfers, readTransferSheet };
