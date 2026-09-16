import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

const SENDER_ADDRESS = '0x1234567890123456789012345678901234567890';
const RECEIVER_1 = '0xdef0000000000000000000000000000000000001';
const RECEIVER_2 = '0xdef0000000000000000000000000000000000002';

const UNIT_18 = BigInt(10) ** BigInt(18);

const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

const createMockRpc = () => ({
  // 默认返回充足的原生币余额（1000 个）
  getNativeBalance: jest.fn().mockResolvedValue((BigInt(1000) * UNIT_18).toString()),
  provider: {
    getFeeData: jest.fn().mockResolvedValue({ gasPrice: BigInt(1000000000) }),
    estimateGas: jest.fn().mockResolvedValue(BigInt(21000))
  }
});

// 已发送交易记录
const sentTxs = [];
// 可配置的交易回执
let mockReceipt = { blockNumber: 1, status: 1 };

class MockWallet {
  constructor(privateKey, provider) {
    this.privateKey = privateKey;
    this.provider = provider;
  }

  async sendTransaction(tx) {
    sentTxs.push(tx);
    return {
      hash: `0xhash${sentTxs.length}`,
      wait: async () => mockReceipt
    };
  }
}

// 获取实际的 ethers 模块，只替换 Wallet
let ethersModule;
try {
  ethersModule = jest.requireActual('ethers');
} catch (e) {
  ethersModule = {};
}

jest.unstable_mockModule('ethers', () => {
  return {
    ethers: { ...ethersModule, Wallet: MockWallet },
    Wallet: MockWallet,
    JsonRpcProvider: jest.fn()
  };
});

const { distributeNative, runDistribute } = await import('../../src/actions/distribute.js');

const senderAccount = { address: SENDER_ADDRESS, privateKey: '0xabc123' };

const makeTransfers = () => [
  { rowNumber: 2, address: RECEIVER_1, rawAmount: '100', amountUnits: BigInt(100) * UNIT_18 },
  { rowNumber: 3, address: RECEIVER_2, rawAmount: '2.5', amountUnits: BigInt(25) * UNIT_18 / BigInt(10) }
];

describe('distributeNative - 批量分发原生币', () => {
  let logger;
  let rpc;

  beforeEach(() => {
    jest.clearAllMocks();
    sentTxs.length = 0;
    mockReceipt = { blockNumber: 1, status: 1 };
    logger = createMockLogger();
    rpc = createMockRpc();
  });

  test('正常分发所有转账，交易携带正确的 to 与 value', async () => {
    const outcome = await distributeNative({
      senderAccount, transfers: makeTransfers(), nativeSymbol: 'ETH', rpcClient: rpc, logger
    });

    expect(outcome.successCount).toBe(2);
    expect(outcome.failedCount).toBe(0);
    expect(sentTxs).toHaveLength(2);

    expect(sentTxs[0].to).toBe(RECEIVER_1);
    expect(sentTxs[0].value).toBe(BigInt(100) * UNIT_18);
    expect(sentTxs[1].to).toBe(RECEIVER_2);
    expect(sentTxs[1].value).toBe(BigInt(25) * UNIT_18 / BigInt(10));

    expect(outcome.results[0].txHash).toBe('0xhash1');
    expect(outcome.results[1].txHash).toBe('0xhash2');
  });

  test('余额（含 Gas 预留）不足时整体中止，不发送任何交易', async () => {
    // 余额 50，但需要 102.5 + Gas
    rpc.getNativeBalance.mockResolvedValue((BigInt(50) * UNIT_18).toString());

    await expect(distributeNative({
      senderAccount, transfers: makeTransfers(), nativeSymbol: 'ETH', rpcClient: rpc, logger
    })).rejects.toThrow('余额不足');

    expect(sentTxs).toHaveLength(0);
  });

  test('余额够转账但不够 Gas 时同样中止', async () => {
    // 恰好等于转账总额，没有 Gas 余量
    const total = BigInt(1025) * UNIT_18 / BigInt(10);
    rpc.getNativeBalance.mockResolvedValue(total.toString());

    await expect(distributeNative({
      senderAccount, transfers: makeTransfers(), nativeSymbol: 'ETH', rpcClient: rpc, logger
    })).rejects.toThrow('余额不足');

    expect(sentTxs).toHaveLength(0);
  });

  test('dry-run 模式只预览，不发送任何交易', async () => {
    const outcome = await distributeNative({
      senderAccount, transfers: makeTransfers(), nativeSymbol: 'ETH',
      rpcClient: rpc, logger, dryRun: true
    });

    expect(outcome.dryRun).toBe(true);
    expect(sentTxs).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('预览'));
  });

  test('单笔预估失败不中断其余转账', async () => {
    rpc.provider.estimateGas
      .mockRejectedValueOnce(new Error('insufficient funds'))
      .mockResolvedValueOnce(BigInt(21000));

    const outcome = await distributeNative({
      senderAccount, transfers: makeTransfers(), nativeSymbol: 'ETH', rpcClient: rpc, logger
    });

    expect(outcome.successCount).toBe(1);
    expect(outcome.failedCount).toBe(1);
    expect(outcome.results[0].success).toBe(false);
    expect(outcome.results[0].error).toBe('预估失败');
    expect(outcome.results[1].success).toBe(true);
    expect(sentTxs).toHaveLength(1);
  });

  test('交易回执 status 为 0 时记为失败', async () => {
    mockReceipt = { blockNumber: 1, status: 0 };

    const outcome = await distributeNative({
      senderAccount, transfers: makeTransfers(), nativeSymbol: 'ETH', rpcClient: rpc, logger
    });

    expect(outcome.failedCount).toBe(2);
    expect(outcome.results[0].error).toBe('交易失败');
  });

  test('转账记录为空时抛错', async () => {
    await expect(distributeNative({
      senderAccount, transfers: [], nativeSymbol: 'ETH', rpcClient: rpc, logger
    })).rejects.toThrow('转账记录为空');
  });
});

