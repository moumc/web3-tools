import { ethers } from 'ethers';

/**
 * JSON-RPC 2.0 批量请求工具
 *
 * 设计要点：
 * - 单次 HTTP 请求携带多条 RPC（call 数组），省去每笔单独 round-trip
 * - HTTP 层错误（5xx、超时、网络断开）→ 整批重试（指数退避）
 * - HTTP 200 但某条 RPC 报 error → 仅该条标记失败，其它不受影响
 * - 响应缺 id → 标记为响应缺失错误
 */

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 3;

/**
 * 编码 ERC20 balanceOf(address) 的 calldata
 * @param {string} address - 钱包地址
 * @returns {string} 0x 开头 hex
 */
function encodeBalanceOfData(address) {
  // ethers.id('balanceOf(address)') 取前 10 字符 = 函数选择子
  const selector = ethers.id('balanceOf(address)').slice(0, 10);
  // address 必须 checksum 化
  const checksum = ethers.getAddress(address);
  // 去掉 0x 再 pad 到 32 字节
  const padded = '0'.repeat(24) + checksum.slice(2).toLowerCase();
  return selector + padded;
}

/**
 * 计算下一次重试的退避时间
 * @param {number} attemptIndex - 0 表示首次失败后第 1 次重试前
 * @returns {number} ms
 */
function defaultBackoff(attemptIndex) {
  // 1s, 2s, 4s
  return 1000 * Math.pow(2, attemptIndex);
}

/**
 * 暂停指定毫秒
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 执行单次 HTTP 批量请求
 * @param {Object} args
 * @param {string} args.rpcUrl
 * @param {Array<{id: number|string, method: string, params: any[]}>} args.calls
 * @param {number} [args.timeoutMs]
 * @param {typeof fetch} [args.fetchImpl]
 * @returns {Promise<Array>}
 */
async function executeBatch({ rpcUrl, calls, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl }) {
  const f = fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await f(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(calls.map(c => ({
        jsonrpc: '2.0',
        id: c.id,
        method: c.method,
        params: c.params || []
      }))),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
    }

    const body = await response.json();
    if (!Array.isArray(body)) {
      throw new Error('响应不是 JSON-RPC batch 数组');
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 将 JSON-RPC batch 响应映射回 calls 顺序
 * @param {Array} calls - 原始请求
 * @param {Array} response - 服务端响应（顺序任意）
 * @returns {Array<{id, ok, result?, error?}>}
 */
function mapResponseToCalls(calls, response) {
  const byId = new Map();
  for (const item of response) {
    if (item && item.id !== undefined) {
      byId.set(item.id, item);
    }
  }
  return calls.map((c) => {
    const item = byId.get(c.id);
    if (!item) {
      return { id: c.id, ok: false, error: `响应缺少 id=${c.id} 的项` };
    }
    if (item.error) {
      const msg = item.error.message || JSON.stringify(item.error);
      return { id: c.id, ok: false, error: msg };
    }
    return { id: c.id, ok: true, result: item.result };
  });
}

/**
 * 公开 API：带重试与超时的批量 RPC 调用
 * @param {Object} args
 * @param {string} args.rpcUrl
 * @param {Array<{id: number|string, method: string, params: any[]}>} args.calls
 * @param {number} [args.timeoutMs=30000]
 * @param {number} [args.retries=3]
 * @param {(attemptIndex: number) => number} [args.backoffMs]
 * @param {typeof fetch} [args.fetchImpl]
 * @returns {Promise<Array<{id, ok, result?, error?}>>}
 */
async function batchRpcCall({
  rpcUrl,
  calls,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  backoffMs = defaultBackoff,
  fetchImpl
}) {
  if (!Array.isArray(calls)) {
    throw new Error('calls 必须为数组');
  }
  if (calls.length === 0) {
    return [];
  }
  if (!rpcUrl) {
    throw new Error('rpcUrl 必填');
  }

  let lastError;
  const maxAttempts = retries + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await executeBatch({ rpcUrl, calls, timeoutMs, fetchImpl });
      return mapResponseToCalls(calls, response);
    } catch (err) {
      lastError = err;
      // 最后一次不再等待
      if (attempt < maxAttempts - 1) {
        await sleep(backoffMs(attempt));
      }
    }
  }
  // 整批 HTTP 层失败：抛出明确错误，让调用方知晓"这一批完全没拿到响应"
  const reason = lastError && lastError.message
    ? lastError.message
    : 'RPC 请求失败';
  const err = new Error(`RPC 请求失败: ${reason}`);
  err.lastError = lastError;
  throw err;
}

export {
  batchRpcCall,
  encodeBalanceOfData,
  defaultBackoff
};
