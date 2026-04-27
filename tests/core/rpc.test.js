import { jest } from '@jest/globals';

// Mock ethers module
jest.unstable_mockModule('ethers', () => ({
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getBalance: jest.fn().mockResolvedValue('1000000000000000000'),
    call: jest.fn().mockResolvedValue('0x00000000000000000000000000000000000000000000000000000000000000a0')
  }))
}));

// Import after mock is set up
const { RpcClient } = await import('../../src/core/rpc.js');

describe('RpcClient', () => {
  test('应该能创建 JsonRpcProvider 实例', () => {
    const client = new RpcClient('https://mainnet.infura.io/v3/test', 1);
    expect(client.provider).toBeDefined();
  });

  test('getNativeBalance 应该返回余额', async () => {
    const client = new RpcClient('https://mainnet.infura.io/v3/test', 1);
    const balance = await client.getNativeBalance('0x1234');
    expect(balance).toBe('1000000000000000000');
  });
});
