const test = require('node:test'); const assert = require('node:assert/strict'); const request = require('supertest'); const { Interface } = require('ethers');
const { DeFiVaultProService, VAULT_ABI, TOKEN_ABI } = require('../src/services/defivaultpro-service'); const { Server, parseRpcUrls } = require('../src/server');
const vaultAddress = '0x0000000000000000000000000000000000001000'; const assetAddress = '0x0000000000000000000000000000000000002000'; const account = '0x0000000000000000000000000000000000003000';
const vault = new Interface(VAULT_ABI); const token = new Interface(TOKEN_ABI);

function rpcFixture() {
  let calls = 0;
  const values = { name: 'Example Vault', symbol: 'evUSDC', decimals: 18n, asset: assetAddress, totalAssets: 2500000n, totalSupply: 2000000000000000000n, convertToAssets: 1250000n, convertToShares: 800000000000000000n, previewDeposit: 800000000000000000n, previewWithdraw: 810000000000000000n, maxDeposit: 5000000n, maxWithdraw: 1000000n };
  const tokenValues = { name: 'USD Coin', symbol: 'USDC', decimals: 6n };
  const fetchImpl = async (_url, options) => {
    calls += 1; const body = JSON.parse(options.body);
    if (body.method === 'eth_getCode') return { ok: true, json: async () => ({ result: '0x6000' }) };
    const call = body.params[0]; const iface = call.to.toLowerCase() === vaultAddress.toLowerCase() ? vault : token;
    const fragment = iface.getFunction(call.data.slice(0, 10)); const value = iface === vault ? values[fragment.name] : tokenValues[fragment.name];
    return { ok: true, json: async () => ({ result: iface.encodeFunctionResult(fragment, [value]) }) };
  };
  return { fetchImpl, calls: () => calls };
}

test('reads and formats an ERC-4626 vault with previews and limits', async () => {
  const fixture = rpcFixture(); const service = new DeFiVaultProService({ rpcUrls: { ethereum: 'https://rpc.test' }, fetchImpl: fixture.fetchImpl });
  const result = await service.inspect('ethereum', vaultAddress, { account, amount: '1000000' });
  assert.equal(result.standard, 'ERC-4626'); assert.equal(result.asset.symbol, 'USDC'); assert.equal(result.totals.assetsFormatted, '2.5');
  assert.equal(result.sharePrice.formatted, '1.25'); assert.equal(result.preview.sharesForDeposit, '800000000000000000'); assert.equal(result.limits.maxWithdraw, '1000000');
  const before = fixture.calls(); assert.equal((await service.inspect('ethereum', vaultAddress, { account, amount: '1000000' })).cached, true); assert.equal(fixture.calls(), before);
});

test('validates chains, addresses, and amounts', async () => {
  const service = new DeFiVaultProService({ rpcUrls: { ethereum: 'https://rpc.test' }, fetchImpl: rpcFixture().fetchImpl });
  await assert.rejects(service.inspect('polygon', vaultAddress), error => error.code === 'CHAIN_NOT_CONFIGURED');
  await assert.rejects(service.inspect('ethereum', 'bad'), error => error.code === 'INVALID_ADDRESS');
  await assert.rejects(service.inspect('ethereum', vaultAddress, { amount: '1.2' }), error => error.code === 'INVALID_AMOUNT');
});

test('serves health, vault data, and structured errors', async () => {
  const service = new DeFiVaultProService({ rpcUrls: { ethereum: 'https://rpc.test' }, fetchImpl: rpcFixture().fetchImpl }); const app = new Server({ service }).app;
  assert.equal((await request(app).get('/health')).status, 200);
  const response = await request(app).get(`/api/v1/vaults/ethereum/${vaultAddress}?amount=1000000`); assert.equal(response.status, 200); assert.equal(response.body.name, 'Example Vault');
  const missing = await request(app).get(`/api/v1/vaults/unknown/${vaultAddress}`); assert.equal(missing.status, 404); assert.equal(missing.body.code, 'CHAIN_NOT_CONFIGURED');
});

test('parses only explicit HTTP(S) RPC configuration', () => {
  assert.deepEqual(parseRpcUrls('{"eth":"https://rpc.example"}'), { eth: 'https://rpc.example' });
  assert.throws(() => parseRpcUrls('{"eth":"file:///secret"}'), /HTTP/); assert.throws(() => parseRpcUrls('bad'), /valid JSON/);
});
