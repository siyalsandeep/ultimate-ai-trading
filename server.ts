import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { marketDataService } from './server/data/market-data-service';
import { riskEngine } from './server/risk/risk-engine';
import { strategyEngine } from './server/strategies/strategy-engine';
import { executionEngine } from './server/execution/execution-engine';
import { backtestEngine } from './server/backtest/backtest-engine';
import { healthService } from './server/health/health-service';
import { auditLogger } from './server/audit/audit-logger';
import { geminiResearchService } from './server/ai/gemini-service';
import { authService } from './server/security/auth-service';
import { brokerTruthService } from './server/broker/broker-truth-service';
import { centralPermissionGate } from './server/risk/permission-gate';
import { portfolioRiskService } from './server/risk/portfolio-risk-service';
import { FinnhubSnapshotProvider } from './server/data/market-price-provider';
import {
  isLoopbackMt5Client,
  isValidMt5SymbolRequest,
  mt5ReadOnlyConnector,
} from './server/broker/mt5-read-only-connector';
import { Mt5ShadowCaptureService } from './server/broker/mt5-shadow-capture-service';

const marketPriceProvider = new FinnhubSnapshotProvider();
marketPriceProvider.start();
const mt5ShadowCaptureService = new Mt5ShadowCaptureService(mt5ReadOnlyConnector);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// ==========================================
// 0. Operator Session & Authentication Endpoints
// ==========================================
app.get(
  '/api/auth/session',
  authService.rateLimiter,
  authService.requireOperatorAuth,
  authService.operatorSessionHandler(() => executionEngine.getMode())
);

// ==========================================
// 1. Periodic Application Health Endpoints
// ==========================================
app.get('/api/health', (_req: Request, res: Response) => {
  const report = healthService.getHealthReport();
  const statusCode = report.overallState === 'HEALTHY' ? 200 : report.overallState === 'DEGRADED' ? 200 : 503;
  res.status(statusCode).json({
    status: report.overallState,
    timestamp: report.timestamp,
    uptimeSeconds: report.uptimeSeconds,
    failClosedArmed: report.failClosedArmed,
  });
});

app.get('/api/health/detailed', (_req: Request, res: Response) => {
  const report = healthService.getHealthReport();
  res.json(report);
});

app.post('/api/health/run-check', (_req: Request, res: Response) => {
  const report = healthService.runHealthCheck();
  res.json(report);
});

// ==========================================
// 2. Market Data & Instruments Endpoints
// ==========================================
app.get('/api/instruments', (_req: Request, res: Response) => {
  res.json(marketDataService.getSupportedInstruments());
});

app.get('/api/quotes', (_req: Request, res: Response) => {
  res.json(marketDataService.getAllQuotes());
});

app.get('/api/market/prices', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const symbols = marketDataService.getSupportedInstruments().map((instrument) => instrument.symbol);
  res.json(marketPriceProvider.getSnapshots(symbols));
});

app.get('/api/quotes/:symbol', (req: Request, res: Response) => {
  const quote = marketDataService.getQuote(req.params.symbol);
  if (!quote) return res.status(404).json({ error: 'Instrument not found' });
  res.json(quote);
});

app.get('/api/candles/:symbol', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const candles = marketDataService.getCandles(req.params.symbol, limit);
  res.json(candles);
});

app.get('/api/regime/:symbol', (req: Request, res: Response) => {
  const regime = marketDataService.classifyMarketRegime(req.params.symbol);
  res.json({ symbol: req.params.symbol, regime });
});

// ==========================================
// 3. Strategy Engine Endpoints
// ==========================================
app.get('/api/strategies', (_req: Request, res: Response) => {
  res.json(strategyEngine.getStrategies());
});

app.get('/api/strategy-definitions', (_req: Request, res: Response) => {
  res.json(strategyEngine.getStrategyDefinitions());
});

app.post('/api/strategy-selection/evaluate', authService.rateLimiter, authService.requireOperatorAuth, (req: Request, res: Response) => {
  const symbol = typeof req.body.symbol === 'string' ? req.body.symbol : '';
  if (!symbol || !marketDataService.getInstrument(symbol)) {
    return res.status(400).json({ error: 'Validation Error: symbol must identify a supported instrument' });
  }
  res.json(strategyEngine.evaluateSelection(symbol));
});

