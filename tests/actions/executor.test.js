import { jest } from '@jest/globals';

// 测试地址
const TEST_ADDRESS = '0x1234567890123456789012345678901234567890';
const TEST_ADDRESS_2 = '0xabcd567890123456789012345678901234567890';
const TOKEN_ADDRESS = '0xabcd1234567890abcdef1234567890abcdef1234';
const CONTRACT_ADDRESS = '0xdef01234567890abcdef1234567890abcdef1234';
const CONTRACT_ADDRESS_2 = '0x9876543210fedcba9876543210fedcba98765432';

// mockLogger 工厂函数
const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
});

let mockLogger = createMockLogger();

// mockRpc 工厂函数
const createMockRpc = () => ({
  getNativeBalance: jest.fn().mockResolvedValue('1000000000000000000'),
  call: jest.fn(),
  provider: {
    getFeeData: jest.fn().mockResolvedValue({ gasPrice: BigInt(1000000000) }),
    estimateGas: jest.fn().mockResolvedValue(BigInt(50000))
  }
});

let mockRpc = createMockRpc();

// Wallet mock 行为标志
let walletBehavior = 'success';

// Mock Wallet 类
class MockWallet {
  constructor(privateKey, provider) {
    this.privateKey = privateKey;
    this.provider = provider;
  }

  async sendTransaction(tx) {
    if (walletBehavior === 'success') {
      return {
        hash: '0xabc',
        wait: async () => ({ blockNumber: 1, status: 1, gasUsed: BigInt(21000) })
      };
    } else {
      return {
        hash: '0xdef',
        wait: async () => ({ blockNumber: 1, status: 0, gasUsed: BigInt(21000) })
      };
    }
  }
}

// 获取实际的 ethers 模块用于扩展
let ethersModule;
try {
  ethersModule = jest.requireActual('ethers');
} catch (e) {
  // 如果获取失败，使用基础对象
  ethersModule = {};
}

// Mock ethers - 关键是要正确导出 ethers 对象
jest.unstable_mockModule('ethers', () => {
  // 创建包含 Wallet 的 ethers 对象
  const ethersObj = {
    ...ethersModule,
    Wallet: MockWallet
  };

  return {
    // 导出 ethers 作为命名导出
    ethers: ethersObj,
    // 同时直接导出 Wallet 以兼容其他导入方式
    Wallet: MockWallet,
    JsonRpcProvider: jest.fn()
  };
});

const { executeContracts } = await import('../../src/actions/executor.js');

describe('executeContracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 重置为默认行为
    walletBehavior = 'success';
    mockLogger = createMockLogger();
    mockRpc = createMockRpc();
  });

  test('执行后余额变化应该打印成功日志', async () => {
    mockRpc.call
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000001')
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000000');

    const accounts = [{ address: TEST_ADDRESS, privateKey: '0xabc123' }];
    const tokens = { targetToken: { address: TOKEN_ADDRESS, decimals: 18, name: 'Test Token' } };
    const contracts = { targetContract: { address: CONTRACT_ADDRESS, input: '0x123456' } };

    const results = await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].transactions).toHaveLength(1);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('余额已变化'));
  });

  test('执行后余额不变应该打印 WARN 日志', async () => {
    mockRpc.call.mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001');

    const accounts = [{ address: TEST_ADDRESS, privateKey: '0xabc123' }];
    const tokens = { targetToken: { address: TOKEN_ADDRESS, decimals: 18, name: 'Test Token' } };
    const contracts = { targetContract: { address: CONTRACT_ADDRESS, input: '0x123456' } };

    await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('余额未变化'));
  });

  test('交易执行失败应该标记为失败并返回错误信息', async () => {
    // 设置为失败行为
    walletBehavior = 'fail';

    mockRpc.call
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000001')
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000001');

    const accounts = [{ address: TEST_ADDRESS, privateKey: '0xabc123' }];
    const tokens = { targetToken: { address: TOKEN_ADDRESS, decimals: 18, name: 'Test Token' } };
    const contracts = { targetContract: { address: CONTRACT_ADDRESS, input: '0x123456' } };

    const results = await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('部分交易执行失败');
  });

  test('多账户场景 - 应该正确处理多个账户', async () => {
    mockRpc.call.mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001');

    const accounts = [
      { address: TEST_ADDRESS, privateKey: '0xabc123' },
      { address: TEST_ADDRESS_2, privateKey: '0xdef456' }
    ];
    const tokens = { targetToken: { address: TOKEN_ADDRESS, decimals: 18, name: 'Test Token' } };
    const contracts = { targetContract: { address: CONTRACT_ADDRESS, input: '0x123456' } };

    const results = await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    expect(results).toHaveLength(2);
    expect(results[0].address).toBe(TEST_ADDRESS);
    expect(results[1].address).toBe(TEST_ADDRESS_2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  });

  test('多合约场景 - 应该正确执行多个合约', async () => {
    mockRpc.call
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000001')
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000001')
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000000')
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000000');

    const accounts = [{ address: TEST_ADDRESS, privateKey: '0xabc123' }];
    const tokens = { targetToken: { address: TOKEN_ADDRESS, decimals: 18, name: 'Test Token' } };
    const contracts = {
      contract1: { address: CONTRACT_ADDRESS, input: '0x123456' },
      contract2: { address: CONTRACT_ADDRESS_2, input: '0xabcdef' }
    };

    const results = await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    expect(results).toHaveLength(1);
    expect(results[0].transactions).toHaveLength(2);
    expect(results[0].transactions[0].contractName).toBe('contract1');
    expect(results[0].transactions[1].contractName).toBe('contract2');
  });

  test('返回值应该包含正确的结构', async () => {
    mockRpc.call
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000001')
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000000');

    const accounts = [{ address: TEST_ADDRESS, privateKey: '0xabc123' }];
    const tokens = { targetToken: { address: TOKEN_ADDRESS, decimals: 18, name: 'Test Token' } };
    const contracts = { targetContract: { address: CONTRACT_ADDRESS, input: '0x123456' } };

    const results = await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    expect(results[0]).toHaveProperty('success');
    expect(results[0]).toHaveProperty('address');
    expect(results[0]).toHaveProperty('transactions');
    expect(results[0]).toHaveProperty('balanceChanges');
    expect(results[0].transactions[0]).toHaveProperty('contractName');
    expect(results[0].transactions[0]).toHaveProperty('txHash');
    expect(results[0].transactions[0]).toHaveProperty('status');
    expect(results[0].transactions[0]).toHaveProperty('gasUsed');
  });

  test('executeAccountContracts 返回结果对象包含所有必要字段', async () => {
    mockRpc.call
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000001')
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000000');

    const accounts = [{ address: TEST_ADDRESS, privateKey: '0xabc123' }];
    const tokens = { targetToken: { address: TOKEN_ADDRESS, decimals: 18, name: 'Test Token' } };
    const contracts = { targetContract: { address: CONTRACT_ADDRESS, input: '0x123456' } };

    const results = await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    // 验证结果结构
    expect(results[0].success).toBe(true);
    expect(results[0].address).toBe(TEST_ADDRESS);
    expect(results[0].transactions.length).toBeGreaterThan(0);
    expect(results[0].balanceChanges.targetToken).toBeDefined();
    expect(results[0].balanceChanges.targetToken.before).toBeDefined();
    expect(results[0].balanceChanges.targetToken.after).toBeDefined();
  });
});
