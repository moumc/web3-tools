# Web3 Tools

类 Ethereum 区块链批量操作工具。基于 [ethers.js v6](https://docs.ethers.org/) 与 [SheetJS](https://docs.sheetjs.com/)，提供**账户生成 / 余额查询 / 合约执行 / 代币归集 / 原生币归集 / 批量分发**等常见运维场景，所有操作通过 RPC 与链上交互，本地完成签名。

## 功能总览

| 命令 | 用途 | 是否需要链上签名 |
|------|------|------------------|
| `balance` | 批量查询原生币与 ERC20 代币余额 | 否（只读） |
| `execute` | 批量执行预编码合约调用 | 是 |
| `collect` | 批量归集多个账户的 ERC20 代币到目标地址 | 是 |
| `collect-native` | 批量归集多个账户的原生币到目标地址 | 是 |
| `distribute` | 从单一发送方向 xlsx 收款表批量分发原生币 | 是 |
| `balance-export` | 从 xlsx 批量读取地址，从链上拉余额并写入 MySQL（支持断点续跑） | 否（只读） |
| `gen-account` | 本地生成以太坊地址与私钥（带三层防御校验） | 否（完全离线） |

## 安装

```bash
npm install
```

> 依赖：[`ethers@^6.13.0`](https://www.npmjs.com/package/ethers) 与 [`xlsx`](https://www.npmjs.com/package/xlsx)（私有 tarball 源）。开发依赖仅 [`jest@^29`](https://jestjs.io/)。

## 配置

> ⚠️ **安全提示**：`config/config.json` 已在 `.gitignore` 中，**绝不能**提交到仓库。私钥等敏感信息请放在本地配置文件里。

首次使用从模板复制：

```bash
# Windows (Git Bash)
cp config/config.example.json config/config.json

# Windows (PowerShell / CMD)
copy config\config.example.json config\config.json
```

然后编辑 `config/config.json`：

| 字段 | 必填 | 说明 |
|------|------|------|
| `network.rpcUrl` | ✅ | RPC 节点 URL（支持 Infura / Alchemy / 自建节点） |
| `network.chainId` | ✅ | 链 ID（如 1 = 主网） |
| `network.nativeSymbol` | ✅ | 原生币符号（ETH、BNB、AIA 等，仅用于日志显示） |
| `accounts[]` | ✅ | 账户列表，元素 `{ address, privateKey }` |
| `accounts[].address` | ✅ | 账户地址（任意大小写，运行时统一 checksum） |
| `accounts[].privateKey` | ✅ | 账户私钥（`0x` 前缀 64 位十六进制） |
| `tokens` | ✅ | ERC20 代币映射 `{ name: { address, name, decimals } }` |
| `contracts` | ✅ | 合约调用映射 `{ name: { address, input } }`（`input` 为已编码 calldata） |
| `collector.targetAddress` | collect 时必填 | 归集目标地址 |
| `distributor.senderAddress` | 可选 | 分发时的发送地址（须存在于 `accounts`，未配置时取 `accounts[0]`） |
| `execution.logLevel` | 可选 | 日志级别（`error` / `warn` / `info` / `debug`），默认 `info` |

`loadConfig` 会在启动时校验：缺失 `network` / `accounts` / `tokens` / `contracts` 或任一账户缺少 `address` / `privateKey` 都会直接报错退出。

## 使用

> 所有命令都在仓库根目录执行。除 `gen-account` 外，其余命令都需要有效 `config/config.json`。

### 查询余额

读取 `accounts` 中每个账户的原生币 + `tokens` 中每个代币的余额。

```bash
npm run balance
```

### 执行合约

按 `contracts` 中的预编码 calldata，依次在 `accounts` 每个账户上发送交易（gas 上限 300000）。先 `estimateGas` 预检，预估失败直接跳过该笔；执行前后对比余额变化并写入日志。

```bash
npm run execute
```

### 归集 ERC20 代币

将 `accounts` 中每个账户在 `tokens` 里的全部余额转至 `collector.targetAddress`。单账户代币余额为 0 时跳过且不消耗 Gas。

```bash
npm run collect
```

### 归集原生币

将 `accounts` 中每个账户的全部原生币转至 `collector.targetAddress`（gas 上限 21000，转账金额自动预留 Gas 之外的余额）。

```bash
npm run collect-native
```

### 批量分发原生币（distribute）

从 xlsx 表格读取收款清单，从单一发送地址逐笔向所有收款地址转原生币，**数量自动按 18 位精度换算**。

```bash
# 先预览，不实际发送（强烈建议先 dry-run）
npm run distribute -- list.xlsx --dry-run

# 确认无误后正式执行
npm run distribute -- list.xlsx
```

#### xlsx 格式

- **列 1**：收款地址（任意大小写，运行时统一 checksum）
- **列 2**：数量
- **首行**：表头（自动跳过）
- 空白行静默跳过
- 默认读取第一个工作表

示例：

| 地址 | 数量 |
|------|------|
| `0xAbC…123` | `100` |
| `0xDef…456` | `2.5` |
| `0x789…abc` | `1,000` |
| `0xfed…cba` | `1e3` |

#### 行为说明

- **发送方**：`config.distributor.senderAddress`（须存在于 `accounts`，否则报错）；未配置时默认 `accounts[0]`，并在日志中告警
- **文件格式校验**：读取前检查 xlsx 魔数（`PK\x03\x04`），非 xlsx 文件直接拒绝
- **数量解析**：支持小数、千分位逗号（`1,000`）、科学计数法（`1e3` / `1.5e-2`）、前导 `+`；小数位超过 18 位报错
- **地址校验**：每行地址必须通过 `ethers.isAddress`，否则跳过该行并记录原因
- **重复地址**：检测重复并在日志中告警，但**仍执行转账**（请人工确认是否预期）
- **预检**：发送前校验余额 ≥ 转账总额 + Gas 预留（`gasPrice × 21000 × 笔数`），不足则整体中止，一笔不发
- **逐笔预估**：单笔交易先 `estimateGas`，预估失败仅跳过该笔，不影响其他转账
- **顺序执行**：每笔等待链上确认后再发下一笔，避免 nonce 竞争
- **容错**：单行地址 / 数量非法只跳过该行并记录警告，其余转账继续

#### 返回值（dry-run 与正式执行均为同一 API）

```js
{
  dryRun: boolean,
  results: Array<{
    success: boolean,
    rowNumber: number,        // 在 xlsx 中的行号（含表头）
    toAddress: string,        // checksum 格式
    rawAmount: string,        // 人类可读数量
    amountUnits: string,      // 最小单位数量（BigInt 字符串）
    txHash: string,           // 交易哈希，失败时为空
    error?: string            // 失败原因
  }>,
  total: bigint,              // 转账总额（最小单位）
  successCount: number,
  failedCount: number
}
```

### 批量导出余额（balance-export）

从 xlsx 表格读取所有地址，遍历配置好的原生币 + 每个 ERC20 代币，从链上读取余额并**写入 MySQL**（宽表：每行一个地址，每代币一个 `DECIMAL` 列）。

> 适用场景：10W+ 地址 × 数十个代币；查询分批 + 失败可重试。优先可靠性。

#### 1. 准备数据库配置

复制模板：

```bash
# Windows (Git Bash)
cp config/database.example.json config/database.json

# Windows (PowerShell / CMD)
copy config\database.example.json config\database.json
```

`config/database.json` 字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `host` | ✅ | MySQL 主机 |
| `port` | ✅ | 端口（1..65535） |
| `user` | ✅ | 数据库用户 |
| `password` | ✅ | 密码 |
| `database` | ✅ | 库名（需提前 `CREATE DATABASE`） |
| `connectionLimit` | 可选 | 连接池上限，默认 10 |

`config/database.json` 与 `config/tokens-export.json` 已在 `.gitignore` 中，**不要入库**。

#### 2. 自动建表

工具首次运行时会**自动建表**。表名规则：

```text
balance_export_<sessionId>
```

其中 `sessionId` 缺省为 `YYYYMMDD_HHMMSS`（如 `balance_export_20260916_124057`），可通过 `--session <id>` 指定。

表结构：

| 列 | 类型 | 说明 |
|------|------|------|
| `id` | `BIGINT PK AUTO_INCREMENT` | 行号 |
| `address` | `VARCHAR(42) UNIQUE NOT NULL` | checksum 地址 |
| `native_balance` | `DECIMAL(38,18)` | 原生币最小单位 |
| `<symbol>_<addr4hex>_balance` | `DECIMAL(38,N)` | 每个代币一列（列名 = `<symbol 小写 + 仅 [a-z0-9_]>_<地址前 4 位 hex 小写>_balance`，例如 `usdt_dac1_balance`） |
| `created_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | — |
| `updated_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | — |

索引：`UNIQUE(address)`、`INDEX(id)`（用于游标分页）。

#### 3. 准备代币列表

balance-export 默认读 **`config/tokens-export.json`**（数组形式，每项 `{ symbol, address, decimals }`）。模板见 `config/tokens-export.example.json`：

```json
[
  { "symbol": "USDT", "address": "0xdAC17F…", "decimals": 6 },
  { "symbol": "AIA",  "address": "0xABC123…", "decimals": 18 }
]
```

读取优先级：

1. `--tokens <path>` 指定的文件（不存在报错）
2. 默认 `config/tokens-export.json`（不存在 `warn` 并回退）
3. 回退到 `config.json` 的 `tokens`（兼容 `name` 字段）

无效地址（非 `ethers.isAddress`）自动跳过并 `warn`；**同 symbol 不同 address** 会生成不同列（列名带地址前 4 位 hex 区分，例如 `usdt_dac1_balance` 与 `usdt_4f23_balance`），两列都会被查询并写入；**同 address 重复出现**会跳过第二次并 `warn`；空代币列表也能跑（只查原生币）。

#### 4. 命令

```bash
# 完整流程：先导入地址到 MySQL，再分批查余额
npm run balance-export -- input.xlsx

# 指定会话 ID（多次跑同一文件用相同 session 复用表）
npm run balance-export -- input.xlsx --session 20260916_124057

# 重建表：先 DROP 再 CREATE
npm run balance-export -- input.xlsx --fresh

# 调整每批 SELECT 行数（默认 100，上限 10000）
npm run balance-export -- input.xlsx --batch-size 200
```

参数：

| 参数 | 默认 | 说明 |
|------|------|------|
| `<xlsx>` | 必填 | 输入文件路径 |
| `--session <id>` | `YYYYMMDD_HHMMSS` | 会话 ID（即表名后缀） |
| `--fresh` | `false` | 先 DROP 再 CREATE；丢数据慎用 |
| `--batch-size <n>` | `100` | 每批从表里 `SELECT` 的地址数；同时也是单次 JSON-RPC 批量请求大小 |
| `--tokens <file>` | `config/tokens-export.json` | 覆盖默认代币列表 |

#### 5. 输入 xlsx 格式

- **无表头**；每一行可以有任意多列
- **所有非空单元格**均视为地址候选；自动展平读取
- 无效地址（如错别字、非 0x 开头）跳过并 `warn`，不影响其他地址
- 重复地址（checksum 不区分大小写）仅插入一次，重复的也 `warn`

#### 6. 两阶段流程

```text
Phase 1：导入地址
  1. 解析 xlsx → 去重 → INSERT IGNORE 到 balance_export_<session>
     按 1000/批拆分（避免单条 SQL 占位符过多；MySQL 9.x 要求多行 VALUES 各自带括号）
  2. 输出「已写入 N 个地址」

Phase 2：查询余额 + 回写
  循环（游标分页，按 id 升序逐批取出）：
    a. SELECT id, address FROM balance_export_<session>
       WHERE id > <lastId> ORDER BY id LIMIT <batch-size>
    b. 单条 JSON-RPC 批量请求：每地址 1 个 eth_getBalance + N 个 eth_call(balanceOf)
    c. 单条 SQL UPDATE（使用 CASE WHEN）批量回写金额：
         SET native_balance = CASE address WHEN … END,
             usdt_dac1_balance = CASE address WHEN … END
         WHERE address IN (…)
    d. lastId = 该批最大 id
  进度日志（每 max(50, total/10) 行输出一次）
```

失败处理：
- **网络/HTTP 错误**：`batchRpcCall` 自动指数退避重试（1s → 2s → 4s）
- **整批 RPC 失败**：该批地址余额保持 NULL，**继续下一批**（不终止流程）。下次同 session 再跑时该批地址会被重新查询并填入。

#### 7. 进度日志示例

```
[balance-export] 会话 20260916_124057 表 balance_export_20260916_124057 启动
[balance-export] 已写入 100940 个地址到表 balance_export_20260916_124057（按 1000/批）
[balance-export] 开始查询: 总 100940 地址
[balance-export] 进度: 10094/100940
[balance-export] 进度: 20188/100940
…
[balance-export] 完成: 表: balance_export_20260916_124057 共更新 100940 行
```

#### 8. 查询余额

```sql
SELECT address,
       native_balance,
       usdt_dac1_balance,
       aia_abc1_balance,
       updated_at
FROM balance_export_20260916_124057
ORDER BY id;
```

> 列名包含地址前 4 位 hex 是为了在 symbol 重复时仍能区分不同代币（例如两个 USDT 不同合约）。

如需按人读单位展示：

```sql
SELECT address,
       native_balance / 1e18 AS native_aia,
       usdt_dac1_balance / 1e6 AS usdt,
       aia_abc1_balance / 1e18 AS aia
FROM balance_export_20260916_124057;
```

### 生成账户（gen-account）

生成新的以太坊地址与私钥，**完全离线**，私钥**不会上传任何远端**。输出为 JSON 数组，请妥善保管。

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

#### 安全保证（三层防御）

1. **熵源探测**：模块加载与每次生成前探测 `node:crypto.randomBytes`（优先）或 `WebCrypto.getRandomValues`；任一可用方生成；二者皆缺失直接抛错拒绝生成。绝不使用 `Math.random` 等弱源。
2. **强熵**：32 字节（256 bit）熵，源自 OS 内核 CSPRNG；远超比特币 / BIP-39 推荐下限（128 bit）。
3. **签名往返校验**：每个账户生成后立即用私钥对固定消息 `web3-tools:address-derivation-check` 签名并 `verifyMessage` 恢复地址，与声称地址比对；任一步骤不符即抛错——可捕获 ethers 升级或实现 bug 导致的地址派生错误。

`meta.verified === true` 表示本轮已通过上述校验。生产代码（CLI、库调用）都会执行此校验；集成测试 `tests/actions/account.integration.test.js` 用真实 ethers 跑 sign + recover 闭环。

## 项目结构

```text
src/
├── index.js                   # CLI 入口，按子命令分发
├── core/
│   ├── config.js              # 加载 / 校验 config.json
│   ├── logger.js              # 控制台 + 文件双输出，懒加载日志流
│   ├── rpc.js                 # JsonRpcProvider 封装
│   ├── xlsx.js                # xlsx 解析、金额归一化、转账记录提取
│   ├── schema.js              # SQL 标识符校验 + 建表 / UPDATE / INSERT DDL/DML 构建器
│   ├── db.js                  # MySQL 配置加载 + 连接池 + 事务包装
│   └── batch-rpc.js           # JSON-RPC 2.0 批量调用 + 重试 / 指数退避
└── actions/
    ├── account.js             # gen-account：账户生成 + 三层防御
    ├── balance.js             # balance：原生币 + ERC20 余额查询
    ├── executor.js            # execute：批量合约执行
    ├── collect.js             # collect / collect-native：代币与原生币归集
    ├── distribute.js          # distribute：xlsx 驱动批量分发
    └── balance-export.js      # balance-export：xlsx 解析 → MySQL 宽表 → 批量 RPC 写回

tests/
├── actions/                   # balance / collect / distribute / executor / account / balance-export 单元测试
│                              # 含 account.integration.test.js（真实 ethers 跑闭环）
└── core/                      # config / logger / rpc / xlsx / schema / db / batch-rpc 单元测试

config/
├── config.example.json        # 模板（已入库）
├── config.json                # 实际配置（已 gitignore，绝对不要入库）
├── tokens-export.example.json # balance-export 代币列表模板（已入库）
├── tokens-export.json         # 真实代币列表（已 gitignore）
├── database.example.json      # MySQL 配置模板（已入库）
└── database.json              # 真实数据库配置（已 gitignore）

coverage/                      # 测试覆盖率产物（已 gitignore）
docs/                          # 项目文档
logs/                          # 运行日志（已 gitignore）
```

## 测试

```bash
npm test
```

使用 Jest + ESM（`--experimental-vm-modules`）。覆盖率阈值见 `jest.config.js`，产物输出到 `coverage/`。

测试组织：

| 类型 | 覆盖范围 | 文件 |
|------|----------|------|
| 单元 | 配置加载、日志、RPC、xlsx 解析、金额归一化、SQL 构建器、JSON-RPC 批量、各 action | `tests/core/*.test.js`、`tests/actions/*.test.js` |
| 集成 | 真实 ethers 跑账户生成 sign + recover 闭环 | `tests/actions/account.integration.test.js` |

## 日志

所有命令的日志同时输出到：

- **控制台**：按 `execution.logLevel` 过滤（JSON 格式单行）
- **文件**：`logs/app.log`（懒加载，首次写入时创建；JSON 格式便于解析）

日志条目格式：

```json
{"timestamp":"2026-07-08T12:40:57.659Z","level":"info","message":"[0xAbC…] 原生币余额: 1.5 ETH"}
```

## 安全

- 本仓库**不存储任何真实私钥**——`config/config.json` 已在 `.gitignore` 中
- `config/database.json`（数据库密码）与 `config/tokens-export.json`（代币列表）也在 `.gitignore` 中
- 修改配置前请确认 `.gitignore` 中包含上述三个文件
- 提交前可运行 `git status` 再次确认没有敏感文件被暂存
- `gen-account` 输出包含私钥，请妥善保管；建议管道重定向到本地加密存储，**不要写入公共日志或粘贴到公共渠道**
- 所有合约 / 归集 / 分发交易都先 `estimateGas` 预检，明显会回滚的交易不会浪费 Gas
- `distribute` 在发第一笔前预检余额（含 Gas 预留），整体不足时一笔不发，避免半完成状态
- `balance-export` 写入 MySQL 的所有 SQL 均使用预编译参数（防注入）；表名 / 列名均通过关键字黑名单 + 长度 + 字符白名单校验
- 表 / 列名含 token symbol 时会被规整为 `<symbol>_<addr4hex>_balance`，symbol 部分小写 + 非字母数字替换为 `_` + 关键字黑名单；`drop` 等关键字会被拒绝

## 开发提示

- 所有源文件使用 **ESM**（`"type": "module"`），导入路径需带 `.js` 后缀
- 金额统一以 `bigint` 在最小单位运算，仅在展示与日志处用 `ethers.formatUnits` 转回字符串
- 任何对外暴露函数都使用 JSDoc 标注参数与返回值类型，便于编辑器补全与静态检查
- 提交前请确保 `npm test` 通过且覆盖率 ≥ 80%