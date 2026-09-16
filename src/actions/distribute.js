import { ethers } from 'ethers';
import { readTransferSheet } from '../core/xlsx.js';

// 单笔原生币转账的标准 Gas 上限
const GAS_LIMIT_PER_TRANSFER = BigInt(21000);

// 原生币精度固定为 18 位
const NATIVE_DECIMALS = 18;

/**
 * @typedef {Object} DistributeResult
 * @property {boolean} success - 转账是否成功
 * @property {number} rowNumber - 来源表格行号
 * @property {string} toAddress - 收款地址
 * @property {string} rawAmount - 原始数量（人类可读）
 * @property {string} amountUnits - 最小单位数量（字符串形式的 BigInt）
 * @property {string} txHash - 交易哈希
 * @property {string} [error] - 错误信息（如果失败）
 */

/**
 * 分发单笔原生币转账
 * @param {Object} signer - 已连接 provider 的钱包
 * @param {Object} senderAccount - 发送方账户 {address, privateKey}
 * @param {Object} transfer - 转账记录 {rowNumber, address, rawAmount, amountUnits}
 * @param {Object} feeData - 费用数据 {gasPrice}
 * @param {Object} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 * @returns {Promise<DistributeResult>}
 */
async function distributeOne(signer, senderAccount, transfer, feeData, rpcClient, logger) {
  const { rowNumber, address: toAddress, rawAmount, amountUnits } = transfer;

  try {
    const txRequest = {
      to: toAddress,
      value: amountUnits,
      from: senderAccount.address
    };

    // 预估 Gas，提前拦截必然失败的交易（避免浪费 Gas）
    try {
      await rpcClient.provider.estimateGas(txRequest);
    } catch (estimateError) {
      logger.warn(`[行 ${rowNumber}] -> ${toAddress} 预估失败，跳过: ${estimateError.reason || estimateError.message}`);
      return {
        success: false,
        rowNumber,
        toAddress,
        rawAmount,
        amountUnits: amountUnits.toString(),
        txHash: '',
        error: '预估失败'
      };
    }

    txRequest.gasLimit = GAS_LIMIT_PER_TRANSFER;
    txRequest.gasPrice = feeData.gasPrice;

    const sentTx = await signer.sendTransaction(txRequest);
    logger.info(`[行 ${rowNumber}] -> ${toAddress} ${rawAmount} 交易已发送，等待确认... hash: ${sentTx.hash}`);

    const receipt = await sentTx.wait();
    logger.info(`[行 ${rowNumber}] -> ${toAddress} 完成 blockNumber: ${receipt.blockNumber}, status: ${receipt.status}`);

    return {
      success: receipt.status === 1,
      rowNumber,
      toAddress,
      rawAmount,
      amountUnits: amountUnits.toString(),
      txHash: sentTx.hash,
      error: receipt.status === 0 ? '交易失败' : undefined
    };
  } catch (error) {
    logger.error(`[行 ${rowNumber}] -> ${toAddress} 转账失败: ${error.message}`);
    return {
      success: false,
      rowNumber,
      toAddress,
      rawAmount,
      amountUnits: amountUnits.toString(),
      txHash: '',
      error: error.message
    };
  }
}

/**
 * 从单一发送地址向多个收款地址批量分发原生币
 * @param {Object} params
 * @param {Object} params.senderAccount - 发送方账户 {address, privateKey}
 * @param {Array} params.transfers - 转账记录列表（来自 extractTransfers）
 * @param {string} params.nativeSymbol - 原生币符号（ETH、AIA 等），仅用于日志
 * @param {Object} params.rpcClient - RPC 客户端
 * @param {Logger} params.logger - 日志实例
 * @param {boolean} [params.dryRun=false] - 仅预览，不实际发送
 * @returns {Promise<{dryRun: boolean, results: Array<DistributeResult>, total: bigint, successCount: number, failedCount: number}>}
 */
