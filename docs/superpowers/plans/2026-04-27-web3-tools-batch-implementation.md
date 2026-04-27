# Web3 Tools 批量操作脚本实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 实现一个 Node.js 运维工具，支持批量查询余额和批量执行合约操作

**架构：** 使用 ethers.js v6 进行区块链交互，模块化设计（actions/ + core/），CLI 入口分离 balance/execute 两个独立功能

**技术栈：** Node.js, ethers.js v6, Node.js 内置 fs/console 模块

---

## 文件结构

```
web3-tools/
├── config/
│   └── config.json           # 配置文件
├── src/
│   ├── index.js             # CLI 入口，路由分发
│   ├── actions/
│   │   ├── balance.js        # 功能一：余额查询
│   │   └── executor.js      # 功能二：合约执行 + 校验
│   └── core/
│       ├── logger.js         # 日志模块（文件 + 控制台分离）
│       ├── rpc.js            # RPC 调用封装（基于 ethers.JsonRpcProvider）
│       └── config.js         # 配置加载
├── tests/
│   ├── core/
│   │   ├── logger.test.js
│   │   └── config.test.js
│   └── actions/
│       ├── balance.test.js
│       └── executor.test.js
├── package.json
└── README.md
```

---

## Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `config/config.json`
- Create: `README.md`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "web3-tools",
  "version": "1.0.0",
  "description": "Ethereum-like blockchain batch operations tool",
  "main": "src/index.js",
  "type": "module",
  "scripts": {
    "balance": "node src/index.js balance",
    "execute": "node src/index.js execute",
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js"
  },
  "dependencies": {
    "ethers": "^6.13.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 2: 创建 config/config.json**

```json
{
  "network": {
    "rpcUrl": "https://mainnet.infura.io/v3/YOUR_PROJECT_ID",
    "chainId": 1
  },
  "accounts": [
    {
      "address": "0x0000000000000000000000000000000000000000",
      "privateKey": "0x0000000000000000000000000000000000000000000000000000000000000000"
    }
  ],
  "tokens": {
    "targetToken": {
      "address": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      "name": "USDT",
      "decimals": 6
    }
  },
  "contracts": {
    "targetContract": {
      "address": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      "input": "0xa9059cbb0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001"
    }
  },
  "execution": {
    "logLevel": "info"
  }
}
```

- [ ] **Step 3: 创建 README.md**

```markdown
# Web3 Tools

类 Ethereum 区块链批量操作工具。

## 安装

```bash
npm install
```

## 配置

编辑 `config/config.json`：
- `network.rpcUrl`: RPC 节点地址
- `network.chainId`: 链 ID
- `accounts`: 账户列表（地址 + 私钥）
- `tokens`: 代币配置
- `contracts`: 合约配置

## 使用

### 查询余额

```bash
npm run balance
```

### 执行合约

```bash
npm run execute
```

## 日志

日志输出到 `logs/app.log`，同时打印到控制台。
```

- [ ] **Step 4: 安装依赖**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm install`
Expected: ethers 和 jest 安装成功

- [ ] **Step 5: 提交**

```bash
git init && git add package.json config/config.json README.md
git commit -m "feat: 项目初始化，配置和文档"
```

---

## Task 2: 核心模块 - logger

**Files:**
- Create: `src/core/logger.js`
- Create: `tests/core/logger.test.js`

- [ ] **Step 1: 编写测试**

```javascript
import { jest } from '@jest/globals';

// Mock fs module
jest.unstable_mockModule('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  createWriteStream: jest.fn(() => ({
    write: jest.fn(),
    end: jest.fn()
  }))
}));

