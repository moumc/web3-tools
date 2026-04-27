import fs from 'fs';
import path from 'path';

/**
 * 加载配置文件
 * @param {string} configPath - 配置文件路径，默认 'config/config.json'
 * @returns {Object} 配置对象
 */
function loadConfig(configPath = 'config/config.json') {
  const fullPath = path.resolve(configPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`配置文件不存在: ${fullPath}`);
  }

  const content = fs.readFileSync(fullPath, 'utf-8');

  let config;
  try {
    config = JSON.parse(content);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`配置文件格式错误: ${message}`);
  }

  // 验证必要字段
  const required = ['network', 'accounts', 'tokens', 'contracts'];
  for (const field of required) {
    if (!config[field]) {
      throw new Error(`配置文件缺少必要字段: ${field}`);
    }
  }

  // 验证 network.rpcUrl
  if (!config.network.rpcUrl || typeof config.network.rpcUrl !== 'string') {
    throw new Error(`配置文件缺少必要字段: network.rpcUrl`);
  }

  // 验证 accounts 数组元素结构
  if (!Array.isArray(config.accounts) || config.accounts.length === 0) {
    throw new Error(`配置文件缺少必要字段: accounts (必须是非空数组)`);
  }
  for (const account of config.accounts) {
    if (!account.address || typeof account.address !== 'string') {
      throw new Error(`账户配置缺少 address 字段`);
    }
    if (!account.privateKey || typeof account.privateKey !== 'string') {
      throw new Error(`账户配置缺少 privateKey 字段`);
    }
  }

  return config;
}

export { loadConfig };