app.post('/api/strategies/:id/toggle', authService.rateLimiter, authService.requireOperatorAuth, (req: Request, res: Response) => {
  if (typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ error: 'Validation Error: enabled must be boolean' });
  }
  const updated = strategyEngine.toggleStrategy(req.params.id, req.body.enabled);
  if (!updated) return res.status(404).json({ error: 'Strategy not found' });
  res.json(updated);
});

app.post('/api/strategies/:id/params', authService.rateLimiter, authService.requireOperatorAuth, (req: Request, res: Response) => {
  if (!req.body.parameters || typeof req.body.parameters !== 'object') {
    return res.status(400).json({ error: 'Validation Error: parameters must be an object' });
  }
  const ok = strategyEngine.updateParameters(req.params.id, req.body.parameters);
  if (!ok) return res.status(404).json({ error: 'Strategy not found' });
  res.json({ success: true });
});

app.get('/api/signals', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  res.json(strategyEngine.getRecentSignals(limit));
});

app.post('/api/signals/scan', authService.rateLimiter, authService.requireOperatorAuth, (_req: Request, res: Response) => {
  const signals = strategyEngine.scanForSignals();
  res.json(signals);
});

// ==========================================
// 4. Deterministic Risk Engine Endpoints
// ==========================================
app.get('/api/risk/limits', (_req: Request, res: Response) => {
  res.json({
    limits: riskEngine.getLimits(),
    isGlobalKillSwitched: riskEngine.isGlobalKillSwitched(),
    cooldowns: riskEngine.getAllCooldowns(),
    accountCooldown: riskEngine.getCooldown('ACCOUNT'),
  });
});

app.get('/api/risk/portfolio', authService.rateLimiter, authService.requireOperatorAuth, (_req: Request, res: Response) => {
  const assessment = portfolioRiskService.assess({
    equity: executionEngine.getPortfolio().totalEquity,
    positions: executionEngine.getPositions(),
    orders: executionEngine.getOrders(Number.MAX_SAFE_INTEGER),
    getInstrument: (symbol) => marketDataService.getInstrument(symbol),
    limits: riskEngine.getLimits(),
  });
  res.json(assessment);
});

app.get('/api/risk/cooldowns', (_req: Request, res: Response) => {
  res.json({
    cooldowns: riskEngine.getAllCooldowns(),
    accountCooldown: riskEngine.getCooldown('ACCOUNT'),
    consecutiveLossesByStrategy: executionEngine.getConsecutiveLossesByStrategy(),
    accountConsecutiveLosses: executionEngine.getAccountConsecutiveLosses(),
  });
});

app.get('/api/trades/closed', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  res.json(executionEngine.getClosedTrades(limit));
});

app.post('/api/risk/limits', authService.rateLimiter, authService.requireOperatorAuth, authService.validateRiskLimitsInput, async (req: Request, res: Response) => {
  const previousLimits = riskEngine.getLimits();
  const result = riskEngine.updateLimits(req.body);
  if (!result.success) return res.status(400).json(result);
  if (!await executionEngine.persistCurrentState()) {
    riskEngine.updateLimits(previousLimits);
    return res.status(503).json({ success: false, message: 'Risk limits were not durably persisted; the previous limits remain active.' });
  }
  res.json(result);
});

app.post('/api/risk/validate', (req: Request, res: Response) => {
  const quote = marketDataService.getQuote(req.body.symbol);
  const instrument = marketDataService.getInstrument(req.body.symbol);
  const portfolio = executionEngine.getPortfolio();
  const positions = executionEngine.getPositions();
  const health = healthService.getHealthReport().overallState;

  const result = riskEngine.evaluatePreTradeRisk(
    req.body,
    quote,
    instrument,
    portfolio,
    positions,
    health
  );
  res.json(result);
});

app.post('/api/risk/kill-switch', authService.rateLimiter, authService.requireOperatorAuth, async (req: Request, res: Response) => {
  if (typeof req.body.active !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Validation Error: active must be boolean.' });
  }
  if (req.body.reason !== undefined && typeof req.body.reason !== 'string') {
    return res.status(400).json({ success: false, error: 'Validation Error: reason must be a string.' });
  }
  const active = req.body.active;
  const previousSafetyState = riskEngine.getPersistedSafetyState();
  riskEngine.setGlobalKillSwitch(active, req.body.reason || 'Operator UI Action');
  const positionsLeftOpen = executionEngine.getPositions().length;
  let cancelledCount = 0;
  if (active) {
    cancelledCount = await executionEngine.cancelAllOpenOrders('Global Kill Switch Triggered');
  }
  if (!await executionEngine.persistCurrentState()) {
    if (!active) riskEngine.restorePersistedSafetyState(previousSafetyState);
    return res.status(503).json({
      success: false,
      isGlobalKillSwitched: riskEngine.isGlobalKillSwitched(),
      positionsLeftOpen,
      cancelledCount,
      message: 'Kill-switch state could not be durably persisted. Verify current server state before assuming the halt changed.',
    });
  }
  const openOrderStatuses = new Set(['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED']);
  const openOrdersRemaining = executionEngine.getOrders(Number.MAX_SAFE_INTEGER)
    .filter((order) => openOrderStatuses.has(order.status)).length;
  res.json({
    success: true,
    isGlobalKillSwitched: active,
    cancelledCount,
    openOrdersRemaining,
    positionsLeftOpen,
    positionAction: 'EXISTING_POSITIONS_UNCHANGED',
  });
});

