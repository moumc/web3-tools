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

describe('queryBalances', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('应该查询原生币和代币余额', async () => {
    const mockRpc = createMockRpc(
      jest.fn().mockResolvedValue('1000000000000000000'),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001')
    );
    const accounts = [{ address: '0x1234' }];
    const tokens = { targetToken: { address: '0xabcd', decimals: 18, name: 'Test Token' } };

    await queryBalances(accounts, tokens, mockRpc, mockLogger);

    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith('0x1234');
    expect(mockLogger.info).toHaveBeenCalled();
  });

  test('当decimals未提供时应使用默认值18', async () => {
    const mockRpc = createMockRpc(
      jest.fn().mockResolvedValue('1000000000000000000'),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001')
    );
    const accounts = [{ address: '0x1234' }];
    // 不提供 decimals，触发 || 18 的分支
    const tokens = { targetToken: { address: '0xabcd', name: 'Test Token' } };

    await queryBalances(accounts, tokens, mockRpc, mockLogger);

    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith('0x1234');
  });

  test('单个账户失败不应影响其他账户', async () => {
    const mockRpc = createMockRpc(
      jest.fn()
        .mockRejectedValueOnce(new Error('RPC error for account 1'))
        .mockResolvedValue('2000000000000000000'),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001')
    );
    const accounts = [
      { address: '0x1111' },
      { address: '0x2222' }
    ];
    const tokens = { targetToken: { address: '0xabcd', decimals: 18, name: 'Test Token' } };

    await queryBalances(accounts, tokens, mockRpc, mockLogger);

    // 第一个账户失败，记录错误但继续处理
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('0x1111'));
    // 第二个账户成功
    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith('0x2222');
  });

  test('多账户场景测试', async () => {
    const mockRpc = createMockRpc(
      jest.fn().mockResolvedValue('3000000000000000000'),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000002')
    );
    const accounts = [
      { address: '0xaaaa' },
      { address: '0xbbbb' },
      { address: '0xcccc' }
    ];
    const tokens = { targetToken: { address: '0xabcd', decimals: 18, name: 'Test Token' } };

    await queryBalances(accounts, tokens, mockRpc, mockLogger);

    // 验证每个账户都被查询
    expect(mockRpc.getNativeBalance).toHaveBeenCalledTimes(3);
    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith('0xaaaa');
    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith('0xbbbb');
    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith('0xcccc');
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
    const address = '0x1234';
    const tokenAddress = '0xabcd';

    const result = await queryTokenBalance(mockRpc, address, tokenAddress);

    // 验证调用了正确的函数签名 (balanceOf)
    expect(mockRpc.call).toHaveBeenCalledWith(
      tokenAddress,
      '0x70a082310000000000000000000000001234'
    );
    expect(result).toBe(1n);
  });

  test('代币余额为零时应该返回0n', async () => {
    const mockRpc = createMockRpc(
      jest.fn(),
      jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000000')
    );

    const result = await queryTokenBalance(mockRpc, '0x5678', '0xdef0');

    expect(result).toBe(0n);
  });

  test('RPC调用失败时应该抛出错误', async () => {
    const mockRpc = createMockRpc(
      jest.fn(),
      jest.fn().mockRejectedValue(new Error('Connection refused'))
    );

    await expect(queryTokenBalance(mockRpc, '0x1234', '0xabcd')).rejects.toThrow('Connection refused');
  });

  test('大额代币余额应该正确解析', async () => {
    // 模拟 1000000 * 10^18 的余额
    const largeBalance = '0x00000000000000000000000000000000000000000000000de0b6b3a7640000';
    const mockRpc = createMockRpc(
      jest.fn(),
      jest.fn().mockResolvedValue(largeBalance)
    );

    const result = await queryTokenBalance(mockRpc, '0xabcd', '0x1234');

    // 验证返回的是 bigint 类型
    expect(typeof result).toBe('bigint');
    expect(result).toBeGreaterThan(0n);
  });
});