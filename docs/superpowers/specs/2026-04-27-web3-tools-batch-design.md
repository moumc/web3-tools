# Web3 Tools 批量操作脚本设计

## 概述

一个运行在类 Ethereum 区块链网络上的 Node.js 运维工具，提供批量余额查询和批量合约执行功能。

## 项目结构

```
web3-tools/
├── config/
│   └── config.json       # 所有配置
├── src/
│   ├── index.js          # 入口，CLI 路由
│   ├── actions/          # 操作模块
│   │   ├── balance.js    # 功能一：余额查询
│   │   └── executor.js   # 功能二：合约执行 + 校验
│   ├── core/             # 核心工具
│   │   ├── logger.js     # 日志（文件 + 控制台分离）
│   │   ├── rpc.js        # RPC 调用封装
│   │   └── config.js     # 配置加载
├── package.json
└── README.md
```

## 调用方式

```bash
node src/index.js balance   # 余额查询
node src/index.js execute   # 合约执行
```

## 配置文件 (config/config.json)

```json
{
  "network": {
    "rpcUrl": "https://mainnet.example.com",
    "chainId": 1
  },
  "accounts": [
    {
      "address": "0x1234...",
      "privateKey": "0xabcd..."
    }
  ],
  "tokens": {
    "targetToken": {
      "address": "0xabcd...",
      "name": "USDT",
      "decimals": 18
    }
  },
  "contracts": {
    "targetContract": {
      "address": "0xdef...",
      "input": "0xa9059cbb..."  // 固定模板
    }
  },
  "execution": {
    "logLevel": "info"
  }
}
```

## 功能模块

### 功能一：查询余额 (balance)

- 输入：账户地址列表
- 输出：每个账户的原生币余额 + 代币余额
- 独立运行

### 功能二：执行合约 + 余额校验 (execute)

- 执行前：查询代币余额，打印日志
- 执行：发送交易
- 执行后：查询代币余额，打印日志
- 对比余额：
  - 变化 → 打印成功日志
  - 不变 → 打印 WARN 日志（继续执行）

## 错误处理

- RPC 调用失败 → 打印错误日志，该账户跳过，继续下一个
- 交易发送失败 → 打印错误日志，该账户跳过，继续下一个
- 余额查询失败 → 打印错误日志，该账户跳过，继续下一个
- 配置文件缺失/格式错误 → 程序退出，输出错误信息

## 日志策略

- 日志输出到文件 + 控制台
- 不同级别分级输出
- 结构化格式便于分析

## 扩展方向

- 更多区块链交互（不同代币标准、DEX 交互、质押等）
- 扩展时在 `actions/` 添加新模块，在 `index.js` 添加新路由