describe('runDistribute - 从配置与 xlsx 文件分发', () => {
  let logger;
  let rpc;
  let tmpDir;

  beforeEach(() => {
    jest.clearAllMocks();
    sentTxs.length = 0;
    mockReceipt = { blockNumber: 1, status: 1 };
    logger = createMockLogger();
    rpc = createMockRpc();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'distribute-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeXlsx(rows) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const filePath = path.join(tmpDir, 'list.xlsx');
    XLSX.writeFile(workbook, filePath);
    return filePath;
  }

  const makeConfig = (distributor = {}) => ({
    network: { rpcUrl: 'http://localhost:8545', chainId: 1, nativeSymbol: 'ETH' },
    accounts: [senderAccount],
    tokens: {},
    contracts: {},
    distributor
  });

  test('按配置读取 xlsx 并完成分发', async () => {
    const filePath = writeXlsx([
      ['地址', '数量'],
      [RECEIVER_1, 100],
      [RECEIVER_2, 2.5]
    ]);

    const results = await runDistribute(makeConfig(), filePath, rpc, logger);

    expect(results).toHaveLength(2);
    expect(sentTxs).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('默认使用第一个账户'));
  });

  test('distributor.senderAddress 不在 accounts 中时抛错', async () => {
    const filePath = writeXlsx([['地址', '数量'], [RECEIVER_1, 1]]);

    await expect(runDistribute(
      makeConfig({ senderAddress: '0x9999999999999999999999999999999999999999' }),
      filePath, rpc, logger
    )).rejects.toThrow('不在 accounts 配置中');

    expect(sentTxs).toHaveLength(0);
  });

  test('表格中没有有效记录时抛错', async () => {
    const filePath = writeXlsx([['地址', '数量']]);

    await expect(runDistribute(makeConfig(), filePath, rpc, logger))
      .rejects.toThrow('没有有效的转账记录');
  });

  test('无效行被跳过并记录警告，有效行正常转账', async () => {
    const filePath = writeXlsx([
      ['地址', '数量'],
      ['无效地址', 100],
      [RECEIVER_1, 1]
    ]);

    const results = await runDistribute(makeConfig(), filePath, rpc, logger);

    expect(results).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('行已跳过'));
  });
});
