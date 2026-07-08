// 端到端集成测试：不 mock ethers，跑真实签名/验证
// 独立文件避开 Jest 模块缓存，确保每次都是真实模块

import { jest } from '@jest/globals';

jest.unmock('ethers');

const { generateAccount } = await import('../../src/actions/account.js');
const ethers = await import('ethers');

describe('generateAccount 端到端（真实 ethers）', () => {
  test('返回的私钥确实控制声称地址（signMessage + verifyMessage）', async () => {
    const account = generateAccount();

    // 1) 用私钥重新构造钱包，地址必须一致
    const wallet = new ethers.Wallet(account.privateKey);
    expect(wallet.address.toLowerCase()).toBe(account.address.toLowerCase());

    // 2) 真实签名 + recover，必须回到同一地址
    const message = 'web3-tools integration test';
    const signature = await wallet.signMessage(message);
    const recovered = ethers.verifyMessage(message, signature);
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());

    // 3) meta 元数据正确
    expect(account.meta.verified).toBe(true);
    expect(account.meta.curve).toBe('secp256k1');
    expect(account.meta.entropyBits).toBe(256);
  });

  test('连续生成的两个账户互不相同', () => {
    const a = generateAccount();
    const b = generateAccount();
    expect(a.address).not.toBe(b.address);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});