const { Logger } = await import('../src/core/logger.js');

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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test -- tests/core/logger.test.js`
Expected: FAIL - Logger 模块不存在

- [ ] **Step 3: 编写最小实现**

```javascript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Logger {
  constructor(options = {}) {
    this.logDir = options.logDir || 'logs';
    this.logLevel = options.logLevel || 'info';
    this.levels = { error: 0, warn: 1, info: 2, debug: 3 };

    // 确保日志目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    const logFile = path.join(this.logDir, 'app.log');
    this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
  }

  _formatMessage(level, message) {
    const timestamp = new Date().toISOString();
    return JSON.stringify({ timestamp, level, message });
  }

  _shouldLog(level) {
    return this.levels[level] <= this.levels[this.logLevel];
  }

  _write(level, message) {
    if (!this._shouldLog(level)) return;

    const formatted = this._formatMessage(level, message);

    // 输出到控制台
    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }

    // 输出到文件
    this.logStream.write(formatted + '\n');
  }

  info(message) {
    this._write('info', message);
  }

  warn(message) {
    this._write('warn', message);
  }

  error(message) {
    this._write('error', message);
  }

  debug(message) {
    this._write('debug', message);
  }
}

export { Logger };
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test -- tests/core/logger.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/logger.js tests/core/logger.test.js
git commit -m "feat: 添加日志模块"
```

---

## Task 3: 核心模块 - config

**Files:**
- Create: `src/core/config.js`
- Create: `tests/core/config.test.js`

- [ ] **Step 1: 编写测试**

```javascript
import { jest } from '@jest/globals';

// Mock fs
jest.unstable_mockModule('fs', () => ({
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => JSON.stringify({
    network: { rpcUrl: 'https://example.com', chainId: 1 },
    accounts: [],
    tokens: {},
    contracts: {},
    execution: { logLevel: 'info' }
  }))
}));

const { loadConfig } = await import('../src/core/config.js');

describe('loadConfig', () => {
  test('应该正确加载配置文件', () => {
    const config = loadConfig('config/config.json');
    expect(config).toHaveProperty('network');
    expect(config).toHaveProperty('accounts');
    expect(config.network.rpcUrl).toBe('https://example.com');
  });

  test('配置文件不存在应该抛出错误', () => {
    jest.resetModules();
    jest.unstable_mockModule('fs', () => ({
      existsSync: jest.fn(() => false)
    }));
    const { loadConfig: newLoadConfig } = await import('../src/core/config.js');
    expect(() => newLoadConfig('nonexistent.json')).toThrow('配置文件不存在');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test -- tests/core/config.test.js`
Expected: FAIL - config 模块不存在

- [ ] **Step 3: 编写最小实现**

```javascript
import fs from 'fs';
import path from 'path';

function loadConfig(configPath = 'config/config.json') {
  const fullPath = path.resolve(configPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`配置文件不存在: ${fullPath}`);
  }

  const content = fs.readFileSync(fullPath, 'utf-8');

  let config;
  try {
    config = JSON.parse(content);
  } catch (e) {
    throw new Error(`配置文件格式错误: ${e.message}`);
  }

  // 验证必要字段
  const required = ['network', 'accounts', 'tokens', 'contracts'];
  for (const field of required) {
    if (!config[field]) {
      throw new Error(`配置文件缺少必要字段: ${field}`);
    }
  }

  return config;
}

export { loadConfig };
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test -- tests/core/config.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/config.js tests/core/config.test.js
git commit -m "feat: 添加配置加载模块"
```

---

## Task 4: 核心模块 - rpc

**Files:**
- Create: `src/core/rpc.js`
- Create: `tests/core/rpc.test.js`

- [ ] **Step 1: 编写测试**

```javascript
import { jest } from '@jest/globals';

// Mock ethers
jest.unstable_mockModule('ethers', () => ({
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getBalance: jest.fn().mockResolvedValue('1000000000000000000'),
    call: jest.fn().mockResolvedValue('0x00000000000000000000000000000000000000000000000000000000000000a0')
  }))
}));

const { RpcClient } = await import('../src/core/rpc.js');

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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test -- tests/core/rpc.test.js`
Expected: FAIL - rpc 模块不存在

- [ ] **Step 3: 编写最小实现**

```javascript
import { ethers } from 'ethers';

class RpcClient {
  constructor(rpcUrl, chainId) {
    this.rpcUrl = rpcUrl;
    this.chainId = chainId;
    this.provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
  }

