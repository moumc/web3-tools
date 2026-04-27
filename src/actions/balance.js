import { ethers } from 'ethers';

// ERC20 balanceOf(address) 函数选择器
const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';

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
  // 规范化地址为 checksummed 格式
  const normalizedAddress = ethers.getAddress(address);
  const normalizedTokenAddress = ethers.getAddress(tokenAddress);

  // 构建 ERC20 balanceOf(address) 调用数据
  const addressBytes = ethers.zeroPadValue(address, 32);
  const data = ERC20_BALANCE_OF_SELECTOR + ethers.hexlify(addressBytes).slice(2);
  const result = await rpcClient.call(normalizedTokenAddress, data);
  // 解析返回的余额值
  return ethers.toBigInt(result);
}

export { queryBalances, queryTokenBalance };