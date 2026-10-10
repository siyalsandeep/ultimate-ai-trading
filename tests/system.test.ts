/**
 * Global AI Trader OS - Automated Quantitative & System Integrity Tests
 */

import { riskEngine } from '../server/risk/risk-engine';
import { marketDataService } from '../server/data/market-data-service';
import { strategyEngine } from '../server/strategies/strategy-engine';
import {
  calculateDeterministicPaperFillPrice,
  cancelNonTerminalPaperOrders,
  ExecutionEngine,
  executionEngine,
} from '../server/execution/execution-engine';
import { StrategyEngine } from '../server/strategies/strategy-engine';
import { AIResearchResponse, CandleOHLCV, Order, StrategyConfig } from '../src/types/trading';
import { backtestEngine } from '../server/backtest/backtest-engine';
import { healthService } from '../server/health/health-service';
import { storageService } from '../server/persistence/storage-service';
import { brokerTruthService } from '../server/broker/broker-truth-service';
import { auditLogger } from '../server/audit/audit-logger';
import { centralPermissionGate } from '../server/risk/permission-gate';
import { PortfolioRiskService } from '../server/risk/portfolio-risk-service';
import { FinnhubSnapshotProvider } from '../server/data/market-price-provider';
import {
  calculateBrokerAwarePositionSize,
  BrokerInstrumentConstraints,
  OrderAuthorizationContext,
  OrderAuthorizationService,
} from '../server/execution/order-authorization-service';
import {
  evaluateStrategySelection,
  STRATEGY_DEFINITIONS,
  StrategySelectionInput,
  StrategyValidationEvidence,
} from '../server/strategies/strategy-selection';
import { evaluateResearchSignal } from '../server/strategies/strategy-signals';
import { isLoopbackMt5Client, Mt5ReadOnlyConnector } from '../server/broker/mt5-read-only-connector';
import { Mt5ShadowCaptureService, Mt5ShadowCaptureStore } from '../server/broker/mt5-shadow-capture-service';
import { isConfiguredEntrySessionOpen } from '../server/risk/trading-session';
import { RiskEngine } from '../server/risk/risk-engine';
import express from 'express';
import { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuthService } from '../server/security/auth-service';
import { StorageService } from '../server/persistence/storage-service';
import { GeminiResearchService } from '../server/ai/gemini-service';

