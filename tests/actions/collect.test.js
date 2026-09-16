import { jest } from '@jest/globals';

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890';
const TOKEN_ADDRESS = '0xabcd1234567890abcdef1234567890abcdef1234';
const TARGET_ADDRESS = '0xdef0000000000000000000000000000000000000';

const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
});

let mockLogger = createMockLogger();

const createMockRpc = () => ({
  call: jest.fn(),
  getNativeBalance: jest.fn().mockResolvedValue(BigInt(0)),
  provider: {
    getFeeData: jest.fn().mockResolvedValue({ gasPrice: BigInt(1000000000) }),
    estimateGas: jest.fn().mockResolvedValue(BigInt(50000))
  }
});

let mockRpc = createMockRpc();

class MockWallet {
  constructor(privateKey, provider) {
    this.privateKey = privateKey;
    this.provider = provider;
  }

  async sendTransaction(tx) {
    return {
      hash: '0xabc123',
      wait: async () => ({ blockNumber: 1, status: 1, gasUsed: BigInt(65000) })
    };
  }
}

// 获取实际的 ethers 模块
let ethersModule;
try {
  ethersModule = jest.requireActual('ethers');
} catch (e) {
  ethersModule = {};
}

// Mock ethers - 必须导出为 ethers 命名导出
jest.unstable_mockModule('ethers', () => {
  const ethersObj = {
    ...ethersModule,
    Wallet: MockWallet,
    formatUnits: (value, decimals = 18) => {
      const divisor = BigInt(10) ** BigInt(decimals);
      return (value / divisor).toString();
    },
    zeroPadValue: (value, bytes) => {
      // 简单模拟：如果是 BigInt，转换为 Buffer
      if (typeof value === 'bigint') {
        const hex = value.toString(16).slice(2) || '0';
        const padded = hex.padStart(bytes * 2, '0');
        return Buffer.from(padded.padEnd(bytes * 2, '0'), 'hex');
      }
      return Buffer.alloc(bytes);
    },
    hexlify: (val) => '0x' + val.toString('hex')
  };

  return {
    ethers: ethersObj,
    Wallet: MockWallet,
    JsonRpcProvider: jest.fn()
  };
});

const { collectTokens } = await import('../../src/actions/collect.js');

describe('collectTokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    mockRpc = createMockRpc();
  });

  test('余额为0时应跳过归集', async () => {
    mockRpc.call.mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000000');

    const accounts = [{ address: TEST_ADDRESS, privateKey: '0xabc123' }];
    const tokens = [{ address: TOKEN_ADDRESS, decimals: 18, symbol: 'Test Token' }];

    const results = await collectTokens(accounts, tokens, TARGET_ADDRESS, mockRpc, mockLogger);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].txHash).toBe('');
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('余额为 0'));
  });

  test('预估失败时应跳过归集', async () => {
    mockRpc.call.mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000de6b27b');
    mockRpc.provider.estimateGas.mockRejectedValue(new Error('execution reverted'));

    const accounts = [{ address: TEST_ADDRESS, privateKey: '0xabc123' }];
    const tokens = [{ address: TOKEN_ADDRESS, decimals: 18, symbol: 'Test Token' }];

    const results = await collectTokens(accounts, tokens, TARGET_ADDRESS, mockRpc, mockLogger);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('预估失败');
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('预估失败'));
  });

  test('多账户多代币场景', async () => {
    const TEST_ADDRESS_2 = '0xabcd567890123456789012345678901234567890';
    mockRpc.call
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000de6b27b')
      .mockResolvedValueOnce('0x')
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000de6b27b')
      .mockResolvedValueOnce('0x');

    const accounts = [
      { address: TEST_ADDRESS, privateKey: '0xabc123' },
      { address: TEST_ADDRESS_2, privateKey: '0xdef456' }
    ];
    const tokens = [{ address: TOKEN_ADDRESS, decimals: 18, symbol: 'Test Token' }];

    const results = await collectTokens(accounts, tokens, TARGET_ADDRESS, mockRpc, mockLogger);

    expect(results).toHaveLength(2);
    expect(results[0].address).toBe(TEST_ADDRESS);
    expect(results[1].address).toBe(TEST_ADDRESS_2);
  });
});
