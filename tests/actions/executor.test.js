import { jest } from '@jest/globals';

// 测试地址 - 使用有效的 40 字符十六进制地址
const TEST_ADDRESS = '0x1234567890123456789012345678901234567890';
const TOKEN_ADDRESS = '0xabcd1234567890abcdef1234567890abcdef1234';
const CONTRACT_ADDRESS = '0xdef01234567890abcdef1234567890abcdef1234';

// 创建一个共享的 mockLogger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// 创建 mock call 函数
const mockCall = jest.fn();

// 创建 mockRpc
const mockRpc = {
  getNativeBalance: jest.fn().mockResolvedValue('1000000000000000000'),
  call: mockCall,
  provider: {
    getFeeData: jest.fn().mockResolvedValue({ gasPrice: BigInt(1000000000) })
  }
};

// 模拟 Wallet 类
class MockWallet {
  constructor(privateKey, provider) {
    this.privateKey = privateKey;
    this.provider = provider;
    this.address = TEST_ADDRESS;
  }

  async sendTransaction(tx) {
    return {
      hash: '0xabc',
      wait: async () => ({ blockNumber: 1, status: 1 })
    };
  }
}

jest.unstable_mockModule('../../src/core/logger.js', () => ({
  Logger: jest.fn(() => mockLogger)
}));

jest.unstable_mockModule('../../src/core/rpc.js', () => ({
  RpcClient: jest.fn()
}));

jest.unstable_mockModule('ethers', () => ({
  ...jest.requireActual('ethers'),
  JsonRpcProvider: jest.fn(),
  Wallet: MockWallet
}));

const { executeContracts } = await import('../../src/actions/executor.js');

describe('executeContracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 重置 mockCall
    mockCall.mockReset();
  });

  test('执行后余额变化应该打印成功日志', async () => {
    // 设置余额变化场景：执行前余额为1，执行后余额为0
    mockCall
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000001') // 执行前余额
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000000'); // 执行后余额

    const accounts = [{ address: TEST_ADDRESS, privateKey: '0xabc1234567890abcdef1234567890abcdef1234567890abcdef12345678900001' }];
    const tokens = { targetToken: { address: TOKEN_ADDRESS, decimals: 18, name: 'Test Token' } };
    const contracts = { targetContract: { address: CONTRACT_ADDRESS, input: '0x123456' } };

    await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    // 验证余额变化日志
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('余额已变化'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('执行成功'));
  });

  test('执行后余额不变应该打印 WARN 日志', async () => {
    // 设置余额不变场景：执行前后余额都是1
    mockCall.mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001');

    const accounts = [{ address: TEST_ADDRESS, privateKey: '0xabc1234567890abcdef1234567890abcdef1234567890abcdef12345678900001' }];
    const tokens = { targetToken: { address: TOKEN_ADDRESS, decimals: 18, name: 'Test Token' } };
    const contracts = { targetContract: { address: CONTRACT_ADDRESS, input: '0x123456' } };

    await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    // 验证余额未变化警告
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('余额未变化'));
  });
});
