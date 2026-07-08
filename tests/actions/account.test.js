import { jest } from '@jest/globals';

const mockWallets = [
  { address: '0x' + 'a'.repeat(40), privateKey: '0x' + '1'.repeat(64) },
  { address: '0x' + 'b'.repeat(40), privateKey: '0x' + '2'.repeat(64) },
  { address: '0x' + 'c'.repeat(40), privateKey: '0x' + '3'.repeat(64) }
];

const walletByPk = new Map(mockWallets.map(w => [w.privateKey, w]));

let mockIndex = 0;

function makeMockWalletInstance(privateKey, fallbackAddress) {
  const w = walletByPk.get(privateKey) || { address: fallbackAddress, privateKey };
  return {
    address: w.address,
    privateKey: w.privateKey,
    signMessage: jest.fn(async () => '0xvalidSignatureFor' + w.address),
    signingKey: {
      sign: jest.fn(() => ({ serialized: '0xvalidSignatureFor' + w.address }))
    }
  };
}

const MockWallet = jest.fn().mockImplementation((privateKey) => {
  const fallback = '0x' + privateKey.slice(-40).padStart(40, '0');
  return makeMockWalletInstance(privateKey, fallback);
});

MockWallet.createRandom = jest.fn(() => {
  const w = mockWallets[mockIndex % mockWallets.length];
  mockIndex += 1;
  return makeMockWalletInstance(w.privateKey, w.address);
});

jest.unstable_mockModule('ethers', () => ({
  Wallet: MockWallet,
  verifyMessage: jest.fn((_msg, sig) => {
    const match = sig.match(/0xvalidSignatureFor(0x[a-fA-F0-9]+)$/);
    return match ? match[1] : '0x0000000000000000000000000000000000000000';
  }),
  hashMessage: jest.fn(() => new Uint8Array(32))
}));

const {
  generateAccount,
  generateAccounts,
  detectEntropySource,
  verifyKeyPair
} = await import('../../src/actions/account.js');

describe('detectEntropySource', () => {
  test('应识别 Node crypto 或 WebCrypto 之一', () => {
    const source = detectEntropySource();
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(0);
  });
});

describe('verifyKeyPair', () => {
  test('私钥与地址匹配时应通过', () => {
    const w = mockWallets[0];
    expect(() => verifyKeyPair(w.privateKey, w.address)).not.toThrow();
  });

  test('私钥与声称地址不匹配时应抛错', async () => {
    const ethers = await import('ethers');
    ethers.verifyMessage.mockReturnValueOnce('0xdeadbeef00000000000000000000000000000000');
    const w = mockWallets[0];
    expect(() => verifyKeyPair(w.privateKey, w.address))
      .toThrow(/签名恢复失败|未真正控制/);
  });
});

describe('generateAccount', () => {
  beforeEach(() => {
    mockIndex = 0;
  });

  test('应返回 address / privateKey / meta', () => {
    const result = generateAccount();
    expect(result).toHaveProperty('address');
    expect(result).toHaveProperty('privateKey');
    expect(result).toHaveProperty('meta');
  });

  test('address 应为有效以太坊地址格式', () => {
    const { address } = generateAccount();
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    // EIP-55 checksum 由 ethers.Wallet 提供，集成测试已覆盖
  });

  test('privateKey 应为 0x + 64 位十六进制', () => {
    const { privateKey } = generateAccount();
    expect(privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  test('meta 应包含曲线、熵源、验证状态', () => {
    const { meta } = generateAccount();
    expect(meta.curve).toBe('secp256k1');
    expect(typeof meta.entropySource).toBe('string');
    expect(meta.entropyBits).toBe(256);
    expect(meta.verified).toBe(true);
    expect(typeof meta.verifiedAt).toBe('string');
  });

  test('每个生成的地址互不相同', () => {
    const a = generateAccount();
    const b = generateAccount();
    expect(a.address).not.toBe(b.address);
  });

  test('签名验证失败时整体应抛错（捕获实现 bug）', async () => {
    const ethers = await import('ethers');
    ethers.verifyMessage.mockReturnValueOnce('0xbadbad00000000000000000000000000000000');
    expect(() => generateAccount()).toThrow(/签名恢复失败|未真正控制/);
  });
});

describe('generateAccounts', () => {
  beforeEach(() => {
    mockIndex = 0;
  });

  test('count=3 应返回三个独立账户', () => {
    const result = generateAccounts(3);
    expect(result).toHaveLength(3);
    expect(new Set(result.map(r => r.address)).size).toBe(3);
    result.forEach(r => {
      expect(r.meta.verified).toBe(true);
    });
  });

  test('默认 count=1', () => {
    expect(generateAccounts()).toHaveLength(1);
  });

  test('count=0/-1/1.5 均抛错', () => {
    expect(() => generateAccounts(0)).toThrow('count 必须为正整数');
    expect(() => generateAccounts(-1)).toThrow('count 必须为正整数');
    expect(() => generateAccounts(1.5)).toThrow('count 必须为正整数');
  });
});