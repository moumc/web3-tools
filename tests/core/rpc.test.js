import { jest } from '@jest/globals';

// Mock ethers module
jest.unstable_mockModule('ethers', () => ({
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getBalance: jest.fn().mockResolvedValue('1000000000000000000'),
    call: jest.fn().mockResolvedValue('0x00000000000000000000000000000000000000000000000000000000000000a0'),
    broadcastTransaction: jest.fn().mockResolvedValue({
      hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      wait: jest.fn().mockResolvedValue({ status: 1 })
    })
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

  test('call 应该执行只读调用', async () => {
    const client = new RpcClient('https://mainnet.infura.io/v3/test', 1);
    const result = await client.call('0x1234', '0xabcdef');
    expect(result).toBe('0x00000000000000000000000000000000000000000000000000000000000000a0');
  });

  test('sendTransaction 应该广播交易', async () => {
    const client = new RpcClient('https://mainnet.infura.io/v3/test', 1);
    const signedTx = '0xf86d8201...'; // 模拟签名交易数据
    const response = await client.sendTransaction(signedTx);
    expect(response.hash).toBe('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
  });
});
