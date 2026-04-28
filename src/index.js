import { Logger } from './core/logger.js';
import { loadConfig } from './core/config.js';
import { RpcClient } from './core/rpc.js';
import { queryBalances } from './actions/balance.js';
import { executeContracts } from './actions/executor.js';
import { collectTokens } from './actions/collect.js';

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  if (!action) {
    console.error('请指定操作: balance, execute 或 collect');
    console.error('用法: node src/index.js <balance|execute|collect>');
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
      await queryBalances(config.accounts, config.tokens, config.network.nativeSymbol, rpcClient, logger);
    } else if (action === 'execute') {
      await executeContracts(config.accounts, config.tokens, config.contracts, rpcClient, logger);
    } else if (action === 'collect') {
      if (!config.collector?.targetAddress) {
        console.error('配置中缺少 collector.targetAddress');
        process.exit(1);
      }
      await collectTokens(config.accounts, config.tokens, config.collector.targetAddress, rpcClient, logger);
    } else {
      console.error(`未知操作: ${action}`);
      console.error('可用操作: balance, execute, collect');
      process.exit(1);
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    process.exit(1);
  }

  process.exit(0);
}

main();