  async getNativeBalance(address) {
    const balance = await this.provider.getBalance(address);
    return balance.toString();
  }

  async call(to, data) {
    return await this.provider.call({ to, data });
  }

  async sendTransaction(signedTx) {
    return await this.provider.broadcastTransaction(signedTx);
  }
}

export { RpcClient };
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test -- tests/core/rpc.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/rpc.js tests/core/rpc.test.js
git commit -m "feat: 添加 RPC 客户端模块"
```

---

## Task 5: 功能模块 - balance

**Files:**
- Create: `src/actions/balance.js`
- Create: `tests/actions/balance.test.js`

- [ ] **Step 1: 编写测试**

```javascript
import { jest } from '@jest/globals';

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockRpc = {
  getNativeBalance: jest.fn().mockResolvedValue('1000000000000000000'),
  call: jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001')
};

jest.unstable_mockModule('../src/core/logger.js', () => ({
  Logger: jest.fn(() => mockLogger)
}));

jest.unstable_mockModule('../src/core/rpc.js', () => ({
  RpcClient: jest.fn(() => mockRpc)
}));

const { queryBalances } = await import('../src/actions/balance.js');

describe('queryBalances', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('应该查询原生币和代币余额', async () => {
    const accounts = [{ address: '0x1234' }];
    const tokens = { targetToken: { address: '0xabcd', decimals: 18 } };

    await queryBalances(accounts, tokens, mockRpc, mockLogger);

    expect(mockRpc.getNativeBalance).toHaveBeenCalledWith('0x1234');
    expect(mockLogger.info).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test -- tests/actions/balance.test.js`
Expected: FAIL - balance 模块不存在

- [ ] **Step 3: 编写最小实现**

```javascript
import { ethers } from 'ethers';

/**
 * 查询账户的原生币和代币余额
 * @param {Array} accounts - 账户列表 [{address, privateKey}]
 * @param {Object} tokens - 代币配置 { tokenName: { address, name, decimals } }
 * @param {RpcClient} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 */
async function queryBalances(accounts, tokens, rpcClient, logger) {
  logger.info('=== 开始查询余额 ===');

  for (const account of accounts) {
    const { address } = account;

    try {
      // 查询原生币余额
      const nativeBalance = await rpcClient.getNativeBalance(address);
      const nativeInEth = ethers.formatEther(nativeBalance);
      logger.info(`[${address}] 原生币余额: ${nativeInEth} ETH`);

      // 查询每个代币的余额
      for (const [tokenName, tokenInfo] of Object.entries(tokens)) {
        const tokenBalance = await queryTokenBalance(rpcClient, address, tokenInfo.address);
        const decimals = tokenInfo.decimals || 18;
        const formattedBalance = ethers.formatUnits(tokenBalance, decimals);
        logger.info(`[${address}] ${tokenInfo.name} (${tokenName}) 余额: ${formattedBalance}`);
      }
    } catch (error) {
      logger.error(`[${address}] 查询余额失败: ${error.message}`);
      // 继续处理下一个账户
    }
  }

  logger.info('=== 余额查询完成 ===');
}

/**
 * 查询 ERC20 代币余额
 */
async function queryTokenBalance(rpcClient, address, tokenAddress) {
  // ERC20 balanceOf(address) 的函数签名
  const data = '0x70a08231000000000000000000000000' + address.slice(2).toLowerCase();
  const result = await rpcClient.call(tokenAddress, data);
  // 解析返回的余额值
  return ethers.toBigInt(result);
}

export { queryBalances, queryTokenBalance };
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test -- tests/actions/balance.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/actions/balance.js tests/actions/balance.test.js
git commit -m "feat: 添加余额查询功能"
```

---

## Task 6: 功能模块 - executor

**Files:**
- Create: `src/actions/executor.js`
- Create: `tests/actions/executor.test.js`

- [ ] **Step 1: 编写测试**

```javascript
import { jest } from '@jest/globals';

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const mockRpc = {
  getNativeBalance: jest.fn().mockResolvedValue('1000000000000000000'),
  call: jest.fn()
    .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000001') // 执行前余额
    .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000000'), // 执行后余额
  provider: {
    getFeeData: jest.fn().mockResolvedValue({ gasPrice: BigInt(1000000000) })
  }
};

const mockWallet = {
  address: '0x1234',
  sendTransaction: jest.fn().mockResolvedValue({ hash: '0xabc' })
};

jest.unstable_mockModule('../src/core/logger.js', () => ({
  Logger: jest.fn(() => mockLogger)
}));

jest.unstable_mockModule('../src/core/rpc.js', () => ({
  RpcClient: jest.fn(() => mockRpc)
}));

jest.unstable_mockModule('ethers', () => ({
  ...jest.requireActual('ethers'),
  JsonRpcProvider: jest.fn(),
  Wallet: jest.fn(() => mockWallet)
}));

const { executeContracts } = await import('../src/actions/executor.js');

describe('executeContracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('执行后余额变化应该打印成功日志', async () => {
    const accounts = [{ address: '0x1234', privateKey: '0xabc' }];
    const tokens = { targetToken: { address: '0xabcd', decimals: 18 } };
    const contracts = { targetContract: { address: '0xdef', input: '0x123456' } };

    await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('执行成功'));
  });

  test('执行后余额不变应该打印 WARN 日志', async () => {
    // 余额不变的 mock
    mockRpc.call.mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000001');

    const accounts = [{ address: '0x1234', privateKey: '0xabc' }];
    const tokens = { targetToken: { address: '0xabcd', decimals: 18 } };
    const contracts = { targetContract: { address: '0xdef', input: '0x123456' } };

    await executeContracts(accounts, tokens, contracts, mockRpc, mockLogger);

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('余额未变化'));
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test -- tests/actions/executor.test.js`
Expected: FAIL - executor 模块不存在

- [ ] **Step 3: 编写最小实现**

```javascript
import { ethers } from 'ethers';
import { queryTokenBalance } from './balance.js';

/**
 * 批量执行合约调用
 * @param {Array} accounts - 账户列表
 * @param {Object} tokens - 代币配置
 * @param {Object} contracts - 合约配置
 * @param {RpcClient} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 */
async function executeContracts(accounts, tokens, contracts, rpcClient, logger) {
  logger.info('=== 开始执行合约 ===');

  for (const account of accounts) {
    const { address, privateKey } = account;

    try {
      // 创建钱包实例
      const wallet = new ethers.Wallet(privateKey, rpcClient.provider);

      // 获取执行前余额
      const balanceBefore = {};
      for (const [tokenName, tokenInfo] of Object.entries(tokens)) {
        balanceBefore[tokenName] = await queryTokenBalance(rpcClient, address, tokenInfo.address);
        logger.info(`[${address}] ${tokenInfo.name} 执行前余额: ${balanceBefore[tokenName].toString()}`);
      }

      // 执行每个合约调用
      for (const [contractName, contractInfo] of Object.entries(contracts)) {
        logger.info(`[${address}] 执行合约 ${contractName}: ${contractInfo.address}`);

        try {
          // 构造交易
          const tx = {
            to: contractInfo.address,
            data: contractInfo.input,
            value: 0
          };

          // 签名并发送
          const sentTx = await wallet.sendTransaction(tx);
          logger.info(`[${address}] 交易已发送，等待确认... hash: ${sentTx.hash}`);

          // 等待交易确认
          const receipt = await sentTx.wait();
          logger.info(`[${address}] 交易确认完成 blockNumber: ${receipt.blockNumber}, status: ${receipt.status}`);

        } catch (txError) {
          logger.error(`[${address}] 交易执行失败: ${txError.message}`);
          continue;
        }
      }

      // 获取执行后余额并对比
      for (const [tokenName, tokenInfo] of Object.entries(tokens)) {
        const balanceAfter = await queryTokenBalance(rpcClient, address, tokenInfo.address);
        logger.info(`[${address}] ${tokenInfo.name} 执行后余额: ${balanceAfter.toString()}`);

        if (balanceBefore[tokenName] === balanceAfter) {
          logger.warn(`[${address}] ${tokenInfo.name} 余额未变化，请确认交易是否执行成功`);
        } else {
          logger.info(`[${address}] ${tokenInfo.name} 余额已变化，执行成功`);
        }
      }

    } catch (error) {
      logger.error(`[${address}] 处理失败: ${error.message}`);
      // 继续处理下一个账户
    }
  }

  logger.info('=== 合约执行完成 ===');
}

export { executeContracts };
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test -- tests/actions/executor.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/actions/executor.js tests/actions/executor.test.js
git commit -m "feat: 添加合约执行功能"
```

---

## Task 7: 入口文件 - index.js

**Files:**
- Create: `src/index.js`

- [ ] **Step 1: 编写入口文件**

```javascript
import { Logger } from './core/logger.js';
import { loadConfig } from './core/config.js';
import { RpcClient } from './core/rpc.js';
import { queryBalances } from './actions/balance.js';
import { executeContracts } from './actions/executor.js';

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  if (!action) {
    console.error('请指定操作: balance 或 execute');
    console.error('用法: node src/index.js <balance|execute>');
    process.exit(1);
  }

  // 加载配置
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`配置加载失败: ${error.message}`);
    process.exit(1);
  }

  // 初始化日志
  const logger = new Logger({
    logDir: 'logs',
    logLevel: config.execution?.logLevel || 'info'
  });

  // 初始化 RPC 客户端
  const rpcClient = new RpcClient(
    config.network.rpcUrl,
    config.network.chainId
  );

  // 根据 action 执行对应功能
  try {
    if (action === 'balance') {
      await queryBalances(config.accounts, config.tokens, rpcClient, logger);
    } else if (action === 'execute') {
      await executeContracts(config.accounts, config.tokens, config.contracts, rpcClient, logger);
    } else {
      console.error(`未知操作: ${action}`);
      console.error('可用操作: balance, execute');
      process.exit(1);
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    process.exit(1);
  }

  process.exit(0);
}

