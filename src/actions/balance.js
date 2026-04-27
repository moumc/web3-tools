import { ethers } from 'ethers';

/**
 * 查询账户的原生币和代币余额
 * @param {Array} accounts - 账户列表 [{address, privateKey}]
 * @param {Object} tokens - 代币配置 { tokenName: { address, name, decimals } }
 * @param {RpcClient} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 */
async function queryBalances(accounts, tokens, rpcClient, logger) {
  logger.info('=== 开始查询余额 ===');

  for (const account of accounts) {
    const { address } = account;

    try {
      // 查询原生币余额
      const nativeBalance = await rpcClient.getNativeBalance(address);
      const nativeInEth = ethers.formatEther(nativeBalance);
      logger.info(`[${address}] 原生币余额: ${nativeInEth} ETH`);

      // 查询每个代币的余额
      for (const [tokenName, tokenInfo] of Object.entries(tokens)) {
        const tokenBalance = await queryTokenBalance(rpcClient, address, tokenInfo.address);
        const decimals = tokenInfo.decimals || 18;
        const formattedBalance = ethers.formatUnits(tokenBalance, decimals);
        logger.info(`[${address}] ${tokenInfo.name} (${tokenName}) 余额: ${formattedBalance}`);
      }
    } catch (error) {
      logger.error(`[${address}] 查询余额失败: ${error.message}`);
      // 继续处理下一个账户
    }
  }

  logger.info('=== 余额查询完成 ===');
}

/**
 * 查询 ERC20 代币余额
 * @param {RpcClient} rpcClient - RPC 客户端
 * @param {string} address - 钱包地址
 * @param {string} tokenAddress - 代币合约地址
 * @returns {Promise<bigint>} 代币余额
 */
async function queryTokenBalance(rpcClient, address, tokenAddress) {
  // ERC20 balanceOf(address) 的函数签名
  const data = '0x70a08231000000000000000000000000' + address.slice(2).toLowerCase();
  const result = await rpcClient.call(tokenAddress, data);
  // 解析返回的余额值
  return ethers.toBigInt(result);
}

export { queryBalances, queryTokenBalance };