app.post('/api/risk/strategy-quarantine', authService.rateLimiter, authService.requireOperatorAuth, async (req: Request, res: Response) => {
  if (!req.body.strategyId) {
    return res.status(400).json({ error: 'Validation Error: strategyId is required' });
  }
  const previousSafetyState = riskEngine.getPersistedSafetyState();
  riskEngine.setStrategySuspension(req.body.strategyId, Boolean(req.body.suspended));
  if (!await executionEngine.persistCurrentState()) {
    riskEngine.restorePersistedSafetyState(previousSafetyState);
    return res.status(503).json({ success: false, message: 'Strategy suspension could not be durably persisted.' });
  }
  res.json({ success: true, strategyId: req.body.strategyId, suspended: req.body.suspended });
});

app.get('/api/risk/instrument-suspensions', (_req: Request, res: Response) => {
  res.json({ suspendedInstruments: riskEngine.getSuspendedInstruments() });
});

app.post('/api/risk/instrument-suspension', authService.rateLimiter, authService.requireOperatorAuth, async (req: Request, res: Response) => {
  if (!req.body.symbol || typeof req.body.symbol !== 'string') {
    return res.status(400).json({ error: 'Validation Error: symbol is required' });
  }
  const previousSafetyState = riskEngine.getPersistedSafetyState();
  const suspended = Boolean(req.body.suspended);
  riskEngine.setInstrumentSuspension(req.body.symbol, suspended, req.body.reason || (suspended ? 'Operator instrument pause' : 'Operator instrument resume'));
  if (!await executionEngine.persistCurrentState()) {
    riskEngine.restorePersistedSafetyState(previousSafetyState);
    return res.status(503).json({ success: false, message: 'Instrument suspension could not be durably persisted.' });
  }
  res.json({ success: true, symbol: req.body.symbol.toUpperCase(), suspended, reason: req.body.reason || (suspended ? 'Operator instrument pause' : 'Operator instrument resume') });
});

app.post('/api/risk/broker-isolate', authService.rateLimiter, authService.requireOperatorAuth, async (req: Request, res: Response) => {
  if (!req.body.broker) {
    return res.status(400).json({ error: 'Validation Error: broker is required' });
  }
  const previousSafetyState = riskEngine.getPersistedSafetyState();
  riskEngine.setBrokerSuspension(req.body.broker, Boolean(req.body.suspended));
  if (!await executionEngine.persistCurrentState()) {
    riskEngine.restorePersistedSafetyState(previousSafetyState);
    return res.status(503).json({ success: false, message: 'Broker isolation state could not be durably persisted.' });
  }
  res.json({ success: true, broker: req.body.broker, suspended: req.body.suspended });
});

app.post('/api/risk/reset-daily-loss', authService.rateLimiter, authService.requireOperatorAuth, async (_req: Request, res: Response) => {
  const previousSafetyState = riskEngine.getPersistedSafetyState();
  riskEngine.resetDailyLossCircuitBreaker();
  if (!await executionEngine.persistCurrentState()) {
    riskEngine.restorePersistedSafetyState(previousSafetyState);
    return res.status(503).json({ success: false, message: 'Daily loss breaker reset could not be durably persisted.' });
  }
  res.json({ success: true, message: 'Daily loss circuit breaker disarmed.' });
});

// ==========================================
// 5. Portfolio & Execution Endpoints
// ==========================================
app.get('/api/portfolio', (_req: Request, res: Response) => {
  res.json(executionEngine.getPortfolio());
});

