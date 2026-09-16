import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

const ADDR_A = '0x1111111111111111111111111111111111111111';
const ADDR_B = '0x2222222222222222222222222222222222222222';
const ADDR_C = '0x3333333333333333333333333333333333333333';

// 代币：USDT（6 位精度，地址以 0xdAC17F 开头，截前 4 字符得 0xdAC1）
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
// 代币：AIA（18 位精度，地址以 0xABC123 开头）
const AIA_ADDRESS = '0xABC1230000000000000000000000000000000000';

const UNIT_18 = BigInt(10) ** BigInt(18);

const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

// queryTokenBalance 内部依赖 rpcClient.call；createMockRpc 用 queryTokenBalance 的注入点
const createMockRpc = ({ nativeBalances = {}, tokenBalances = {} } = {}) => ({
  getNativeBalance: jest.fn(async (addr) => {
    if (addr in nativeBalances) {
      return BigInt(nativeBalances[addr]).toString();
    }
    // 默认返回 1 个原生币
    return UNIT_18.toString();
  }),
  call: jest.fn(async (to, data) => {
    // 从 calldata 0x70a08231 + 32字节地址 中提取目标地址
    const target = '0x' + data.slice(2 + 8 + 24, 2 + 8 + 64);
    const tokenAddr = to.toLowerCase();
    const map = tokenBalances[tokenAddr] || {};
    if (target in map) {
      // 返回 32 字节 hex 字符串
      const v = BigInt(map[target]);
      return '0x' + v.toString(16).padStart(64, '0');
    }
    // 默认 100 个 token（按各自精度：USDT=6 位=100_000_000，AIA=18 位=100*10^18）
    const defaultVal = tokenAddr === USDT_ADDRESS.toLowerCase()
      ? BigInt(100) * BigInt(10) ** BigInt(6)
      : BigInt(100) * UNIT_18;
    return '0x' + defaultVal.toString(16).padStart(64, '0');
  })
});

// 模块在 src/index.js 之前 mock ethers（queryTokenBalance 用 isAddress/getAddress/zeroPadValue/hexlify/toBigInt）
let ethersModule;
try {
  ethersModule = jest.requireActual('ethers');
} catch (e) {
  ethersModule = {};
}

jest.unstable_mockModule('ethers', () => {
  return {
    ethers: { ...ethersModule },
    ...ethersModule
  };
});

const { extractAddressesFromSheet, runBalanceExport } = await import('../../src/actions/balance-export.js');

describe('extractAddressesFromSheet - 从 xlsx 提取地址', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'balance-export-extract-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeXlsx(rows) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const filePath = path.join(tmpDir, 'input.xlsx');
    XLSX.writeFile(workbook, filePath);
    return filePath;
  }

  test('多列无表头：展平所有非空单元格并 checksum', () => {
    const filePath = writeXlsx([
      [ADDR_A, ADDR_B],
      [ADDR_C, '']
    ]);
    const { addresses, skipped } = extractAddressesFromSheet(filePath);

    expect(addresses).toEqual([
      ADDR_A.toLowerCase().replace(/^0x/, ''),
      ADDR_B.toLowerCase().replace(/^0x/, ''),
      ADDR_C.toLowerCase().replace(/^0x/, '')
    ].map(a => '0x' + a));
    // checksum 形式返回（ethers.getAddress）
    expect(addresses[0]).toBe(ethersModule.getAddress(ADDR_A));
    expect(skipped).toHaveLength(0);
  });

  test('空白单元格被跳过，无效地址计入 skipped', () => {
    const filePath = writeXlsx([
      [ADDR_A, '不是地址'],
      ['', ADDR_B]
    ]);
    const { addresses, skipped } = extractAddressesFromSheet(filePath);

    expect(addresses).toHaveLength(2);
    expect(addresses).toContain(ethersModule.getAddress(ADDR_A));
    expect(addresses).toContain(ethersModule.getAddress(ADDR_B));
    expect(skipped).toHaveLength(1);
    expect(skipped[0].raw).toBe('不是地址');
  });

  test('重复地址只保留首个并标记', () => {
    const filePath = writeXlsx([
      [ADDR_A, ADDR_A],
      [ADDR_B]
    ]);
    const { addresses, duplicates } = extractAddressesFromSheet(filePath);

    expect(addresses).toHaveLength(2);
    expect(addresses[0]).toBe(ethersModule.getAddress(ADDR_A));
    expect(addresses[1]).toBe(ethersModule.getAddress(ADDR_B));
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].address).toBe(ethersModule.getAddress(ADDR_A));
  });

  test('文件不存在时抛错', () => {
    expect(() => extractAddressesFromSheet(path.join(tmpDir, 'missing.xlsx')))
      .toThrow(/文件不存在/);
  });

  test('非 xlsx 文件（魔数不匹配）抛错', () => {
    const filePath = path.join(tmpDir, 'fake.xlsx');
    fs.writeFileSync(filePath, '这不是 xlsx 内容');
    expect(() => extractAddressesFromSheet(filePath))
      .toThrow(/不是有效的 xlsx 格式/);
  });

  test('xlsx 文件结构损坏时（魔数通过但解析失败）抛错', () => {
    // 仅 zip 魔数通过、但内部不是 workbook；SheetJS.read 会抛错
    const filePath = path.join(tmpDir, 'broken.xlsx');
    const buf = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, // PK\x03\x04
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00
    ]);
    fs.writeFileSync(filePath, buf);
    expect(() => extractAddressesFromSheet(filePath))
      .toThrow(/读取 xlsx 失败/);
  });
});

