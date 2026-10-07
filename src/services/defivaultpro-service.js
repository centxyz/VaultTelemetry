const { Interface, formatUnits, isAddress } = require('ethers');

const VAULT_ABI = [
  'function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)',
  'function asset() view returns (address)', 'function totalAssets() view returns (uint256)', 'function totalSupply() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)', 'function convertToShares(uint256 assets) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)', 'function previewWithdraw(uint256 assets) view returns (uint256)',
  'function maxDeposit(address receiver) view returns (uint256)', 'function maxWithdraw(address owner) view returns (uint256)'
];
const TOKEN_ABI = ['function symbol() view returns (string)', 'function name() view returns (string)', 'function decimals() view returns (uint8)'];
const vaultInterface = new Interface(VAULT_ABI); const tokenInterface = new Interface(TOKEN_ABI);

class VaultError extends Error { constructor(message, code = 'VAULT_ERROR', status = 500) { super(message); this.name = 'VaultError'; this.code = code; this.status = status; } }

class DeFiVaultProService {
  constructor({ rpcUrls = {}, fetchImpl = globalThis.fetch, timeout = 12000, cacheTtl = 15000 } = {}) {
    this.rpcUrls = rpcUrls; this.fetch = fetchImpl; this.timeout = timeout; this.cacheTtl = cacheTtl; this.cache = new Map(); this.requestId = 0;
  }

  listChains() { return Object.keys(this.rpcUrls); }

  async inspect(chain, address, { account, amount } = {}) {
    const rpcUrl = this.rpcUrls[chain];
    if (!rpcUrl) throw new VaultError(`Chain '${chain}' is not configured`, 'CHAIN_NOT_CONFIGURED', 404);
    if (!isAddress(address)) throw new VaultError('Vault address is invalid', 'INVALID_ADDRESS', 400);
    if (account && !isAddress(account)) throw new VaultError('Account address is invalid', 'INVALID_ADDRESS', 400);
    if (amount != null && (!/^\d+$/.test(String(amount)) || BigInt(amount) < 0n)) throw new VaultError('Amount must be a non-negative base-unit integer', 'INVALID_AMOUNT', 400);
    const key = `${chain}:${address.toLowerCase()}:${account || ''}:${amount || ''}`; const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return { ...cached.value, cached: true };
    const code = await this.rpc(rpcUrl, 'eth_getCode', [address, 'latest']);
    if (!code || code === '0x') throw new VaultError('No contract is deployed at this address', 'NOT_CONTRACT', 404);
    const [name, symbol, decimals, asset, totalAssets, totalSupply] = await Promise.all([
      this.read(rpcUrl, address, vaultInterface, 'name'), this.read(rpcUrl, address, vaultInterface, 'symbol'), this.read(rpcUrl, address, vaultInterface, 'decimals'),
      this.read(rpcUrl, address, vaultInterface, 'asset'), this.read(rpcUrl, address, vaultInterface, 'totalAssets'), this.read(rpcUrl, address, vaultInterface, 'totalSupply')
    ]);
    const [assetName, assetSymbol, assetDecimals] = await Promise.all([
      this.read(rpcUrl, asset, tokenInterface, 'name'), this.read(rpcUrl, asset, tokenInterface, 'symbol'), this.read(rpcUrl, asset, tokenInterface, 'decimals')
    ]);
    const oneShare = 10n ** BigInt(decimals); const assetsPerShare = await this.read(rpcUrl, address, vaultInterface, 'convertToAssets', [oneShare]);
    const result = {
      chain, address, standard: 'ERC-4626', name, symbol, decimals: Number(decimals), asset: { address: asset, name: assetName, symbol: assetSymbol, decimals: Number(assetDecimals) },
      totals: { assets: totalAssets.toString(), assetsFormatted: formatUnits(totalAssets, assetDecimals), shares: totalSupply.toString(), sharesFormatted: formatUnits(totalSupply, decimals) },
      sharePrice: { assetsPerShare: assetsPerShare.toString(), formatted: formatUnits(assetsPerShare, assetDecimals) },
      ...(amount != null ? { preview: await this.preview(rpcUrl, address, BigInt(amount)) } : {}),
      ...(account ? { limits: { maxDeposit: (await this.read(rpcUrl, address, vaultInterface, 'maxDeposit', [account])).toString(), maxWithdraw: (await this.read(rpcUrl, address, vaultInterface, 'maxWithdraw', [account])).toString() } } : {}),
      observedAt: new Date().toISOString(), cached: false
    };
    this.cache.set(key, { value: result, expires: Date.now() + this.cacheTtl }); return result;
  }

  async preview(rpcUrl, address, amount) {
    const [sharesForDeposit, sharesForWithdrawal, sharesAtRate] = await Promise.all([
      this.read(rpcUrl, address, vaultInterface, 'previewDeposit', [amount]), this.read(rpcUrl, address, vaultInterface, 'previewWithdraw', [amount]), this.read(rpcUrl, address, vaultInterface, 'convertToShares', [amount])
    ]);
    return { assets: amount.toString(), sharesForDeposit: sharesForDeposit.toString(), sharesForWithdrawal: sharesForWithdrawal.toString(), sharesAtCurrentRate: sharesAtRate.toString() };
  }

  async read(rpcUrl, to, iface, functionName, args = []) {
    const data = iface.encodeFunctionData(functionName, args); const result = await this.rpc(rpcUrl, 'eth_call', [{ to, data }, 'latest']);
    try { return iface.decodeFunctionResult(functionName, result)[0]; }
    catch { throw new VaultError(`Contract does not implement ${functionName} as expected`, 'NOT_ERC4626', 422); }
  }

  async rpc(url, method, params) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await this.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++this.requestId, method, params }), signal: controller.signal });
      if (!response.ok) throw new VaultError(`RPC returned HTTP ${response.status}`, 'RPC_HTTP', 502);
      const payload = await response.json(); if (payload.error) throw new VaultError(`RPC ${payload.error.code}: ${payload.error.message}`, 'RPC_ERROR', 502);
      return payload.result;
    } catch (error) { if (error.name === 'AbortError') throw new VaultError(`RPC timed out after ${this.timeout}ms`, 'RPC_TIMEOUT', 504); throw error; }
    finally { clearTimeout(timer); }
  }
}

module.exports = { DeFiVaultProService, VaultError, VAULT_ABI, TOKEN_ABI };
