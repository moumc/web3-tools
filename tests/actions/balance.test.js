import { jest } from '@jest/globals';

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockRpc = {
  getNativeBalance: jest.fn().mockResolvedValue('1000000000000000000'),
  call: jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001')
};

jest.unstable_mockModule('../../src/core/logger.js', () => ({
  Logger: jest.fn(() => mockLogger)
}));

jest.unstable_mockModule('../../src/core/rpc.js', () => ({
  RpcClient: jest.fn(() => mockRpc)
}));

const { queryBalances } = await import('../../src/actions/balance.js');

describe('queryBalances', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('应该查询原生币和代币余额', async () => {
    const accounts = [{ address: '0x1234' }];
    const tokens = { targetToken: { address: '0xabcd', decimals: 18, name: 'Test Token' } };

    await queryBalances(accounts, tokens, mockRpc, mockLogger);

    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith('0x1234');
    expect(mockLogger.info).toHaveBeenCalled();
  });
});