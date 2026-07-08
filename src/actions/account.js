import { Wallet } from 'ethers';

/**
 * 生成一个以太坊账户（地址 + 私钥）。
 * 使用 CSPRNG，本地生成，私钥不会上传任何远端。
 * @returns {{address: string, privateKey: string}}
 */
function generateAccount() {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey
  };
}

/**
 * 批量生成多个以太坊账户。
 * @param {number} [count=1] - 生成数量，必须为正整数
 * @returns {Array<{address: string, privateKey: string}>}
 */
function generateAccounts(count = 1) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('count 必须为正整数');
  }
  const accounts = [];
  for (let i = 0; i < count; i += 1) {
    accounts.push(generateAccount());
  }
  return accounts;
}

export { generateAccount, generateAccounts };