app.post('/api/portfolio/mode', authService.rateLimiter, authService.requireOperatorAuth, (req: Request, res: Response) => {
  const validModes = ['BACKTEST', 'PAPER', 'LIVE'];
  if (!validModes.includes(req.body.mode)) {
    return res.status(400).json({ success: false, error: 'Validation Error: Invalid system mode.' });
  }
  const result = executionEngine.setMode(req.body.mode);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.get('/api/positions', (_req: Request, res: Response) => {
  res.json(executionEngine.getPositions());
});

app.post('/api/positions/:symbol/close', authService.rateLimiter, authService.requireOperatorAuth, async (req: Request, res: Response) => {
  const result = await executionEngine.closePosition(req.params.symbol, req.body.reason || 'Operator Manual Close');
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.get('/api/orders', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  res.json(executionEngine.getOrders(limit));
});

app.post('/api/orders', authService.rateLimiter, authService.requireOperatorAuth, authService.validateOrderInput, async (req: Request, res: Response) => {
  const result = await executionEngine.submitOrder(
    req.body,
    () => healthService.runHealthCheck().overallState
  );
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/orders/:id/cancel', authService.rateLimiter, authService.requireOperatorAuth, async (req: Request, res: Response) => {
  const ok = await executionEngine.cancelOrder(req.params.id);
  if (!ok) return res.status(400).json({ success: false, message: 'Could not cancel order' });
  res.json({ success: true });
});

app.post('/api/orders/cancel-all', authService.rateLimiter, authService.requireOperatorAuth, async (req: Request, res: Response) => {
  const count = await executionEngine.cancelAllOpenOrders(req.body.reason || 'Manual Mass Cancel');
  res.json({ success: true, cancelledCount: count });
});

app.post('/api/orders/reconcile', authService.rateLimiter, authService.requireOperatorAuth, (_req: Request, res: Response) => {
  const result = executionEngine.reconcileState();
  res.json(result);
});

// ==========================================
// 5B. Broker Truth & Safety Service Endpoints
// ==========================================
app.get('/api/broker/truth', (_req: Request, res: Response) => {
  res.json(executionEngine.getBrokerTruthState());
});

app.get('/api/broker/connection', (_req: Request, res: Response) => {
  res.json(brokerTruthService.getConnectionInfo());
});

app.get('/api/broker/quotes', (_req: Request, res: Response) => {
  res.json(brokerTruthService.getQuotesWithProvenance().filter((quote) => quote.provenance === 'BROKER_CONFIRMED'));
});

app.get('/api/quotes/provenance', (_req: Request, res: Response) => {
  res.json(brokerTruthService.getQuotesWithProvenance());
});

app.get('/api/broker/positions', (_req: Request, res: Response) => {
  res.json(brokerTruthService.getBrokerPositions());
});

app.get('/api/broker/deals', (_req: Request, res: Response) => {
  res.json(brokerTruthService.getBrokerDeals());
});

app.get('/api/broker/pnl', (_req: Request, res: Response) => {
  res.json(brokerTruthService.getBrokerPnLVerification());
});

function requireLocalMt5Host(req: Request, res: Response, next: () => void): void {
  if (!isLoopbackMt5Client(
    req.socket.remoteAddress,
    Boolean(req.headers['x-forwarded-for'] || req.headers.forwarded)
  )) {
    res.status(403).json({
      method: 'LOCAL_LOGGED_IN_MT5_TERMINAL',
      status: 'UNAVAILABLE',
      message: 'A browser-hosted/cloud server cannot access an MT5 terminal on your computer. Run the app locally beside the terminal.',
      testedAt: null,
      snapshot: null,
      automatedTradingEnabled: false,
    });
    return;
  }
  next();
}

app.get(
  '/api/mt5/status',
  requireLocalMt5Host,
  authService.rateLimiter,
  authService.requireOperatorAuth,
  (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(mt5ReadOnlyConnector.getStatus());
  }
);

app.post(
  '/api/mt5/connect/test',
  requireLocalMt5Host,
  authService.rateLimiter,
  authService.requireOperatorAuth,
  async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const requestedSymbols = req.body?.symbols;
    if (requestedSymbols !== undefined && !Array.isArray(requestedSymbols)) {
      res.status(400).json({ error: 'symbols must be an array of MT5 symbol names' });
      return;
    }
    const symbols = Array.isArray(requestedSymbols) ? requestedSymbols : [];
    res.json(await mt5ReadOnlyConnector.testReadOnlyConnection(symbols));
  }
);

app.post(
  '/api/mt5/shadow/captures',
  requireLocalMt5Host,
  authService.rateLimiter,
  authService.requireOperatorAuth,
  async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isValidMt5SymbolRequest(req.body?.symbols)) {
      res.status(400).json({ error: 'symbols must contain 1 to 10 valid MT5 symbol names' });
      return;
    }
    try {
      const capture = await mt5ShadowCaptureService.capture(req.body.symbols);
      auditLogger.record({
        category: 'HEALTH_CHECK',
        level: capture.status === 'OBSERVATION_ONLY' ? 'INFO' : 'WARNING',
        action: 'MT5_READ_ONLY_SHADOW_OBSERVATION_CAPTURED',
        details: {
          captureId: capture.id,
          status: capture.status,
          connectionStatus: capture.connectionStatus,
          symbols: capture.requestedSymbols,
          gaps: capture.gaps,
          tradingEnabled: false,
        },
        actor: 'OPERATOR',
      });
      res.status(capture.status === 'OBSERVATION_ONLY' ? 201 : 202).json(capture);
    } catch (error) {
      console.error('Failed to persist MT5 read-only shadow observation:', error);
      auditLogger.record({
        category: 'HEALTH_CHECK',
        level: 'WARNING',
        action: 'MT5_READ_ONLY_SHADOW_OBSERVATION_PERSIST_FAILED',
        details: {
          symbols: req.body.symbols,
          errorType: error instanceof Error ? error.name : 'UNKNOWN',
          tradingEnabled: false,
        },
        actor: 'OPERATOR',
      });
      res.status(500).json({ error: 'MT5 observation capture could not be persisted.' });
    }
  }
);

