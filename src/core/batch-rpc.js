/**
 * JSON-RPC 2.0 单条请求工具（顺序逐条，**不并发**）
 *
 * 设计要点（优先可靠性，效率次要）：
 * - 每条 call 单独发一条 HTTP POST，不拼 batch
 * - 每条 call 失败按指数退避重试（1s → 2s → 4s）
 * - HTTP 层错误 / RPC error / 响应缺字段 → 标记该条 ok=false，其它不受影响
 * - 输入 calls 按原顺序返回结果数组
 *
 * 不发 JSON-RPC batch 的原因：
 * - 部分生产 RPC 不支持 batch（会返回 method not found）
 * - 服务端可能按接收顺序处理 batch，第一条失败影响后续
 * - server 端可能重写 id，与请求 id 不匹配导致结果错位（之前观察到的现象）
 */

import { ethers } from 'ethers';

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
  // 去掉 0x 再 pad 到 32 字节；**保留 checksum 大小写**，不能 toLowerCase
  // 生产 RPC 对 calldata 里的地址大小写敏感：全小写会返非零的脏数据
  const padded = '0'.repeat(24) + checksum.slice(2);
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
 * 单条 JSON-RPC 调用（带超时）
 * @param {Object} args
 * @param {string} args.rpcUrl
 * @param {string} args.method
 * @param {any[]} [args.params]
 * @param {number} [args.timeoutMs]
 * @param {typeof fetch} [args.fetchImpl]
 * @returns {Promise<any>} result 字段值
 */
async function singleRpc({ rpcUrl, method, params, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl }) {
  const f = fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await f(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method,
        params: params || []
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
    }

    const body = await response.json();
    if (body && body.error) {
      const msg = body.error.message || JSON.stringify(body.error);
      throw new Error(`RPC error: ${msg}`);
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 并发执行一组 JSON-RPC 调用（每条单独 POST，并发上限默认 10）
 * 行为：
 * - 每条单独 HTTP POST，不发 batch（避免服务端 id 重写等问题）
 * - 用 worker pool 模式维持固定并发数
 * - 每条单独 try/catch，失败按指数退避重试
 * - 返回值与 calls 等长，按输入顺序对齐：{ id, ok, result?, error? }
 *
 * @param {Object} args
 * @param {string} args.rpcUrl
 * @param {Array<{id: number|string, method: string, params: any[]}>} args.calls
 * @param {number} [args.timeoutMs=30000]
 * @param {number} [args.retries=3]
 * @param {number} [args.concurrency=10] - 同时在飞的请求数
 * @param {(attemptIndex: number) => number} [args.backoffMs]
 * @param {typeof fetch} [args.fetchImpl]
 * @param {(call: any, index: number, result: any) => void} [args.onProgress] - 每条完成后回调
 * @returns {Promise<Array<{id, ok, result?, error?}>>}
 */
async function batchRpcCall({
  rpcUrl,
  calls,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  concurrency = 10,
  backoffMs = defaultBackoff,
  fetchImpl,
  onProgress
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

  const out = new Array(calls.length);
  let next = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= calls.length) return;
      const c = calls[i];

      let lastError = null;
      let result = null;
      let ok = false;

      const maxAttempts = retries + 1;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          result = await singleRpc({ rpcUrl, method: c.method, params: c.params, timeoutMs, fetchImpl });
          ok = true;
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if (attempt < maxAttempts - 1) {
            await sleep(backoffMs(attempt));
          }
        }
      }

      out[i] = ok
        ? { id: c.id, ok: true, result }
        : { id: c.id, ok: false, error: lastError ? lastError.message : 'unknown' };

      completed += 1;
      if (typeof onProgress === 'function') {
        try {
          onProgress(c, i, out[i]);
        } catch (_) {
          // 回调异常不影响主流程
        }
      }
    }
  }

  const workerCount = Math.min(concurrency, calls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return out;
}

export {
  batchRpcCall,
  singleRpc,
  encodeBalanceOfData,
  defaultBackoff
};