async function distributeNative({ senderAccount, transfers, nativeSymbol, rpcClient, logger, dryRun = false }) {
  const symbol = nativeSymbol || 'ETH';

  if (!Array.isArray(transfers) || transfers.length === 0) {
    throw new Error('转账记录为空');
  }

  const total = transfers.reduce((sum, t) => sum + t.amountUnits, BigInt(0));
  const formattedTotal = ethers.formatUnits(total, NATIVE_DECIMALS);

  logger.info(`=== 开始分发 ${symbol} ===`);
  logger.info(`发送方: ${senderAccount.address}, 收款地址数: ${transfers.length}, 总量: ${formattedTotal} ${symbol}`);

  // 预检：余额必须覆盖 转账总额 + Gas 预留，不足则整体中止（一笔都不发）
  const feeData = await rpcClient.provider.getFeeData();
  const balance = BigInt(await rpcClient.getNativeBalance(senderAccount.address));
  const gasReserve = (feeData.gasPrice || BigInt(0)) * GAS_LIMIT_PER_TRANSFER * BigInt(transfers.length);
  const required = total + gasReserve;

  if (balance < required) {
    throw new Error(
      `发送方 ${symbol} 余额不足: 需要 ${ethers.formatUnits(required, NATIVE_DECIMALS)} ` +
      `（转账 ${formattedTotal} + Gas 预留 ${ethers.formatUnits(gasReserve, NATIVE_DECIMALS)}），` +
      `实际 ${ethers.formatUnits(balance, NATIVE_DECIMALS)}`
    );
  }

  // dry-run：只打印预览，不发送任何交易
  if (dryRun) {
    for (const t of transfers) {
      logger.info(`[预览] 行 ${t.rowNumber}: ${t.address} <- ${t.rawAmount} ${symbol}`);
    }
    logger.info(`[预览] dry-run 完成，共 ${transfers.length} 笔、总量 ${formattedTotal} ${symbol}，未发送任何交易`);
    return { dryRun: true, results: [], total, successCount: 0, failedCount: 0 };
  }

  const signer = new ethers.Wallet(senderAccount.privateKey, rpcClient.provider);

  /** @type {Array<DistributeResult>} */
  const results = [];
  // 顺序执行：每笔等待确认后再发下一笔，避免 nonce 竞争
  for (const transfer of transfers) {
    const result = await distributeOne(signer, senderAccount, transfer, feeData, rpcClient, logger);
    results.push(result);
  }

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;

  return { dryRun: false, results, total, successCount, failedCount };
}

/**
 * 从配置文件与 xlsx 文件执行分发
 * 发送方：config.distributor.senderAddress（缺省取 accounts[0]）
 * @param {Object} config - 全局配置
 * @param {string} xlsxPath - xlsx 文件路径（列1=地址，列2=数量，首行为表头）
 * @param {Object} rpcClient - RPC 客户端
 * @param {Logger} logger - 日志实例
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] - 仅预览
 * @returns {Promise<Array<DistributeResult>>}
 */
async function runDistribute(config, xlsxPath, rpcClient, logger, options = {}) {
  const { dryRun = false } = options;

  // 定位发送方账户
  const senderAddressConfig = config.distributor?.senderAddress;
  let senderAccount;
  if (senderAddressConfig) {
    senderAccount = config.accounts.find(
      a => a.address.toLowerCase() === senderAddressConfig.toLowerCase()
    );
    if (!senderAccount) {
      throw new Error(`发送方地址不在 accounts 配置中: ${senderAddressConfig}`);
    }
  } else {
    senderAccount = config.accounts[0];
    logger.warn(`未配置 distributor.senderAddress，默认使用第一个账户: ${senderAccount.address}`);
  }

  const nativeSymbol = config.network.nativeSymbol || 'ETH';
  logger.info(`读取转账表: ${xlsxPath}（原生币 ${nativeSymbol}，精度 ${NATIVE_DECIMALS} 位）`);

  // 解析表格：列1=地址，列2=数量，去掉表头
  const { transfers, skipped } = readTransferSheet(xlsxPath, { decimals: NATIVE_DECIMALS });

  for (const s of skipped) {
    logger.warn(`第 ${s.rowNumber} 行已跳过: ${s.reason}`);
  }
  for (const t of transfers) {
    if (t.duplicate) {
      logger.warn(`第 ${t.rowNumber} 行地址重复: ${t.address}（仍将转账，请确认是否预期）`);
    }
  }

  if (transfers.length === 0) {
    throw new Error('表格中没有有效的转账记录');
  }

  const { results, successCount, failedCount } = await distributeNative({
    senderAccount,
    transfers,
    nativeSymbol,
    rpcClient,
    logger,
    dryRun
  });

  if (!dryRun) {
    logger.info(`=== 分发完成 === 成功: ${successCount}, 失败: ${failedCount}`);
  }

  return results;
}

export { distributeNative, runDistribute };
