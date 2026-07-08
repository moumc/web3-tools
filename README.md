# Web3 Tools

类 Ethereum 区块链批量操作工具。

## 安装

```bash
npm install
```

## 配置

> ⚠️ **安全提示**：`config/config.json` 已在 `.gitignore` 中，**绝不能**提交到仓库。
> 私钥等敏感信息请放在本地配置文件里。

首次使用从模板复制：

```bash
cp config/config.example.json config/config.json
```

然后编辑 `config/config.json`：

- `network.rpcUrl`：RPC 节点地址
- `network.chainId`：链 ID
- `network.nativeSymbol`：原生币符号（如 ETH、AIA）
- `accounts`：账户列表（地址 + 私钥）—— **不要提交含私钥的文件**
- `tokens`：代币配置
- `contracts`：合约配置
- `collector.targetAddress`：归集目标地址
- `execution.logLevel`：日志级别

## 使用

### 查询余额

```bash
npm run balance
```

### 执行合约

```bash
npm run execute
```

### 归集代币（ERC20）

```bash
npm run collect
```

### 归集原生币

```bash
npm run collect-native
```

### 生成账户

生成新的以太坊地址与私钥，本地使用 CSPRNG，私钥**不会上传任何远端**。
输出为 JSON 数组，请妥善保管。

```bash
# 生成 1 个（默认）
npm run gen-account

# 生成 N 个
npm run gen-account -- 5
```

输出示例：

```json
[{
  "address": "0x9e75c58AD2C47095032D78a0788EBCFB48adBE65",
  "privateKey": "0xf2183d3879ff37a7000a26c65fc62bf7cdef2acda7c5d6c427f16020868aebec",
  "meta": {
    "curve": "secp256k1",
    "entropySource": "node:crypto.randomBytes",
    "entropyBits": 256,
    "verified": true,
    "verifiedAt": "2026-07-08T12:40:57.659Z"
  }
}]
```

**安全保证（三层防御）**

1. **熵源探测**：模块加载与每次生成前探测 `node:crypto.randomBytes` 或 `WebCrypto.getRandomValues`；任一可用方生成；二者皆缺失直接抛错拒绝生成
2. **强熵**：32 字节（256 bit）熵，源自 OS 内核 CSPRNG；远超比特币/BIP-39 推荐下限（128 bit）
3. **签名往返校验**：每个账户生成后立即用私钥对固定消息签名并 `verifyMessage` 恢复地址，与声称地址比对；任一步骤不符即抛错——可捕获 ethers 升级或实现 bug 导致的地址派生错误

`meta.verified === true` 表示本轮已通过上述校验。生产代码（CLI、库调用）都会执行此校验；集成测试 `tests/actions/account.integration.test.js` 用真实 ethers 跑 sign+recover 闭环。

## 日志

日志输出到 `logs/app.log`，同时打印到控制台。

## 安全

- 本仓库不存储任何真实私钥
- 修改配置前请确认 `.gitignore` 中包含 `config/config.json`
- 提交前可运行 `git status` 再次确认没有敏感文件被暂存