app.get(
  '/api/mt5/shadow/captures',
  requireLocalMt5Host,
  authService.rateLimiter,
  authService.requireOperatorAuth,
  async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const requestedLimit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      res.status(400).json({ error: 'limit must be an integer between 1 and 100' });
      return;
    }
    try {
      res.json(await mt5ShadowCaptureService.getRecent(requestedLimit));
    } catch (error) {
      console.error('Failed to read MT5 shadow observation history:', error);
      res.status(500).json({ error: 'MT5 observation history is unavailable.' });
    }
  }
);

app.post('/api/positions/:symbol/stop', authService.rateLimiter, authService.requireOperatorAuth, async (req: Request, res: Response) => {
  const newStop = parseFloat(req.body.stopLoss);
  if (isNaN(newStop) || newStop <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid stop price: must be a positive number.' });
  }
  const result = await executionEngine.modifyPositionStopLoss(req.params.symbol, newStop);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

app.post('/api/risk/permission-gate/validate', (req: Request, res: Response) => {
  const quote = marketDataService.getQuote(req.body.symbol);
  const instrument = marketDataService.getInstrument(req.body.symbol);
  const portfolio = executionEngine.getPortfolio();
  const positions = executionEngine.getPositions();
  const orders = executionEngine.getOrders();
  const limits = riskEngine.getLimits();

  const result = centralPermissionGate.evaluateGate(
    req.body,
    quote || null,
    instrument || null,
    portfolio,
    positions,
    orders,
    limits,
    healthService.getHealthReport().overallState,
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p),
    executionEngine.hasUncertainOrderIntents(),
    (symbol) => riskEngine.isInstrumentSuspended(symbol)
  );

  res.json(result);
});

// ==========================================
// 6. Backtesting Engine Endpoints
// ==========================================
app.post('/api/backtest', (req: Request, res: Response) => {
  const result = backtestEngine.runBacktest(req.body);
  res.json(result);
});

// ==========================================
// 7. Audit Log Endpoints
// ==========================================
app.get('/api/audit-logs', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const category = req.query.category as string | undefined;
  res.json(auditLogger.getRecentLogs(limit, category));
});

// ==========================================
// 8. AI Quantitative Research Endpoints
// ==========================================
app.post('/api/ai/research', async (req: Request, res: Response) => {
  try {
    const response = await geminiResearchService.conductResearch(req.body);
    res.json(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ==========================================
// 9. Vite Frontend Integration
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const host = process.env.HOST || '127.0.0.1';
  app.listen(PORT, host, () => {
    console.log(`Global AI Trader OS operational at http://${host}:${PORT}`);
    auditLogger.record({
      category: 'HEALTH_CHECK',
      level: 'INFO',
      action: 'SERVER_BOOTSTRAP_COMPLETE',
      details: { port: PORT, mode: executionEngine.getMode() },
      actor: 'OPERATOR',
    });
  });
}

startServer().catch(err => {
  console.error('Fatal failure starting server:', err);
  process.exit(1);
});
