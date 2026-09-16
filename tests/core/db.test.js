import { jest } from '@jest/globals';
import {
  loadDatabaseConfig,
  createPool,
  withTransaction,
  closePool
} from '../../src/core/db.js';

// 用 fake pool 模拟 mysql2 pool；与真实接口保持一致
function makeFakePool() {
  const calls = {
    execute: [],
    getConnection: 0,
    release: 0,
    beginTransaction: 0,
    commit: 0,
    rollback: 0
  };
  let failNextExecute = null;

  const fakeConnection = {
    execute: jest.fn(async (sql, params) => {
      calls.execute.push({ kind: 'conn', sql, params });
      if (failNextExecute) {
        const err = failNextExecute;
        failNextExecute = null;
        throw err;
      }
      return [{ affectedRows: 1 }];
    }),
    beginTransaction: jest.fn(async () => {
      calls.beginTransaction += 1;
    }),
    commit: jest.fn(async () => {
      calls.commit += 1;
    }),
    rollback: jest.fn(async () => {
      calls.rollback += 1;
    }),
    release: jest.fn(() => {
      calls.release += 1;
    })
  };

  const pool = {
    execute: jest.fn(async (sql, params) => {
      calls.execute.push({ kind: 'pool', sql, params });
      if (failNextExecute) {
        const err = failNextExecute;
        failNextExecute = null;
        throw err;
      }
      return [{ affectedRows: 1 }];
    }),
    getConnection: jest.fn(async () => {
      calls.getConnection += 1;
      return fakeConnection;
    }),
    end: jest.fn(async () => {}),
    _calls: calls,
    _connection: fakeConnection,
    _failNextExecute: (err) => { failNextExecute = err; }
  };

  return pool;
}

describe('core/db', () => {
  describe('loadDatabaseConfig', () => {
    test('reads config/database.json when present', () => {
      const cfg = loadDatabaseConfig({
        cwd: '/nonexistent-for-test',
        fsOverride: {
          existsSync: () => true,
          readFileSync: () => JSON.stringify({
            host: '10.0.0.1', port: 3307, user: 'u', password: 'p', database: 'd', connectionLimit: 5
          })
        }
      });
      expect(cfg).toEqual({
        host: '10.0.0.1', port: 3307, user: 'u', password: 'p', database: 'd', connectionLimit: 5
      });
    });

    test('returns null when file absent', () => {
      const cfg = loadDatabaseConfig({
        cwd: '/nonexistent',
        fsOverride: {
          existsSync: () => false
        }
      });
      expect(cfg).toBeNull();
    });

    test('throws on invalid JSON', () => {
      expect(() => loadDatabaseConfig({
        cwd: '/x',
        fsOverride: {
          existsSync: () => true,
          readFileSync: () => '{not json'
        }
      })).toThrow(/数据库配置 JSON 解析失败/);
    });

    test('throws on missing required fields', () => {
      expect(() => loadDatabaseConfig({
        cwd: '/x',
        fsOverride: {
          existsSync: () => true,
          readFileSync: () => JSON.stringify({ host: 'h' })
        }
      })).toThrow(/缺少字段/);
    });
  });

  describe('createPool', () => {
    test('returns a pool object (mocked mysql2)', async () => {
      const mysql2 = await import('mysql2/promise');
      const originalCreatePool = mysql2.default.createPool;
      const fakePool = makeFakePool();
      mysql2.default.createPool = jest.fn(() => fakePool);
      try {
        const pool = createPool({ host: 'h', port: 3306, user: 'u', password: 'p', database: 'd', connectionLimit: 5 });
        expect(mysql2.default.createPool).toHaveBeenCalledWith(expect.objectContaining({
          host: 'h', port: 3306, user: 'u', password: 'p', database: 'd', connectionLimit: 5,
          waitForConnections: true
        }));
        expect(pool).toBe(fakePool);
      } finally {
        mysql2.default.createPool = originalCreatePool;
      }
    });
  });

  describe('withTransaction', () => {
    test('commits on success', async () => {
      const pool = makeFakePool();
      const result = await withTransaction(pool, async (conn) => {
        await conn.execute('SELECT 1', []);
        return 'ok';
      });
      expect(result).toBe('ok');
      expect(pool._calls.beginTransaction).toBe(1);
      expect(pool._calls.commit).toBe(1);
      expect(pool._calls.rollback).toBe(0);
      expect(pool._calls.release).toBe(1);
    });

    test('rolls back on error', async () => {
      const pool = makeFakePool();
      await expect(withTransaction(pool, async () => {
        throw new Error('boom');
      })).rejects.toThrow('boom');
      expect(pool._calls.beginTransaction).toBe(1);
      expect(pool._calls.commit).toBe(0);
      expect(pool._calls.rollback).toBe(1);
      expect(pool._calls.release).toBe(1);
    });

    test('releases connection even when rollback throws', async () => {
      const pool = makeFakePool();
      pool._connection.rollback.mockRejectedValueOnce(new Error('rollback fail'));
      await expect(withTransaction(pool, async () => {
        throw new Error('boom');
      })).rejects.toThrow('boom');
      expect(pool._calls.release).toBe(1);
    });
  });

  describe('closePool', () => {
    test('calls pool.end', async () => {
      const pool = makeFakePool();
      await closePool(pool);
      expect(pool.end).toHaveBeenCalled();
    });
  });
});
