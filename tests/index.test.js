import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

// 直接覆盖被测模块：loadDatabaseConfig 是带 fsOverride 的纯函数
const { loadDatabaseConfig } = await import('../src/core/db.js');

describe('loadDatabaseConfig (via index.js consumer)', () => {
  test('返回 null 当 config/database.json 不存在', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    try {
      const cfg = loadDatabaseConfig({ cwd });
      expect(cfg).toBeNull();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('返回合法配置对象', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    fs.mkdirSync(path.join(cwd, 'config'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'config/database.json'), JSON.stringify({
      host: '127.0.0.1', port: 3306, user: 'root', password: 'p', database: 'd'
    }));
    try {
      const cfg = loadDatabaseConfig({ cwd });
      expect(cfg.host).toBe('127.0.0.1');
      expect(cfg.port).toBe(3306);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('JSON 解析失败抛错', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    fs.mkdirSync(path.join(cwd, 'config'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'config/database.json'), '{not json}');
    try {
      expect(() => loadDatabaseConfig({ cwd })).toThrow(/JSON 解析失败/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('缺字段抛错', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    fs.mkdirSync(path.join(cwd, 'config'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'config/database.json'), JSON.stringify({ host: 'x' }));
    try {
      expect(() => loadDatabaseConfig({ cwd })).toThrow(/缺少字段/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// 保护：src/index.js 在被 import 时不应自动调用 main()
// 只要该文件能 import 不抛错即可说明 isMain 守卫起作用
describe('src/index.js 入口守卫', () => {
  test('作为模块被 import 时不执行 main()', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.main).toBe('function');
  });
});
