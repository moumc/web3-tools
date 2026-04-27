import { JsonRpcProvider } from 'ethers';

/**
 * RPC 客户端封装
 * 封装 ethers.js 的 JsonRpcProvider，提供区块链交互能力
 */
class RpcClient {
  /**
   * 创建 RPC 客户端实例
   * @param {string} rpcUrl - RPC 节点 URL
   * @param {number} chainId - 链 ID
   */
  constructor(rpcUrl, chainId) {
    this.rpcUrl = rpcUrl;
    this.chainId = chainId;
    this.provider = new JsonRpcProvider(rpcUrl, chainId);
  }

  /**
   * 获取原生代币余额
   * @param {string} address - 钱包地址
   * @returns {Promise<string>} 余额（wei 为单位的字符串）
   */
  async getNativeBalance(address) {
    const balance = await this.provider.getBalance(address);
    return balance.toString();
  }

  /**
   * 执行只读调用
   * @param {string} to - 目标合约地址
   * @param {string} data - 调用数据
   * @returns {Promise<string>} 调用的返回值
   */
  async call(to, data) {
    return await this.provider.call({ to, data });
  }

  /**
   * 广播已签名交易
   * @param {string} signedTx - 签名的交易数据
   * @returns {Promise<ethers.TransactionResponse>} 交易响应
   */
  async sendTransaction(signedTx) {
    return await this.provider.broadcastTransaction(signedTx);
  }
}

export { RpcClient };
