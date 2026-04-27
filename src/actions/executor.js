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
        logger.info(`[${address}] 执行合约 ${contractName}: ${contractInfo.address}`);

        try {
          // 构造交易
          const tx = {
            to: contractInfo.address,
            data: contractInfo.input,
            value: 0
          };

          // 使用 provider 签名发送交易
          const signer = new ethers.Wallet(privateKey, rpcClient.provider);
          const sentTx = await signer.sendTransaction(tx);
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
        try {
          const balanceAfter = await queryTokenBalance(rpcClient, address, tokenInfo.address);
          const tokenNameDisplay = tokenInfo.name || tokenName;
          logger.info(`[${address}] ${tokenNameDisplay} 执行后余额: ${balanceAfter.toString()}`);

          if (balanceBefore[tokenName] === balanceAfter) {
            logger.warn(`[${address}] ${tokenNameDisplay} 余额未变化，请确认交易是否执行成功`);
          } else {
            logger.info(`[${address}] ${tokenNameDisplay} 余额已变化，执行成功`);
          }
        } catch (balanceError) {
          logger.error(`[${address}] 获取 ${tokenName} 执行后余额失败: ${balanceError.message}`);
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
