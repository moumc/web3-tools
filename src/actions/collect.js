import { ethers } from 'ethers';
import { queryTokenBalance } from './balance.js';

// ERC20 transfer(address, amount) 函数选择器
const ERC20_TRANSFER_SELECTOR = '0xa9059cbb';

/**
 * @typedef {Object} CollectResult
 * @property {boolean} success - 归集是否成功
 * @property {string} address - 账户地址
 * @property {string} tokenName - 代币名称
 * @property {string} amount - 归集数量
 * @property {string} txHash - 交易哈希
 * @property {string} [error] - 错误信息（如果失败）
 */

/**
 * 归集单个代币
 * @param {Object} account - 账户 {address, privateKey}
 * @param {Object} tokenInfo - 代币信息 {address, name, decimals}
 * @param {string} targetAddress - 目标地址
 * @param {Object} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 * @returns {Promise<CollectResult>} 归集结果
 */
async function collectToken(account, tokenInfo, targetAddress, rpcClient, logger) {
  const { address, privateKey } = account;
  const { address: tokenAddress, name: tokenName, decimals } = tokenInfo;

  try {
    // 查询当前余额
    const balance = await queryTokenBalance(rpcClient, address, tokenAddress);
    const formattedBalance = ethers.formatUnits(balance, decimals || 18);

    if (balance === BigInt(0)) {
      logger.info(`[${address}] ${tokenName} 余额为 0，跳过归集`);
      return {
        success: true,
        address,
        tokenName,
        amount: '0',
        txHash: ''
      };
    }

    logger.info(`[${address}] ${tokenName} 开始归集: ${formattedBalance} -> ${targetAddress}`);

    const signer = new ethers.Wallet(privateKey, rpcClient.provider);

    // 构建 transfer 数据
    const amountHex = balance.toString(16);
    const paddedAmount = amountHex.padStart(64, '0');
    const data = ERC20_TRANSFER_SELECTOR + targetAddress.slice(2).toLowerCase() + paddedAmount;

    const txRequest = {
      to: tokenAddress,
      data: data,
      value: 0,
      from: address
    };

    // 预估 Gas
    try {
      await rpcClient.provider.estimateGas(txRequest);
    } catch (estimateError) {
      logger.warn(`[${address}] ${tokenName} 归集预估失败，跳过: ${estimateError.reason || estimateError.message}`);
      return {
        success: false,
        address,
        tokenName,
        amount: formattedBalance,
        txHash: '',
        error: '预估失败'
      };
    }

    const feeData = await rpcClient.provider.getFeeData();
    txRequest.gasLimit = BigInt(100000);
    txRequest.gasPrice = feeData.gasPrice;

    const sentTx = await signer.sendTransaction(txRequest);
    logger.info(`[${address}] ${tokenName} 归集交易已发送，等待确认... hash: ${sentTx.hash}`);

    const receipt = await sentTx.wait();
    logger.info(`[${address}] ${tokenName} 归集完成 blockNumber: ${receipt.blockNumber}, status: ${receipt.status}`);

    return {
      success: receipt.status === 1,
      address,
      tokenName,
      amount: formattedBalance,
      txHash: sentTx.hash,
      error: receipt.status === 0 ? '交易失败' : undefined
    };
  } catch (error) {
    logger.error(`[${address}] ${tokenName} 归集失败: ${error.message}`);
    return {
      success: false,
      address,
      tokenName,
      amount: '0',
      txHash: '',
      error: error.message
    };
  }
}

/**
 * 批量归集代币到目标地址
 * @param {Array} accounts - 账户列表
 * @param {Object} tokens - 代币配置
 * @param {string} targetAddress - 目标地址
 * @param {RpcClient} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 * @returns {Promise<Array<CollectResult>>} 归集结果列表
 */
async function collectTokens(accounts, tokens, targetAddress, rpcClient, logger) {
  logger.info('=== 开始归集代币 ===');
  logger.info(`目标地址: ${targetAddress}`);

  /** @type {Array<CollectResult>} */
  const results = [];

  for (const account of accounts) {
    for (const [tokenName, tokenInfo] of Object.entries(tokens)) {
      const result = await collectToken(account, tokenInfo, targetAddress, rpcClient, logger);
      results.push(result);
    }
  }

  // 汇总结果
  const successCount = results.filter(r => r.success && r.txHash).length;
  const failCount = results.filter(r => !r.success).length;
  const skipCount = results.filter(r => r.success && !r.txHash).length;

  logger.info(`=== 归集完成 === 成功: ${successCount}, 失败: ${failCount}, 跳过: ${skipCount}`);

  return results;
}

export { collectTokens };
