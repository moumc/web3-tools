import { jest } from '@jest/globals';

let mockCreateRandomCallCount = 0;
const mockWallets = [
  { address: '0x' + 'a'.repeat(40), privateKey: '0x' + '1'.repeat(64) },
  { address: '0x' + 'b'.repeat(40), privateKey: '0x' + '2'.repeat(64) },
  { address: '0x' + 'c'.repeat(40), privateKey: '0x' + '3'.repeat(64) }
];

jest.unstable_mockModule('ethers', () => ({
  Wallet: class MockWallet {
    static createRandom() {
      const wallet = mockWallets[mockCreateRandomCallCount % mockWallets.length];
      mockCreateRandomCallCount += 1;
      return wallet;
    }
  }
}));

const { generateAccount, generateAccounts } = await import('../../src/actions/account.js');

describe('generateAccount', () => {
  beforeEach(() => {
    mockCreateRandomCallCount = 0;
  });

  test('应该返回包含 address 和 privateKey 的对象', () => {
    const result = generateAccount();
    expect(result).toHaveProperty('address');
    expect(result).toHaveProperty('privateKey');
  });

  test('address 应该是 0x 开头的 40 位十六进制', () => {
    const { address } = generateAccount();
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test('privateKey 应该是 0x 开头的 64 位十六进制', () => {
    const { privateKey } = generateAccount();
    expect(privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });
});

describe('generateAccounts', () => {
  beforeEach(() => {
    mockCreateRandomCallCount = 0;
  });

  test('count=1 应返回一个账户', () => {
    const result = generateAccounts(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('address');
    expect(result[0]).toHaveProperty('privateKey');
  });

  test('count=5 应返回五个账户', () => {
    const result = generateAccounts(5);
    expect(result).toHaveLength(5);
  });

  test('不传 count 时默认生成 1 个', () => {
    const result = generateAccounts();
    expect(result).toHaveLength(1);
  });

  test('count=0 应抛出错误', () => {
    expect(() => generateAccounts(0)).toThrow('count 必须为正整数');
  });

  test('count=-1 应抛出错误', () => {
    expect(() => generateAccounts(-1)).toThrow('count 必须为正整数');
  });

  test('count=1.5 应抛出错误（非整数）', () => {
    expect(() => generateAccounts(1.5)).toThrow('count 必须为正整数');
  });

  test('批量生成时返回的账户应各不相同', () => {
    const result = generateAccounts(3);
    const addresses = result.map(r => r.address);
    expect(new Set(addresses).size).toBe(3);
  });
});