describe('runBalanceExport - 完整导出流程', () => {
  let tmpDir;
  let logger;
  let rpc;
  let config;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'balance-export-run-'));
    logger = createMockLogger();
    rpc = createMockRpc();
    config = {
      network: { rpcUrl: 'http://localhost:8545', chainId: 1, nativeSymbol: 'ETH' },
      accounts: [],
      tokens: [
        { address: USDT_ADDRESS, symbol: 'USDT', decimals: 6 },
        { address: AIA_ADDRESS,  symbol: 'AIA',  decimals: 18 }
      ],
      contracts: {}
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeInputXlsx(rows) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    return path.join(tmpDir, 'input.xlsx');
  }

  test('正常导出：表头格式为 原生币(SYMBOL) 与 SYMBOL(0xXXXX)', async () => {
    const inputPath = writeInputXlsx([[ADDR_A, ADDR_B]]);
    const outputPath = path.join(tmpDir, 'out.xlsx');
    // 写入输入
    const sheet = XLSX.utils.aoa_to_sheet([[ADDR_A, ADDR_B]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, inputPath);

    await runBalanceExport({
      config,
      inputPath,
      outputPath,
      rpcClient: rpc,
      logger
    });

    const out = XLSX.readFile(outputPath);
    const rows = XLSX.utils.sheet_to_json(out.Sheets[out.SheetNames[0]], { header: 1 });

    expect(rows[0]).toEqual(['地址', '原生币(ETH)', 'USDT(0xdAC1)', 'AIA(0xABC1)']);
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe(ethersModule.getAddress(ADDR_A));
    expect(rows[2][0]).toBe(ethersModule.getAddress(ADDR_B));
  });

  test('未指定 outputPath 时使用默认 output/balance-<timestamp>.xlsx', async () => {
    const inputPath = path.join(tmpDir, 'in.xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([[ADDR_A]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, inputPath);

    // 切到 tmpDir 以便 output/ 落在临时目录
    const cwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await runBalanceExport({
        config,
        inputPath,
        rpcClient: rpc,
        logger
      });
      const outputDir = path.join(tmpDir, 'output');
      expect(fs.existsSync(outputDir)).toBe(true);
      const files = fs.readdirSync(outputDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^balance-\d{4}-\d{2}-\d{2}T.*\.xlsx$/);
    } finally {
      process.chdir(cwd);
    }
  });

  test('没有 tokens 时仅输出 地址 与 原生币(SYMBOL) 两列', async () => {
    const inputPath = path.join(tmpDir, 'in.xlsx');
    config.tokens = {};
    const sheet = XLSX.utils.aoa_to_sheet([[ADDR_A]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, inputPath);
    const outputPath = path.join(tmpDir, 'out.xlsx');

    await runBalanceExport({ config, inputPath, outputPath, rpcClient: rpc, logger });

    const out = XLSX.readFile(outputPath);
    const rows = XLSX.utils.sheet_to_json(out.Sheets[out.SheetNames[0]], { header: 1 });
    expect(rows[0]).toEqual(['地址', '原生币(ETH)']);
    expect(rows[1]).toHaveLength(2);
  });

  test('所有地址非法时抛错', async () => {
    const inputPath = path.join(tmpDir, 'in.xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([['无效1', '无效2']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, inputPath);

    await expect(runBalanceExport({
      config, inputPath, outputPath: path.join(tmpDir, 'o.xlsx'),
      rpcClient: rpc, logger
    })).rejects.toThrow(/没有有效地址/);
  });

  test('RPC 单笔失败时该单元格写占位 --，其他单元格继续', async () => {
    const inputPath = path.join(tmpDir, 'in.xlsx');
    const outputPath = path.join(tmpDir, 'o.xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([[ADDR_A, ADDR_B]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, inputPath);

    // 让 ADDR_A 的原生币查询抛错
    rpc.getNativeBalance = jest.fn(async (addr) => {
      if (addr.toLowerCase() === ADDR_A.toLowerCase()) {
        throw new Error('RPC timeout');
      }
      return UNIT_18.toString();
    });

    await runBalanceExport({ config, inputPath, outputPath, rpcClient: rpc, logger });

    const out = XLSX.readFile(outputPath);
    const rows = XLSX.utils.sheet_to_json(out.Sheets[out.SheetNames[0]], { header: 1 });

    expect(rows[1][1]).toBe('--'); // ADDR_A 原生币
    expect(rows[1][2]).not.toBe('--'); // ADDR_A USDT 应成功
    expect(rows[2][1]).not.toBe('--'); // ADDR_B 原生币应成功
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('RPC timeout'));
  });

  test('单个 ERC20 token RPC 失败时该单元格写占位 --', async () => {
    const inputPath = path.join(tmpDir, 'in.xlsx');
    const outputPath = path.join(tmpDir, 'o.xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([[ADDR_A]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, inputPath);

    // 让所有 ERC20 查询抛错
    rpc.call = jest.fn(async () => {
      throw new Error('token RPC down');
    });

    await runBalanceExport({ config, inputPath, outputPath, rpcClient: rpc, logger });

    const out = XLSX.readFile(outputPath);
    const rows = XLSX.utils.sheet_to_json(out.Sheets[out.SheetNames[0]], { header: 1 });

    expect(rows[1][2]).toBe('--'); // USDT
    expect(rows[1][3]).toBe('--'); // AIA
    expect(rows[1][1]).not.toBe('--'); // 原生币不受影响
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('token RPC down'));
  });

  test('重复地址在日志中记录一次 warn，且输出表只出现一次', async () => {
    const inputPath = path.join(tmpDir, 'in.xlsx');
    const outputPath = path.join(tmpDir, 'o.xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([[ADDR_A, ADDR_A, ADDR_B]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, inputPath);

    await runBalanceExport({ config, inputPath, outputPath, rpcClient: rpc, logger });

    const out = XLSX.readFile(outputPath);
    const rows = XLSX.utils.sheet_to_json(out.Sheets[out.SheetNames[0]], { header: 1 });
    const addressRows = rows.slice(1).map(r => r[0]);
    expect(addressRows).toHaveLength(2);
    expect(addressRows).toContain(ethersModule.getAddress(ADDR_A));
    expect(addressRows).toContain(ethersModule.getAddress(ADDR_B));

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('重复'));
  });

  test('无效地址记 warn 但不中断整体流程', async () => {
    const inputPath = path.join(tmpDir, 'in.xlsx');
    const outputPath = path.join(tmpDir, 'o.xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([['无效地址', ADDR_A]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, inputPath);

    await runBalanceExport({ config, inputPath, outputPath, rpcClient: rpc, logger });

    const out = XLSX.readFile(outputPath);
    const rows = XLSX.utils.sheet_to_json(out.Sheets[out.SheetNames[0]], { header: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe(ethersModule.getAddress(ADDR_A));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('无效'));
  });
});