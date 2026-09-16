import {
  isValidIdentifier,
  isValidSessionId,
  getTokenColumnName,
  buildCreateTableSql,
  buildInsertAddressesSql,
  buildSelectPendingSql,
  buildUpdateBalancesSql,
  tableNameFor
} from '../../src/core/schema.js';

describe('core/schema', () => {
  describe('isValidIdentifier', () => {
    test('accepts alphanumeric + underscore', () => {
      expect(isValidIdentifier('usdt')).toBe(true);
      expect(isValidIdentifier('USDT')).toBe(true);
      expect(isValidIdentifier('a_b_c')).toBe(true);
      expect(isValidIdentifier('a1b2')).toBe(true);
      expect(isValidIdentifier('_private')).toBe(true);
    });

    test('rejects empty string', () => {
      expect(isValidIdentifier('')).toBe(false);
    });

    test('rejects strings starting with digit', () => {
      expect(isValidIdentifier('1abc')).toBe(false);
    });

    test('rejects special characters', () => {
      expect(isValidIdentifier('a-b')).toBe(false);
      expect(isValidIdentifier('a.b')).toBe(false);
      expect(isValidIdentifier('a b')).toBe(false);
      expect(isValidIdentifier('a;b')).toBe(false);
      expect(isValidIdentifier("a'b")).toBe(false);
      expect(isValidIdentifier('a`b')).toBe(false);
      expect(isValidIdentifier('a\\b')).toBe(false);
      expect(isValidIdentifier('drop--table')).toBe(false);
    });

    test('rejects SQL keywords', () => {
      expect(isValidIdentifier('drop')).toBe(false);
      expect(isValidIdentifier('DROP')).toBe(false);
      expect(isValidIdentifier('select')).toBe(false);
      expect(isValidIdentifier('insert')).toBe(false);
      expect(isValidIdentifier('update')).toBe(false);
      expect(isValidIdentifier('delete')).toBe(false);
      expect(isValidIdentifier('where')).toBe(false);
      expect(isValidIdentifier('union')).toBe(false);
      expect(isValidIdentifier('from')).toBe(false);
      expect(isValidIdentifier('table')).toBe(false);
      expect(isValidIdentifier('null')).toBe(false);
      expect(isValidIdentifier('true')).toBe(false);
    });

    test('rejects too long identifiers (>64)', () => {
      expect(isValidIdentifier('a'.repeat(65))).toBe(false);
      expect(isValidIdentifier('a'.repeat(64))).toBe(true);
    });
  });

  describe('isValidSessionId', () => {
    test('accepts timestamp-like id', () => {
      expect(isValidSessionId('20260916_124057')).toBe(true);
      expect(isValidSessionId('20260916')).toBe(true);
    });

    test('rejects injection attempts', () => {
      expect(isValidSessionId('2026; DROP TABLE')).toBe(false);
      expect(isValidSessionId("2026'")).toBe(false);
      expect(isValidSessionId('2026`')).toBe(false);
      expect(isValidSessionId('2026 OR 1=1')).toBe(false);
    });

    test('rejects empty / overly long', () => {
      expect(isValidSessionId('')).toBe(false);
      expect(isValidSessionId('a'.repeat(65))).toBe(false);
    });
  });

  describe('getTokenColumnName', () => {
    test('lowercases symbol and appends _balance', () => {
      expect(getTokenColumnName({ symbol: 'USDT', decimals: 6 })).toBe('usdt_balance');
      expect(getTokenColumnName({ symbol: 'aia', decimals: 18 })).toBe('aia_balance');
    });

    test('strips non-identifier characters from symbol', () => {
      expect(getTokenColumnName({ symbol: 'USDT-A', decimals: 6 })).toBe('usdta_balance');
      expect(getTokenColumnName({ symbol: 'My Token', decimals: 18 })).toBe('mytoken_balance');
      expect(getTokenColumnName({ symbol: 'foo.bar', decimals: 18 })).toBe('foobar_balance');
    });

    test('throws on symbol that becomes empty after sanitization', () => {
      expect(() => getTokenColumnName({ symbol: '---', decimals: 18 })).toThrow();
      expect(() => getTokenColumnName({ symbol: '', decimals: 18 })).toThrow();
    });

    test('throws on reserved keyword symbol', () => {
      expect(() => getTokenColumnName({ symbol: 'drop', decimals: 18 })).toThrow();
      expect(() => getTokenColumnName({ symbol: 'SELECT', decimals: 18 })).toThrow();
    });
  });

  describe('tableNameFor', () => {
    test('produces prefixed name', () => {
      expect(tableNameFor('20260916_124057')).toBe('balance_export_20260916_124057');
    });
  });

  describe('buildCreateTableSql', () => {
    const tokens = [
      { symbol: 'USDT', address: '0xdAC17F', decimals: 6 },
      { symbol: 'AIA', address: '0xEC4C', decimals: 18 }
    ];

    test('contains required base columns', () => {
      const sql = buildCreateTableSql('20260916_124057', tokens);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS `balance_export_20260916_124057`/);
      expect(sql).toMatch(/`id` BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT/);
      expect(sql).toMatch(/`address` VARCHAR\(42\) NOT NULL/);
      expect(sql).toMatch(/`status` ENUM\('pending','done','failed'\) NOT NULL DEFAULT 'pending'/);
      expect(sql).toMatch(/`native_balance` DECIMAL\(38,18\) DEFAULT NULL/);
      expect(sql).toMatch(/`error_msg` VARCHAR\(255\) DEFAULT NULL/);
      expect(sql).toMatch(/`created_at`/);
      expect(sql).toMatch(/`updated_at`/);
      expect(sql).toMatch(/UNIQUE KEY `uk_address` \(`address`\)/);
      expect(sql).toMatch(/KEY `idx_status` \(`status`\)/);
    });

    test('one DECIMAL column per token with matching decimals', () => {
      const sql = buildCreateTableSql('s1', tokens);
      expect(sql).toMatch(/`usdt_balance` DECIMAL\(38,6\) DEFAULT NULL/);
      expect(sql).toMatch(/`aia_balance` DECIMAL\(38,18\) DEFAULT NULL/);
    });

    test('engine and charset explicit', () => {
      const sql = buildCreateTableSql('s1', tokens);
      expect(sql).toMatch(/ENGINE=InnoDB/);
      expect(sql).toMatch(/CHARSET=utf8mb4/);
    });

    test('empty token list omits token columns but still defines native_balance', () => {
      const sql = buildCreateTableSql('s1', []);
      expect(sql).toMatch(/`native_balance` DECIMAL\(38,18\) DEFAULT NULL/);
      expect(sql).not.toMatch(/(usdt|aia)_balance/); // 没有代币列
    });

    test('throws on invalid sessionId', () => {
      expect(() => buildCreateTableSql('bad;name', tokens)).toThrow();
      expect(() => buildCreateTableSql('drop', tokens)).toThrow();
    });
  });

  describe('buildInsertAddressesSql', () => {
    test('generates parameterized INSERT IGNORE', () => {
      const sql = buildInsertAddressesSql('s1', ['0xaaa', '0xbbb', '0xccc']);
      expect(sql).toMatch(/INSERT IGNORE INTO `balance_export_s1` \(`address`\) VALUES \?, \?, \?/);
    });

    test('single row uses single placeholder', () => {
      const sql = buildInsertAddressesSql('s1', ['0xaaa']);
      expect(sql).toMatch(/INSERT IGNORE INTO `balance_export_s1` \(`address`\) VALUES \?;/);
    });

    test('throws on empty address list', () => {
      expect(() => buildInsertAddressesSql('s1', [])).toThrow();
    });

    test('throws on invalid sessionId', () => {
      expect(() => buildInsertAddressesSql('bad name', ['0xaaa'])).toThrow();
    });
  });

  describe('buildSelectPendingSql', () => {
    test('cursor pagination with lastId', () => {
      const sql = buildSelectPendingSql('s1', 1000, 50);
      expect(sql).toMatch(/SELECT `address` FROM `balance_export_s1`/);
      expect(sql).toMatch(/WHERE `status` = 'pending' AND `id` > \?/);
      expect(sql).toMatch(/ORDER BY `id`/);
      expect(sql).toMatch(/LIMIT \?/);
    });

    test('first page uses lastId=0', () => {
      const sql = buildSelectPendingSql('s1', 0, 100);
      expect(sql).toMatch(/`id` > \?/);
    });
  });

  describe('buildUpdateBalancesSql', () => {
    const tokens = [
      { symbol: 'USDT', address: '0xdAC17F', decimals: 6 },
      { symbol: 'AIA', address: '0xEC4C', decimals: 18 }
    ];

    test('uses CASE WHEN for each balance column', () => {
      const sql = buildUpdateBalancesSql('s1', tokens, [
        { address: '0xaaa', nativeBalance: '1.5', balances: { USDT: '100', AIA: '50' } },
        { address: '0xbbb', nativeBalance: '2.0', balances: { USDT: '200', AIA: '0' } }
      ]);
      expect(sql).toMatch(/UPDATE `balance_export_s1` SET/);
      expect(sql).toMatch(/`status` = 'done'/);
      expect(sql).toMatch(/`native_balance` = CASE `address`/);
      expect(sql).toMatch(/WHEN \? THEN \?/);
      expect(sql).toMatch(/`usdt_balance` = CASE `address`/);
      expect(sql).toMatch(/`aia_balance` = CASE `address`/);
      expect(sql).toMatch(/WHERE `address` IN \(\?, \?\)/);
    });

    test('marks status failed when provided', () => {
      const sql = buildUpdateBalancesSql('s1', tokens, [
        { address: '0xaaa', nativeBalance: '1.5', balances: { USDT: '100', AIA: '50' } }
      ], { status: 'failed', errorMsg: 'rpc timeout' });
      expect(sql).toMatch(/`status` = 'failed'/);
      expect(sql).toMatch(/`error_msg` = \?/);
    });

    test('throws on empty data', () => {
      expect(() => buildUpdateBalancesSql('s1', tokens, [])).toThrow();
    });
  });
});
