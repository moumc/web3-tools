import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { ethers } from 'ethers';
import { toTokenUnits, extractTransfers, readTransferSheet } from '../../src/core/xlsx.js';

const VALID_ADDRESS = '0x1234567890123456789012345678901234567890';
const VALID_ADDRESS_2 = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

describe('toTokenUnits - 数量转 18 位精度', () => {
  test('整数字符串按 18 位精度放大', () => {
    expect(toTokenUnits('100')).toBe(BigInt(100) * BigInt(10) ** BigInt(18));
  });

  test('数字类型按 18 位精度放大', () => {
    expect(toTokenUnits(100.5)).toBe(BigInt(1005) * BigInt(10) ** BigInt(17));
  });

  test('小数字符串精确转换', () => {
    expect(toTokenUnits('1.5')).toBe(BigInt(15) * BigInt(10) ** BigInt(17));
    expect(toTokenUnits('0.000000000000000001')).toBe(BigInt(1));
  });

  test('科学计数法展开后转换', () => {
    expect(toTokenUnits('1e3')).toBe(BigInt(1000) * BigInt(10) ** BigInt(18));
    expect(toTokenUnits('1.5e-2')).toBe(BigInt(15) * BigInt(10) ** BigInt(15));
    expect(toTokenUnits(1e3)).toBe(BigInt(1000) * BigInt(10) ** BigInt(18));
  });

  test('千分位逗号自动去除', () => {
    expect(toTokenUnits('1,000')).toBe(BigInt(1000) * BigInt(10) ** BigInt(18));
    expect(toTokenUnits('1,234.5')).toBe(BigInt(12345) * BigInt(10) ** BigInt(17));
  });

  test('支持自定义精度', () => {
    expect(toTokenUnits('100', 6)).toBe(BigInt(100) * BigInt(10) ** BigInt(6));
  });

  test('非法格式抛错', () => {
    expect(() => toTokenUnits('abc')).toThrow('数量格式无效');
    expect(() => toTokenUnits('')).toThrow('数量格式无效');
    expect(() => toTokenUnits(null)).toThrow('数量格式无效');
    expect(() => toTokenUnits(undefined)).toThrow('数量格式无效');
    expect(() => toTokenUnits(NaN)).toThrow('数量格式无效');
  });

  test('零或负数抛错', () => {
    expect(() => toTokenUnits('0')).toThrow('数量必须大于 0');
    expect(() => toTokenUnits('-1')).toThrow('数量必须大于 0');
  });

  test('小数位超过精度抛错', () => {
    expect(() => toTokenUnits('1.1234567', 6)).toThrow('小数位超过精度');
  });
});

describe('extractTransfers - 从表格行提取转账记录', () => {
  test('跳过表头并提取有效记录', () => {
    const rows = [
      ['地址', '数量'],
      [VALID_ADDRESS, 100],
      [VALID_ADDRESS_2, '2.5']
    ];

    const { transfers, skipped } = extractTransfers(rows);

    expect(skipped).toHaveLength(0);
    expect(transfers).toHaveLength(2);
    expect(transfers[0].address).toBe(VALID_ADDRESS);
    expect(transfers[0].amountUnits).toBe(BigInt(100) * BigInt(10) ** BigInt(18));
    expect(transfers[0].rawAmount).toBe('100');
    expect(transfers[1].rawAmount).toBe('2.5');
  });

  test('地址统一转为 checksum 格式', () => {
    const lowercase = VALID_ADDRESS_2.toLowerCase();
    const rows = [['地址', '数量'], [lowercase, 1]];

    const { transfers } = extractTransfers(rows);

    // 地址应规范化为 EIP-55 checksum 格式
    expect(transfers[0].address).toBe(ethers.getAddress(lowercase));
  });

  test('非法地址记入 skipped', () => {
    const rows = [['地址', '数量'], ['not-an-address', 100]];

    const { transfers, skipped } = extractTransfers(rows);

    expect(transfers).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain('地址无效');
    expect(skipped[0].rowNumber).toBe(2);
  });

  test('非法数量记入 skipped', () => {
    const rows = [['地址', '数量'], [VALID_ADDRESS, 'abc']];

    const { transfers, skipped } = extractTransfers(rows);

    expect(transfers).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain('数量');
  });

  test('数量为空的行记入 skipped', () => {
    const rows = [['地址', '数量'], [VALID_ADDRESS, undefined]];

    const { skipped } = extractTransfers(rows);

    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain('数量');
  });

  test('完全空白的行静默跳过', () => {
    const rows = [
      ['地址', '数量'],
      [VALID_ADDRESS, 1],
      [undefined, undefined],
      [],
      [VALID_ADDRESS_2, 2]
    ];

    const { transfers, skipped } = extractTransfers(rows);

    expect(transfers).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });

  test('无有效数据行时返回空列表', () => {
    const { transfers, skipped } = extractTransfers([['地址', '数量']]);

    expect(transfers).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  test('重复地址发出警告标记', () => {
    const rows = [
      ['地址', '数量'],
      [VALID_ADDRESS, 1],
      [VALID_ADDRESS.toLowerCase(), 2]
    ];

    const { transfers } = extractTransfers(rows);

    expect(transfers).toHaveLength(2);
    expect(transfers[1].duplicate).toBe(true);
  });

  test('skipHeader=false 时首行也作为数据处理', () => {
    const rows = [[VALID_ADDRESS, 1]];

    const { transfers } = extractTransfers(rows, { skipHeader: false });

    expect(transfers).toHaveLength(1);
  });
});

describe('readTransferSheet - 读取 xlsx 文件', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeXlsx(fileName, rows) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const filePath = path.join(tmpDir, fileName);
    XLSX.writeFile(workbook, filePath);
    return filePath;
  }

  test('读取真实 xlsx 文件并解析转账记录', () => {
    const filePath = writeXlsx('list.xlsx', [
      ['地址', '数量'],
      [VALID_ADDRESS, 100],
      [VALID_ADDRESS_2, 2.5]
    ]);

    const { transfers, skipped } = readTransferSheet(filePath);

    expect(skipped).toHaveLength(0);
    expect(transfers).toHaveLength(2);
    expect(transfers[0].amountUnits).toBe(BigInt(100) * BigInt(10) ** BigInt(18));
  });

  test('中间存在空白行时行号仍与表格真实行号一致', () => {
    // 行1=表头, 行2=有效, 行3=空白, 行4=无效地址, 行5=有效
    const filePath = writeXlsx('blank.xlsx', [
      ['地址', '数量'],
      [VALID_ADDRESS, 100],
      [],
      ['bad-address', 5],
      [VALID_ADDRESS_2, 2]
    ]);

    const { transfers, skipped } = readTransferSheet(filePath);

    expect(transfers.map(t => t.rowNumber)).toEqual([2, 5]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].rowNumber).toBe(4);
  });

  test('文件不存在时抛错', () => {
    expect(() => readTransferSheet(path.join(tmpDir, 'missing.xlsx'))).toThrow('文件不存在');
  });

  test('非 xlsx 文件抛错', () => {
    const filePath = path.join(tmpDir, 'bad.xlsx');
    fs.writeFileSync(filePath, '这不是一个 xlsx 文件');

    expect(() => readTransferSheet(filePath)).toThrow('读取 xlsx 失败');
  });
});
