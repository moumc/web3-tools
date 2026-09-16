import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './core/logger.js';
import { loadConfig } from './core/config.js';
import { RpcClient } from './core/rpc.js';
import { queryBalances } from './actions/balance.js';
import { executeContracts } from './actions/executor.js';
import { collectTokens, collectNativeCoins } from './actions/collect.js';
import { generateAccounts } from './actions/account.js';
import { runDistribute } from './actions/distribute.js';
import { runBalanceExport } from './actions/balance-export.js';

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  if (!action) {
    console.error('请指定操作: balance, execute, collect, collect-native, distribute, balance-export, gen-account');
    console.error('用法: node src/index.js <action> [args]');
    process.exit(1);
  }

  // gen-account 不需要 config / RPC / 日志，直接走
  if (action === 'gen-account') {
    const count = Number.parseInt(args[1], 10);
    try {
      const accounts = generateAccounts(Number.isNaN(count) ? undefined : count);
      console.log(JSON.stringify(accounts, null, 2));
    } catch (error) {
      console.error(`生成失败: ${error.message}`);
      process.exit(1);
    }
    process.exit(0);
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
      await queryBalances(config.accounts, config.tokens, config.network.nativeSymbol, rpcClient, logger);
    } else if (action === 'execute') {
      await executeContracts(config.accounts, config.tokens, config.contracts, rpcClient, logger);
    } else if (action === 'collect') {
      if (!config.collector?.targetAddress) {
        console.error('配置中缺少 collector.targetAddress');
        process.exit(1);
      }
      await collectTokens(config.accounts, config.tokens, config.collector.targetAddress, rpcClient, logger);
    } else if (action === 'collect-native') {
      if (!config.collector?.targetAddress) {
        console.error('配置中缺少 collector.targetAddress');
        process.exit(1);
      }
      await collectNativeCoins(config.accounts, config.network.nativeSymbol, config.collector.targetAddress, rpcClient, logger);
    } else if (action === 'distribute') {
      // 第一个非 flag 参数为 xlsx 路径
      const xlsxPath = args.slice(1).find(a => !a.startsWith('--'));
      if (!xlsxPath) {
        console.error('用法: node src/index.js distribute <xlsx 文件路径> [--dry-run]');
        console.error('xlsx 格式: 列1=收款地址, 列2=数量, 首行为表头');
        process.exit(1);
      }
      const dryRun = args.includes('--dry-run');
      await runDistribute(config, xlsxPath, rpcClient, logger, { dryRun });
    } else if (action === 'balance-export') {
      const inputPath = args[1];
      if (!inputPath) {
        console.error('用法: node src/index.js balance-export <输入 xlsx 路径> [--session <id>] [--fresh] [--batch-size <n>] [--tokens <代币列表>]');
        console.error('xlsx 格式: 无表头，所有非空单元格视为地址');
        process.exit(1);
      }
      let sessionId;
      let tokensPath;
      let fresh = false;
      let batchSize = 100;
      for (let i = 2; i < args.length; i += 1) {
        const a = args[i];
        if (a === '--session') {
          sessionId = args[++i];
        } else if (a === '--tokens') {
          tokensPath = args[++i];
        } else if (a === '--fresh') {
          fresh = true;
        } else if (a === '--batch-size') {
          batchSize = Number.parseInt(args[++i], 10);
          if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > 10000) {
            console.error('--batch-size 必须是 1..10000 的整数');
            process.exit(1);
          }
        }
      }

      // 加载数据库配置
      const { loadDatabaseConfig, createPool, closePool } = await import('./core/db.js');
      const dbCfg = loadDatabaseConfig();
      if (!dbCfg) {
        console.error('未找到 config/database.json；balance-export 需要 MySQL 配置');
        process.exit(1);
      }
      const pool = createPool(dbCfg);
      try {
        await runBalanceExport({
          config,
          inputPath,
          pool,
          sessionId,
          tokensPath,
          fresh,
          batchSize,
          logger
        });
      } finally {
        await closePool(pool);
      }
    } else {
      console.error(`未知操作: ${action}`);
      console.error('可用操作: balance, execute, collect, collect-native, distribute, balance-export, gen-account');
      process.exit(1);
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    process.exit(1);
  }

  process.exit(0);
}

// 仅当作为入口脚本直接执行时才调用 main()；被 import 时（例如测试）不自动跑
const isMain = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return fileURLToPath(import.meta.url) === path.resolve(argv1);
  } catch (_) {
    return false;
  }
})();

if (isMain) {
  main();
}

export { main };