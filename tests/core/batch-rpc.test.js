import { jest } from '@jest/globals';
import { batchRpcCall, encodeBalanceOfData } from '../../src/core/batch-rpc.js';

// 构造一个可控的 fetch 实现，记录调用 + 返回预设响应
function makeFetchMock(scenarios) {
  // scenarios: 数组按调用顺序返回 response，每个是 {status, body} 或 {throw: Error}
  let i = 0;
  return jest.fn(async (url, init) => {
    const s = scenarios[Math.min(i, scenarios.length - 1)];
    i += 1;
    if (s.throw) throw s.throw;
    return {
      ok: s.status >= 200 && s.status < 300,
      status: s.status,
      statusText: s.statusText || '',
      json: async () => s.body,
      text: async () => JSON.stringify(s.body)
    };
  });
}

describe('core/batch-rpc', () => {
  describe('encodeBalanceOfData', () => {
    test('produces 0x70a08231 + padded address', () => {
      // balanceOf(address) selector = 0x70a08231
      const addr = '0x0000000000000000000000000000000000000001';
      const data = encodeBalanceOfData(addr);
      expect(data.startsWith('0x70a08231')).toBe(true);
      // 0x70a08231 + 32 bytes address => 0x + (8 + 64) hex chars
      expect(data.length).toBe(2 + 8 + 64);
    });

    test('throws on invalid address', () => {
      expect(() => encodeBalanceOfData('not-an-address')).toThrow();
    });
  });

  describe('batchRpcCall', () => {
    test('happy path: parses JSON-RPC batch response', async () => {
      const fetchMock = makeFetchMock([{
        status: 200,
        body: [
          { jsonrpc: '2.0', id: 1, result: '0x100' },
          { jsonrpc: '2.0', id: 2, result: '0x200' },
          { jsonrpc: '2.0', id: 3, error: { code: -32000, message: 'execution reverted' } }
        ]
      }]);
      const result = await batchRpcCall({
        rpcUrl: 'http://test',
        calls: [
          { id: 1, method: 'eth_call', params: [{ to: '0xa', data: '0x' }, 'latest'] },
          { id: 2, method: 'eth_getBalance', params: ['0xb', 'latest'] },
          { id: 3, method: 'eth_call', params: [{ to: '0xc', data: '0x' }, 'latest'] }
        ],
        fetchImpl: fetchMock
      });
      expect(result).toEqual([
        { id: 1, ok: true, result: '0x100' },
        { id: 2, ok: true, result: '0x200' },
        { id: 3, ok: false, error: 'execution reverted' }
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://test');
      const payload = JSON.parse(init.body);
      expect(payload).toHaveLength(3);
      expect(payload[0].id).toBe(1);
      expect(payload[0].method).toBe('eth_call');
    });

    test('HTTP 500: retry with exponential backoff then succeed', async () => {
      const fetchMock = makeFetchMock([
        { status: 500, body: { error: 'server error' } },
        { status: 200, body: [{ jsonrpc: '2.0', id: 1, result: '0xabc' }] }
      ]);
      const result = await batchRpcCall({
        rpcUrl: 'http://test',
        calls: [{ id: 1, method: 'eth_getBalance', params: ['0x', 'latest'] }],
        retries: 3,
        backoffMs: () => 0, // 加速测试
        fetchImpl: fetchMock
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result[0]).toEqual({ id: 1, ok: true, result: '0xabc' });
    });

    test('network error: retries, fails after max retries', async () => {
      const fetchMock = makeFetchMock([
        { throw: new Error('ECONNRESET') },
        { throw: new Error('ECONNRESET') },
        { throw: new Error('ECONNRESET') }
      ]);
      await expect(batchRpcCall({
        rpcUrl: 'http://test',
        calls: [{ id: 1, method: 'eth_call', params: [] }],
        retries: 2,
        backoffMs: () => 0,
        fetchImpl: fetchMock
      })).rejects.toThrow(/RPC 请求失败/);
      expect(fetchMock).toHaveBeenCalledTimes(3); // 1 初始 + 2 重试
    });

    test('timeout: AbortError triggers retry', async () => {
      let callIdx = 0;
      const fetchMock = jest.fn(async (url, init) => {
        callIdx += 1;
        if (callIdx === 1) {
          // 第一次模拟 AbortError（不论是超时还是网络中断）
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        }
        return {
          ok: true, status: 200,
          json: async () => [{ jsonrpc: '2.0', id: 1, result: 'ok' }]
        };
      });
      const result = await batchRpcCall({
        rpcUrl: 'http://test',
        calls: [{ id: 1, method: 'eth_call', params: [] }],
        timeoutMs: 30000,
        retries: 2,
        backoffMs: () => 0,
        fetchImpl: fetchMock
      });
      expect(result[0]).toEqual({ id: 1, ok: true, result: 'ok' });
      expect(fetchMock).toHaveBeenCalledTimes(2); // 1 失败 + 1 重试成功
    });

    test('response missing id: marked as error', async () => {
      const fetchMock = makeFetchMock([{
        status: 200,
        body: [
          { jsonrpc: '2.0', id: 1, result: '0x1' },
          { jsonrpc: '2.0', id: 999, result: '0x2' } // 没有 id=2 的响应
        ]
      }]);
      const result = await batchRpcCall({
        rpcUrl: 'http://test',
        calls: [
          { id: 1, method: 'eth_call', params: [] },
          { id: 2, method: 'eth_call', params: [] }
        ],
        fetchImpl: fetchMock
      });
      expect(result[1]).toEqual({ id: 2, ok: false, error: '响应缺少 id=2 的项' });
    });

    test('empty calls list: returns empty array, no fetch', async () => {
      const fetchMock = makeFetchMock([]);
      const result = await batchRpcCall({ rpcUrl: 'http://test', calls: [], fetchImpl: fetchMock });
      expect(result).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
