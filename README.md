# DeFiVaultPro

DeFiVaultPro is a read-only ERC-4626 vault analytics API. It queries configured EVM JSON-RPC endpoints for vault and underlying-asset state, calculates a share price, exposes deposit/withdrawal previews and account limits, and returns normalized JSON for dashboards or monitoring systems.

It never accepts private keys, signs transactions, or moves assets.

## Configure and run

```bash
git clone https://github.com/centxyz/DeFiVaultPro.git
cd DeFiVaultPro
npm install

export RPC_URLS='{"ethereum":"https://your-ethereum-rpc.example","base":"https://your-base-rpc.example"}'
export PORT=3000
npm start
```

RPC URLs are configured by the operator, not accepted in requests, preventing the API from becoming an arbitrary network proxy. Set `CORS_ORIGIN` only when a browser frontend should be allowed.

## API

- `GET /health` — service status and configured chain keys
- `GET /api/v1/chains` — configured chain keys
- `GET /api/v1/vaults/:chain/:address` — vault, asset, totals, and share price
- `GET /api/v1/vaults/:chain/:address?amount=1000000` — add ERC-4626 previews for a base-unit asset amount
- `GET /api/v1/vaults/:chain/:address?account=0x...` — add `maxDeposit` and `maxWithdraw`

Results are cached for 15 seconds by default. A contract that does not expose the expected ERC-4626 interface returns a structured `NOT_ERC4626` response rather than invented data.

## Verify

```bash
npm test
```

Tests execute ABI-encoded mock RPC calls, decoding and unit formatting, caching, validation, HTTP routes, and structured error behavior.

## License

MIT © cent
