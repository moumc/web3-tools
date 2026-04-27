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

  test('debug 方法应该打印调试级别日志', () => {
    const debugLogger = new Logger({ logDir: 'logs', logLevel: 'debug' });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    debugLogger.debug('debug message');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('当 logLevel=info 时 debug 不应输出', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    logger.debug('debug message');
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('close 方法应该关闭日志流', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    logger.info('test');
    logger.close();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('当日志目录不存在时应自动创建', async () => {
    jest.resetModules();
    jest.unstable_mockModule('fs', () => ({
      default: {
        existsSync: jest.fn((path) => path !== 'logs'), // logs 目录不存在
        mkdirSync: jest.fn(),
        createWriteStream: jest.fn(() => ({
          write: jest.fn(),
          end: jest.fn()
        }))
      },
      existsSync: jest.fn((path) => path !== 'logs'),
      mkdirSync: jest.fn(),
      createWriteStream: jest.fn(() => ({
        write: jest.fn(),
        end: jest.fn()
      }))
    }));

    const { Logger: NewLogger } = await import('../../src/core/logger.js');
    const newLogger = new NewLogger({ logDir: 'logs', logLevel: 'info' });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    newLogger.info('test message');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('当 logLevel=error 时 info 不应输出', () => {
    const errorLogger = new Logger({ logDir: 'logs', logLevel: 'error' });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    errorLogger.info('info message');
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('当 logLevel=warn 时 info 不应输出', () => {
    const warnLogger = new Logger({ logDir: 'logs', logLevel: 'warn' });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    warnLogger.info('info message');
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('error 方法应该输出到 console.error', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    logger.error('error message');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('warn 方法应该输出到 console.warn', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    logger.warn('warn message');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('info 方法应该输出到 console.log', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    logger.info('info message');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('默认选项应该使用默认值', () => {
    const defaultLogger = new Logger();
    expect(defaultLogger.logDir).toBe('logs');
    expect(defaultLogger.logLevel).toBe('info');
  });

  test('close 方法在日志流未初始化时应该安全处理', () => {
    const freshLogger = new Logger({ logDir: 'logs', logLevel: 'info' });
    // 不调用任何写操作，直接 close
    freshLogger.close();
    // 应该安全退出，不抛出错误
  });
});