main();
```

- [ ] **Step 2: 测试入口文件 (无需 RPC 的 balance 命令)**

Run: `cd D:/workspace/ai/ai-project/web3-tools && node src/index.js`
Expected: 错误提示"请指定操作"

- [ ] **Step 3: 提交**

```bash
git add src/index.js
git commit -m "feat: 添加 CLI 入口文件"
```

---

## Task 8: Jest 配置

**Files:**
- Create: `jest.config.js`

- [ ] **Step 1: 创建 Jest 配置**

```javascript
export default {
  testEnvironment: 'node',
  transform: {},
  moduleFileExtensions: ['js', 'mjs'],
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  collectCoverageFrom: ['src/**/*.js'],
  coverageDirectory: 'coverage'
};
```

- [ ] **Step 2: 验证测试能运行**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test`
Expected: 所有测试通过

- [ ] **Step 3: 提交**

```bash
git add jest.config.js
git commit -m "chore: 添加 Jest 配置"
```

---

## Task 9: 最终验证

**Files:**
- Modify: `package.json` (添加 scripts 别名)

- [ ] **Step 1: 添加 npm scripts 别名**

```bash
git add package.json
git commit -m "chore: 完善 package.json scripts"
```

- [ ] **Step 2: 最终构建验证**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm run balance`
Expected: 能运行（会因为 RPC 失败而报错，但代码结构正确）

- [ ] **Step 3: 运行所有测试**

Run: `cd D:/workspace/ai/ai-project/web3-tools && npm test`
Expected: 所有测试通过

---

## 自检清单

- [ ] 所有任务完成
- [ ] 测试覆盖率达标
- [ ] 配置文件示例完整
- [ ] README 文档完整
- [ ] commit 历史清晰

---

## 执行选项

**1. Subagent-Driven (推荐)** - 每个任务派遣新 subagent，任务间审查，快速迭代

**2. Inline Execution** - 本会话执行，带检查点

选择哪种方式？