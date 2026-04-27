import { jest } from '@jest/globals';

// Mock fs module
jest.unstable_mockModule('fs', () => ({
  default: {
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    appendFileSync: jest.fn(),
    createWriteStream: jest.fn(() => ({
      write: jest.fn(),
      end: jest.fn()
    }))
  },
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  createWriteStream: jest.fn(() => ({
    write: jest.fn(),
    end: jest.fn()
  }))
}));

const { Logger } = await import('../../src/core/logger.js');

describe('Logger', () => {
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new Logger({ logDir: 'logs', logLevel: 'info' });
  });

  test('info 方法应该打印信息级别日志', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    logger.info('test message');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('warn 方法应该打印警告级别日志', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    logger.warn('warn message');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('error 方法应该打印错误级别日志', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    logger.error('error message');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});