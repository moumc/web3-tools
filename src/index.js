import { Logger } from './core/logger.js';
import { loadConfig } from './core/config.js';
import { RpcClient } from './core/rpc.js';
import { queryBalances } from './actions/balance.js';
import { executeContracts } from './actions/executor.js';
import { collectTokens, collectNativeCoins } from './actions/collect.js';
import { generateAccounts } from './actions/account.js';
import { runDistribute } from './actions/distribute.js';

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  if (!action) {
    console.error('请指定操作: balance, execute, collect, collect-native, distribute, gen-account');
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
    } else {
      console.error(`未知操作: ${action}`);
      console.error('可用操作: balance, execute, collect, collect-native, distribute, gen-account');
      process.exit(1);
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    process.exit(1);
  }

  process.exit(0);
}

main();