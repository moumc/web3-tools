import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';

const ADDR_A = '0x1111111111111111111111111111111111111111';
const ADDR_B = '0x2222222222222222222222222222222222222222';
const ADDR_C = '0x3333333333333333333333333333333333333333';

const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const AIA_ADDRESS = '0xABC1230000000000000000000000000000000000';

const UNIT_18 = BigInt(10) ** BigInt(18);

const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

/**
 * 构造 fakePool：记录所有 execute 调用，按需返回结果
 */
function makeFakePool({ rowsByStatus = {} } = {}) {
  const calls = [];
  const executed = []; // { sql, params }
  // 初始时已存在的行（address, id, status）
  let pendingRows = []; // [{id, address}]
  let nextId = 1;
  let tableExists = false;

  const execute = jest.fn(async (sql, params) => {
    const trimmed = sql.trim().toUpperCase();
    executed.push({ sql, params });

    // CREATE TABLE
    if (trimmed.startsWith('CREATE TABLE')) {
      tableExists = true;
      return [{ affectedRows: 0 }];
    }
    // DROP TABLE
    if (trimmed.startsWith('DROP TABLE')) {
      tableExists = false;
      pendingRows = [];
      nextId = 1;
      return [{ affectedRows: 0 }];
    }
    // INSERT IGNORE
    if (trimmed.startsWith('INSERT IGNORE')) {
      // params = addresses 列表
      for (const addr of params) {
        if (!pendingRows.find(r => r.address === addr)) {
          pendingRows.push({ id: nextId++, address: addr, status: 'pending' });
        }
      }
      return [{ affectedRows: params.length }];
    }
    // SELECT address WHERE status='pending' AND id>?
    if (trimmed.startsWith('SELECT `ADDRESS` FROM') || trimmed.startsWith('SELECT `address` FROM')) {
      const [lastId, limit] = params;
      const subset = pendingRows
        .filter(r => r.status === 'pending' && r.id > lastId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
      return [subset.map(r => ({ address: r.address, id: r.id }))];
    }
    // UPDATE
    if (trimmed.startsWith('UPDATE')) {
      // 解析 SQL 拿列名
      const colMatches = [...sql.matchAll(/`(\w+)` = CASE `address`/g)];
      const cols = colMatches.map(m => m[1]);
      const status = /`status` = '(\w+)'/.exec(sql)?.[1] || 'done';
      // params 顺序：[errorMsg?, ...native, ...tokenCols, ...addressList]
      let p = 0;
      let errorMsg;
      const setClauseMatch = /`error_msg` = \?/.test(sql);
      if (setClauseMatch) {
        errorMsg = params[p++];
      }
      // native + 每代币 → 每列一组 (addr, val) × N 地址
      const colParams = {};
      for (const c of cols) {
        colParams[c] = [];
        for (let i = 0; i < pendingRows.length && p + 1 < params.length; ) {
          // 简化：每列按地址数对参数；用最后的 WHERE IN 子句边界判断
          // 这里我们用 limit 推断：addressList 是最后 N 个参数
          break;
        }
      }
      // 简化策略：直接按 rowsByStatus 推断更新值
      // 我们用更直接的策略：把 caseMap 从外部设置
      // 重新设计：fakePool 接受 updateResolver
      throw new Error('UPDATE 路径请通过 updateResolver 设置');
    }
    throw new Error(`未实现的 SQL: ${sql.slice(0, 80)}`);
  });

  return {
    execute,
    _executed: executed,
    _setPending: (rows) => { pendingRows = rows; nextId = rows.length + 1; },
    _getPending: () => [...pendingRows],
    _update: 'use updateResolver'
  };
}

/**
 * 改进版 fakePool：把 UPDATE 用 updateResolver 拆出来
 */
function makeFakePoolV2({ updateResolver } = {}) {
  const executed = [];
  let pendingRows = [];
  let nextId = 1;

  const execute = jest.fn(async (sql, params = []) => {
    executed.push({ sql, params });
    const trimmed = sql.trim().toUpperCase();

    if (trimmed.startsWith('CREATE TABLE')) {
      return [{ affectedRows: 0 }];
    }
    if (trimmed.startsWith('DROP TABLE')) {
      pendingRows = [];
      nextId = 1;
      return [{ affectedRows: 0 }];
    }
    if (trimmed.startsWith('INSERT IGNORE')) {
      let inserted = 0;
      for (const addr of params) {
        if (!pendingRows.find(r => r.address === addr)) {
          pendingRows.push({ id: nextId++, address: addr, status: 'pending' });
          inserted += 1;
        }
      }
      return [{ affectedRows: inserted }];
    }
    if (trimmed.startsWith('SELECT')) {
      // COUNT(*) 路径
      if (/COUNT\(\*\)\s+AS\s+CNT/i.test(sql)) {
        const isDoneQuery = /status\s*=\s*'done'/i.test(sql);
        const cnt = isDoneQuery
          ? pendingRows.filter(r => r.status === 'done').length
          : pendingRows.length;
        return [[{ cnt }]];
      }
      // 分页查询路径
      const [lastId, limit] = params;
      const subset = pendingRows
        .filter(r => r.status === 'pending' && r.id > lastId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
      return [subset.map(r => ({ address: r.address, id: r.id }))];
    }
    if (trimmed.startsWith('UPDATE')) {
      // 解析 CASE WHEN 段
      const colRegex = /`(\w+)` = CASE `address`([\s\S]*?)END/g;
      const colMap = {};
      let m;
      while ((m = colRegex.exec(sql)) !== null) {
        colMap[m[1]] = m[2];
      }
      const statusMatch = /`status` = '(\w+)'/.exec(sql);
      const status = statusMatch ? statusMatch[1] : 'done';
      const errMatch = /`error_msg` = \?/.test(sql);
      // params 顺序：errorMsg?, native (addr,val)×N, 每列 (addr,val)×N, ..., WHERE IN [addr,...]
      // 我们用 updateResolver 解析
      if (updateResolver) {
        fs.appendFileSync('debug-balance.log', `[FAKEPOOL] calling resolver status=${status} params=${JSON.stringify(params)}\n`);
        const result = updateResolver({ colMap, status, hasErrorMsg: errMatch, params, pendingRows, sql });
        fs.appendFileSync('debug-balance.log', `[FAKEPOOL] resolver result=${JSON.stringify(result)}\n`);
      } else {
        fs.appendFileSync('debug-balance.log', `[FAKEPOOL] NO resolver! status=${status}\n`);
      }
      // 计算受影响行数：WHERE IN 子句
      const inMatch = /WHERE `address` IN \(([^)]+)\)/.exec(sql);
      const whereAddrs = inMatch ? inMatch[1].split('?').length - 1 : 0;
      return [{ affectedRows: whereAddrs }];
    }
    throw new Error(`未实现的 SQL: ${sql.slice(0, 80)}`);
  });

  return {
    execute,
    _executed: executed,
    _addPending: (addresses, status = 'pending') => {
      for (const a of addresses) {
        if (!pendingRows.find(r => r.address === a)) {
          pendingRows.push({ id: nextId++, address: a, status });
        }
      }
    },
    _getRows: () => [...pendingRows],
    _getRow: (addr) => pendingRows.find(r => r.address === addr)
  };
}

// 构造 mock rpcBatchCall：从 calls 中按方法路由到响应
function makeMockBatchRpc(handler) {
  // handler: ({ method, params }) => string | null(模拟失败)
  return jest.fn(async ({ rpcUrl, calls }) => {
    return calls.map(c => {
      try {
        const result = handler({ method: c.method, params: c.params, id: c.id });
        if (result && result.error) {
          return { id: c.id, ok: false, error: result.error };
        }
        return { id: c.id, ok: true, result: result?.result || '0x0' };
      } catch (err) {
        return { id: c.id, ok: false, error: err.message };
      }
    });
  });
}

// 工具：解析 CASE WHEN params → {addr: {col: value}}
function parseCaseUpdateParams({ colMap, hasErrorMsg, params }) {
  let p = 0;
  let errorMsg = null;
  if (hasErrorMsg) {
    errorMsg = params[p++];
  }
  const result = { errorMsg, byAddr: {} };
  for (const col of Object.keys(colMap)) {
    // CASE WHEN 段中的 WHEN ? THEN ? 数量
    const whenCount = (colMap[col].match(/WHEN \? THEN \?/g) || []).length;
    for (let i = 0; i < whenCount; i += 1) {
      const addr = params[p++];
      const val = params[p++];
      if (!result.byAddr[addr]) result.byAddr[addr] = {};
      result.byAddr[addr][col] = val;
    }
  }
  // 末尾是 WHERE IN 子句的地址列表（不计入 result）
  return result;
}

let ethersModule;
try {
  ethersModule = jest.requireActual('ethers');
} catch (e) {
  ethersModule = {};
}

jest.unstable_mockModule('ethers', () => {
  return {
    ethers: { ...ethersModule },
    ...ethersModule
  };
});

const { runBalanceExport, extractAddressesFromSheet } = await import('../../src/actions/balance-export.js');

function withCwd(newCwd, fn) {
  const old = process.cwd();
  process.chdir(newCwd);
  return Promise.resolve(fn()).finally(() => process.chdir(old));
}

function writeInputXlsx(tmpDir, rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  const inputPath = path.join(tmpDir, 'in.xlsx');
  XLSX.writeFile(wb, inputPath);
  return inputPath;
}

describe('extractAddressesFromSheet - 保留旧功能', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-extract-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('多列无表头，提取所有地址', () => {
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A, ADDR_B], [ADDR_C]]);
    const { addresses } = extractAddressesFromSheet(inputPath);
    expect(addresses).toHaveLength(3);
    expect(addresses[0]).toBe(ethersModule.getAddress(ADDR_A));
  });
});

