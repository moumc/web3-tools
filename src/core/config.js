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
    throw new Error(`配置文件格式错误: ${e.message}`);
  }

  // 验证必要字段
  const required = ['network', 'accounts', 'tokens', 'contracts'];
  for (const field of required) {
    if (!config[field]) {
      throw new Error(`配置文件缺少必要字段: ${field}`);
    }
  }

  return config;
}

export { loadConfig };
