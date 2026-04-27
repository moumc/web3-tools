import { jest } from '@jest/globals';

// Mock fs
jest.unstable_mockModule('fs', () => ({
  default: {
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => JSON.stringify({
      network: { rpcUrl: 'https://example.com', chainId: 1 },
      accounts: [{ address: '0x123456789012345678901234567890123456789a', privateKey: '0xabc123' }],
      tokens: {},
      contracts: {},
      execution: { logLevel: 'info' }
    }))
  },
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => JSON.stringify({
    network: { rpcUrl: 'https://example.com', chainId: 1 },
    accounts: [{ address: '0x123456789012345678901234567890123456789a', privateKey: '0xabc123' }],
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

  test('JSON格式错误应该抛出错误', async () => {
    jest.resetModules();
    jest.unstable_mockModule('fs', () => ({
      default: {
        existsSync: jest.fn(() => true),
        readFileSync: jest.fn(() => 'invalid json{')
      },
      existsSync: jest.fn(() => true),
      readFileSync: jest.fn(() => 'invalid json{')
    }));
    const { loadConfig: newLoadConfig } = await import('../../src/core/config.js');
    expect(() => newLoadConfig('config.json')).toThrow('配置文件格式错误');
  });

  test('缺少必要字段应该抛出错误', async () => {
    jest.resetModules();
    jest.unstable_mockModule('fs', () => ({
      default: {
        existsSync: jest.fn(() => true),
        readFileSync: jest.fn(() => JSON.stringify({
          network: { rpcUrl: 'https://example.com' },
          accounts: [],
          // 缺少 tokens 和 contracts
        }))
      },
      existsSync: jest.fn(() => true),
      readFileSync: jest.fn(() => JSON.stringify({
        network: { rpcUrl: 'https://example.com' },
        accounts: [],
        // 缺少 tokens 和 contracts
      }))
    }));
    const { loadConfig: newLoadConfig } = await import('../../src/core/config.js');
    expect(() => newLoadConfig('config.json')).toThrow('配置文件缺少必要字段');
  });

  test('network.rpcUrl缺失应该抛出错误', async () => {
    jest.resetModules();
    jest.unstable_mockModule('fs', () => ({
      default: {
        existsSync: jest.fn(() => true),
        readFileSync: jest.fn(() => JSON.stringify({
          network: { chainId: 1 }, // 缺少 rpcUrl
          accounts: [],
          tokens: {},
          contracts: {}
        }))
      },
      existsSync: jest.fn(() => true),
      readFileSync: jest.fn(() => JSON.stringify({
        network: { chainId: 1 }, // 缺少 rpcUrl
        accounts: [],
        tokens: {},
        contracts: {}
      }))
    }));
    const { loadConfig: newLoadConfig } = await import('../../src/core/config.js');
    expect(() => newLoadConfig('config.json')).toThrow('network.rpcUrl');
  });
});