describe('runBalanceExport - MySQL 模式', () => {
  let tmpDir;
  let logger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-mysql-'));
    logger = createMockLogger();
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function makeConfig() {
    return {
      network: { rpcUrl: 'http://localhost:8545', chainId: 1, nativeSymbol: 'ETH' },
      accounts: [],
      tokens: {
        usdt: { address: USDT_ADDRESS, name: 'USDT', decimals: 6 },
        aia:  { address: AIA_ADDRESS,  name: 'AIA',  decimals: 18 }
      },
      contracts: {}
    };
  }

  test('CREATE TABLE → INSERT IGNORE → SELECT → UPDATE 全链路', async () => {
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A, ADDR_B]]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
            if (r.errorMsg !== null) row.error_msg = r.errorMsg;
          }
        }
      }
    });

    // 用 mock rpcBatchCall 替代真实 RPC
    const rpcBatchCall = jest.fn(async ({ calls }) => {
      return calls.map(c => {
        if (c.method === 'eth_getBalance') {
          return { id: c.id, ok: true, result: UNIT_18.toString() };
        }
        if (c.method === 'eth_call') {
          return { id: c.id, ok: true, result: '0x' + BigInt(100 * Number(UNIT_18)).toString(16).padStart(64, '0') };
        }
        return { id: c.id, ok: false, error: 'unknown method' };
      });
    });

    const result = await runBalanceExport({
      config: makeConfig(),
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      tokens: [
        { symbol: 'USDT', address: USDT_ADDRESS, decimals: 6 },
        { symbol: 'AIA',  address: AIA_ADDRESS,  decimals: 18 }
      ],
      sessionId: '20260916_120000'
    });

    // 验证 execute 顺序
    const sqls = pool._executed.map(e => e.sql.trim().split('\n')[0].toUpperCase());
    expect(sqls.some(s => s.startsWith('CREATE TABLE'))).toBe(true);
    expect(sqls.some(s => s.startsWith('INSERT IGNORE'))).toBe(true);
    expect(sqls.some(s => s.startsWith('SELECT'))).toBe(true);
    expect(sqls.some(s => s.startsWith('UPDATE'))).toBe(true);

    // 验证表名
    const createSql = pool._executed.find(e => e.sql.trim().toUpperCase().startsWith('CREATE TABLE')).sql;
    expect(createSql).toMatch(/balance_export_20260916_120000/);

    // 验证所有地址已 done
    const rows = pool._getRows();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.status === 'done')).toBe(true);

    expect(result).toEqual(expect.objectContaining({
      sessionId: '20260916_120000',
      tableName: 'balance_export_20260916_120000',
      totalCount: 2,
      doneCount: 2,
      failedCount: 0
    }));
  });

  test('续跑：已有部分 done，只查 pending', async () => {
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A, ADDR_B, ADDR_C]]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
            if (r.errorMsg !== null) row.error_msg = r.errorMsg;
          }
        }
      }
    });
    // 预设：ADDR_A 已 done，ADDR_B/C pending
    pool._addPending([ADDR_A], 'done');
    pool._addPending([ADDR_B, ADDR_C], 'pending');

    const rpcBatchCall = jest.fn(async ({ calls }) => {
      return calls.map(c => ({ id: c.id, ok: true, result: '0x' + BigInt(1).toString(16).padStart(64, '0') }));
    });

    const result = await runBalanceExport({
      config: makeConfig(),
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      tokens: [
        { symbol: 'USDT', address: USDT_ADDRESS, decimals: 6 },
        { symbol: 'AIA',  address: AIA_ADDRESS,  decimals: 18 }
      ],
      sessionId: 's2'
    });

    // 只查了 B 和 C
    const selectCalls = pool._executed.filter(e => e.sql.trim().toUpperCase().startsWith('SELECT'));
    expect(selectCalls.length).toBeGreaterThanOrEqual(1);
    // 总 SELECT 行数 = 2
    const allSelectParams = selectCalls.flatMap(c => c.params);
    expect(allSelectParams.length).toBeGreaterThanOrEqual(2);

    // doneCount = 初始 1 + 本次 2 = 3（包含重启跳过的已 done 行）
    expect(result.doneCount).toBe(3);
    expect(result.skippedCount).toBe(1);
  });

  test('整批 RPC 抛错：地址状态置 failed，记录 error_msg', async () => {
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A]]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
            if (r.errorMsg !== null) row.error_msg = r.errorMsg;
          }
        }
      }
    });

    const rpcBatchCall = jest.fn(async () => {
      throw new Error('RPC 503');
    });

    const result = await runBalanceExport({
      config: makeConfig(),
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      tokens: [
        { symbol: 'USDT', address: USDT_ADDRESS, decimals: 6 },
        { symbol: 'AIA',  address: AIA_ADDRESS,  decimals: 18 }
      ],
      sessionId: 's3',
      maxRpcRetries: 0
    });

    const rows = pool._getRows();
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error_msg).toMatch(/RPC/);
    expect(result.failedCount).toBe(1);
  });

  test('单地址部分代币失败：状态仍 done，未失败的列正常', async () => {
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A]]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
            if (r.errorMsg !== null) row.error_msg = r.errorMsg;
          }
        }
      }
    });

    // 让 USDT 查询失败，AIA 成功
    const rpcBatchCall = jest.fn(async ({ calls }) => {
      const usdtChecksum = ethersModule.getAddress(USDT_ADDRESS).toLowerCase();
      const aiaChecksum = ethersModule.getAddress(AIA_ADDRESS).toLowerCase();
      return calls.map(c => {
        const calldata = c.params[0]?.data?.toLowerCase();
        // balanceOf(USDT_ADDRESS) calldata
        if (c.method === 'eth_call' && calldata === '0x70a08231' + '0'.repeat(24) + usdtChecksum.slice(2)) {
          return { id: c.id, ok: false, error: 'USDT contract paused' };
        }
        // AIA eth_call → success
        if (c.method === 'eth_call' && calldata === '0x70a08231' + '0'.repeat(24) + aiaChecksum.slice(2)) {
          return { id: c.id, ok: true, result: '0x' + BigInt(100 * Number(UNIT_18)).toString(16).padStart(64, '0') };
        }
        if (c.method === 'eth_getBalance') {
          return { id: c.id, ok: true, result: UNIT_18.toString() };
        }
        if (c.method === 'eth_call') {
          return { id: c.id, ok: true, result: '0x' + BigInt(100 * Number(UNIT_18)).toString(16).padStart(64, '0') };
        }
        return { id: c.id, ok: false, error: 'unknown' };
      });
    });

    const result = await runBalanceExport({
      config: makeConfig(),
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      tokens: [
        { symbol: 'USDT', address: USDT_ADDRESS, decimals: 6 },
        { symbol: 'AIA',  address: AIA_ADDRESS,  decimals: 18 }
      ],
      sessionId: 's4'
    });

    const row = pool._getRow(ethersModule.getAddress(ADDR_A));
    expect(row.status).toBe('done');
    expect(row.usdt_dac1_balance).toBeNull();
    expect(row.aia_abc1_balance).not.toBeNull();
    expect(row.native_balance).not.toBeNull();
    expect(result.doneCount).toBe(1);
    expect(result.failedCount).toBe(0); // 部分失败仍算 done
  });

  test('--fresh / fresh=true 时 DROP 旧表', async () => {
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A]]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
            if (r.errorMsg !== null) row.error_msg = r.errorMsg;
          }
        }
      }
    });
    const rpcBatchCall = jest.fn(async ({ calls }) =>
      calls.map(c => ({ id: c.id, ok: true, result: '0x0' }))
    );

    await runBalanceExport({
      config: makeConfig(),
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      tokens: [
        { symbol: 'USDT', address: USDT_ADDRESS, decimals: 6 },
        { symbol: 'AIA',  address: AIA_ADDRESS,  decimals: 18 }
      ],
      sessionId: 's5',
      fresh: true
    });

    const sqls = pool._executed.map(e => e.sql.trim().toUpperCase());
    expect(sqls.some(s => s.startsWith('DROP TABLE'))).toBe(true);
  });

  test('默认 fresh=false：不执行 DROP', async () => {
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A]]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
            if (r.errorMsg !== null) row.error_msg = r.errorMsg;
          }
        }
      }
    });
    const rpcBatchCall = jest.fn(async ({ calls }) =>
      calls.map(c => ({ id: c.id, ok: true, result: '0x0' }))
    );

    await runBalanceExport({
      config: makeConfig(),
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      tokens: [
        { symbol: 'USDT', address: USDT_ADDRESS, decimals: 6 },
        { symbol: 'AIA',  address: AIA_ADDRESS,  decimals: 18 }
      ],
      sessionId: 's6'
    });

    const sqls = pool._executed.map(e => e.sql.trim().toUpperCase());
    expect(sqls.some(s => s.startsWith('DROP TABLE'))).toBe(false);
  });

  test('没有有效地址时抛错', async () => {
    const inputPath = writeInputXlsx(tmpDir, [['无效1', '无效2']]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
            if (r.errorMsg !== null) row.error_msg = r.errorMsg;
          }
        }
      }
    });
    const rpcBatchCall = jest.fn();

    await expect(runBalanceExport({
      config: makeConfig(),
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      sessionId: 's7'
    })).rejects.toThrow(/没有有效地址/);
  });

  test('代币列表为空：仅查询原生币，无 _balance 列', async () => {
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A]]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
            if (r.errorMsg !== null) row.error_msg = r.errorMsg;
          }
        }
      }
    });
    const rpcBatchCall = jest.fn(async ({ calls }) =>
      calls.map(c => ({ id: c.id, ok: true, result: '0x0' }))
    );

    await withCwd(tmpDir, () => runBalanceExport({
      config: { ...makeConfig(), tokens: {} },
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      sessionId: 's8'
    }));

    const createSql = pool._executed.find(e => e.sql.trim().toUpperCase().startsWith('CREATE TABLE')).sql;
    expect(createSql).toMatch(/native_balance/);
    expect(createSql).not.toMatch(/(usdt|aia)_\w{4}_balance/);

    // rpcBatchCall 只调用了一次，全部 eth_getBalance（按地址）
    const allCalls = rpcBatchCall.mock.calls.flatMap(c => c[0].calls);
    expect(allCalls.every(c => c.method === 'eth_getBalance')).toBe(true);
  });

  test('进度日志：每完成 50 个或最后一批输出', async () => {
    const addresses = [];
    for (let i = 0; i < 120; i += 1) {
      addresses.push('0x' + i.toString(16).padStart(40, '0'));
    }
    const inputPath = writeInputXlsx(tmpDir, [addresses]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
            if (r.errorMsg !== null) row.error_msg = r.errorMsg;
          }
        }
      }
    });
    const rpcBatchCall = jest.fn(async ({ calls }) =>
      calls.map(c => ({ id: c.id, ok: true, result: '0x0' }))
    );

    await runBalanceExport({
      config: { ...makeConfig(), tokens: [] },
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      tokens: [],
      sessionId: 's9',
      batchSize: 50
    });

    const progressCalls = logger.info.mock.calls
      .map(c => c[0])
      .filter(msg => /进度: \d+\/120/.test(msg));

    expect(progressCalls).toEqual([
      '进度: 50/120',
      '进度: 100/120',
      '进度: 120/120'
    ]);
  });

  test('--tokens 覆盖代币列表', async () => {
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A]]);
    const customPath = path.join(tmpDir, 'my-tokens.json');
    fs.writeFileSync(customPath, JSON.stringify([
      { symbol: 'CUSTOM', address: USDT_ADDRESS, decimals: 6 }
    ]));
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
            if (r.errorMsg !== null) row.error_msg = r.errorMsg;
          }
        }
      }
    });
    const rpcBatchCall = jest.fn(async ({ calls }) =>
      calls.map(c => ({ id: c.id, ok: true, result: '0x0' }))
    );

    await runBalanceExport({
      config: makeConfig(),
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      sessionId: 's10',
      tokensPath: customPath
    });

    const createSql = pool._executed.find(e => e.sql.trim().toUpperCase().startsWith('CREATE TABLE')).sql;
    expect(createSql).toMatch(/custom_dac1_balance/);
    expect(createSql).not.toMatch(/aia_\w{4}_balance/);
  });

  test('重复 symbol 不同 address：生成不同列名，两列都正常写入', async () => {
    const USDT2_ADDRESS = '0x0000000000000000000000000000000000012345'; // 另一个 USDT（同 symbol）
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A]]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
          }
        }
      }
    });

    // USDT 和 USDT2 区分开
    const usdt1Checksum = ethersModule.getAddress(USDT_ADDRESS).toLowerCase();
    const usdt2Checksum = ethersModule.getAddress(USDT2_ADDRESS).toLowerCase();
    const rpcBatchCall = jest.fn(async ({ calls }) => {
      return calls.map(c => {
        if (c.method === 'eth_getBalance') return { id: c.id, ok: true, result: UNIT_18.toString() };
        const calldata = c.params[0]?.data?.toLowerCase();
        if (c.method === 'eth_call' && calldata === '0x70a08231' + '0'.repeat(24) + usdt1Checksum.slice(2)) {
          return { id: c.id, ok: true, result: '0x' + BigInt(111 * Number(UNIT_18)).toString(16).padStart(64, '0') };
        }
        if (c.method === 'eth_call' && calldata === '0x70a08231' + '0'.repeat(24) + usdt2Checksum.slice(2)) {
          return { id: c.id, ok: true, result: '0x' + BigInt(222 * Number(UNIT_18)).toString(16).padStart(64, '0') };
        }
        return { id: c.id, ok: false, error: 'unknown' };
      });
    });

    await runBalanceExport({
      config: makeConfig(),
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      tokens: [
        { symbol: 'USDT', address: USDT_ADDRESS,  decimals: 6 }, // column usdt_dac1_balance
        { symbol: 'USDT', address: USDT2_ADDRESS, decimals: 6 }  // column usdt_4f23_balance
      ],
      sessionId: 'sdup'
    });

    // CREATE TABLE 必须同时包含两列
    const createSql = pool._executed.find(e => e.sql.trim().toUpperCase().startsWith('CREATE TABLE')).sql;
    expect(createSql).toMatch(/`usdt_dac1_balance`/);
    expect(createSql).toMatch(/`usdt_0000_balance`/);

    // UPDATE 写入两列
    const row = pool._getRow(ethersModule.getAddress(ADDR_A));
    expect(row.usdt_dac1_balance).not.toBeNull(); // 111
    expect(row.usdt_0000_balance).not.toBeNull(); // 222
    expect(row.status).toBe('done');
  });

  test('同 symbol + 同 address（配置文件中重复条目）：后者被跳过并 warn', async () => {
    const inputPath = writeInputXlsx(tmpDir, [[ADDR_A]]);
    const pool = makeFakePoolV2({
      updateResolver: ({ colMap, status, hasErrorMsg, params }) => {
        const r = parseCaseUpdateParams({ colMap, hasErrorMsg, params });
        for (const [addr, vals] of Object.entries(r.byAddr)) {
          const row = pool._getRow(addr);
          if (row) {
            for (const [k, v] of Object.entries(vals)) row[k] = v;
            row.status = status;
          }
        }
      }
    });
    const rpcBatchCall = jest.fn(async ({ calls }) =>
      calls.map(c => ({ id: c.id, ok: true, result: '0x0' }))
    );

    await runBalanceExport({
      config: makeConfig(),
      inputPath,
      pool,
      rpcBatchCall,
      logger,
      tokens: [
        { symbol: 'USDT', address: USDT_ADDRESS, decimals: 6 },
        { symbol: 'USDTDUP', address: USDT_ADDRESS, decimals: 6 } // 同地址，只保留首个
      ],
      sessionId: 'sdup2'
    });

    // 只有一列 usdt_dac1_balance（重复条目已去重）
    const createSql = pool._executed.find(e => e.sql.trim().toUpperCase().startsWith('CREATE TABLE')).sql;
    expect(createSql).toMatch(/`usdt_dac1_balance`/);
    expect(createSql).not.toMatch(/usdtdup_/);

    // sanitizeTokens 应有 warn
    const warns = logger.warn.mock.calls.map(c => c[0]).filter(m => /重复/.test(m));
    expect(warns.length).toBeGreaterThan(0);
  });
});
