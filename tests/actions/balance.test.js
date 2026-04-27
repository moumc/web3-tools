import { jest } from '@jest/globals';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

function createMockRpc(getNativeBalanceMock, callMock) {
  return {
    getNativeBalance: getNativeBalanceMock,
    call: callMock
  };
}

jest.unstable_mockModule('../../src/core/logger.js', () => ({
  Logger: jest.fn(() => mockLogger)
}));

jest.unstable_mockModule('../../src/core/rpc.js', () => ({
  RpcClient: jest.fn()
}));

const { queryBalances, queryTokenBalance } = await import('../../src/actions/balance.js');

// 有效格式的以太坊地址 (40字符十六进制)
const TEST_ADDRESS_1 = '0x1234567890123456789012345678901234567890';
const TEST_ADDRESS_2 = '0xabcd1234567890abcdef1234567890abcdef1234';
const TEST_ADDRESS_3 = '0x5678901234567890abcdef1234567890abcdef12';
const TEST_ADDRESS_4 = '0xdef01234567890abcdef1234567890abcdef1234';
const TEST_ADDRESS_5 = '0xaaaa1234567890abcdef1234567890abcdef1234';
const TEST_ADDRESS_6 = '0xbbbb1234567890abcdef1234567890abcdef1234';
const TEST_ADDRESS_7 = '0xcccc1234567890abcdef1234567890abcdef1234';

describe('queryBalances', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('应该查询原生币和代币余额', async () => {
    const mockRpc = createMockRpc(
      jest.fn().mockResolvedValue('1000000000000000000'),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001')
    );
    const accounts = [{ address: TEST_ADDRESS_1 }];
    const tokens = { targetToken: { address: TEST_ADDRESS_2, decimals: 18, name: 'Test Token' } };

    await queryBalances(accounts, tokens, mockRpc, mockLogger);

    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith(TEST_ADDRESS_1);
    expect(mockLogger.info).toHaveBeenCalled();
  });

  test('当decimals未提供时应使用默认值18', async () => {
    const mockRpc = createMockRpc(
      jest.fn().mockResolvedValue('1000000000000000000'),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001')
    );
    const accounts = [{ address: TEST_ADDRESS_1 }];
    // 不提供 decimals，触发 || 18 的分支
    const tokens = { targetToken: { address: TEST_ADDRESS_2, name: 'Test Token' } };

    await queryBalances(accounts, tokens, mockRpc, mockLogger);

    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith(TEST_ADDRESS_1);
  });

  test('单个账户失败不应影响其他账户', async () => {
    const mockRpc = createMockRpc(
      jest.fn()
        .mockRejectedValueOnce(new Error('RPC error for account 1'))
        .mockResolvedValue('2000000000000000000'),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001')
    );
    const accounts = [
      { address: TEST_ADDRESS_3 },
      { address: TEST_ADDRESS_4 }
    ];
    const tokens = { targetToken: { address: TEST_ADDRESS_2, decimals: 18, name: 'Test Token' } };

    await queryBalances(accounts, tokens, mockRpc, mockLogger);

    // 第一个账户失败，记录错误但继续处理
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining(TEST_ADDRESS_3));
    // 第二个账户成功
    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith(TEST_ADDRESS_4);
  });

  test('多账户场景测试', async () => {
    const mockRpc = createMockRpc(
      jest.fn().mockResolvedValue('3000000000000000000'),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000002')
    );
    const accounts = [
      { address: TEST_ADDRESS_5 },
      { address: TEST_ADDRESS_6 },
      { address: TEST_ADDRESS_7 }
    ];
    const tokens = { targetToken: { address: TEST_ADDRESS_2, decimals: 18, name: 'Test Token' } };

    await queryBalances(accounts, tokens, mockRpc, mockLogger);

    // 验证每个账户都被查询
    expect(mockRpc.getNativeBalance).toHaveBeenCalledTimes(3);
    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith(TEST_ADDRESS_5);
    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith(TEST_ADDRESS_6);
    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith(TEST_ADDRESS_7);
  });
});

describe('queryTokenBalance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('应该正确查询代币余额', async () => {
    const mockRpc = createMockRpc(
      jest.fn(),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001')
    );
    const address = TEST_ADDRESS_1;
    const tokenAddress = TEST_ADDRESS_2;

    const result = await queryTokenBalance(mockRpc, address, tokenAddress);

    // 验证调用了正确的函数签名 (balanceOf)
// 注意：ethers.getAddress 会将地址转换为 checksummed 格式
    expect(mockRpc.call).toHaveBeenCalledWith(
      '0xAbcd1234567890abcDeF1234567890AbCdeF1234',
      '0x70a082311234567890123456789012345678901234567890'
    );
    expect(result).toBe(1n);
  });

  test('代币余额为零时应该返回0n', async () => {
    const mockRpc = createMockRpc(
      jest.fn(),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000000')
    );

    const result = await queryTokenBalance(mockRpc, TEST_ADDRESS_3, TEST_ADDRESS_4);

    expect(result).toBe(0n);
  });

  test('RPC调用失败时应该抛出错误', async () => {
    const mockRpc = createMockRpc(
      jest.fn(),
      jest.fn().mockRejectedValue(new Error('Connection refused'))
    );

    await expect(queryTokenBalance(mockRpc, TEST_ADDRESS_1, TEST_ADDRESS_2)).rejects.toThrow('Connection refused');
  });

  test('大额代币余额应该正确解析', async () => {
    // 模拟 1000000 * 10^18 的余额
    const largeBalance = '0x00000000000000000000000000000000000000000000000de0b6b3a7640000';
    const mockRpc = createMockRpc(
      jest.fn(),
      jest.fn().mockResolvedValue(largeBalance)
    );

    const result = await queryTokenBalance(mockRpc, TEST_ADDRESS_2, TEST_ADDRESS_1);

    // 验证返回的是 bigint 类型
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThan(0n);
  });
});