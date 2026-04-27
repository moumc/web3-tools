import { ethers } from 'ethers';
import { queryTokenBalance } from './balance.js';

// 默认 gas limit 配置
const DEFAULT_GAS_LIMIT = BigInt(300000);

/**
 * @typedef {Object} ExecuteResult
 * @property {boolean} success - 执行是否成功
 * @property {string} address - 账户地址
 * @property {string} [error] - 错误信息（如果失败）
 * @property {Array<{contractName: string, txHash: string, status: number, gasUsed: bigint}>} transactions - 交易详情
 * @property {Object} balanceChanges - 余额变化 {tokenName: {before: bigint, after: bigint}}
 */

/**
 * 对比执行前后余额
 * @param {string} address - 账户地址
 * @param {Object} tokens - 代币配置
 * @param {Object} balanceBefore - 执行前余额
 * @param {Object} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 * @returns {Promise<Object>} 余额变化结果
 */
async function compareBalances(address, tokens, balanceBefore, rpcClient, logger) {
  const balanceChanges = {};

  for (const [tokenName, tokenInfo] of Object.entries(tokens)) {
    try {
      const balanceAfter = await queryTokenBalance(rpcClient, address, tokenInfo.address);
      const tokenNameDisplay = tokenInfo.name || tokenName;
      logger.info(`[${address}] ${tokenNameDisplay} 执行后余额: ${balanceAfter.toString()}`);

      balanceChanges[tokenName] = {
        before: balanceBefore[tokenName],
        after: balanceAfter
      };

      if (balanceBefore[tokenName] === balanceAfter) {
        logger.warn(`[${address}] ${tokenNameDisplay} 余额未变化，请确认交易是否执行成功`);
      } else {
        logger.info(`[${address}] ${tokenNameDisplay} 余额已变化，执行成功`);
      }
    } catch (balanceError) {
      logger.error(`[${address}] 获取 ${tokenName} 执行后余额失败: ${balanceError.message}`);
      balanceChanges[tokenName] = {
        before: balanceBefore[tokenName],
        after: null
      };
    }
  }

  return balanceChanges;
}

/**
 * 执行单个合约调用
 * @param {string} address - 账户地址
 * @param {string} privateKey - 私钥
 * @param {string} contractName - 合约名称
 * @param {Object} contractInfo - 合约信息 {address, input}
 * @param {Object} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 * @returns {Promise<{contractName: string, txHash: string, status: number, gasUsed: bigint}|null>} 交易结果
 */
async function executeContract(address, privateKey, contractName, contractInfo, rpcClient, logger) {
  logger.info(`[${address}] 执行合约 ${contractName}: ${contractInfo.address}`);

  try {
    const tx = {
      to: contractInfo.address,
      data: contractInfo.input,
      value: 0,
      gasLimit: DEFAULT_GAS_LIMIT
    };

    const signer = new ethers.Wallet(privateKey, rpcClient.provider);
    const sentTx = await signer.sendTransaction(tx);
    logger.info(`[${address}] 交易已发送，等待确认... hash: ${sentTx.hash}`);

    const receipt = await sentTx.wait();
    logger.info(`[${address}] 交易确认完成 blockNumber: ${receipt.blockNumber}, status: ${receipt.status}`);

    return {
      contractName,
      txHash: sentTx.hash,
      status: receipt.status,
      gasUsed: receipt.gasUsed
    };
  } catch (txError) {
    logger.error(`[${address}] 交易执行失败: ${txError.message}`);
    return null;
  }
}

/**
 * 执行单个账户的所有合约
 * @param {Object} account - 账户 {address, privateKey}
 * @param {Object} tokens - 代币配置
 * @param {Object} contracts - 合约配置
 * @param {Object} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 * @returns {Promise<ExecuteResult>} 执行结果
 */
async function executeAccountContracts(account, tokens, contracts, rpcClient, logger) {
  const { address, privateKey } = account;
  const result = {
    success: false,
    address,
    transactions: [],
    balanceChanges: {}
  };

  // 获取执行前余额
  const balanceBefore = {};
  for (const [tokenName, tokenInfo] of Object.entries(tokens)) {
    try {
      balanceBefore[tokenName] = await queryTokenBalance(rpcClient, address, tokenInfo.address);
      const tokenNameDisplay = tokenInfo.name || tokenName;
      logger.info(`[${address}] ${tokenNameDisplay} 执行前余额: ${balanceBefore[tokenName].toString()}`);
    } catch (balanceError) {
      logger.error(`[${address}] 获取 ${tokenName} 执行前余额失败: ${balanceError.message}`);
      balanceBefore[tokenName] = BigInt(0);
    }
  }

  // 执行每个合约调用
  for (const [contractName, contractInfo] of Object.entries(contracts)) {
    const txResult = await executeContract(address, privateKey, contractName, contractInfo, rpcClient, logger);
    if (txResult) {
      result.transactions.push(txResult);
    }
  }

  // 检查是否有交易失败
  const hasFailure = result.transactions.some(tx => tx.status === 0);
  if (hasFailure) {
    result.success = false;
    result.error = '部分交易执行失败';
  } else if (result.transactions.length === 0) {
    result.success = false;
    result.error = '所有交易执行失败';
  } else {
    result.success = true;
  }

  // 获取执行后余额并对比
  result.balanceChanges = await compareBalances(address, tokens, balanceBefore, rpcClient, logger);

  return result;
}

/**
 * 批量执行合约调用
 * @param {Array} accounts - 账户列表
 * @param {Object} tokens - 代币配置
 * @param {Object} contracts - 合约配置
 * @param {RpcClient} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 * @returns {Promise<Array<ExecuteResult>>} 所有账户的执行结果
 */
async function executeContracts(accounts, tokens, contracts, rpcClient, logger) {
  logger.info('=== 开始执行合约 ===');

  /** @type {Array<ExecuteResult>} */
  const results = [];

  for (const account of accounts) {
    try {
      const result = await executeAccountContracts(account, tokens, contracts, rpcClient, logger);
      results.push(result);
    } catch (error) {
      logger.error(`[${account.address}] 处理失败: ${error.message}`);
      results.push({
        success: false,
        address: account.address,
        error: error.message,
        transactions: [],
        balanceChanges: {}
      });
    }
  }

  logger.info('=== 合约执行完成 ===');
  return results;
}

export { executeContracts };
