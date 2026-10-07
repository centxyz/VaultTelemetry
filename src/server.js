const express = require('express'); const cors = require('cors'); const morgan = require('morgan');
const { DeFiVaultProService, VaultError } = require('./services/defivaultpro-service');

function parseRpcUrls(value) {
  if (!value) return {};
  let parsed; try { parsed = JSON.parse(value); } catch { throw new Error('RPC_URLS must be valid JSON'); }
  for (const [chain, url] of Object.entries(parsed)) if (!chain || typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('RPC_URLS values must be HTTP(S) URLs');
  return parsed;
}

class Server {
  constructor({ port = 3000, service, corsOrigin = false } = {}) {
    this.port = Number(port); this.service = service || new DeFiVaultProService({ rpcUrls: parseRpcUrls(process.env.RPC_URLS) }); this.app = express();
    this.app.disable('x-powered-by'); this.app.use(cors({ origin: corsOrigin || false })); this.app.use(express.json({ limit: '16kb' })); this.app.use(morgan('combined'));
    this.routes();
  }
  routes() {
    this.app.get('/health', (_req, res) => res.json({ status: 'healthy', service: 'DeFiVaultPro', chains: this.service.listChains() }));
    this.app.get('/api/v1/chains', (_req, res) => res.json({ chains: this.service.listChains() }));
    this.app.get('/api/v1/vaults/:chain/:address', async (req, res, next) => {
      try { res.json(await this.service.inspect(req.params.chain, req.params.address, { account: req.query.account, amount: req.query.amount })); } catch (error) { next(error); }
    });
    this.app.use((_req, res) => res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' }));
    this.app.use((error, _req, res, _next) => { const status = error instanceof VaultError ? error.status : 500; res.status(status).json({ error: error.message, code: error.code || 'INTERNAL' }); });
  }
  start() { this.httpServer = this.app.listen(this.port, () => console.log(`DeFiVaultPro listening on ${this.port}`)); return this.httpServer; }
}
if (require.main === module) new Server({ port: process.env.PORT || 3000, corsOrigin: process.env.CORS_ORIGIN || false }).start();
module.exports = { Server, parseRpcUrls };
