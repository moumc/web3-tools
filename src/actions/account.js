import { Wallet, verifyMessage, hashMessage } from 'ethers';
import { webcrypto, randomBytes as nodeRandomBytes } from 'node:crypto';

const ENTROPY_BYTES = 32;
const ENTROPY_BITS = ENTROPY_BYTES * 8;
const SECP256K1 = 'secp256k1';
const VERIFICATION_MESSAGE = 'web3-tools:address-derivation-check';

/**
 * 探测当前进程可用的 CSPRNG 源。
 * 优先 Node 原生 crypto.randomBytes（内核熵池），
 * 其次 WebCrypto.getRandomValues（浏览器/Workers）。
 * 任一可用即可，绝不接受 Math.random 等弱源。
 * @returns {string} 熵源标识
 */
function detectEntropySource() {
  if (typeof nodeRandomBytes === 'function') {
    try {
      const probe = nodeRandomBytes(ENTROPY_BYTES);
      if (probe && probe.length === ENTROPY_BYTES) {
        return 'node:crypto.randomBytes';
      }
    } catch {
      // fallthrough
    }
  }
  const c = webcrypto ?? globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    return 'WebCrypto.getRandomValues';
  }
  throw new Error(
    '无可用 CSPRNG 源（需要 Node crypto.randomBytes 或 WebCrypto.getRandomValues），拒绝生成账户'
  );
}

/**
 * 验证私钥与地址的对应关系。
 * 用私钥对一条已知消息签名，再用 verifyMessage 恢复地址，
 * 与声称地址比对；任一步骤不符都抛错。
 * 这能捕获实现 bug（如地址计算错误、字节序错乱等）。
 * @param {string} privateKey
 * @param {string} expectedAddress - EIP-55 checksum 形式
 * @returns {boolean} 验证通过
 */
function verifyKeyPair(privateKey, expectedAddress) {
  const wallet = new Wallet(privateKey);
  if (wallet.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error('私钥与声称地址不匹配：实现异常');
  }
  // 与 verifyMessage 内部一致：先用 hashMessage 加前缀并 keccak256
  const digest = hashMessage(VERIFICATION_MESSAGE);
  const signature = wallet.signingKey.sign(digest).serialized;
  const recovered = verifyMessage(VERIFICATION_MESSAGE, signature);
  if (recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error('签名恢复验证失败：私钥未真正控制声称地址');
  }
  return true;
}

/**
 * 生成一个以太坊账户（地址 + 私钥）。
 * 三层防御：
 *   1) detectEntropySource 确保熵源为 CSPRNG
 *   2) ethers.Wallet.createRandom 内部用 CSPRNG 抽 32 字节熵
 *   3) verifyKeyPair 签名往返确认私钥真控制地址
 * @returns {{
 *   address: string,
 *   privateKey: string,
 *   meta: {
 *     curve: string,
 *     entropySource: string,
 *     entropyBits: number,
 *     verified: boolean,
 *     verifiedAt: string
 *   }
 * }}
 */
function generateAccount() {
  const entropySource = detectEntropySource();
  const wallet = Wallet.createRandom();
  verifyKeyPair(wallet.privateKey, wallet.address);
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    meta: {
      curve: SECP256K1,
      entropySource,
      entropyBits: ENTROPY_BITS,
      verified: true,
      verifiedAt: new Date().toISOString()
    }
  };
}

/**
 * 批量生成多个以太坊账户。
 * @param {number} [count=1] - 生成数量，必须为正整数
 * @returns {Array<ReturnType<typeof generateAccount>>}
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

export { generateAccount, generateAccounts, detectEntropySource, verifyKeyPair };