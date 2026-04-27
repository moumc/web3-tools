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