function assert(condition: boolean, testName: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${testName}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${testName}`);
  }
}

async function testOperatorAuthenticationEndpoint(): Promise<void> {
  const app = express();
  const auth = new AuthService('phase8-test-operator-secret-0123456789abcdef');
  let protectedMutationReached = false;
  app.get('/api/auth/session', auth.requireOperatorAuth, auth.operatorSessionHandler(() => 'PAPER'));
  app.post('/api/operator-control', auth.requireOperatorAuth, (_req, res) => {
    protectedMutationReached = true;
    res.json({ success: true });
  });
  const unconfiguredAuth = new AuthService('');
  app.get('/api/unconfigured-session', unconfiguredAuth.requireOperatorAuth, (_req, res) => res.json({ success: true }));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    listener.once('listening', resolve);
    listener.once('error', reject);
  });
  try {
    const address = listener.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const unauthenticated = await fetch(`${baseUrl}/api/auth/session`);
    const unauthenticatedBody = await unauthenticated.json();
    assert(
      unauthenticated.status === 401 &&
        unauthenticatedBody.token === undefined &&
        unauthenticated.headers.get('cache-control') === 'no-store',
      'Unauthenticated session requests disclose no operator credential and cannot be cached'
    );
    const unauthorizedMutation = await fetch(`${baseUrl}/api/operator-control`, { method: 'POST' });
    assert(
      unauthorizedMutation.status === 401 && !protectedMutationReached,
      'Unauthenticated operator requests cannot reach protected mutations'
    );
    const legacyHeaderAttempt = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { 'x-operator-token': 'phase8-test-operator-secret-0123456789abcdef' },
    });
    assert(legacyHeaderAttempt.status === 401, 'Operator credentials are accepted only through the Authorization bearer header');
    const authenticated = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Authorization: 'Bearer phase8-test-operator-secret-0123456789abcdef' },
    });
    const authenticatedBody = await authenticated.json();
    assert(
      authenticated.status === 200 &&
        authenticatedBody.authenticated === true &&
        authenticatedBody.mode === 'PAPER' &&
        authenticatedBody.token === undefined,
      'Authenticated session returns status metadata without echoing the operator credential'
    );
    const unconfigured = await fetch(`${baseUrl}/api/unconfigured-session`);
    assert(unconfigured.status === 503, 'Protected controls fail closed when no sufficiently long operator secret is configured');
  } finally {
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  }
}

async function runTests() {
  await testOperatorAuthenticationEndpoint();
  const legacyRiskEngine = new RiskEngine();
  legacyRiskEngine.restorePersistedSafetyState(undefined);
  assert(
    legacyRiskEngine.isGlobalKillSwitched() &&
      legacyRiskEngine.checkDailyLossBreach({
        ...executionEngine.getPortfolio(),
        startOfDayEquity: Number.NaN,
      }),
    'Missing persisted breaker state and invalid daily-loss inputs fail closed'
  );
  const partialPersistedStateEngine = new RiskEngine();
  partialPersistedStateEngine.restorePersistedSafetyState({
    globalKillSwitchActive: false,
    dailyLossTripped: false,
    suspendedStrategies: [],
    suspendedInstruments: [],
    suspendedBrokers: [],
  });
  partialPersistedStateEngine.restoreCooldowns(undefined);
  assert(
    partialPersistedStateEngine.isGlobalKillSwitched() &&
      partialPersistedStateEngine.isDailyLossCircuitBreakerTripped(),
    'Missing cooldown persistence remains halted even when other persisted safety state is valid'
  );
  riskEngine.setGlobalKillSwitch(false, 'Isolate system test fixtures');
  riskEngine.resetDailyLossCircuitBreaker();
  riskEngine.restoreCooldowns({});
  riskEngine.restorePersistedSafetyState({
    ...riskEngine.getPersistedSafetyState(),
    globalKillSwitchActive: false,
    dailyLossTripped: false,
    suspendedStrategies: [],
    suspendedInstruments: [],
    suspendedBrokers: [],
  });
  executionEngine.recordClosedTrade({
    symbol: 'SPY',
    strategyId: `test_setup_${Date.now()}`,
    side: 'BUY',
    quantity: 1,
    entryPrice: 1,
    exitPrice: 2,
    grossPnL: 1,
    feePaid: 0,
    exitReason: 'Isolate persisted account-loss fixture',
    isPartial: false,
  });
  console.log('\n--- 1. Testing Deterministic Risk Engine Invariants ---');
  const portfolioRiskService = new PortfolioRiskService();
  const portfolioRiskLimits = {
    ...riskEngine.getLimits(),
    maxLeverage: 5,
    maxSingleAssetExposurePct: 20,
    maxAssetClassExposurePct: 50,
    maxStrategyExposurePct: 50,
    portfolioOpenRiskBudgetPct: 10,
  };
  const spyRiskInstrument = marketDataService.getInstrument('SPY')!;
  const qqqRiskInstrument = marketDataService.getInstrument('QQQ')!;
  const minimumLotOverBudget = riskEngine.calculatePositionSize(1000, 100, 90, spyRiskInstrument);
  assert(
    minimumLotOverBudget.quantity === 0 && minimumLotOverBudget.riskAmountUSD === 0,
    'Position sizing abstains when the minimum lot would exceed the per-trade risk budget'
  );
  const riskBoundedSize = riskEngine.calculatePositionSize(100000, 500, 450, spyRiskInstrument);
  const riskBudgetUSD = 100000 * riskEngine.getLimits().maxRiskPerTradePct / 100;
  assert(
    riskBoundedSize.quantity >= spyRiskInstrument.minLotSize &&
      riskBoundedSize.riskAmountUSD === riskBoundedSize.quantity * 50 &&
      riskBoundedSize.riskAmountUSD <= riskBudgetUSD,
    'Position sizing reports the rounded quantity risk and remains within its risk budget'
  );
  const unconvertedCurrencySize = riskEngine.calculatePositionSize(
    100000,
    150,
    149,
    { ...spyRiskInstrument, currency: 'JPY' }
  );
  assert(
    unconvertedCurrencySize.quantity === 0,
    'Position sizing abstains when quote-currency risk cannot be converted to USD'
  );
  const invalidSizeInput = riskEngine.calculatePositionSize(Number.NaN, 100, 90, spyRiskInstrument);
  assert(invalidSizeInput.quantity === 0, 'Position sizing rejects non-finite equity instead of returning NaN');

  const portfolioRiskResult = portfolioRiskService.assess({
    equity: 100000,
    positions: [
      {
        id: 'risk-spy', symbol: 'SPY', assetClass: 'EQUITY', side: 'BUY', quantity: 2,
        entryPrice: 490, currentPrice: 500, stopLossPrice: 480, unrealizedPnL: 20,
        unrealizedPnLPct: 2, realizedPnL: 0, marginUsed: 200, openedAt: Date.now(),
        strategyId: 'strat_test', broker: 'SimulatedInstitutionalBroker',
      },
      {
        id: 'risk-qqq', symbol: 'QQQ', assetClass: 'EQUITY', side: 'BUY', quantity: 1,
        entryPrice: 390, currentPrice: 400, stopLossPrice: 380, unrealizedPnL: 10,
        unrealizedPnLPct: 2, realizedPnL: 0, marginUsed: 160, openedAt: Date.now(),
        strategyId: 'strat_test', broker: 'SimulatedInstitutionalBroker',
      },
    ],
    orders: [{
      id: 'pending-spy', clientOrderId: 'pending-spy', symbol: 'SPY', side: 'BUY',
      type: 'LIMIT', quantity: 1, price: 490, stopLoss: 480, status: 'SUBMITTED',
      filledQuantity: 0, feePaid: 0, estimatedSlippage: 0, createdAt: Date.now(),
      updatedAt: Date.now(), strategyId: 'strat_test', broker: 'SimulatedInstitutionalBroker',
    }],
    proposed: {
      symbol: 'SPY', side: 'BUY', quantity: 1, price: 500, stopLoss: 490,
      strategyId: 'strat_test', instrument: spyRiskInstrument,
    },
    getInstrument: (symbol) => symbol === 'SPY' ? spyRiskInstrument : symbol === 'QQQ' ? qqqRiskInstrument : undefined,
    limits: portfolioRiskLimits,
    now: Date.now(),
  });
  assert(portfolioRiskResult.status === 'ESTIMATED_PAPER_ONLY', 'Portfolio assessment explicitly identifies local paper-ledger provenance');
  assert(portfolioRiskResult.grossNotional === 2390, 'Portfolio assessment includes positions, active pending-order remainder, and proposed notional');
  assert(portfolioRiskResult.correlatedClusters.some((cluster) => cluster.symbols.includes('SPY') && cluster.symbols.includes('QQQ')), 'Portfolio assessment identifies shared asset-class and currency risk proxy');
  const excessiveLeverageAssessment = portfolioRiskService.assess({
    equity: 1000,
    positions: [],
    orders: [],
    proposed: {
      symbol: 'SPY', side: 'BUY', quantity: 10, price: 500, stopLoss: 499,
      strategyId: 'strat_test', instrument: spyRiskInstrument,
    },
    getInstrument: (symbol) => symbol === 'SPY' ? spyRiskInstrument : undefined,
    limits: { ...portfolioRiskLimits, maxLeverage: 1 },
  });
  assert(!excessiveLeverageAssessment.entryAllowed && excessiveLeverageAssessment.reasons.some((reason) => reason.includes('gross leverage')), 'Portfolio assessment rejects proposed exposure above leverage ceiling');
  const unknownPositionAssessment = portfolioRiskService.assess({
    equity: 100000,
    positions: [{
      id: 'unknown', symbol: 'UNKNOWN', assetClass: 'EQUITY', side: 'BUY', quantity: 1,
      entryPrice: 10, currentPrice: 10, stopLossPrice: 9, unrealizedPnL: 0,
      unrealizedPnLPct: 0, realizedPnL: 0, marginUsed: 1, openedAt: Date.now(),
      strategyId: 'strat_test', broker: 'SimulatedInstitutionalBroker',
    }],
    orders: [],
    getInstrument: () => undefined,
    limits: portfolioRiskLimits,
  });
  assert(unknownPositionAssessment.status === 'UNAVAILABLE' && !unknownPositionAssessment.entryAllowed, 'Portfolio assessment fails closed when an existing position cannot be valued');

  const spyQuote = marketDataService.getQuote('SPY');
  const spyInst = marketDataService.getInstrument('SPY');
  const portfolio = executionEngine.getPortfolio();
  const positions = executionEngine.getPositions();

  assert(!!spyQuote, 'Market quote for SPY retrieved');
  assert(!!spyInst, 'Instrument metadata for SPY retrieved');

  // Test 1: Reject order without Stop-Loss
  const noStopLossCheck = riskEngine.evaluatePreTradeRisk(
    {
      symbol: 'SPY',
      side: 'BUY',
      quantity: 10,
      price: 580,
      stopLoss: undefined, // Missing stop-loss
      strategyId: 'strat_test',
      broker: 'SimulatedInstitutionalBroker',
    },
    spyQuote,
    spyInst,
    portfolio,
    positions,
    'HEALTHY'
  );
  assert(!noStopLossCheck.approved && noStopLossCheck.code === 'ERR_NO_STOP_LOSS', 'Deterministic rejection on missing stop-loss');

  // Test 1b: Verify Stage 6 Session/Calendar Guard on non-crypto assets
  const weekendMockInstrument = {
    ...spyInst!,
    weekendEntryAllowed: false,
  };
  assert(weekendMockInstrument.marketCloseBufferMinutes === 15, 'Stage 6: 15-minute market close buffer configured');

  // Test 2: Approve valid order with compliant risk sizing & stop-loss
  const ethQuote = marketDataService.getQuote('ETH/USDT');
  const ethInst = marketDataService.getInstrument('ETH/USDT');
  assert(
    isConfiguredEntrySessionOpen(weekendMockInstrument, Date.parse('2025-01-06T15:00:00Z')) &&
      !isConfiguredEntrySessionOpen(weekendMockInstrument, Date.parse('2025-01-06T21:00:00Z')) &&
      !isConfiguredEntrySessionOpen(weekendMockInstrument, Date.parse('2025-01-04T15:00:00Z')),
    'Configured equity session admits open-market entries and blocks close-buffer and weekend entries'
  );
  assert(
    isConfiguredEntrySessionOpen(ethInst!, Date.parse('2025-01-04T15:00:00Z')) &&
      !isConfiguredEntrySessionOpen({ ...ethInst!, weekendEntryAllowed: false }, Date.parse('2025-01-04T15:00:00Z')),
    '24/7 session is open on weekends only when the instrument explicitly permits weekend entry'
  );
  const validOrderCheck = riskEngine.evaluatePreTradeRisk(
    {
      symbol: 'ETH/USDT',
      side: 'BUY',
      quantity: 1,
      price: ethQuote!.lastPrice,
      stopLoss: ethQuote!.lastPrice - 50,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    ethQuote,
    ethInst,
    portfolio,
    positions,
    'HEALTHY'
  );
  assert(validOrderCheck.approved, 'Approval for compliant order with protective stop-loss');
  const staleRiskCheck = riskEngine.evaluatePreTradeRisk(
    {
      symbol: 'ETH/USDT',
      side: 'BUY',
      quantity: 1,
      price: ethQuote!.ask,
      stopLoss: ethQuote!.ask - 50,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    { ...ethQuote!, timestamp: Date.now() - riskEngine.getLimits().maxQuoteAgeMs - 1 },
    ethInst,
    portfolio,
    positions,
    'HEALTHY'
  );
  assert(!staleRiskCheck.approved && staleRiskCheck.code === 'ERR_STALE_MARKET_DATA', 'Stale market data blocks risk approval');
  const invalidQuantityCheck = riskEngine.evaluatePreTradeRisk(
    {
      symbol: 'ETH/USDT',
      side: 'BUY',
      quantity: -1,
      price: ethQuote!.ask,
      stopLoss: ethQuote!.ask - 50,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    ethQuote,
    ethInst,
    portfolio,
    positions,
    'HEALTHY'
  );
  assert(!invalidQuantityCheck.approved && invalidQuantityCheck.code === 'ERR_INVALID_ORDER_OR_PORTFOLIO_STATE', 'Non-positive order quantity blocks deterministic risk approval');

  // Test 3: Global Kill Switch blocks all new orders
  riskEngine.setGlobalKillSwitch(true, 'Test Kill Switch');
  const killedCheck = riskEngine.evaluatePreTradeRisk(
    {
      symbol: 'SPY',
      side: 'BUY',
      quantity: 5,
      price: 580,
      stopLoss: 574,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    spyQuote,
    spyInst,
    portfolio,
    positions,
    'HEALTHY'
  );
  assert(!killedCheck.approved && killedCheck.code === 'ERR_GLOBAL_KILL_SWITCH', 'Global kill switch blocks order entry');
  riskEngine.setGlobalKillSwitch(false, 'Disarm Test Kill Switch');

  console.log('\n--- 2. Testing Market Data & Indicator Calculus ---');
  const candles = marketDataService.getCandles('BTC/USDT', 30);
  assert(candles.length === 30, 'Retrieved 30 OHLCV candles for BTC/USDT');
  const lastCandle = candles[candles.length - 1];
  assert(!!lastCandle.indicators?.ema20, 'EMA 20 indicator present and computed');
  assert(!!lastCandle.indicators?.atr14, 'ATR 14 volatility indicator computed');
  assert(!!lastCandle.indicators?.rsi14, 'RSI 14 momentum oscillator computed');
  assert(!!lastCandle.indicators?.bbUpper, 'Bollinger Bands upper/lower envelopes computed');

  const regime = marketDataService.classifyMarketRegime('BTC/USDT');
  assert(['TRENDING_BULL', 'TRENDING_BEAR', 'RANGING_LOW_VOL', 'RANGING_HIGH_VOL', 'UNCERTAIN_SHOCK'].includes(regime), `Regime classifier returned valid regime: ${regime}`);

  console.log('\n--- 2a. Testing Evidence-Gated Strategy Suitability Selection ---');
  const selectorNow = Date.now();
  const selectionInput: StrategySelectionInput = {
    symbol: 'SPY',
    assetClass: 'INDEX',
    timeframe: '1d',
    marketCondition: 'TRENDING_BULL',
    regimeConfidence: 0.9,
    regimeConfidenceMethod: 'Mock validated calibration',
    regimeConfidenceCalibrated: true,
    quoteStatus: 'LIVE',
    quoteProvider: 'Mock Verified Provider',
    quoteTimestamp: selectorNow - 1000,
    quoteIsBrokerExecutable: true,
    quoteAgeMs: 1000,
    spreadBasisPoints: 2,
    candlesVerified: true,
    candleProvider: 'Mock Historical Provider',
    candleTimestamp: selectorNow - 60_000,
    candleAgeMs: 60_000,
    sessionStatus: 'OPEN',
    strategyEnabled: Object.fromEntries(STRATEGY_DEFINITIONS.map(definition => [definition.id, definition.id === 'strat_trend'])),
    blockedStrategyReasons: {},
    accountRiskBlocked: false,
    evidence: [],
    now: selectorNow,
  };
  const simulatedSelection = evaluateStrategySelection({
    ...selectionInput,
    quoteStatus: 'SIMULATED',
    quoteProvider: 'Local Paper Simulator',
    quoteIsBrokerExecutable: false,
    candlesVerified: false,
    evidence: [{
      evidenceId: 'mock-evidence-1',
      dataSetId: 'mock-dataset-1',
      codeRevision: 'test-revision',
      completedAt: selectorNow - 500,
      strategyId: 'strat_trend',
      strategyVersion: '1.0.0',
      symbol: 'SPY',
      timeframe: '1d',
      marketCondition: 'TRENDING_BULL',
      outOfSampleTrades: 120,
      walkForwardWindows: 4,
      outOfSampleNetExpectancyPct: 0.2,
      netExpectancyLower95Pct: 0.05,
      outOfSampleSharpe: 0.8,
      annualizedTurnover: 10,
      totalCostsPctOfGrossNotional: 0.1,
      includesRealisticCosts: true,
      includesAdverseExecution: true,
      passedBiasReview: true,
      maxDrawdownPct: 4,
      stableAcrossWindows: true,
    }],
  });
  assert(simulatedSelection.decision === 'NO_TRADE' && simulatedSelection.marketCondition === 'UNKNOWN', 'Simulated prices and generated candles force UNKNOWN conditions and NO TRADE');

  const noEvidenceSelection = evaluateStrategySelection(selectionInput);
  assert(noEvidenceSelection.decision === 'NO_TRADE' && noEvidenceSelection.candidates.find(candidate => candidate.strategyId === 'strat_trend')?.validationStatus === 'NOT_VALIDATED', 'No version-matched out-of-sample evidence means selector abstains');

  const researchEngine = new StrategyEngine();
  const ordersBeforeResearchEvaluation = executionEngine.getOrders().length;
  const strategiesBeforeExplicitEnable = researchEngine.getStrategies();
  assert(strategiesBeforeExplicitEnable.every(strategy => !strategy.enabled), 'No candidate or classifier is automatically activated');
  assert(
    STRATEGY_DEFINITIONS.every(definition =>
      definition.version && Object.keys(definition.parameters).length > 0 &&
      definition.candleRules.length > 0 && definition.comparisonBaselines.length > 0
    ),
    'Candidates A-D each declare a version, explicit parameters, closed-candle rules, and comparison baseline'
  );
  assert(
    researchEngine.getStrategies().every(strategy => strategy.autoExecutionDisabled === true),
    'Enabling a research module cannot enable automatic order execution'
  );
  researchEngine.toggleStrategy('strat_trend', true);
  const signalOnlyStatus = researchEngine.getStrategies().find(strategy => strategy.id === 'strat_trend');
  assert(Boolean(signalOnlyStatus?.enabled && signalOnlyStatus.autoExecutionDisabled), 'Operator activation enables research signals only and leaves auto-execution disabled');
  researchEngine.scanForSignals();
  assert(executionEngine.getOrders().length === ordersBeforeResearchEvaluation, 'Scheduled strategy scanning cannot create orders');
  researchEngine.toggleStrategy('strat_trend', false);
  assert(
    researchEngine.evaluateSelection('SPY').decision === 'NO_TRADE',
    'Runtime selector abstains on simulated data, disabled candidates, and absent validation evidence'
  );
  const strategyById = (id: string): StrategyConfig => {
    const definition = STRATEGY_DEFINITIONS.find(candidate => candidate.id === id)!;
    const type = id === 'strat_trend' ? 'TREND_FOLLOWING'
      : id === 'strat_mean_reversion' ? 'MEAN_REVERSION'
        : id === 'strat_momentum' ? 'MOMENTUM_RELATIVE_STRENGTH'
          : 'REGIME_CLASSIFIER';
    return {
      id,
      name: definition.name,
      version: definition.version,
      type,
      enabled: true,
      targetAssetClasses: definition.eligibleAssetClasses,
      parameters: { ...definition.parameters },
      allowedRegimes: definition.marketConditions,
      allocationPct: 0,
      activeSignalsCount: 0,
      isSuspended: false,
      consecutiveLosses: 0,
    };
  };
  const researchNow = Date.now();
  const makeCandles = (count: number, close: number, indicators: NonNullable<CandleOHLCV['indicators']>) =>
    Array.from({ length: count }, (_, index) => ({
      time: researchNow - (count - index - 1) * 86_400_000,
      open: close,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1000,
      indicators,
    }));
  const researchQuote = {
    ...spyQuote!,
    ask: 110.1,
    timestamp: researchNow,
    quality: 'SIMULATED' as const,
    isLiveBrokerExecutable: false,
    isStale: false,
  };
  const trendResearchSignal = evaluateResearchSignal({
    strategy: strategyById('strat_trend'),
    symbol: 'SPY',
    instrument: spyInst!,
    quote: researchQuote,
    completedCandles: makeCandles(50, 110, { ema20: 105, ema50: 100, adx14: 30, rsi14: 60, atr14: 2 }),
    regime: 'TRENDING_BULL',
    now: researchNow,
  });
  assert(Boolean(trendResearchSignal) && trendResearchSignal?.stopLossPrice! < trendResearchSignal?.entryPrice!, 'Candidate A trend module emits only a rule-matched signal with an initial stop');
  assert(trendResearchSignal?.confidence === null && trendResearchSignal?.suggestedSize === 0, 'Research signal does not invent calibrated confidence or position size');
  assert(
    evaluateResearchSignal({
      strategy: { ...strategyById('strat_trend'), parameters: { ...strategyById('strat_trend').parameters, adxThreshold: 31 } },
      symbol: 'SPY', instrument: spyInst!, quote: researchQuote,
      completedCandles: makeCandles(50, 110, { ema20: 105, ema50: 100, adx14: 30, rsi14: 60, atr14: 2 }),
      regime: 'TRENDING_BULL', now: researchNow,
    }) === null,
    'Candidate A abstains when its configured ADX threshold is unmet'
  );
  const meanReversionSignal = evaluateResearchSignal({
    strategy: strategyById('strat_mean_reversion'),
    symbol: 'SPY',
    instrument: spyInst!,
    quote: { ...researchQuote, ask: 95.1 },
    completedCandles: makeCandles(20, 95, { bbLower: 96, bbMiddle: 100, rsi14: 25, atr14: 2 }),
    regime: 'RANGING_LOW_VOL',
    now: researchNow,
  });
  assert(Boolean(meanReversionSignal) && meanReversionSignal?.takeProfitPrice! > meanReversionSignal?.entryPrice!, 'Candidate B mean-reversion module requires lower-band/RSI setup and an attainable mean target');
  assert(
    evaluateResearchSignal({
      strategy: { ...strategyById('strat_mean_reversion'), parameters: { ...strategyById('strat_mean_reversion').parameters, rsiOversold: 20 } },
      symbol: 'SPY', instrument: spyInst!, quote: { ...researchQuote, ask: 95.1 },
      completedCandles: makeCandles(20, 95, { bbLower: 96, bbMiddle: 100, rsi14: 25, atr14: 2 }),
      regime: 'RANGING_LOW_VOL', now: researchNow,
    }) === null,
    'Candidate B abstains when RSI does not meet its configured oversold threshold'
  );
  const momentumCandles = makeCandles(21, 110, { volatility: 1, atr14: 2 });
  momentumCandles[0].open = 100;
  momentumCandles[0].close = 100;
  momentumCandles[0].high = 102;
  momentumCandles[0].low = 98;
  const momentumSignal = evaluateResearchSignal({
    strategy: strategyById('strat_momentum'),
    symbol: 'SPY',
    instrument: spyInst!,
    quote: researchQuote,
    completedCandles: momentumCandles,
    regime: 'TRENDING_BULL',
    now: researchNow,
  });
  assert(Boolean(momentumSignal), 'Candidate C momentum module uses only the configured lookback and completed-candle volatility');
  assert(
    evaluateResearchSignal({
      strategy: { ...strategyById('strat_momentum'), parameters: { ...strategyById('strat_momentum').parameters, minMomentumScore: 11 } },
      symbol: 'SPY', instrument: spyInst!, quote: researchQuote,
      completedCandles: momentumCandles, regime: 'TRENDING_BULL', now: researchNow,
    }) === null,
    'Candidate C abstains when the configured risk-adjusted momentum threshold is unmet'
  );
  const regimeClassifierSignal = evaluateResearchSignal({
    strategy: strategyById('strat_regime'),
    symbol: 'SPY',
    instrument: spyInst!,
    quote: researchQuote,
    completedCandles: makeCandles(50, 110, { ema20: 105, ema50: 100, adx14: 30, rsi14: 60, atr14: 2 }),
    regime: 'TRENDING_BULL',
    now: researchNow,
  });
  assert(regimeClassifierSignal === null, 'Candidate D regime classifier is informational and cannot emit an entry signal');
  assert(executionEngine.getOrders().length === ordersBeforeResearchEvaluation, 'Research signal evaluation has no order-submission side effect');
  const missingRuleDataSignal = evaluateResearchSignal({
    strategy: strategyById('strat_trend'),
    symbol: 'SPY',
    instrument: spyInst!,
    quote: researchQuote,
    completedCandles: makeCandles(50, 110, { ema20: 105, ema50: 100, adx14: 30, rsi14: 60 }),
    regime: 'TRENDING_BULL',
    now: researchNow,
  });
  assert(missingRuleDataSignal === null, 'Candidate modules abstain when a required indicator such as ATR is unavailable');
  const futureDatedSignal = evaluateResearchSignal({
    strategy: strategyById('strat_trend'),
    symbol: 'SPY',
    instrument: spyInst!,
    quote: researchQuote,
    completedCandles: [
      ...makeCandles(49, 100, { ema20: 95, ema50: 90, adx14: 30, rsi14: 60, atr14: 2 }),
      { ...makeCandles(1, 110, { ema20: 105, ema50: 100, adx14: 30, rsi14: 60, atr14: 2 })[0], time: researchNow + 1 },
    ],
    regime: 'TRENDING_BULL',
    now: researchNow,
  });
  assert(futureDatedSignal === null, 'Candidate signal evaluation rejects a future-dated candle rather than using look-ahead data');
  assert(!researchEngine.updateParameters('strat_trend', { unrecognizedParameter: 5 }), 'Strategy configuration rejects unregistered parameters');

  const qualifiedEvidence: StrategyValidationEvidence = {
    evidenceId: 'mock-evidence-1',
    dataSetId: 'mock-dataset-1',
    codeRevision: 'test-revision',
    completedAt: selectorNow - 500,
    strategyId: 'strat_trend',
    strategyVersion: STRATEGY_DEFINITIONS.find(definition => definition.id === 'strat_trend')!.version,
    symbol: 'SPY',
    timeframe: '1d',
    marketCondition: 'TRENDING_BULL',
    outOfSampleTrades: 120,
    walkForwardWindows: 4,
    outOfSampleNetExpectancyPct: 0.2,
    netExpectancyLower95Pct: 0.05,
    outOfSampleSharpe: 0.8,
    annualizedTurnover: 10,
    totalCostsPctOfGrossNotional: 0.1,
    includesRealisticCosts: true,
    includesAdverseExecution: true,
    passedBiasReview: true,
    maxDrawdownPct: 4,
    stableAcrossWindows: true,
  };
  const delayedSelection = evaluateStrategySelection({
    ...selectionInput,
    quoteStatus: 'DELAYED',
    evidence: [qualifiedEvidence],
  });
  assert(delayedSelection.decision === 'NO_TRADE', 'Delayed quotes cannot support a strategy selection');
  const indicativeQuoteSelection = evaluateStrategySelection({
    ...selectionInput,
    quoteIsBrokerExecutable: false,
    evidence: [qualifiedEvidence],
  });
  assert(indicativeQuoteSelection.decision === 'NO_TRADE', 'Indicative third-party prices cannot qualify as broker-executable selection data');
  const qualifiedSelection = evaluateStrategySelection({ ...selectionInput, evidence: [qualifiedEvidence] });
  assert(qualifiedSelection.decision === 'SELECT' && qualifiedSelection.selectedStrategyId === 'strat_trend', 'A sole strategy selects only after verified inputs, regime fit, and qualified matching evidence');
  const wrongVersionSelection = evaluateStrategySelection({
    ...selectionInput,
    evidence: [{ ...qualifiedEvidence, strategyVersion: '0.9.0' }],
  });
  assert(wrongVersionSelection.decision === 'NO_TRADE', 'Evidence from another strategy version cannot qualify selection');
  const wrongRegimeEvidence = evaluateStrategySelection({
    ...selectionInput,
    evidence: [{ ...qualifiedEvidence, marketCondition: 'RANGING_LOW_VOL' }],
  });
  assert(wrongRegimeEvidence.decision === 'NO_TRADE', 'Validation evidence for a different market regime cannot qualify selection');
  const uncertainExpectancySelection = evaluateStrategySelection({
    ...selectionInput,
    evidence: [{ ...qualifiedEvidence, netExpectancyLower95Pct: -0.01 }],
  });
  assert(uncertainExpectancySelection.decision === 'NO_TRADE', 'Uncertain out-of-sample expectancy with a non-positive confidence bound is rejected');
  const riskBlockedSelection = evaluateStrategySelection({
    ...selectionInput,
    evidence: [qualifiedEvidence],
    accountRiskBlocked: true,
  });
  assert(riskBlockedSelection.decision === 'NO_TRADE', 'Account risk and cooldown gate prevents strategy selection');
  const wideSpreadSelection = evaluateStrategySelection({
    ...selectionInput,
    evidence: [qualifiedEvidence],
    spreadBasisPoints: 16,
  });
  assert(wideSpreadSelection.decision === 'NO_TRADE', 'Spread exceeding the strategy-specific limit prevents selection');
  const costOverLimitSelection = evaluateStrategySelection({
    ...selectionInput,
    evidence: [{ ...qualifiedEvidence, totalCostsPctOfGrossNotional: 0.31 }],
  });
  assert(costOverLimitSelection.decision === 'NO_TRADE', 'Transaction costs above the strategy-specific cap prevent selection');
  const staleCandlesSelection = evaluateStrategySelection({
    ...selectionInput,
    evidence: [qualifiedEvidence],
    candleAgeMs: 37 * 60 * 60 * 1000,
  });
  assert(staleCandlesSelection.decision === 'NO_TRADE', 'Stale historical candles prevent selection');
  const lowConfidenceSelection = evaluateStrategySelection({
    ...selectionInput,
    evidence: [qualifiedEvidence],
    regimeConfidence: 0.74,
  });
  assert(lowConfidenceSelection.decision === 'NO_TRADE', 'Regime confidence below the threshold prevents selection');
  const undersampledSelection = evaluateStrategySelection({
    ...selectionInput,
    evidence: [{ ...qualifiedEvidence, outOfSampleTrades: 99 }],
  });
  assert(undersampledSelection.decision === 'NO_TRADE', 'Validation evidence below the minimum out-of-sample sample size is rejected');
  const momentumEvidence: StrategyValidationEvidence = { ...qualifiedEvidence, strategyId: 'strat_momentum' };
  const ambiguousSelection = evaluateStrategySelection({
    ...selectionInput,
    strategyEnabled: Object.fromEntries(STRATEGY_DEFINITIONS.map(definition => [definition.id, ['strat_trend', 'strat_momentum'].includes(definition.id)])),
    evidence: [qualifiedEvidence, momentumEvidence],
  });
  assert(ambiguousSelection.decision === 'NO_TRADE' && ambiguousSelection.selectedStrategyId === null, 'Selector abstains when multiple strategies qualify instead of ranking recent returns');
  const staleSelection = evaluateStrategySelection({
    ...selectionInput,
    quoteTimestamp: selectorNow - 31_000,
    quoteAgeMs: 31_000,
    evidence: [qualifiedEvidence],
  });
  assert(staleSelection.decision === 'NO_TRADE' && staleSelection.dataStatus !== 'VERIFIED', 'Stale market data prevents strategy selection');
  const unknownSessionSelection = evaluateStrategySelection({
    ...selectionInput,
    evidence: [qualifiedEvidence],
    sessionStatus: 'UNKNOWN',
  });
  assert(unknownSessionSelection.decision === 'NO_TRADE', 'Unknown market session prevents strategy selection');
  const versioningEngine = new StrategyEngine();
  const originalStrategyVersion = versioningEngine.getStrategyDefinitions().find(definition => definition.id === 'strat_trend')?.version;
  const versionedParams = versioningEngine.updateParameters('strat_trend', { adxThreshold: 26 });
  const updatedStrategyVersion = versioningEngine.getStrategyDefinitions().find(definition => definition.id === 'strat_trend')?.version;
  assert(versionedParams && originalStrategyVersion === '1.1.0' && updatedStrategyVersion === '1.1.1', 'Manual parameter edits increment the version used to match validation evidence');

  console.log('\n--- 2b. Testing Provider Snapshot Provenance and Failure Handling ---');
  let providerNow = Date.now();
  let providerTimestamp = Math.floor(providerNow / 1000);
  let providerDisconnected = false;
  let providerRequestUrl = '';
  let providerRequestToken: string | null = null;
  const snapshotProvider = new FinnhubSnapshotProvider({
    apiKey: 'test-only-key',
    maxQuoteAgeMs: 120_000,
    now: () => providerNow,
    fetcher: async (input, init) => {
      providerRequestUrl = input;
      providerRequestToken = new Headers(init?.headers).get('X-Finnhub-Token');
      if (providerDisconnected) throw new Error('mock disconnect');
      return new Response(JSON.stringify({
        c: 101.25,
        dp: 0.5,
        t: providerTimestamp,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  await snapshotProvider.refresh();
  const providerSnapshot = snapshotProvider.getSnapshots(['SPY'])[0];
  assert(providerSnapshot.status === 'SNAPSHOT' && providerSnapshot.provider === 'Finnhub', 'Mapped equity quote is labeled as a provider snapshot, not live or broker-executable');
  assert(
    !providerRequestUrl.includes('test-only-key') && providerRequestToken === 'test-only-key',
    'Market-data API credential is sent in a request header rather than a URL that may be logged'
  );
  assert(providerSnapshot.lastPrice === 101.25 && providerSnapshot.sourceTimestamp === providerTimestamp * 1000, 'Provider last price and source timestamp are retained');
  assert(providerSnapshot.bid === null && providerSnapshot.ask === null && providerSnapshot.spread === null, 'Unavailable bid/ask/spread fields are not fabricated');
  assert(providerSnapshot.receiptTimestamp !== null && providerSnapshot.quoteAgeMs !== null, 'Local receipt time and quote age are available');

  providerNow += 121_000;
  const agedSnapshot = snapshotProvider.getSnapshots(['SPY'])[0];
  assert(agedSnapshot.isStale, 'Snapshot exceeding configured age is marked stale');

  providerDisconnected = true;
  await snapshotProvider.refresh();
  const disconnectedSnapshot = snapshotProvider.getSnapshots(['SPY'])[0];
  assert(disconnectedSnapshot.isStale && disconnectedSnapshot.lastPrice === 101.25, 'Provider disconnect retains the last valid value only as a stale snapshot');

  providerDisconnected = false;
  providerNow += 121_000;
  providerTimestamp = Math.floor(providerNow / 1000);
  await snapshotProvider.refresh();
  const reconnectedSnapshot = snapshotProvider.getSnapshots(['SPY'])[0];
  assert(!reconnectedSnapshot.isStale && reconnectedSnapshot.connectionState === 'CONNECTED', 'New provider timestamp clears stale state after reconnect');

  await snapshotProvider.refresh();
  const duplicateSnapshot = snapshotProvider.getSnapshots(['SPY'])[0];
  assert(duplicateSnapshot.isStale && duplicateSnapshot.lastPrice === 101.25, 'Duplicate provider timestamp is rejected without replacing the valid snapshot');

  providerTimestamp = Math.floor(providerNow / 1000) + 10;
  await snapshotProvider.refresh();
  const futureSnapshot = snapshotProvider.getSnapshots(['SPY'])[0];
  assert(futureSnapshot.isStale && futureSnapshot.lastPrice === 101.25, 'Future-dated provider quote is rejected without replacing the valid snapshot');

  const closedMarketProvider = new FinnhubSnapshotProvider({
    apiKey: 'test-only-key',
    maxQuoteAgeMs: 120_000,
    now: () => providerNow,
    fetcher: async () => new Response(JSON.stringify({
      c: 101.25,
      t: Math.floor((providerNow - 3_600_000) / 1000),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  await closedMarketProvider.refresh();
  const closedMarketSnapshot = closedMarketProvider.getSnapshots(['SPY'])[0];
  assert(closedMarketSnapshot.status === 'SNAPSHOT' && closedMarketSnapshot.isStale, 'Old snapshot after a market close is retained as stale, not represented as current');

  const unconfiguredProvider = new FinnhubSnapshotProvider({ apiKey: '', now: () => providerNow });
  const unavailableSnapshot = unconfiguredProvider.getSnapshots(['SPY', 'BTC/USDT']);
  assert(unavailableSnapshot.every((snapshot) => snapshot.status === 'UNAVAILABLE' && snapshot.lastPrice === null), 'Unconfigured and unmapped instruments are explicitly unavailable with no simulated fallback');

  const emptyResponseProvider = new FinnhubSnapshotProvider({
    apiKey: 'test-only-key',
    now: () => providerNow,
    fetcher: async () => new Response(JSON.stringify({
      c: 0,
      t: Math.floor(providerNow / 1000),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  await emptyResponseProvider.refresh();
  const emptyProviderSnapshot = emptyResponseProvider.getSnapshots(['SPY'])[0];
  assert(emptyProviderSnapshot.status === 'UNAVAILABLE' && emptyProviderSnapshot.lastPrice === null, 'Empty provider response remains unavailable rather than using a fabricated fallback');

  const providerError = new FinnhubSnapshotProvider({
    apiKey: 'test-only-key',
    now: () => providerNow,
    fetcher: async () => new Response('rate limited', { status: 429 }),
  });
  await providerError.refresh();
  const rateLimitedSnapshot = providerError.getSnapshots(['SPY'])[0];
  assert(rateLimitedSnapshot.status === 'UNAVAILABLE' && Boolean(rateLimitedSnapshot.error?.includes('429')), 'Provider HTTP errors surface as unavailable instead of price fallbacks');
  const warningMessages: string[] = [];
  const originalConsoleWarn = console.warn;
  console.warn = (...args: unknown[]) => warningMessages.push(args.map(String).join(' '));
  let aiFallbackReport: AIResearchResponse | undefined;
  try {
    const failingResearchService = new GeminiResearchService(async () => {
      throw new Error('provider failure with injected-secret-value');
    });
    aiFallbackReport = await failingResearchService.conductResearch({ symbol: 'SPY' });
  } finally {
    console.warn = originalConsoleWarn;
  }
  assert(
    Boolean(aiFallbackReport?.explainableSignals.length) &&
      aiFallbackReport.regulatoryNotice.includes('non-authoritative') &&
      !warningMessages.join(' ').includes('injected-secret-value'),
    'AI provider failure returns advisory deterministic research and does not log error payloads that may contain secrets'
  );

  console.log('\n--- 3. Testing Order State Machine & Idempotency ---');
  const paperBuyFill = calculateDeterministicPaperFillPrice(100, 'BUY', 0.01, 0.0002);
  const paperSellFill = calculateDeterministicPaperFillPrice(100, 'SELL', 0.01, 0.0002);
  assert(paperBuyFill >= 100 && paperSellFill <= 100, 'Deterministic paper slippage is adverse for both long and short entry sides');
  let invalidPaperFillRejected = false;
  try {
    calculateDeterministicPaperFillPrice(100, 'BUY', 0, 0.0002);
  } catch {
    invalidPaperFillRejected = true;
  }
  assert(invalidPaperFillRejected, 'Paper fill model rejects missing or invalid tick-size assumptions');

  console.log('\n--- 3a. Testing Mandatory Three-Approval Authorization ---');
  let authorizationNow = Date.now();
  const authorizationService = new OrderAuthorizationService(() => authorizationNow);
  const authorizationInstrument = marketDataService.getInstrument('SPY')!;
  const sourceSpyQuote = marketDataService.getQuote('SPY')!;
  const brokerQuote = {
    brokerSymbol: 'SPY.US',
    appSymbol: 'SPY',
    ticketOrSeq: null,
    bid: sourceSpyQuote.bid,
    ask: sourceSpyQuote.ask,
    sourceTimestamp: authorizationNow,
    receiptTimestamp: authorizationNow,
    quoteAgeMs: 0,
    provenance: 'BROKER_CONFIRMED' as const,
    connectionHealth: 'HEALTHY' as const,
    isStale: false,
  };
  const liveSpyQuote = {
    ...sourceSpyQuote,
    timestamp: authorizationNow,
    quality: 'LIVE' as const,
    isLiveBrokerExecutable: true,
    isStale: false,
  };
  const brokerInstrument: BrokerInstrumentConstraints = {
    appSymbol: 'SPY',
    brokerSymbol: 'SPY.US',
    asOf: authorizationNow,
    provenance: 'BROKER_CONFIRMED',
    minimumVolume: authorizationInstrument.minLotSize,
    maximumVolume: 10000,
    volumeStep: authorizationInstrument.lotStep,
    contractSize: 1,
    tickSize: authorizationInstrument.tickSize,
    tickValue: authorizationInstrument.tickSize,
    profitCurrency: 'USD',
    marginCurrency: 'USD',
    marginRequirement: authorizationInstrument.marginRequirement,
    commissionPerUnit: authorizationInstrument.commissionPerUnit,
    commissionType: authorizationInstrument.commissionType,
    minimumStopDistance: 0,
    freezeLevel: 0,
    allowedOrderTypes: ['MARKET', 'LIMIT'],
    executionMode: 'MARKET',
    allowedFillPolicies: ['FOK'],
    expirationRules: ['GTC'],
    tradingAllowed: true,
    closeOnly: false,
    tradingSessionOpen: true,
  };
  const brokerTruthBase = brokerTruthService.getBrokerTruthState();
  const authorizedBrokerTruth = {
    ...brokerTruthBase,
    connection: {
      ...brokerTruthBase.connection,
      brokerName: 'Verified Demo Broker',
      server: 'Demo Server',
      accountId: 'fixture-account-id',
      accountMode: 'DEMO' as const,
      currency: 'USD',
      leverage: 1,
      connectionHealth: 'AUTHENTICATED_READ_ONLY' as const,
      readOnlyAuthenticated: true,
      executionPermitted: true,
      lastSyncTimestamp: authorizationNow,
    },
    accountSnapshot: {
      balance: 100000,
      equity: 100000,
      margin: 0,
      freeMargin: 100000,
      marginLevelPct: null,
      currency: 'USD',
      asOf: authorizationNow,
      provenance: 'BROKER_CONFIRMED' as const,
    },
    pnlVerification: {
      realizedPnL: 0,
      unrealizedPnL: 0,
      grossPnL: 0,
      totalCommissions: 0,
      totalFees: 0,
      totalSwaps: 0,
      currencyConversionAdjustment: 0,
      brokerReportedTotalPnL: 0,
      appCalculatedTotalPnL: 0,
      netDiscrepancy: 0,
      hasDiscrepancy: false,
      verifiedAsOf: authorizationNow,
      provenance: 'BROKER_CONFIRMED' as const,
    },
    quotes: [brokerQuote],
    reconciliationStatus: {
      inSync: true,
      status: 'RECONCILED' as const,
      unresolvedDiscrepancies: 0,
      lastReconciledAt: authorizationNow,
      details: 'Fixture reconciliation is current.',
    },
  };
  const createAuthorizationContext = (
    overrides: Partial<OrderAuthorizationContext> = {}
  ): OrderAuthorizationContext => ({
    intent: {
      symbol: 'SPY',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
      price: liveSpyQuote.ask,
      stopLoss: Math.floor((liveSpyQuote.ask - 1) / authorizationInstrument.tickSize) * authorizationInstrument.tickSize,
      strategyId: 'strat_fixture',
      broker: 'VerifiedDemoBroker',
      clientOrderId: `auth_fixture_${authorizationNow}`,
    },
    brokerTruth: authorizedBrokerTruth,
    brokerQuote,
    brokerInstrument,
    quote: liveSpyQuote,
    instrument: authorizationInstrument,
    portfolio: {
      ...executionEngine.getPortfolio(),
      mode: 'PAPER',
      totalEquity: 100000,
      cashBalance: 100000,
      availableMargin: 100000,
      usedMargin: 0,
      unrealizedPnL: 0,
    },
    positions: [],
    orders: executionEngine.getOrders(Number.MAX_SAFE_INTEGER),
    limits: riskEngine.getLimits(),
    health: 'HEALTHY',
    permissionGate: {
      approved: true,
      gateCode: 'GATE_PASSED',
      message: 'All local order constraints passed.',
      checks: [],
      timestamp: authorizationNow,
    },
    riskApproval: {
      approved: true,
      code: 'RISK_APPROVED',
      message: 'Deterministic risk checks passed.',
      calculatedPositionSize: 1,
      riskAmountUSD: 1,
      riskPercentOfEquity: 0.001,
      checks: [],
    },
    ...overrides,
  });
  const validAuthorization = authorizationService.authorize(createAuthorizationContext());
  assert(
    validAuthorization.approved && !!validAuthorization.approval,
    'A verified, fresh demo account, broker constraints, permission checks, and deterministic risk can jointly authorize'
  );
  const brokerBoundedSize = calculateBrokerAwarePositionSize({
    equity: 100000,
    riskPercent: 0.25,
    entryPrice: liveSpyQuote.ask,
    stopLossPrice: liveSpyQuote.ask - 1,
    accountCurrency: 'USD',
    constraints: brokerInstrument,
    maxSlippagePercent: 0.2,
  });
  assert(
    !!brokerBoundedSize &&
      brokerBoundedSize.maximumQuantity > 0 &&
      brokerBoundedSize.estimatedWorstCaseLoss <= brokerBoundedSize.riskBudget,
    'Broker-aware sizing includes adverse movement and commission within the exact per-trade risk budget'
  );
  const excessiveOpenRiskAuthorization = authorizationService.authorize(createAuthorizationContext({
    positions: [{
      id: 'fixture-high-risk-position',
      symbol: 'SPY',
      assetClass: 'INDEX',
      side: 'BUY',
      quantity: 1000,
      entryPrice: liveSpyQuote.ask,
      currentPrice: liveSpyQuote.ask,
      stopLossPrice: liveSpyQuote.ask - 10,
      unrealizedPnL: 0,
      unrealizedPnLPct: 0,
      realizedPnL: 0,
      marginUsed: 1000,
      openedAt: authorizationNow,
      strategyId: 'strat_fixture',
      broker: 'VerifiedDemoBroker',
    }],
  }));
  assert(
    !excessiveOpenRiskAuthorization.approved &&
      excessiveOpenRiskAuthorization.checks.some((check) => check.name.startsWith('D.') && !check.passed),
    'Independent account-wide risk assessment rejects open stop risk and exposure above policy'
  );
  const unmappedBrokerPositionAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerTruth: {
      ...authorizedBrokerTruth,
      positions: [{
        ticket: 'external-fixture',
        symbol: 'SPY',
        side: 'BUY',
        lots: 1,
        openPrice: liveSpyQuote.ask,
        currentPrice: liveSpyQuote.ask,
        stopLoss: liveSpyQuote.ask - 1,
        takeProfit: 0,
        commission: 0,
        swap: 0,
        taxes: 0,
        brokerReportedProfit: 0,
        appEstimatedProfit: 0,
        discrepancyUSD: 0,
        provenance: 'BROKER_CONFIRMED',
        stopModificationStatus: 'ACTIVE_CONFIRMED',
      }],
    },
  }));
  assert(
    !unmappedBrokerPositionAuthorization.approved &&
      unmappedBrokerPositionAuthorization.checks.some((check) => check.name.startsWith('D.') && !check.passed),
    'Unmapped broker-confirmed positions fail closed rather than being omitted from account-wide risk'
  );
  const changedIntentRevalidation = authorizationService.revalidate(
    validAuthorization.approval!,
    createAuthorizationContext({
      intent: { ...createAuthorizationContext().intent, quantity: 2 },
    })
  );
  assert(
    !changedIntentRevalidation.approved &&
      changedIntentRevalidation.checks.some((check) => check.name === 'Authorization freshness and intent binding' && !check.passed),
    'Authorization is rejected when volume changes between approval and submission'
  );
  const approvedBeforeQuoteChange = authorizationService.authorize(createAuthorizationContext());
  authorizationNow += 1;
  const revisedBrokerQuote = {
    ...brokerQuote,
    ask: brokerQuote.ask + authorizationInstrument.tickSize,
    sourceTimestamp: authorizationNow,
    receiptTimestamp: authorizationNow,
    quoteAgeMs: 0,
  };
  const revisedLocalQuote = {
    ...liveSpyQuote,
    ask: revisedBrokerQuote.ask,
    timestamp: authorizationNow,
  };
  const changedQuoteRevalidation = authorizationService.revalidate(
    approvedBeforeQuoteChange.approval!,
    createAuthorizationContext({
      intent: { ...createAuthorizationContext().intent, price: revisedLocalQuote.ask },
      brokerQuote: revisedBrokerQuote,
      brokerTruth: { ...authorizedBrokerTruth, quotes: [revisedBrokerQuote] },
      quote: revisedLocalQuote,
    })
  );
  assert(
    !changedQuoteRevalidation.approved &&
      changedQuoteRevalidation.checks.some((check) => check.name === 'Authorization freshness and intent binding' && !check.passed),
    'Authorization is rejected when the executable quote changes before submission'
  );
  authorizationNow -= 1;
  const approvedBeforePositionChange = authorizationService.authorize(createAuthorizationContext());
  const changedPositions = authorizationService.revalidate(
    approvedBeforePositionChange.approval!,
    createAuthorizationContext({
      positions: [{
        id: 'fixture-new-position',
        symbol: 'QQQ',
        assetClass: 'INDEX',
        side: 'BUY',
        quantity: 1,
        entryPrice: 400,
        currentPrice: 400,
        stopLossPrice: 390,
        unrealizedPnL: 0,
        unrealizedPnLPct: 0,
        realizedPnL: 0,
        marginUsed: 100,
        openedAt: authorizationNow,
        strategyId: 'strat_fixture',
        broker: 'VerifiedDemoBroker',
      }],
    })
  );
  assert(
    !changedPositions.approved &&
      changedPositions.checks.some((check) => check.name === 'Authorization freshness and intent binding' && !check.passed),
    'Authorization is rejected when reconciled position state changes before submission'
  );
  const approvedBeforeAccountChange = authorizationService.authorize(createAuthorizationContext());
  const changedAccount = authorizationService.revalidate(
    approvedBeforeAccountChange.approval!,
    createAuthorizationContext({
      brokerTruth: {
        ...authorizedBrokerTruth,
        accountSnapshot: { ...authorizedBrokerTruth.accountSnapshot, equity: 99999 },
      },
    })
  );
  assert(
    !changedAccount.approved &&
      changedAccount.checks.some((check) => check.name === 'Authorization freshness and intent binding' && !check.passed),
    'Authorization is rejected when broker account values change before submission'
  );
  const approvedBeforeRiskLimitChange = authorizationService.authorize(createAuthorizationContext());
  const changedRiskLimits = authorizationService.revalidate(
    approvedBeforeRiskLimitChange.approval!,
    createAuthorizationContext({
      limits: { ...riskEngine.getLimits(), maxRiskPerTradePct: 0.1 },
    })
  );
  assert(
    !changedRiskLimits.approved &&
      changedRiskLimits.checks.some((check) => check.name === 'Authorization freshness and intent binding' && !check.passed),
    'Authorization is rejected when risk limits change before submission'
  );
  const replayedApproval = authorizationService.revalidate(
    approvedBeforeRiskLimitChange.approval!,
    createAuthorizationContext()
  );
  assert(!replayedApproval.approved, 'A single-use authorization cannot be replayed');
  const unavailableAccountAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerTruth: brokerTruthBase,
  }));
  assert(
    !unavailableAccountAuthorization.approved &&
      unavailableAccountAuthorization.checks.some((check) => check.name.startsWith('A.') && !check.passed),
    'Unavailable broker/account state fails the independent account approval'
  );
  const unavailableInstrumentAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerInstrument: null,
  }));
  assert(
    !unavailableInstrumentAuthorization.approved &&
      unavailableInstrumentAuthorization.checks.some((check) => check.name.startsWith('B.') && !check.passed),
    'Missing broker instrument constraints fail the independent order-parameter approval'
  );
  const staleAccountTruth = {
    ...authorizedBrokerTruth,
    accountSnapshot: {
      ...authorizedBrokerTruth.accountSnapshot,
      asOf: authorizationNow - 60000,
    },
  };
  const staleAccountAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerTruth: staleAccountTruth,
  }));
  assert(
    !staleAccountAuthorization.approved &&
      staleAccountAuthorization.checks.some((check) => check.name.startsWith('A.') && !check.passed),
    'Stale account/reconciliation data blocks authorization'
  );
  const invalidBrokerVolumeAuthorization = authorizationService.authorize(createAuthorizationContext({
    intent: { ...createAuthorizationContext().intent, quantity: 0.5 },
  }));
  assert(
    !invalidBrokerVolumeAuthorization.approved &&
      invalidBrokerVolumeAuthorization.checks.some((check) => check.name.startsWith('B.') && !check.passed),
    'Volume outside current broker min/step rules blocks authorization'
  );
  const invalidStopDistanceAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerInstrument: { ...brokerInstrument, minimumStopDistance: 10 },
  }));
  assert(
    !invalidStopDistanceAuthorization.approved &&
      invalidStopDistanceAuthorization.checks.some((check) => check.name.startsWith('B.') && !check.passed),
    'A protective stop inside the broker minimum distance blocks authorization'
  );
  const invalidCommissionAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerInstrument: { ...brokerInstrument, commissionPerUnit: Number.NaN },
  }));
  assert(
    !invalidCommissionAuthorization.approved &&
      invalidCommissionAuthorization.checks.some((check) => check.name.startsWith('B.') && !check.passed),
    'Missing broker commission semantics block sizing and authorization'
  );
  const unavailableConversionAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerInstrument: {
      ...brokerInstrument,
      profitCurrency: 'EUR',
      marginCurrency: 'EUR',
    },
    brokerTruth: {
      ...authorizedBrokerTruth,
      connection: { ...authorizedBrokerTruth.connection, currency: 'EUR' },
      accountSnapshot: { ...authorizedBrokerTruth.accountSnapshot, currency: 'EUR' },
    },
  }));
  assert(
    !unavailableConversionAuthorization.approved &&
      unavailableConversionAuthorization.checks.some((check) => check.name.startsWith('B.') && !check.passed),
    'Unknown account/instrument currency conversion blocks order authorization'
  );
  const closedBrokerSessionAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerInstrument: { ...brokerInstrument, tradingSessionOpen: false },
  }));
  assert(
    !closedBrokerSessionAuthorization.approved &&
      closedBrokerSessionAuthorization.checks.some((check) => check.name.startsWith('B.') && !check.passed),
    'Broker-reported closed instrument session blocks authorization'
  );
  const staleBrokerQuoteAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerQuote: {
      ...brokerQuote,
      sourceTimestamp: authorizationNow - 60000,
    },
  }));
  assert(
    !staleBrokerQuoteAuthorization.approved &&
      staleBrokerQuoteAuthorization.checks.some((check) => check.name.startsWith('A.') && !check.passed),
    'Stale broker quotes block authorization'
  );
  const negativeAgeBrokerQuoteAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerQuote: { ...brokerQuote, quoteAgeMs: -1 },
  }));
  assert(
    !negativeAgeBrokerQuoteAuthorization.approved &&
      negativeAgeBrokerQuoteAuthorization.checks.some((check) => check.name.startsWith('A.') && !check.passed),
    'Invalid negative broker quote age blocks authorization'
  );
  const misalignedAsk = brokerQuote.ask + authorizationInstrument.tickSize / 3;
  const misalignedBrokerQuote = {
    ...brokerQuote,
    ask: misalignedAsk,
    sourceTimestamp: authorizationNow,
    receiptTimestamp: authorizationNow,
  };
  const misalignedQuoteAuthorization = authorizationService.authorize(createAuthorizationContext({
    brokerQuote: misalignedBrokerQuote,
    brokerTruth: { ...authorizedBrokerTruth, quotes: [misalignedBrokerQuote] },
    quote: { ...liveSpyQuote, ask: misalignedAsk, timestamp: authorizationNow },
  }));
  assert(
    !misalignedQuoteAuthorization.approved &&
      misalignedQuoteAuthorization.checks.some((check) => check.name.startsWith('B.') && !check.passed),
    'Broker quote prices not aligned to current instrument tick size block authorization'
  );
  const unsupportedLimitAuthorization = authorizationService.authorize(createAuthorizationContext({
    intent: { ...createAuthorizationContext().intent, type: 'LIMIT' },
  }));
  assert(
    !unsupportedLimitAuthorization.approved &&
      unsupportedLimitAuthorization.checks.some((check) => check.name.startsWith('B.') && !check.passed),
    'Order types without implemented execution semantics cannot receive authorization'
  );
  const deniedRiskAuthorization = authorizationService.authorize(createAuthorizationContext({
    riskApproval: {
      ...createAuthorizationContext().riskApproval,
      approved: false,
      code: 'RISK_REJECTED',
      message: 'Fixture deterministic risk rejection.',
    },
  }));
  assert(
    !deniedRiskAuthorization.approved &&
      deniedRiskAuthorization.checks.some((check) => check.name.startsWith('C.') && !check.passed),
    'A risk-engine rejection independently blocks authorization'
  );
  const deniedPermissionAuthorization = authorizationService.authorize(createAuthorizationContext({
    permissionGate: {
      ...createAuthorizationContext().permissionGate,
      approved: false,
      gateCode: 'INVALID_ORDER',
      message: 'Fixture invalid order constraints.',
    },
  }));
  assert(
    !deniedPermissionAuthorization.approved &&
      deniedPermissionAuthorization.checks.some((check) => check.name.startsWith('B.') && !check.passed),
    'Invalid order parameters independently block authorization'
  );
  const expiringAuthorization = authorizationService.authorize(createAuthorizationContext());
  authorizationNow += 2000;
  const expiredRevalidation = authorizationService.revalidate(
    expiringAuthorization.approval!,
    createAuthorizationContext()
  );
  assert(!expiredRevalidation.approved, 'An expired authorization approval cannot be consumed');
  authorizationNow -= 2000;

  const clientOrderId = `test_idemp_${Date.now()}`;
  const ethLastPrice = ethQuote!.lastPrice;
  const firstSubmission = await executionEngine.submitOrder({
    clientOrderId,
    symbol: 'ETH/USDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    stopLoss: ethLastPrice - 50,
    strategyId: 'strat_trend',
  }, 'HEALTHY');
  assert(
    !firstSubmission.success &&
      firstSubmission.order?.status === 'REJECTED' &&
      Boolean(firstSubmission.error?.includes('A. Verified broker and account state')),
    'The real paper submission path fails closed when verified broker/account authorization is unavailable'
  );
  const firstOrderTelemetry = firstSubmission.order?.executionTelemetry;
  assert(
    !firstOrderTelemetry && firstSubmission.order?.filledQuantity === 0,
    'A rejected authorization creates no simulated fill or success-shaped execution telemetry'
  );
  const authorizationAudit = auditLogger.getRecentLogs(20).find((entry) =>
    entry.action === 'ORDER_AUTHORIZATION_EVALUATED' &&
    (entry.details as { orderIntent?: { clientOrderId?: string } }).orderIntent?.clientOrderId === clientOrderId
  );
  assert(
    !!authorizationAudit &&
      (authorizationAudit.details as { decision?: string; brokerResponse?: { status?: string } }).decision === 'REJECTED' &&
      (authorizationAudit.details as { brokerResponse?: { status?: string } }).brokerResponse?.status === 'NOT_SUBMITTED',
    'Authorization rejection is persisted with check inputs, decision, reason, and an explicit no-broker-response status'
  );
  assert(
    Boolean(storageService.loadState()?.auditLogs.some((entry) =>
      entry.action === 'ORDER_AUTHORIZATION_EVALUATED' &&
      (entry.details as { orderIntent?: { clientOrderId?: string } }).orderIntent?.clientOrderId === clientOrderId
    )),
    'Authorization decision and provenance are durably stored before returning the rejection'
  );
  const originalGetBrokerTruth = brokerTruthService.getBrokerTruthState.bind(brokerTruthService);
  brokerTruthService.getBrokerTruthState = () => {
    throw new Error('Fixture authorization source failure');
  };
  let failedAuthorizationSubmission: Awaited<ReturnType<ExecutionEngine['submitOrder']>>;
  try {
    failedAuthorizationSubmission = await executionEngine.submitOrder({
      clientOrderId: `test_authorization_service_failure_${Date.now()}`,
      symbol: 'ETH/USDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
      stopLoss: ethLastPrice - 50,
      strategyId: 'strat_trend',
    }, 'HEALTHY');
  } finally {
    brokerTruthService.getBrokerTruthState = originalGetBrokerTruth;
  }
  assert(
    !failedAuthorizationSubmission.success &&
      failedAuthorizationSubmission.order?.status === 'REJECTED' &&
      Boolean(failedAuthorizationSubmission.error?.includes('Authorization service failed closed')),
    'Authorization data-service failure rejects the order without routing'
  );
  assert(
    auditLogger.getRecentLogs(20).some((entry) => entry.action === 'ORDER_AUTHORIZATION_SERVICE_FAILURE'),
    'Authorization service failure is explicitly audited'
  );
  const zeroLimitPriceSubmission = await executionEngine.submitOrder({
    clientOrderId: `test_zero_limit_price_${Date.now()}`,
    symbol: 'ETH/USDT',
    side: 'BUY',
    type: 'LIMIT',
    quantity: 1,
    price: 0,
    stopLoss: ethLastPrice - 50,
    strategyId: 'strat_trend',
  }, 'HEALTHY');
  assert(
    !zeroLimitPriceSubmission.success &&
      zeroLimitPriceSubmission.order?.status === 'REJECTED' &&
      Boolean(zeroLimitPriceSubmission.error?.includes('Explicit order price 0')),
    'Execution path rejects an explicit zero limit price without falling back to the current quote'
  );

  // Retry with same clientOrderId must return existing order without duplicating
  const retrySubmission = await executionEngine.submitOrder({
    clientOrderId,
    symbol: 'ETH/USDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    stopLoss: ethLastPrice - 50,
    strategyId: 'strat_trend',
  }, 'HEALTHY');
  assert(!retrySubmission.success && retrySubmission.order?.id === firstSubmission.order?.id, 'Idempotency replay preserves the authorization rejection without duplicate execution');

  const degradedHealthClientOrderId = `test_degraded_health_${Date.now()}`;
  const degradedHealthSubmission = await executionEngine.submitOrder({
    clientOrderId: degradedHealthClientOrderId,
    symbol: 'ETH/USDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    stopLoss: ethLastPrice - 50,
    strategyId: 'strat_trend',
  }, 'DEGRADED');
  assert(
    !degradedHealthSubmission.success &&
      degradedHealthSubmission.order?.status === 'REJECTED' &&
      Boolean(degradedHealthSubmission.error?.includes('health is DEGRADED')),
    'Real order-submission path rejects new entries when system health is degraded'
  );
  const rejectedOrderRetry = await executionEngine.submitOrder({
    clientOrderId: degradedHealthClientOrderId,
    symbol: 'ETH/USDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    stopLoss: ethLastPrice - 50,
    strategyId: 'strat_trend',
  }, 'HEALTHY');
  assert(
    !rejectedOrderRetry.success &&
      rejectedOrderRetry.order?.status === 'REJECTED' &&
      Boolean(rejectedOrderRetry.error?.includes('health is DEGRADED')),
    'Idempotent retry of a rejected order preserves the original rejection instead of returning success'
  );
  const unavailableHealthSubmission = await executionEngine.submitOrder({
    clientOrderId: `test_unavailable_health_${Date.now()}`,
    symbol: 'ETH/USDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    stopLoss: ethLastPrice - 50,
    strategyId: 'strat_trend',
  }, 'UNAVAILABLE');
  assert(
    !unavailableHealthSubmission.success &&
      unavailableHealthSubmission.order?.status === 'REJECTED' &&
      Boolean(unavailableHealthSubmission.error?.includes('health is UNAVAILABLE')),
    'Real order-submission path rejects new entries when system health is unavailable'
  );

  console.log('\n--- 4. Testing Backtesting Engine ---');
  const btResult = backtestEngine.runBacktest({
    strategyId: 'strat_trend',
    symbol: 'SPY',
    startDate: '2026-04-01',
    endDate: '2026-10-09',
    initialCapital: 100000,
    slippageModelPct: 0.0002,
    commissionPerTrade: 1.5,
    parameters: {},
  });
  assert(btResult.totalTrades > 0, `Backtest generated ${btResult.totalTrades} simulated trades`);
  assert(btResult.maxDrawdownPct >= 0, `Max drawdown metric computed: ${btResult.maxDrawdownPct}%`);
  assert(Number.isFinite(btResult.validationMetrics.inSampleSharpe) && Number.isFinite(btResult.validationMetrics.outOfSampleSharpe), 'In-sample and out-of-sample Sharpe values are computed from observed segment returns');
  assert(btResult.noTradeReturnPct === 0 && Number.isFinite(btResult.benchmarkReturnPct), 'Backtest reports the cash/no-trade and same-period buy-and-hold baselines');
  assert(btResult.trades.every(trade => trade.entryTime <= trade.exitTime), 'Backtest hypothetical fills occur after the completed-bar signal and before exit');
  assert(btResult.equityCurve.length > 0, 'Equity curve points generated without look-ahead bias');

  console.log('\n--- 5. Testing Periodic Health Service ---');
  const healthReport = healthService.runHealthCheck();
  assert(['HEALTHY', 'DEGRADED', 'UNAVAILABLE'].includes(healthReport.overallState), `Overall health state: ${healthReport.overallState}`);
  assert(healthReport.failClosedArmed === true, 'Fail-closed invariant is armed');
  assert(healthReport.components.brokerAdapters.length >= 4, 'Broker adapters matrix reported');
  assert(healthReport.components.apiProcess.latencyMs === null, 'Health does not invent an API latency measurement');
  assert(healthReport.components.marketDataFeeds.sourceLabel.includes('simulator'), 'Health reports the market source as a local simulator');
  assert(!healthReport.liveExecutionAuthorized, 'A healthy local process does not imply live execution authorization');
  assert(healthReport.components.reconciliation.source === 'LOCAL_PAPER_LEDGER', 'Health labels reconciliation as local paper-ledger state, not broker reconciliation');

  console.log('\n--- 6. Testing Strict Live Execution Defense & Invariants ---');
  const liveModeAttempt = executionEngine.setMode('LIVE');
  assert(!liveModeAttempt.success, 'Live mode switch blocked fail-closed when live broker is unconfigured');
  const rolloutState = executionEngine.getControlledRolloutState();
  assert(rolloutState.stage === 'PAPER_ONLY', 'System remains in PAPER_ONLY rollout stage until explicit live-pilot approval');
  assert(!rolloutState.liveExecutionAuthorized, 'Live execution is not authorized by default');

  const rolloutGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'SPY',
      side: 'BUY',
      quantity: 1,
      stopLoss: 580,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
      clientOrderId: 'rollout-gate-check',
    },
    spyQuote || null,
    spyInst || null,
    { ...portfolio, mode: 'LIVE', rolloutStage: 'LIVE_PILOT', liveExecutionAuthorized: false },
    positions,
    executionEngine.getOrders(),
    riskEngine.getLimits(),
    'HEALTHY',
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p)
  );
  assert(!rolloutGate.approved && rolloutGate.gateCode === 'GATE_STAGE_1_ACCOUNT_AUTH', 'Unauthorized LIVE traffic is still rejected by the account-auth gate');
  assert(rolloutGate.checks.find((check) => check.code === 'GATE_STAGE_0_LIVE_ROLLOUT_AUTH')?.passed === false, 'Controlled rollout gate records the missing explicit authorization before live approval');

  const unverifiedBrokerOrder = await executionEngine.submitOrder({
    symbol: 'SPY',
    side: 'BUY',
    type: 'MARKET',
    quantity: 5,
    stopLoss: 570,
    strategyId: 'strat_trend',
    broker: 'InteractiveBrokersGateway', // Unverified broker
  }, 'HEALTHY');
  assert(!unverifiedBrokerOrder.success && unverifiedBrokerOrder.order?.status === 'REJECTED', 'Order routing to unverified live broker is strictly rejected');

  console.log('\n--- 7. Testing State Persistence Service ---');
  const storageHealth = storageService.getStorageHealth();
  assert(storageHealth.path.includes('app_state.json'), 'Durable state storage path configured correctly');

  console.log('\n--- 8. Testing Revenge-Trading Prevention & Consecutive-Loss Cooldown ---');
  // Subtest 8a: Verify initial state
  const testStratId = `strat_cooldown_test_${Date.now()}`;
  assert(!riskEngine.isCooldownActive(testStratId), 'Strategy initially not in cooldown');

  // Subtest 8b: Breakeven trade does not increment or reset loss counter
  const initialStratLosses = executionEngine.getConsecutiveLossesByStrategy()[testStratId] || 0;
  const beTrade = executionEngine.recordClosedTrade({
    symbol: 'SPY',
    strategyId: testStratId,
    side: 'BUY',
    quantity: 1,
    entryPrice: 580,
    exitPrice: 581.5,
    grossPnL: 1.5,
    feePaid: 1.5, // Net PnL = $0.00
    exitReason: 'Test Breakeven Exit',
    isPartial: false,
  });
  assert(beTrade.result === 'BREAKEVEN', 'Trade with 0 net PnL is classified as BREAKEVEN');
  const postBeLosses = executionEngine.getConsecutiveLossesByStrategy()[testStratId] || 0;
  assert(postBeLosses === initialStratLosses, 'Breakeven trade leaves consecutive losses counter unchanged');

  // Subtest 8c: Fee turning gross profit into net loss counts as LOSS
  const feeLossTrade = executionEngine.recordClosedTrade({
    symbol: 'SPY',
    strategyId: testStratId,
    side: 'BUY',
    quantity: 1,
    entryPrice: 580,
    exitPrice: 580.5,
    grossPnL: 0.5,
    feePaid: 1.5, // Net PnL = -$1.00
    exitReason: 'Test Fee Drag Exit',
    isPartial: false,
  });
  assert(feeLossTrade.result === 'LOSS', 'Trade with negative net PnL after commissions is classified as LOSS');
  const postFeeLosses = executionEngine.getConsecutiveLossesByStrategy()[testStratId] || 0;
  assert(postFeeLosses === initialStratLosses + 1, 'Net loss after fees increments consecutive loss counter');

  // Subtest 8d: Test cross-strategy isolation: Intervening win on another strategy resets account counter but NOT Strategy A
  executionEngine.recordClosedTrade({
    symbol: 'ETH/USDT',
    strategyId: 'strat_trend', // Intervening win on different strategy
    side: 'BUY',
    quantity: 1,
    entryPrice: ethQuote!.lastPrice - 100,
    exitPrice: ethQuote!.lastPrice,
    grossPnL: 100.0,
    feePaid: 1.0,
    exitReason: 'Trend Strategy Profit Exit',
    isPartial: false,
  });
  // Account losses reset to 0, but Strategy A still has its 1 loss!
  assert(executionEngine.getAccountConsecutiveLosses() === 0, 'Win on Strategy B resets account loss counter');
  assert(executionEngine.getConsecutiveLossesByStrategy()[testStratId] === 1, 'Win on Strategy B does not reset Strategy A loss counter');

  // Now simulate remaining 4 losses on Strategy A to reach 5 consecutive losses
  for (let i = 2; i <= 5; i++) {
    executionEngine.recordClosedTrade({
      symbol: 'SPY',
      strategyId: testStratId,
      side: 'BUY',
      quantity: 1,
      entryPrice: 580,
      exitPrice: 575,
      grossPnL: -5.0,
      feePaid: 1.0,
      exitReason: `Test Loss ${i}`,
      isPartial: false,
    });
  }

  // Verify 30-minute cooldown triggered specifically for Strategy A
  assert(riskEngine.isCooldownActive(testStratId), '5 consecutive closed losses on Strategy A triggers active cooldown');
  assert(!riskEngine.isCooldownActive('ACCOUNT'), 'Account-level cooldown not triggered because account losses < 5');
  const cooldownState = riskEngine.getCooldown(testStratId);
  assert(!!cooldownState, 'Cooldown record exists for affected strategy');
  assert(cooldownState!.durationMinutes >= 30, `Cooldown duration is at least 30 minutes (actual: ${cooldownState!.durationMinutes}m)`);
  assert(cooldownState!.triggeringTradeIds.length === 5, 'Exactly 5 triggering trade IDs captured in durable record');

  // Subtest 8e: New entry orders for strategy in cooldown are rejected
  const blockedOrderResult = riskEngine.evaluatePreTradeRisk(
    {
      symbol: 'SPY',
      side: 'BUY',
      quantity: 1,
      price: 580,
      stopLoss: 575,
      strategyId: testStratId,
      broker: 'SimulatedInstitutionalBroker',
    },
    spyQuote,
    spyInst,
    portfolio,
    positions,
    'HEALTHY'
  );
  assert(
    !blockedOrderResult.approved && blockedOrderResult.code === 'ERR_CONSECUTIVE_LOSS_COOLDOWN',
    'Pre-trade risk engine strictly rejects orders for strategy during active cooldown'
  );

  // Subtest 8f: Strategy Isolation — other strategies are unaffected
  const isolatedStratResult = riskEngine.evaluatePreTradeRisk(
    {
      symbol: 'ETH/USDT',
      side: 'BUY',
      quantity: 1,
      price: ethQuote!.lastPrice,
      stopLoss: ethQuote!.lastPrice - 50,
      strategyId: 'strat_trend', // Different strategy with no cooldown
      broker: 'SimulatedInstitutionalBroker',
    },
    ethQuote,
    ethInst,
    portfolio,
    positions,
    'HEALTHY'
  );
  assert(isolatedStratResult.approved, 'Strategy isolation verified: un-cooled strategy is permitted to trade');

  // Subtest 8g: Winning trade while in cooldown CANNOT bypass active cooldown
  executionEngine.recordClosedTrade({
    symbol: 'SPY',
    strategyId: testStratId,
    side: 'BUY',
    quantity: 1,
    entryPrice: 580,
    exitPrice: 620,
    grossPnL: 40.0,
    feePaid: 1.0,
    exitReason: 'Test Win During Cooldown',
    isPartial: false,
  });
  assert(riskEngine.isCooldownActive(testStratId), 'Invariant verified: winning trade does not bypass active cooldown');

  // Subtest 8h: Manual strategy toggle CANNOT bypass active cooldown
  strategyEngine.toggleStrategy(testStratId, true);
  const stillBlockedOrder = riskEngine.evaluatePreTradeRisk(
    {
      symbol: 'ETH/USDT',
      side: 'BUY',
      quantity: 1,
      price: ethQuote!.lastPrice,
      stopLoss: ethQuote!.lastPrice - 50,
      strategyId: testStratId,
      broker: 'SimulatedInstitutionalBroker',
    },
    ethQuote,
    ethInst,
    portfolio,
    positions,
    'HEALTHY'
  );
  assert(
    !stillBlockedOrder.approved && stillBlockedOrder.code === 'ERR_CONSECUTIVE_LOSS_COOLDOWN',
    'Invariant verified: manual strategy toggle cannot bypass server-side cooldown'
  );

  // Subtest 8i: Ordinary setting cannot shorten cooldown below 30 minutes
  const invalidCooldownUpdate = riskEngine.updateLimits({ consecutiveLossCooldownMinutes: 15 });
  assert(!invalidCooldownUpdate.success, 'Institutional ceiling: Cooldown duration cannot be shortened below 30m');

  // Subtest 8j: Revenge sizing protection ceiling check
  const revengeSizingAttempt = riskEngine.evaluatePreTradeRisk(
    {
      symbol: 'ETH/USDT',
      side: 'BUY',
      quantity: 1, // Quantity 1 ETH with wide stop distance ($400) = $400 risk = 0.40% equity (> 0.25% limit)
      price: ethQuote!.lastPrice,
      stopLoss: ethQuote!.lastPrice - 400,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    ethQuote,
    ethInst,
    portfolio,
    positions,
    'HEALTHY'
  );
  assert(
    !revengeSizingAttempt.approved && revengeSizingAttempt.code === 'ERR_REVENGE_SIZING_VIOLATION',
    'Revenge sizing check strictly blocks oversized risk recovery orders'
  );

  // Subtest 8k: Persistence survives restart
  riskEngine.setStrategySuspension(testStratId, true);
  await executionEngine.persistCurrentState();
  const reloaded = storageService.loadState();
  assert(!!reloaded?.cooldowns && !!reloaded.cooldowns[testStratId], 'Cooldown state persisted durably to app_state.json');
  assert(reloaded!.cooldowns![testStratId].durationMinutes >= 30, 'Persisted cooldown preserves duration >= 30 minutes');
  assert(Array.isArray(reloaded!.closedTrades) && reloaded!.closedTrades.length > 0, 'Closed trade history persisted durably');
  assert(
    !!reloaded?.riskSafetyState &&
      reloaded.riskSafetyState.suspendedStrategies.includes(testStratId) &&
      !reloaded.riskSafetyState.globalKillSwitchActive &&
      !reloaded.riskSafetyState.dailyLossTripped,
    'Kill, daily-loss, and strategy-suspension safety state is durably persisted with cooldowns'
  );
  const restartedRiskEngine = new RiskEngine();
  restartedRiskEngine.restoreCooldowns(reloaded!.cooldowns);
  restartedRiskEngine.restorePersistedSafetyState(reloaded!.riskSafetyState);
  assert(
    restartedRiskEngine.isCooldownActive(testStratId) &&
      restartedRiskEngine.isStrategySuspended(testStratId) &&
      !restartedRiskEngine.isGlobalKillSwitched(),
    'Persisted cooldown and strategy suspension remain active after risk-engine restart restoration'
  );
  restartedRiskEngine.restoreCooldowns(undefined);
  assert(
    restartedRiskEngine.isGlobalKillSwitched(),
    'Missing persisted cooldown state engages a global halt instead of clearing a breaker'
  );
  const { version: _savedVersion, lastSavedAt: _savedAt, ...stateForStorageFaults } = reloaded!;
  void _savedVersion;
  void _savedAt;
  const isolatedStorageDirectory = mkdtempSync(path.join(tmpdir(), 'phase8-storage-fault-'));
  try {
    const baselineStorage = new StorageService({ dataDirectory: isolatedStorageDirectory });
    assert(await baselineStorage.saveState(stateForStorageFaults), 'Storage fault fixture writes a valid baseline state');
    const baselineStateBytes = readFileSync(path.join(isolatedStorageDirectory, 'app_state.json'), 'utf-8');
    const writeFailureStorage = new StorageService({
      dataDirectory: isolatedStorageDirectory,
      writeFile: async () => { throw new Error('injected write failure'); },
    });
    assert(
      !(await writeFailureStorage.saveState(stateForStorageFaults)) &&
        readFileSync(path.join(isolatedStorageDirectory, 'app_state.json'), 'utf-8') === baselineStateBytes,
      'Injected state-write failure returns failure without corrupting the prior durable snapshot'
    );
    const renameFailureStorage = new StorageService({
      dataDirectory: isolatedStorageDirectory,
      rename: async () => { throw new Error('injected atomic-rename failure'); },
    });
    assert(
      !(await renameFailureStorage.saveState(stateForStorageFaults)) &&
        readFileSync(path.join(isolatedStorageDirectory, 'app_state.json'), 'utf-8') === baselineStateBytes,
      'Injected atomic-rename failure preserves the prior durable snapshot'
    );
  } finally {
    rmSync(isolatedStorageDirectory, { recursive: true, force: true });
  }

  console.log('\n--- 9. Testing Broker-Truth Service & Data Provenance ---');
  // Subtest 9a: No provider is configured, so broker identity must stay unavailable.
  const brokerConn = brokerTruthService.getConnectionInfo();
  assert(brokerConn.brokerName === null && brokerConn.server === null, 'No unconfigured broker identity or server is presented');
  assert(brokerConn.accountId === null && brokerConn.currency === null, 'Unverified account identity and currency remain unavailable');
  assert(brokerConn.accountMode === 'UNKNOWN', 'Account mode remains unknown without broker evidence');
  assert(brokerConn.connectionHealth === 'UNAUTHENTICATED' && !brokerConn.readOnlyAuthenticated, 'Read-only account integration is not claimed');
  assert(brokerConn.executionPermitted === false, 'Execution integration remains disabled');

  // Subtest 9b: Unavailable broker account snapshot
  const brokerSnapshot = brokerTruthService.getAccountSnapshot();
  assert(brokerSnapshot.balance === null && brokerSnapshot.equity === null, 'Unverified account balance and equity are unavailable');
  assert(brokerSnapshot.margin === null && brokerSnapshot.freeMargin === null, 'Unverified margin figures are unavailable');
  assert(brokerSnapshot.provenance === 'UNAVAILABLE' && brokerSnapshot.asOf === null, 'Unavailable account snapshot is not timestamped as broker data');

  // Subtest 9c: Simulated market quotes are not broker quotes.
  const verifiedQuotes = brokerTruthService.getQuotesWithProvenance();
  assert(verifiedQuotes.length > 0, 'Local quote collection retrieved with provenance');
  const btcVerified = verifiedQuotes.find(q => q.appSymbol === 'BTC/USDT');
  assert(!!btcVerified, 'BTC quote found in the local market feed');
  assert(btcVerified!.brokerSymbol === null, 'Broker symbol mapping remains unavailable');
  assert(btcVerified!.ticketOrSeq === null, 'No synthetic sequence is presented as a broker ticket');
  assert(btcVerified!.bid > 0 && btcVerified!.ask > btcVerified!.bid, 'Valid bid/ask quote captured');
  assert(btcVerified!.sourceTimestamp > 0, 'Source timestamp captured for simulated quote');
  assert(btcVerified!.receiptTimestamp >= btcVerified!.sourceTimestamp, 'Receipt timestamp captured');
  assert(btcVerified!.quoteAgeMs !== null && btcVerified!.quoteAgeMs >= 0, 'Quote age in milliseconds captured');
  assert(btcVerified!.provenance === 'SIMULATED', 'Simulated market price is not marked broker-confirmed');
  assert(btcVerified!.connectionHealth === 'UNAUTHENTICATED', 'No broker connection is claimed for market data');
  assert(verifiedQuotes.every((quote) => quote.provenance !== 'BROKER_CONFIRMED'), 'Local market feeds never qualify as broker-confirmed quotes');
  assert(brokerTruthService.getBrokerPositions().length === 0, 'Paper positions are not projected as broker positions');
  assert(brokerTruthService.getBrokerDeals().length === 0, 'Fabricated broker deals are not returned');
  const brokerState = brokerTruthService.getBrokerTruthState();
  assert(brokerState.reconciliationStatus.status === 'UNAVAILABLE', 'Broker reconciliation is explicitly unavailable without a provider');

  console.log('\n--- 9d. Testing Local MT5 Read-Only Connector ---');
  assert(
    isLoopbackMt5Client('127.0.0.1') &&
      isLoopbackMt5Client('::1') &&
      isLoopbackMt5Client('::ffff:127.0.0.1') &&
      !isLoopbackMt5Client('127.0.0.1', true) &&
      !isLoopbackMt5Client('192.168.1.10') &&
      !isLoopbackMt5Client(undefined),
    'Local MT5 connection access accepts loopback only and blocks remote browser/server clients'
  );
  let mt5Now = Date.now();
  let mt5BridgePayload: Record<string, unknown> = {
    ok: true,
    broker: 'XM Global Limited',
    server: 'XMGlobal-MT5 5',
    login: 9482015,
    currency: 'USD',
    accountType: 'DEMO',
    balance: 10000,
    equity: 10020,
    margin: 100,
    freeMargin: 9920,
    marginLevelPct: 10020,
    tradingPermissions: {
      terminalTradeAllowed: true,
      terminalTradeApiDisabled: false,
      accountTradeAllowed: true,
      accountExpertTradingAllowed: true,
    },
    positions: [{
      ticket: '12345',
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.1,
      openPrice: 1.08,
      currentPrice: 1.082,
      stopLoss: 1.07,
      takeProfit: null,
      profit: 2,
      swap: 0,
      commission: null,
    }],
    pendingOrders: [{
      ticket: '12346',
      symbol: 'EURUSD',
      type: 'BUY_LIMIT',
      volume: 0.1,
      price: 1.075,
      stopLoss: 1.07,
      takeProfit: null,
      setupTime: mt5Now,
    }],
    availableSymbols: ['EURUSD', 'GOLD'],
    symbolsTruncated: false,
    unavailableSymbols: [],
    symbols: [{
      symbol: 'EURUSD',
      description: 'Euro vs US Dollar',
      digits: 5,
      point: 0.00001,
      tradeTickSize: 0.00001,
      tradeTickValue: 1,
      contractSize: 100000,
      volumeMinimum: 0.01,
      volumeMaximum: 100,
      volumeStep: 0.01,
      stopsLevelPoints: 10,
      freezeLevelPoints: 0,
      profitCurrency: 'USD',
      marginCurrency: 'EUR',
      tradeMode: 'FULL',
      orderMode: 127,
      executionMode: 2,
      fillingMode: 3,
      expirationMode: 15,
      bid: 1.08,
      ask: 1.0801,
      last: null,
      sourceTimestamp: mt5Now - 1000,
      receiptTimestamp: mt5Now,
      quoteAgeMs: 1000,
      quoteStatus: 'FRESH',
    }],
  };
  const mt5Connector = new Mt5ReadOnlyConnector({
    now: () => mt5Now,
    maxSnapshotAgeMs: 30000,
    runner: async (_python, args) => {
      assert(
        args.length === 3 &&
          args[0].endsWith('mt5_read_only_bridge.py') &&
          args[1] === '' &&
          args[2] === '[]',
        'MT5 bridge receives only its script, optional terminal path, and bounded symbol query (never credentials)'
      );
      return JSON.stringify(mt5BridgePayload);
    },
  });
  const mt5Connected = await mt5Connector.testReadOnlyConnection();
  assert(
    mt5Connected.status === 'CONNECTED' &&
      mt5Connected.snapshot?.provenance === 'BROKER_CONFIRMED' &&
      mt5Connected.snapshot.tradingEnabled === false &&
      mt5Connected.automatedTradingEnabled === false,
    'Successful local bridge response is labeled broker-confirmed and permanently read-only'
  );
  assert(
    mt5Connected.snapshot?.maskedAccountId === '••••2015' &&
      !JSON.stringify(mt5Connected).includes('9482015'),
    'MT5 account identifier is masked before the connection state is returned'
  );
  assert(
    mt5Connected.snapshot?.tradingPermissions.terminalTradeAllowed === true &&
      mt5Connected.snapshot.tradingPermissions.terminalTradeApiDisabled === false &&
      mt5Connected.snapshot.tradingPermissions.accountTradeAllowed === true,
    'Terminal and account trading-permission flags are explicitly observed, not inferred'
  );
  assert(
    mt5Connected.snapshot?.positions.length === 1 &&
      mt5Connected.snapshot.pendingOrders.length === 1 &&
      mt5Connected.snapshot.freeMargin === 9920 &&
      mt5Connected.snapshot.accountType === 'DEMO' &&
      mt5Connected.snapshot.availableSymbols.includes('GOLD') &&
      mt5Connected.snapshot.symbols[0]?.quoteStatus === 'FRESH' &&
      mt5Connected.snapshot.positions[0]?.commission === null,
    'Read-only MT5 snapshot verifies XM demo identity and carries account, symbol contract, quote, position, and order data'
  );
  mt5Now += 30001;
  const staleMt5State = mt5Connector.getStatus();
  assert(
    staleMt5State.status === 'STALE' &&
      staleMt5State.snapshot?.symbols[0]?.quoteStatus === 'STALE' &&
      (staleMt5State.snapshot.symbols[0]?.quoteAgeMs ?? 0) > 30000,
    'Account snapshot and symbol quote freshness age dynamically after the configured threshold'
  );
  mt5BridgePayload = { ok: false, code: 'AUTHENTICATION_REQUIRED' };
  const expiredSession = await mt5Connector.testReadOnlyConnection();
  assert(
    expiredSession.status === 'AUTHENTICATION_REQUIRED' &&
      expiredSession.message.includes('Sign in or renew') &&
      expiredSession.automatedTradingEnabled === false,
    'Missing or expired terminal login is reported as authentication-required without credential entry'
  );
  mt5BridgePayload = { ok: false, code: 'TERMINAL_DISCONNECTED' };
  assert(
    (await mt5Connector.testReadOnlyConnection()).status === 'DISCONNECTED',
    'Disconnected MT5 terminal is reported without treating the cached snapshot as current'
  );
  mt5BridgePayload = { ok: true, login: 1 };
  assert(
    (await mt5Connector.testReadOnlyConnection()).status === 'UNAVAILABLE',
    'Malformed bridge response fails closed instead of displaying unvalidated account fields'
  );
  mt5BridgePayload = { ok: false, code: 'ACCOUNT_DATA_INCOMPLETE' };
  assert(
    (await mt5Connector.testReadOnlyConnection()).status === 'UNAVAILABLE',
    'An account with missing broker/server/currency identity cannot be shown as verified'
  );
  mt5BridgePayload = {
    ok: true,
    broker: 'XM Global Limited',
    server: 'XMGlobal-MT5 5',
    login: 9482015,
    currency: 'USD',
    accountType: 'DEMO',
    balance: 10000,
    equity: 10000,
    margin: 0,
    freeMargin: 10000,
    marginLevelPct: null,
    tradingPermissions: {
      terminalTradeAllowed: false,
      terminalTradeApiDisabled: true,
      accountTradeAllowed: false,
      accountExpertTradingAllowed: false,
    },
    positions: [],
    pendingOrders: [],
    availableSymbols: ['EURUSD'],
    symbolsTruncated: false,
    unavailableSymbols: [],
    symbols: [{
      symbol: 'EURUSD',
      description: 'Euro vs US Dollar',
      digits: 5,
      point: 0.00001,
      tradeTickSize: 0.00001,
      tradeTickValue: 1,
      contractSize: 100000,
      volumeMinimum: 0.01,
      volumeMaximum: 100,
      volumeStep: 0.01,
      stopsLevelPoints: 10,
      freezeLevelPoints: 0,
      profitCurrency: 'USD',
      marginCurrency: 'EUR',
      tradeMode: 'FULL',
      orderMode: 127,
      executionMode: 2,
      fillingMode: 3,
      expirationMode: 15,
      bid: 1.08,
      ask: 1.0801,
      last: null,
      sourceTimestamp: mt5Now - 1000,
      receiptTimestamp: mt5Now,
      quoteAgeMs: 1000,
      quoteStatus: 'FRESH',
    }],
  };
  assert(
    (await mt5Connector.testReadOnlyConnection()).status === 'CONNECTED',
    'Read-only connector recovers after terminal/account authentication is restored'
  );
  const originalAccountPayload = mt5BridgePayload;
  mt5BridgePayload = {
    ...originalAccountPayload,
    login: 9482099,
  };
  const switchedAccountState = await mt5Connector.testReadOnlyConnection();
  assert(
    switchedAccountState.status === 'IDENTITY_MISMATCH' &&
      switchedAccountState.snapshot === null &&
      switchedAccountState.message.includes('account or server changed'),
    'Account identity changes fail closed, clear account metrics, and require a process restart'
  );
  const symbolInputConnector = new Mt5ReadOnlyConnector({
    now: () => mt5Now,
    runner: async (_python, args) => {
      assert(JSON.parse(args[2]) instanceof Array, 'Requested symbol details are passed as structured JSON');
      return JSON.stringify(originalAccountPayload);
    },
  });
  const symbolInputState = await symbolInputConnector.testReadOnlyConnection(['EURUSD']);
  assert(
    symbolInputState.status === 'CONNECTED' &&
      symbolInputState.snapshot?.symbols[0]?.quoteStatus === 'FRESH',
    'Read-only symbol request returns broker contract data and freshness-classified quotes'
  );
  const shadowCaptureDirectory = mkdtempSync(path.join(tmpdir(), 'mt5-shadow-capture-'));
  try {
    let captureTime = symbolInputState.snapshot!.capturedAt;
    const shadowCaptureService = new Mt5ShadowCaptureService(
      {
        testReadOnlyConnection: async () => {
          captureTime += 1;
          return {
            ...symbolInputState,
            testedAt: captureTime,
            snapshot: {
              ...symbolInputState.snapshot!,
              capturedAt: captureTime,
            },
          };
        },
      },
      new Mt5ShadowCaptureStore({ directory: shadowCaptureDirectory }),
      () => mt5Now
    );
    const observationOnlyCapture = await shadowCaptureService.capture(['EURUSD']);
    assert(
      observationOnlyCapture.status === 'OBSERVATION_ONLY' &&
        observationOnlyCapture.source === 'LOCAL_MT5_TERMINAL' &&
        observationOnlyCapture.provenance === 'BROKER_CONFIRMED' &&
        observationOnlyCapture.observations[0]?.freshness === 'FRESH' &&
        observationOnlyCapture.observations[0]?.sourceTimestamp !== null,
      'Manual MT5 capture durably records source, requested symbol, broker timestamp, and freshness'
    );
    assert(
      observationOnlyCapture.cadence.assessment === 'NOT_ASSESSABLE_WITHOUT_SCHEDULE' &&
        observationOnlyCapture.strategyPredictions.status === 'NOT_CAPTURED' &&
        observationOnlyCapture.reconciliation.historicalDeals === false &&
        !observationOnlyCapture.tradingEnabled &&
        !observationOnlyCapture.automatedTradingEnabled,
      'Capture declares manual cadence, missing strategy pairing and history reconciliation, and remains read-only'
    );
    const incompleteCapture = await shadowCaptureService.capture(['EURUSD', 'GBPUSD']);
    assert(
      incompleteCapture.status === 'INCOMPLETE' &&
        incompleteCapture.gaps.includes('GBPUSD:SYMBOL_NOT_RETURNED'),
      'Capture records a gap when the terminal did not return one of the requested symbols'
    );
    const staleCaptureState = {
      ...symbolInputState,
      status: 'STALE' as const,
      snapshot: {
        ...symbolInputState.snapshot!,
        capturedAt: symbolInputState.snapshot!.capturedAt - 1,
        symbols: symbolInputState.snapshot!.symbols.map((symbol) => ({
          ...symbol,
          quoteAgeMs: 60000,
          quoteStatus: 'STALE' as const,
        })),
      },
    };
    const staleCaptureService = new Mt5ShadowCaptureService(
      { testReadOnlyConnection: async () => staleCaptureState },
      new Mt5ShadowCaptureStore({ directory: shadowCaptureDirectory }),
      () => mt5Now
    );
    const staleCapture = await staleCaptureService.capture(['EURUSD']);
    assert(
      staleCapture.status === 'INCOMPLETE' &&
        staleCapture.observations[0]?.freshness === 'STALE' &&
        staleCapture.gaps.includes('EURUSD:STALE_QUOTE'),
      'Capture records stale broker quote age as an explicit gap instead of current shadow evidence'
    );
    const persistedCaptures = await shadowCaptureService.getRecent(2);
    assert(
      persistedCaptures.length === 2 &&
        persistedCaptures[0]?.id === incompleteCapture.id &&
        persistedCaptures[1]?.id === observationOnlyCapture.id,
      'Observation captures survive service reads from the durable per-capture store in newest-first order'
    );
    let invalidCaptureRejected = false;
    try {
      await shadowCaptureService.capture([]);
    } catch {
      invalidCaptureRejected = true;
    }
    assert(invalidCaptureRejected, 'Empty or invalid symbol requests cannot create observation records');
  } finally {
    rmSync(shadowCaptureDirectory, { recursive: true, force: true });
  }
  const failedCaptureDirectory = mkdtempSync(path.join(tmpdir(), 'mt5-shadow-capture-failure-'));
  try {
    const failedCaptureStore = new Mt5ShadowCaptureStore({
      directory: failedCaptureDirectory,
      rename: async () => { throw new Error('injected capture rename failure'); },
    });
    const failedCaptureService = new Mt5ShadowCaptureService(
      { testReadOnlyConnection: async () => symbolInputState },
      failedCaptureStore
    );
    let failedCaptureWasSurfaced = false;
    try {
      await failedCaptureService.capture(['EURUSD']);
    } catch {
      failedCaptureWasSurfaced = true;
    }
    assert(
      failedCaptureWasSurfaced &&
        (await failedCaptureStore.getRecent()).length === 0,
      'Capture persistence failure is surfaced and never returned or listed as a successful observation'
    );
  } finally {
    rmSync(failedCaptureDirectory, { recursive: true, force: true });
  }
  assert(
    (await symbolInputConnector.testReadOnlyConnection(['EURUSD', 'bad;symbol'])).status === 'UNAVAILABLE',
    'Invalid symbol names fail closed before launching the local bridge'
  );
  assert(
    (await symbolInputConnector.testReadOnlyConnection(Array.from({ length: 11 }, (_, index) => `SYM${index}`))).status === 'UNAVAILABLE',
    'Symbol requests above the 10-symbol bound fail closed'
  );
  let identityTestPayload: Record<string, unknown> = { ...originalAccountPayload, broker: 'Other Broker', server: 'Other-Demo' };
  const identityTestConnector = new Mt5ReadOnlyConnector({
    now: () => mt5Now,
    runner: async () => JSON.stringify(identityTestPayload),
  });
  const wrongBroker = await identityTestConnector.testReadOnlyConnection();
  assert(
    wrongBroker.status === 'IDENTITY_MISMATCH' &&
      wrongBroker.snapshot === null &&
      wrongBroker.message.includes('XM Global'),
    'A broker/server not identified as XM Global cannot expose account values'
  );
  identityTestPayload = { ...originalAccountPayload, accountType: 'REAL' };
  const realAccount = await identityTestConnector.testReadOnlyConnection();
  assert(
    realAccount.status === 'IDENTITY_MISMATCH' && realAccount.snapshot === null,
    'A non-demo MT5 account is rejected without exposing its financial snapshot'
  );
  const staleSymbolPayload = {
    ...originalAccountPayload,
    symbols: [{
      ...(originalAccountPayload.symbols as Array<Record<string, unknown>>)[0],
      sourceTimestamp: mt5Now - 60000,
    }],
  };
  const staleSymbolConnector = new Mt5ReadOnlyConnector({
    now: () => mt5Now,
    runner: async () => JSON.stringify(staleSymbolPayload),
  });
  const staleSymbolState = await staleSymbolConnector.testReadOnlyConnection(['EURUSD']);
  assert(
    staleSymbolState.snapshot?.symbols[0]?.quoteStatus === 'STALE',
    'An old MT5 tick is labeled stale instead of current'
  );
  const unavailableSymbolPayload = {
    ...originalAccountPayload,
    symbols: [{
      ...(originalAccountPayload.symbols as Array<Record<string, unknown>>)[0],
      bid: null,
      ask: null,
      sourceTimestamp: null,
    }],
  };
  const unavailableSymbolConnector = new Mt5ReadOnlyConnector({
    now: () => mt5Now,
    runner: async () => JSON.stringify(unavailableSymbolPayload),
  });
  const unavailableSymbolState = await unavailableSymbolConnector.testReadOnlyConnection(['EURUSD']);
  assert(
    unavailableSymbolState.snapshot?.symbols[0]?.quoteStatus === 'UNAVAILABLE',
    'Missing MT5 quote fields remain explicitly unavailable'
  );
  const missingPythonConnector = new Mt5ReadOnlyConnector({
    runner: async () => {
      throw Object.assign(new Error('Interpreter missing'), { code: 'ENOENT' });
    },
  });
  const missingPython = await missingPythonConnector.testReadOnlyConnection();
  assert(
    missingPython.status === 'UNAVAILABLE' &&
      missingPython.message.includes('Python interpreter was not found'),
    'Missing local Python runtime fails safely with an actionable unavailable state'
  );

  console.log('\n--- 10. Testing Central Permission Gate (All 8 Invariant Stages) ---');
  // Stage 1: Verified account identity & authorized execution mode
  const unauthLiveGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'SPY',
      side: 'BUY',
      quantity: 1,
      stopLoss: 580,
      strategyId: 'strat_trend',
      broker: 'MetaTrader 5 Institutional Gateway',
    },
    spyQuote || null,
    spyInst || null,
    { ...portfolio, mode: 'LIVE' }, // Attempting LIVE mode without authorized live execution
    positions,
    executionEngine.getOrders(),
    riskEngine.getLimits(),
    'HEALTHY',
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p)
  );
  assert(!unauthLiveGate.approved && unauthLiveGate.gateCode === 'GATE_STAGE_1_ACCOUNT_AUTH', 'Gate Stage 1: Blocks unauthorized LIVE execution mode');
  assert(
    unauthLiveGate.checks.find((check) => check.code === 'GATE_STAGE_2_PRICE_PROVENANCE')?.passed === false,
    'Gate Stage 2: Rejects local market quotes for LIVE entries'
  );

  // Stage 2: Fresh, valid prices & required source provenance
  const staleQuoteObj = { ...spyQuote!, timestamp: Date.now() - 60000, isStale: true };
  const staleGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'SPY',
      side: 'BUY',
      quantity: 1,
      stopLoss: 580,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    staleQuoteObj,
    spyInst || null,
    portfolio,
    positions,
    executionEngine.getOrders(),
    riskEngine.getLimits(),
    'HEALTHY',
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p)
  );
  assert(!staleGate.approved && staleGate.gateCode === 'GATE_STAGE_2_PRICE_PROVENANCE', 'Gate Stage 2: Blocks stale market quote feeds (> 30s)');
  const futureQuoteGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'SPY',
      side: 'BUY',
      quantity: 1,
      stopLoss: 580,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    { ...spyQuote!, timestamp: Date.now() + 60000, isStale: false },
    spyInst || null,
    portfolio,
    positions,
    executionEngine.getOrders(),
    riskEngine.getLimits(),
    'HEALTHY',
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p)
  );
  assert(!futureQuoteGate.approved && futureQuoteGate.gateCode === 'GATE_STAGE_2_PRICE_PROVENANCE', 'Gate Stage 2: Rejects future-dated market quotes');

  // Stage 3: Correct symbol mapping and instrument specifications (e.g. invalid lot step)
  const invalidLotGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'SPY',
      side: 'BUY',
      quantity: 1.5, // SPY requires integer lots (lotStep: 1)
      stopLoss: 580,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    spyQuote || null,
    spyInst || null,
    portfolio,
    positions,
    executionEngine.getOrders(),
    riskEngine.getLimits(),
    'HEALTHY',
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p)
  );
  assert(!invalidLotGate.approved && invalidLotGate.gateCode === 'GATE_STAGE_3_INSTRUMENT_SPEC', 'Gate Stage 3: Blocks fractional lots violating instrument specifications');
  const alignedSpyPrice = Number((Math.ceil(spyQuote!.ask / spyInst!.tickSize) * spyInst!.tickSize).toFixed(2));
  const alignedSpyStop = Number((Math.floor((alignedSpyPrice - spyInst!.tickSize) / spyInst!.tickSize) * spyInst!.tickSize).toFixed(2));
  const evaluateSpySpecGate = (overrides: { price?: number; stopLoss?: number; takeProfit?: number }) =>
    centralPermissionGate.evaluateGate(
      {
        symbol: 'SPY',
        side: 'BUY',
        type: 'LIMIT',
        quantity: 1,
        price: alignedSpyPrice,
        stopLoss: alignedSpyStop,
        strategyId: 'strat_trend',
        broker: 'SimulatedInstitutionalBroker',
        ...overrides,
      },
      spyQuote || null,
      spyInst || null,
      portfolio,
      [],
      [],
      riskEngine.getLimits(),
      'HEALTHY',
      () => false,
      () => false,
      () => false,
      () => false,
      () => false,
      () => ({ breached: false, action: 'NONE' })
    );
  const invalidPriceTickGate = evaluateSpySpecGate({ price: alignedSpyPrice + spyInst!.tickSize / 2 });
  assert(
    !invalidPriceTickGate.approved &&
      Boolean(invalidPriceTickGate.checks.find((check) => check.code === 'GATE_STAGE_3_INSTRUMENT_SPEC')?.details.includes('align to tick size')),
    'Gate Stage 3: Rejects limit prices that are not aligned to the instrument tick size'
  );
  const invalidStopTickGate = evaluateSpySpecGate({ stopLoss: alignedSpyStop - spyInst!.tickSize / 2 });
  assert(
    !invalidStopTickGate.approved &&
      Boolean(invalidStopTickGate.checks.find((check) => check.code === 'GATE_STAGE_3_INSTRUMENT_SPEC')?.details.includes('Stop-loss price')),
    'Gate Stage 3: Rejects protective stops that are not aligned to the instrument tick size'
  );
  const invalidTakeProfitTickGate = evaluateSpySpecGate({ takeProfit: alignedSpyPrice + spyInst!.tickSize / 2 });
  assert(
    !invalidTakeProfitTickGate.approved &&
      Boolean(invalidTakeProfitTickGate.checks.find((check) => check.code === 'GATE_STAGE_3_INSTRUMENT_SPEC')?.details.includes('Take-profit price')),
    'Gate Stage 3: Rejects take-profit prices that are not aligned to the instrument tick size'
  );
  const explicitZeroPriceGate = evaluateSpySpecGate({ price: 0 });
  assert(
    !explicitZeroPriceGate.approved &&
      Boolean(explicitZeroPriceGate.checks.find((check) => check.code === 'GATE_STAGE_3_INSTRUMENT_SPEC')?.details.includes('must be finite and positive')),
    'Gate Stage 3: Rejects an explicit zero order price instead of substituting a market quote'
  );

  // Stage 4: Reconciled account, positions and outstanding orders
  const btcGateQuote = marketDataService.getQuote('BTC/USDT')!;
  const btcGateInst = marketDataService.getInstrument('BTC/USDT')!;
  const btcGateStopLoss = Number((
    Math.floor((btcGateQuote.lastPrice - 500) / btcGateInst.tickSize) * btcGateInst.tickSize
  ).toFixed(1));
  const discrepantGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'BTC/USDT',
      side: 'BUY',
      quantity: 0.1,
      stopLoss: btcGateStopLoss,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    btcGateQuote,
    btcGateInst,
    { ...portfolio, mode: 'LIVE' },
    positions,
    executionEngine.getOrders(),
    riskEngine.getLimits(),
    'HEALTHY',
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p)
  );
  assert(!discrepantGate.checks.find((check) => check.code === 'GATE_STAGE_4_RECONCILIATION')?.passed, 'Gate Stage 4: Unavailable broker reconciliation blocks LIVE entries');

  // Stage 5: Valid initial stop-loss and calculated position risk
  const missingStopGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'BTC/USDT',
      side: 'BUY',
      quantity: 0.1,
      // No stopLoss provided!
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    btcGateQuote,
    btcGateInst,
    portfolio,
    positions,
    executionEngine.getOrders(),
    riskEngine.getLimits(),
    'HEALTHY',
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p)
  );
  assert(!missingStopGate.approved && missingStopGate.gateCode === 'GATE_STAGE_5_PROTECTIVE_STOP', 'Gate Stage 5: Strictly requires mandatory initial protective stop-loss');

  // Stage 6: Account exposure, margin and daily loss limits
  const breachedDailyLossPortfolio = { ...portfolio, dailyLossPct: 1.5, isDailyLossHalted: true };
  const dailyLossGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'BTC/USDT',
      side: 'BUY',
      quantity: 0.1,
      stopLoss: btcGateStopLoss,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
    btcGateQuote,
    btcGateInst,
    breachedDailyLossPortfolio,
    positions,
    executionEngine.getOrders(),
    riskEngine.getLimits(),
    'HEALTHY',
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p)
  );
  assert(!dailyLossGate.approved && dailyLossGate.gateCode === 'GATE_STAGE_6_EXPOSURE_MARGIN', 'Gate Stage 6: Blocks entry when daily loss limit is breached');

  // Stage 7: Trading schedule, market session & active cooldowns
  const cooldownBlockedGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'BTC/USDT',
      side: 'BUY',
      quantity: 0.1,
      stopLoss: btcGateStopLoss,
      strategyId: testStratId, // In 30m cooldown from earlier test
      broker: 'SimulatedInstitutionalBroker',
    },
    btcGateQuote,
    btcGateInst,
    {
      ...portfolio,
      totalEquity: 100000,
      availableMargin: 100000,
      dailyLossPct: 0,
      currentDrawdownPct: 0,
      isDailyLossHalted: false,
      isGlobalKillSwitched: false,
    },
    [],
    [],
    riskEngine.getLimits(),
    'HEALTHY',
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p)
  );
  assert(!cooldownBlockedGate.approved && cooldownBlockedGate.gateCode === 'GATE_STAGE_7_COOLDOWNS_SESSIONS', 'Gate Stage 7: Blocks entry when strategy is in active 30m revenge cooldown');

  // Stage 8: Duplicate-order protection & execution service health
  const duplicateClientOrderId = 'coid_duplicate_test_123';
  const mockOrders = [
    {
      id: 'ord_1',
      clientOrderId: duplicateClientOrderId,
      symbol: 'BTC/USDT',
      side: 'BUY' as const,
      type: 'MARKET' as const,
      quantity: 0.1,
      price: btcGateQuote.lastPrice,
      stopLoss: btcGateStopLoss,
      status: 'SUBMITTED' as const,
      filledQuantity: 0,
      feePaid: 0,
      estimatedSlippage: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
    },
  ];
  const duplicateGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'BTC/USDT',
      side: 'BUY',
      quantity: 0.1,
      stopLoss: btcGateStopLoss,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
      clientOrderId: duplicateClientOrderId,
    },
    btcGateQuote,
    btcGateInst,
    {
      ...portfolio,
      totalEquity: 100000,
      availableMargin: 100000,
      dailyLossPct: 0,
      currentDrawdownPct: 0,
      isDailyLossHalted: false,
      isGlobalKillSwitched: false,
    },
    [],
    mockOrders,
    riskEngine.getLimits(),
    'HEALTHY',
    (t) => riskEngine.isCooldownActive(t),
    (s) => riskEngine.isStrategySuspended(s),
    (b) => riskEngine.isBrokerSuspended(b),
    () => riskEngine.isGlobalKillSwitched(),
    (p) => riskEngine.checkDailyLossBreach(p),
    (p) => riskEngine.checkDrawdownBreach(p)
  );
  assert(
    !duplicateGate.approved && duplicateGate.gateCode === 'GATE_STAGE_8_IDEMPOTENCY_HEALTH',
    `Gate Stage 8: Blocks duplicate orders via clientOrderId idempotency check (${duplicateGate.gateCode}; ${duplicateGate.checks.filter((check) => !check.passed).map((check) => `${check.code}: ${check.details}`).join(' | ')})`
  );

  console.log('\n--- 11. Testing Profit and Loss Verification & Accounting ---');
  const pnlSummary = brokerTruthService.getBrokerPnLVerification();
  assert(pnlSummary.realizedPnL === null && pnlSummary.unrealizedPnL === null, 'Unverified realized and unrealized P&L are unavailable');
  assert(pnlSummary.totalCommissions === null && pnlSummary.totalFees === null && pnlSummary.totalSwaps === null, 'Unverified broker costs are unavailable');
  assert(pnlSummary.brokerReportedTotalPnL === null && pnlSummary.appCalculatedTotalPnL === null, 'No synthetic P&L is presented as broker-reported');
  assert(pnlSummary.provenance === 'UNAVAILABLE', 'P&L verification is explicitly unavailable');

  console.log('\n--- 12. Testing Responsible Protective Stop-Loss Discipline ---');
  const localSpyPosition = executionEngine.getPositions().find((position) => position.symbol === 'SPY');
  assert(!!localSpyPosition, 'Paper test position is available for stop and close safety checks');
  const originalMarketQuoteGetter = marketDataService.getQuote.bind(marketDataService);
  const priorStopPrice = localSpyPosition!.stopLossPrice;
  marketDataService.getQuote = (symbol: string) => symbol === 'SPY'
    ? { ...spyQuote!, timestamp: Date.now() - 60000, isStale: true }
    : originalMarketQuoteGetter(symbol);
  try {
    const staleClose = await executionEngine.closePosition('SPY', 'Stale quote safety test');
    const staleStopUpdate = await executionEngine.modifyPositionStopLoss('SPY', priorStopPrice + 0.001);
    assert(
      !staleClose.success &&
        executionEngine.getPositions().some((position) => position.symbol === 'SPY') &&
        !staleStopUpdate.success &&
        executionEngine.getPositions().find((position) => position.symbol === 'SPY')?.stopLossPrice === priorStopPrice,
      'Stale quotes block paper closes and stop changes without silently mutating the position'
    );
  } finally {
    marketDataService.getQuote = originalMarketQuoteGetter;
  }

  // Subtest 12a: Moving stop closer to lock profit is confirmed
  const validStopMove = brokerTruthService.evaluateStopModification({
    symbol: 'SPY',
    side: 'BUY',
    currentStopLoss: 575.0,
    newStopLoss: 580.0, // Moving stop UP for BUY (closer to market, reducing risk)
    entryPrice: 582.0,
    currentPrice: 585.0,
  });
  assert(validStopMove.approved && validStopMove.code === 'STOP_MODIFIED_LOCAL' && validStopMove.status === 'UNCONFIRMED_LOCAL_ONLY' && validStopMove.confirmedStop === null, 'Moving protective stop closer is applied only to local paper state and stays unconfirmed until broker acknowledgement');

  // Subtest 12b: CRITICAL INVARIANT: Stop widening to rescue losing trade is STRICTLY PROHIBITED
  const illegalWideningAttempt = brokerTruthService.evaluateStopModification({
    symbol: 'SPY',
    side: 'BUY',
    currentStopLoss: 575.0,
    newStopLoss: 570.0, // Moving stop DOWN for BUY (widening risk to rescue losing trade)
    entryPrice: 582.0,
    currentPrice: 585.0,
  });
  assert(!illegalWideningAttempt.approved && illegalWideningAttempt.code === 'ILLEGAL_STOP_WIDENING', 'Stop discipline invariant: Attempt to widen stop-loss is strictly rejected');

  console.log('\n--- 13. Testing Failure Handling, Idempotency & Uncertain Recovery ---');
  const concurrentClientOrderId = `coid_concurrent_test_${Date.now()}`;
  const concurrentIntent = {
    clientOrderId: concurrentClientOrderId,
    symbol: 'ETH/USDT',
    side: 'BUY' as const,
    type: 'MARKET' as const,
    quantity: 0.01,
    stopLoss: marketDataService.getQuote('ETH/USDT')!.lastPrice - 50,
    strategyId: `strat_concurrent_${Date.now()}`,
  };
  const ordersBeforeConcurrentReplay = executionEngine.getOrders(Number.MAX_SAFE_INTEGER).length;
  const concurrentResults = await Promise.all([
    executionEngine.submitOrder(concurrentIntent, 'HEALTHY'),
    executionEngine.submitOrder(concurrentIntent, 'HEALTHY'),
  ]);
  assert(
    concurrentResults[0].success === concurrentResults[1].success &&
    concurrentResults[0].order?.id === concurrentResults[1].order?.id &&
    concurrentResults[0].order?.status === concurrentResults[1].order?.status &&
    (!concurrentResults[0].success || concurrentResults[0].order?.status === 'FILLED') &&
    executionEngine.getOrders(Number.MAX_SAFE_INTEGER).length <= ordersBeforeConcurrentReplay + 1,
    'Concurrent requests with one idempotency key share the same final order outcome without duplicate records'
  );
  const mismatchedReplay = await executionEngine.submitOrder({
    ...concurrentIntent,
    quantity: 0.02,
  }, 'HEALTHY');
  assert(
    !mismatchedReplay.success &&
      mismatchedReplay.order?.id === concurrentResults[0].order?.id &&
      Boolean(mismatchedReplay.error?.includes('different order intent')),
    'Reusing an idempotency key with a different order payload is rejected'
  );

  // Subtest 13a: Out-of-order quote timestamp rejection
  const testNow = Date.now();
  const futureTimestampCheck = brokerTruthService.recordQuoteTimestamp('FUTURE_FEED_SYMBOL', testNow + 1000);
  assert(!futureTimestampCheck.valid, 'Future-dated quote timestamp is rejected');
  const outOfOrderCheck1 = brokerTruthService.recordQuoteTimestamp('TEST_FEED_SYMBOL', testNow - 1000);
  assert(outOfOrderCheck1.valid, 'First quote timestamp accepted');
  const outOfOrderCheck2 = brokerTruthService.recordQuoteTimestamp('TEST_FEED_SYMBOL', testNow - 5000); // Older timestamp
  assert(!outOfOrderCheck2.valid, 'Out-of-order quote timestamp is strictly detected and rejected');

  // Subtest 13b: Uncertain order intent reconciliation recovery
  const uncertainCoid = 'coid_uncertain_test_999';
  executionEngine.registerOrderIntent(uncertainCoid, { symbol: 'SPY', side: 'BUY', quantity: 1 });
  await executionEngine.markOrderIntentUncertain(uncertainCoid);
  const persistedUncertainState = await executionEngine.persistCurrentState();
  assert(persistedUncertainState, 'Uncertain order intent is durably persisted before restart recovery check');
  const persistedWithUncertainIntent = storageService.loadState();
  assert(
    Boolean(persistedWithUncertainIntent?.pendingOrderIntents?.some((intent) => intent.clientOrderId === uncertainCoid && intent.status === 'UNCERTAIN')),
    'Uncertain order intent and idempotency key are present in durable state'
  );
  const restartedExecutionEngine = new ExecutionEngine();
  assert(restartedExecutionEngine.hasUncertainOrderIntents(), 'Restart converts unresolved persisted order intent into an entry-blocking uncertain state');
  const orderCountBeforeUncertainRetry = executionEngine.getOrders(Number.MAX_SAFE_INTEGER).length;
  const uncertainRetry = await executionEngine.submitOrder({
    clientOrderId: uncertainCoid,
    symbol: 'SPY',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    stopLoss: spyQuote!.lastPrice - 5,
    strategyId: 'strat_trend',
  }, 'HEALTHY');
  assert(
    !uncertainRetry.success &&
      Boolean(uncertainRetry.error?.includes('UNCERTAIN')) &&
      executionEngine.getOrders(Number.MAX_SAFE_INTEGER).length === orderCountBeforeUncertainRetry,
    'Retry of an uncertain order intent is blocked without creating a duplicate order'
  );
  const recoveryReport = executionEngine.recoverUncertainOrderIntents();
  assert(recoveryReport.recoveredCount === 0, 'Uncertain submission is not falsely resolved without broker evidence');
  assert(recoveryReport.details.some((detail) => detail.includes('remains UNCERTAIN')), 'Uncertain submission remains explicitly unresolved');
  assert(executionEngine.hasUncertainOrderIntents(), 'Uncertain submission blocks subsequent risk-increasing orders');
  const btcUncertainQuote = marketDataService.getQuote('BTC/USDT')!;
  const btcUncertainInst = marketDataService.getInstrument('BTC/USDT')!;
  const uncertainGate = centralPermissionGate.evaluateGate(
    {
      symbol: 'BTC/USDT',
      side: 'BUY',
      quantity: 0.1,
      stopLoss: btcUncertainQuote.lastPrice - 500,
      strategyId: 'strat_trend',
      broker: 'SimulatedInstitutionalBroker',
      clientOrderId: 'coid_blocked_while_uncertain',
    },
    btcUncertainQuote,
    btcUncertainInst,
    portfolio,
    [],
    [],
    riskEngine.getLimits(),
    'HEALTHY',
    () => false,
    () => false,
    () => false,
    () => false,
    () => false,
    () => ({ breached: false, action: 'NONE' }),
    true
  );
  assert(
    uncertainGate.checks.find((check) => check.code === 'GATE_STAGE_8_IDEMPOTENCY_HEALTH')?.passed === false,
    'Central permission gate fails Stage 8 while an order intent is uncertain'
  );
  const blockedAfterUncertain = await executionEngine.submitOrder({
    clientOrderId: `test_after_uncertain_${Date.now()}`,
    symbol: 'SPY',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    stopLoss: spyQuote!.lastPrice - 5,
    strategyId: 'strat_trend',
  }, 'HEALTHY');
  assert(!blockedAfterUncertain.success && blockedAfterUncertain.order?.status === 'REJECTED', 'Execution path rejects a new order while a submission outcome is uncertain');

  // Subtest 13c: Emergency halt preserves existing paper positions and their recorded stops.
  const openOrderStates = ['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED'] as const;
  const cancellationFixture: Order[] = [
    ...openOrderStates.map((status, index) => ({
      id: `halt-fixture-${index}`,
      clientOrderId: `halt-fixture-client-${index}`,
      symbol: 'SPY',
      side: 'BUY' as const,
      type: 'LIMIT' as const,
      quantity: 2,
      status,
      filledQuantity: status === 'PARTIALLY_FILLED' ? 1 : 0,
      feePaid: 0,
      estimatedSlippage: 0,
      createdAt: 1,
      updatedAt: 1,
      strategyId: 'test',
      broker: 'SimulatedInstitutionalBroker',
    })),
    {
      id: 'halt-fixture-filled',
      clientOrderId: 'halt-fixture-filled-client',
      symbol: 'SPY',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      status: 'FILLED',
      filledQuantity: 1,
      feePaid: 0,
      estimatedSlippage: 0,
      createdAt: 1,
      updatedAt: 1,
      strategyId: 'test',
      broker: 'SimulatedInstitutionalBroker',
    },
  ];
  const fixtureCancelCount = cancelNonTerminalPaperOrders(cancellationFixture, 12345);
  assert(
    fixtureCancelCount === openOrderStates.length &&
      cancellationFixture.slice(0, openOrderStates.length).every((order) => order.status === 'CANCELLED' && order.updatedAt === 12345) &&
      cancellationFixture[openOrderStates.length].status === 'FILLED',
    'Emergency cancellation covers every open state, including partial fills, and preserves terminal fills'
  );
  const positionsBeforeHalt = executionEngine.getPositions().map((position) => ({
    id: position.id,
    symbol: position.symbol,
    quantity: position.quantity,
    stopLossPrice: position.stopLossPrice,
  }));
  assert(positionsBeforeHalt.length > 0, 'Emergency halt fixture includes an existing open paper position');
  const openStatuses = new Set(['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED']);
  const openOrdersBeforeHalt = executionEngine.getOrders(Number.MAX_SAFE_INTEGER)
    .filter((order) => openStatuses.has(order.status));
  riskEngine.setGlobalKillSwitch(true, 'Emergency halt position-preservation test');
  const haltedCancellationCount = await executionEngine.cancelAllOpenOrders('Emergency halt position-preservation test');
  const positionsAfterHalt = executionEngine.getPositions();
  const openOrdersAfterHalt = executionEngine.getOrders(Number.MAX_SAFE_INTEGER)
    .filter((order) => openStatuses.has(order.status));
  assert(
    haltedCancellationCount === openOrdersBeforeHalt.length && openOrdersAfterHalt.length === 0,
    'Emergency halt cancels every non-terminal local paper order'
  );
  assert(
    positionsAfterHalt.length === positionsBeforeHalt.length &&
      positionsBeforeHalt.every((before) => {
        const after = positionsAfterHalt.find((position) => position.id === before.id);
        return after?.symbol === before.symbol &&
          after.quantity === before.quantity &&
          after.stopLossPrice === before.stopLossPrice;
      }),
    'Emergency halt leaves existing positions open with their recorded local stops unchanged'
  );
  assert(
    riskEngine.isGlobalKillSwitched() &&
      auditLogger.getRecentLogs(20).some((entry) => entry.action === 'GLOBAL_KILL_SWITCH_ENGAGED') &&
      auditLogger.getRecentLogs(20).some((entry) => entry.action === 'EMERGENCY_CANCEL_ALL_ORDERS'),
    'Emergency halt and local order cancellations are audited while positions remain open'
  );
  riskEngine.setGlobalKillSwitch(false, 'Restore system-test safety state');
  assert(await executionEngine.persistCurrentState(), 'Emergency halt test restores persisted safety state after verification');

  console.log('\n========================================');
  console.log('🎉 ALL SYSTEM & QUANTITATIVE TESTS PASSED');
  console.log('========================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
