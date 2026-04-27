import { jest } from '@jest/globals';

// Mock fs
jest.unstable_mockModule('fs', () => ({
  default: {
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => JSON.stringify({
      network: { rpcUrl: 'https://example.com', chainId: 1 },
      accounts: [],
      tokens: {},
      contracts: {},
      execution: { logLevel: 'info' }
    }))
  },
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => JSON.stringify({
    network: { rpcUrl: 'https://example.com', chainId: 1 },
    accounts: [],
    tokens: {},
    contracts: {},
    execution: { logLevel: 'info' }
  }))
}));

const { loadConfig } = await import('../../src/core/config.js');

describe('loadConfig', () => {
  test('应该正确加载配置文件', () => {
    const config = loadConfig('config/config.json');
    expect(config).toHaveProperty('network');
    expect(config).toHaveProperty('accounts');
    expect(config.network.rpcUrl).toBe('https://example.com');
  });

  test('配置文件不存在应该抛出错误', async () => {
    jest.resetModules();
    jest.unstable_mockModule('fs', () => ({
      default: {
        existsSync: jest.fn(() => false),
        readFileSync: jest.fn()
      },
      existsSync: jest.fn(() => false)
    }));
    const { loadConfig: newLoadConfig } = await import('../../src/core/config.js');
    expect(() => newLoadConfig('nonexistent.json')).toThrow('配置文件不存在');
  });
});
