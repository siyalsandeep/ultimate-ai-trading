export type AssetClass = 'EQUITY' | 'CRYPTO' | 'FOREX' | 'COMMODITY' | 'INDEX';

export type OrderSide = 'BUY' | 'SELL';

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'TAKE_PROFIT';

export type OrderStatus =
  | 'CREATED'
  | 'VALIDATED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED';

export type SystemMode = 'BACKTEST' | 'PAPER' | 'LIVE';

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export type MarketRegimeType =
  | 'TRENDING_BULL'
  | 'TRENDING_BEAR'
  | 'RANGING_LOW_VOL'
  | 'RANGING_HIGH_VOL'
  | 'UNCERTAIN_SHOCK';

export interface Instrument {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
  minLotSize: number;
  lotStep: number;
  tickSize: number;
  commissionPerUnit: number; // e.g. 0.005 USD per share, or percentage
  commissionType: 'FIXED_PER_UNIT' | 'PERCENTAGE';
  typicalSpreadPct: number; // e.g. 0.0003 (0.03%)
  marginRequirement: number; // 0.20 for 5x, 1.0 for 1x
  tradingHours: string;
  exchange: string;
  marketCloseBufferMinutes?: number; // e.g. 15 minutes before close entry lockout
  weekendEntryAllowed?: boolean; // false by default for equities/forex/commodities
  timezone?: string; // e.g. 'America/New_York', 'UTC'
}

export interface MarketQuote {
  symbol: string;
  bid: number;
  ask: number;
  lastPrice: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  change24hPct: number;
  spreadPct: number;
  timestamp: number;
  provider: string;
  isStale: boolean;
  quality: 'SIMULATED' | 'LIVE' | 'DELAYED' | 'SNAPSHOT' | 'HISTORICAL' | 'UNAVAILABLE';
  feedDescription: string;
  isLiveBrokerExecutable: boolean;
  feedLatencyMs: number;
}

export interface MarketPriceSnapshot {
  symbol: string;
  provider: string | null;
  providerSymbol: string | null;
  status: 'LIVE' | 'DELAYED' | 'SNAPSHOT' | 'HISTORICAL' | 'SIMULATED' | 'UNAVAILABLE';
  connectionState: 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'UNCONFIGURED' | 'UNAVAILABLE';
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  changePct: number | null;
  sourceTimestamp: number | null;
  receiptTimestamp: number | null;
  quoteAgeMs: number | null;
  isStale: boolean;
  error: string | null;
}

export interface CandleOHLCV {
  time: number; // timestamp in seconds or ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  indicators?: {
    ema20?: number;
    ema50?: number;
    ema200?: number;
    atr14?: number;
    adx14?: number;
    rsi14?: number;
    bbUpper?: number;
    bbMiddle?: number;
    bbLower?: number;
    volatility?: number;
  };
}

export interface TradeSignal {
  id: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  side: OrderSide;
  confidence: number | null; // Null until calibrated out-of-sample
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  suggestedSize: number;
  regime: MarketRegimeType;
  rationale: string;
  factors: {
    name: string;
    value: string | number;
    status: 'FAVORABLE' | 'NEUTRAL' | 'CAUTION';
  }[];
  timestamp: number;
  status: 'NEW' | 'APPROVED' | 'REJECTED_BY_RISK' | 'EXECUTED' | 'EXPIRED';
  riskRejectionReason?: string;
}

export interface Position {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLossPrice: number;
  initialStopPrice?: number;
  lastConfirmedStopPrice?: number | null;
  brokerConfirmedStopPrice?: number | null;
  pendingStopPrice?: number | null;
  stopModificationPending?: boolean;
  stopRule?: string;
  takeProfitPrice?: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  realizedPnL: number;
  marginUsed: number;
  openedAt: number;
  strategyId: string;
  broker: string;
}

export interface Order {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  status: OrderStatus;
  filledQuantity: number;
  avgFillPrice?: number;
  feePaid: number;
  estimatedSlippage: number;
  createdAt: number;
  updatedAt: number;
  strategyId: string;
  broker: string;
  rejectReason?: string;
  executionTelemetry?: {
    provenance: 'PAPER_SIMULATION';
    quoteProvider: string;
    quoteQuality: MarketQuote['quality'];
    quoteTimestamp: number;
    submissionTimestamp: number;
    acknowledgementTimestamp: number;
    fillTimestamp?: number;
    referencePrice: number;
    simulatedProcessingDurationMs?: number;
    slippageModel: string;
  };
}

export interface ClosedTradeRecord {
  id: string;
  orderId?: string;
  symbol: string;
  strategyId: string;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  grossPnL: number;
  feePaid: number;
  netPnL: number;
  closedAt: number;
  exitReason: string;
  isPartial: boolean;
  result: 'LOSS' | 'WIN' | 'BREAKEVEN';
}

export interface CooldownState {
  target: string; // Strategy ID or 'ACCOUNT'
  active: boolean;
  startTime: number;
  cooldownEndTime: number;
  durationMinutes: number; // minimum 30 minutes
  remainingSeconds: number;
  triggeringTradeIds: string[];
  consecutiveLosses: number;
  pauseReason: string;
  autoExecutionDisabled: boolean;
}

export type RolloutStage = 'PAPER_ONLY' | 'SHADOW_MODE' | 'DEMO_ONLY' | 'LIVE_PILOT' | 'LIVE';

export interface RecoveryObjectives {
  rtoSeconds: number;
  rpoSeconds: number;
  backupRestoreTested: boolean;
  restartRecoveryTested: boolean;
  notes: string;
}

export interface ControlledRolloutState {
  stage: RolloutStage;
  liveExecutionAuthorized: boolean;
  requireOperatorApproval: boolean;
  recoveryObjectives: RecoveryObjectives;
  lastAuthorizedAt: number | null;
  lastReviewAt: number | null;
}

export interface PortfolioSummary {
  mode: SystemMode;
  totalEquity: number;
  cashBalance: number;
  availableMargin: number;
  usedMargin: number;
  unrealizedPnL: number;
  realizedPnLToday: number;
  startOfDayEquity: number;
  dailyLossPct: number;
  maxDrawdownPct: number;
  currentDrawdownPct: number;
  grossLeverage: number;
  openRiskBudgetPct: number;
  activePositionsCount: number;
  activeOrdersCount: number;
  consecutiveLosses: number;
  isDailyLossHalted: boolean;
  isGlobalKillSwitched: boolean;
  rolloutStage?: RolloutStage;
  liveExecutionAuthorized?: boolean;
  recoveryObjectives?: RecoveryObjectives;
  accountCooldown?: CooldownState;
  activeCooldowns?: CooldownState[];
}

export interface PortfolioRiskAssessment {
  status: 'ESTIMATED_PAPER_ONLY' | 'UNAVAILABLE';
  source: 'LOCAL_PAPER_LEDGER' | 'UNAVAILABLE';
  equity: number | null;
  grossNotional: number | null;
  grossLeverage: number | null;
  stopRisk: number | null;
  stressedLoss: number | null;
  stressAssumption: string;
  exposureBySymbol: Array<{ key: string; notional: number; pctEquity: number }>;
  exposureByAssetClass: Array<{ key: string; notional: number; pctEquity: number }>;
  exposureByQuoteCurrency: Array<{ key: string; notional: number; pctEquity: number }>;
  correlatedClusters: Array<{ key: string; symbols: string[]; notional: number; limitation: string }>;
  warnings: string[];
  entryAllowed: boolean;
  reasons: string[];
  assessedAt: number;
}

export interface RiskLimits {
  maxRiskPerTradePct: number; // default 0.25%, hard ceiling 1.0%
  dailyLossShutdownPct: number; // default 1.0%
  portfolioOpenRiskBudgetPct: number; // default 2.0%
  maxDrawdownPausePct: number; // default 5.0%
  maxDrawdownHaltPct: number; // default 10.0%
  maxSingleAssetExposurePct: number; // default 15.0%
  maxAssetClassExposurePct: number; // default 35.0%
  maxStrategyExposurePct: number; // default 30.0%
  maxLeverage: number; // default 1.5x
  maxSimultaneousPositions: number; // default 8
  maxSpreadTolerancePct: number; // default 0.15%
  maxSlippageTolerancePct: number; // default 0.20%
  maxQuoteAgeMs: number; // default 30000 ms
  maxConsecutiveLosses: number; // default 5 (triggers 30m cooldown)
  consecutiveLossCooldownMinutes: number; // default 30 minutes
}

export interface RiskValidationResult {
  approved: boolean;
  code: string;
  message: string;
  calculatedPositionSize: number;
  riskAmountUSD: number;
  riskPercentOfEquity: number;
  checks: {
    name: string;
    passed: boolean;
    detail: string;
  }[];
  cooldownActive?: boolean;
}

export interface StrategyConfig {
  id: string;
  name: string;
  version: string;
  type: 'TREND_FOLLOWING' | 'MEAN_REVERSION' | 'MOMENTUM_RELATIVE_STRENGTH' | 'REGIME_CLASSIFIER';
  enabled: boolean;
  targetAssetClasses: AssetClass[];
  parameters: Record<string, number | string | boolean>;
  allowedRegimes: MarketRegimeType[];
  allocationPct: number;
  activeSignalsCount: number;
  isSuspended: boolean;
  consecutiveLosses: number;
  cooldown?: CooldownState;
  autoExecutionDisabled?: boolean;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  version: string;
  parameters: Record<string, number | string | boolean>;
  purpose: string;
  eligibleSymbols: string[];
  eligibleAssetClasses: AssetClass[];
  eligibleTimeframes: string[];
  marketConditions: MarketRegimeType[];
  candleRules: string;
  comparisonBaselines: string[];
  maximumSpreadBasisPoints: number;
  maximumCostsPctOfGrossNotional: number;
  entryRules: string;
  confirmationRules: string;
  invalidationRules: string;
  exitRules: string;
  expectedHoldingPeriod: string;
  requiredData: string[];
  executionAssumptions: string[];
  positionSizing: string;
  maximumRiskPct: number;
  noTradeConditions: string[];
  knownLimitations: string[];
}

export interface StrategyCandidateAssessment {
  strategyId: string;
  strategyName: string;
  strategyVersion: string;
  suitable: boolean;
  confidence: number | null;
  reasons: string[];
  validationStatus: 'NOT_VALIDATED' | 'INSUFFICIENT_EVIDENCE' | 'QUALIFIED';
  validationEvidence: StrategyValidationSummary | null;
}

export interface StrategyValidationSummary {
  evidenceId: string;
  dataSetId: string;
  codeRevision: string;
  completedAt: number;
  outOfSampleTrades: number;
  walkForwardWindows: number;
  outOfSampleNetExpectancyPct: number;
  netExpectancyLower95Pct: number;
  outOfSampleSharpe: number;
  annualizedTurnover: number;
  totalCostsPctOfGrossNotional: number;
  maximumCostsPctOfGrossNotional: number;
  includesRealisticCosts: boolean;
  includesAdverseExecution: boolean;
  passedBiasReview: boolean;
  maxDrawdownPct: number;
  stableAcrossWindows: boolean;
}

export interface StrategySelectionDecision {
  symbol: string;
  timeframe: string;
  decision: 'SELECT' | 'NO_TRADE';
  selectedStrategyId: string | null;
  marketCondition: MarketRegimeType | 'UNKNOWN';
  regimeConfidence: number | null;
  regimeConfidenceMethod: string | null;
  dataStatus: 'VERIFIED' | 'DEGRADED' | 'UNAVAILABLE';
  dataProvider: string | null;
  sourceTimestamp: number | null;
  quoteIsBrokerExecutable: boolean;
  candleProvider: string | null;
  candleTimestamp: number | null;
  spreadBasisPoints: number | null;
  sessionStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  decidedAt: number;
  reasons: string[];
  candidates: StrategyCandidateAssessment[];
}

export interface BacktestRequest {
  strategyId: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  slippageModelPct: number;
  commissionPerTrade: number;
  walkForwardSegments?: number;
  parameters: Record<string, number | string | boolean>;
}

export interface BacktestTrade {
  id: string;
  entryTime: number;
  exitTime: number;
  symbol: string;
  side: OrderSide;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  netPnL: number;
  netReturnPct: number;
  fees: number;
  slippageUSD: number;
  exitReason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'REGIME_INVALIDATION' | 'TIME_EXIT';
  regime: MarketRegimeType;
}

export interface BacktestResult {
  id: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  period: { start: string; end: string };
  initialCapital: number;
  finalEquity: number;
  netReturnPct: number;
  annualizedReturnPct: number;
  benchmarkReturnPct: number;
  noTradeReturnPct: number;
  maxDrawdownPct: number;
  maxDrawdownDurationDays: number;
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  expectancyUSD: number;
  winRatePct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWinUSD: number;
  avgLossUSD: number;
  totalFeesPaid: number;
  totalSlippageCost: number;
  trades: BacktestTrade[];
  equityCurve: { time: number; equity: number; benchmark: number; drawdown: number }[];
  regimePerformance: {
    regime: MarketRegimeType;
    trades: number;
    winRate: number;
    netPnL: number;
  }[];
  validationMetrics: {
    inSampleSharpe: number;
    outOfSampleSharpe: number;
    degradationPct: number;
    inSampleTrades: number;
    outOfSampleTrades: number;
  };
}

export interface SystemHealthReport {
  overallState: HealthState;
  rolloutStage: RolloutStage;
  liveExecutionAuthorized: boolean;
  recoveryObjectives: RecoveryObjectives;
  timestamp: number;
  uptimeSeconds: number;
  failClosedArmed: boolean;
  components: {
    apiProcess: { state: HealthState; latencyMs: number | null; details: string };
    databaseAndState: { state: HealthState; ordersCount: number; auditEventsCount: number; details: string };
    riskEngine: { state: HealthState; dailyLossTripped: boolean; globalKillSwitch: boolean };
    marketDataFeeds: {
      state: HealthState;
      activeSymbols: number;
      staleFeedsCount: number;
      avgLatencyMs: number | null;
      sourceLabel: string;
    };
    brokerAdapters: {
      provider: string;
      state: HealthState;
      connectionType: 'LOCAL_SIMULATOR' | 'LIVE_BROKER' | 'LIVE_EXCHANGE';
      details: string;
      reconciled: boolean;
    }[];
    reconciliation: {
      state: HealthState;
      unresolvedDiscrepancies: number;
      lastReconciledAt: number;
      source: 'LOCAL_PAPER_LEDGER';
    };
  };
  activeWarnings: string[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  category: 'RISK_DECISION' | 'ORDER_STATE' | 'STRATEGY_SIGNAL' | 'KILL_SWITCH' | 'HEALTH_CHECK' | 'RECONCILIATION';
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  action: string;
  details: Record<string, unknown>;
  actor: 'RISK_ENGINE' | 'STRATEGY_ENGINE' | 'PAPER_EXECUTION' | 'OPERATOR' | 'HEALTH_MONITOR';
}

export interface AIResearchResponse {
  hypothesis: string;
  marketRegimeAssessment: string;
  riskEvaluation: string;
  explainableSignals: {
    symbol: string;
    recommendation: 'STRONG_SIGNAL' | 'CAUTIOUS' | 'NO_TRADE';
    quantitativeReasoning: string;
    riskBoundary: string;
  }[];
  regulatoryNotice: string;
}

// ==========================================
// Broker-Truth & Verified Data Types
// ==========================================
export type DataProvenance =
  | 'BROKER_CONFIRMED'
  | 'THIRD_PARTY'
  | 'APP_ESTIMATED'
  | 'HISTORICAL'
  | 'CACHED'
  | 'SIMULATED'
  | 'UNAVAILABLE'
  | 'STALE';

export interface BrokerConnectionInfo {
  brokerName: string | null;
  server: string | null;
  accountId: string | null;
  accountMode: 'DEMO' | 'REAL' | 'SIMULATED' | 'UNKNOWN';
  currency: string | null;
  leverage: number | null;
  connectionHealth: 'CONNECTED' | 'AUTHENTICATED_READ_ONLY' | 'DISCONNECTED' | 'DEGRADED' | 'UNAUTHENTICATED';
  readOnlyAuthenticated: boolean;
  executionPermitted: boolean;
  lastSyncTimestamp: number | null;
  pingLatencyMs: number | null;
}

export interface BrokerAccountSnapshot {
  balance: number | null;
  equity: number | null;
  margin: number | null;
  freeMargin: number | null;
  marginLevelPct: number | null;
  currency: string | null;
  asOf: number | null;
  provenance: DataProvenance;
}

export interface QuoteProvenanceRecord {
  brokerSymbol: string | null;
  appSymbol: string;
  ticketOrSeq: number | null;
  bid: number;
  ask: number;
  sourceTimestamp: number;
  receiptTimestamp: number;
  quoteAgeMs: number | null;
  provenance: DataProvenance;
  connectionHealth: 'HEALTHY' | 'DEGRADED' | 'STALE' | 'DISCONNECTED' | 'UNAUTHENTICATED';
  isStale: boolean;
  unavailableReason?: string;
}

export interface BrokerPositionRecord {
  ticket: string;
  symbol: string;
  side: OrderSide;
  lots: number;
  openPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  commission: number;
  swap: number;
  taxes: number;
  brokerReportedProfit: number;
  appEstimatedProfit: number;
  discrepancyUSD: number;
  discrepancyExplanation?: string;
  provenance: DataProvenance;
  stopModificationStatus: 'ACTIVE_CONFIRMED' | 'MODIFICATION_PENDING' | 'REJECTED';
}

export interface BrokerDealRecord {
  ticket: string;
  orderTicket: string;
  time: number;
  symbol: string;
  side: OrderSide;
  lots: number;
  price: number;
  commission: number;
  swap: number;
  fee: number;
  profit: number;
  dealType: 'IN' | 'OUT' | 'INOUT';
  provenance: DataProvenance;
}

export interface PnLVerificationSummary {
  realizedPnL: number | null;
  unrealizedPnL: number | null;
  grossPnL: number | null;
  totalCommissions: number | null;
  totalFees: number | null;
  totalSwaps: number | null;
  currencyConversionAdjustment: number | null;
  brokerReportedTotalPnL: number | null;
  appCalculatedTotalPnL: number | null;
  netDiscrepancy: number | null;
  hasDiscrepancy: boolean | null;
  discrepancyExplanation?: string;
  verifiedAsOf: number | null;
  provenance: DataProvenance;
}

export interface PermissionGateCheck {
  name: string;
  code: string;
  passed: boolean;
  critical: boolean;
  details: string;
}

export interface PermissionGateResult {
  approved: boolean;
  gateCode: string;
  message: string;
  checks: PermissionGateCheck[];
  timestamp: number;
}

export interface TradeStopState {
  initialStopPrice: number | null;
  localActiveStopPrice: number | null;
  brokerConfirmedStopPrice: number | null;
  pendingStopPrice: number | null;
  remainingRiskUsd: number | null;
  estimatedCostUsd: number | null;
  rule: string;
  status: 'CONFIRMED' | 'UNCONFIRMED_LOCAL_ONLY' | 'REJECTED';
}

export interface StopModificationEvaluationResult {
  approved: boolean;
  code: string;
  status?: 'UNCONFIRMED_LOCAL_ONLY' | 'REJECTED';
  message: string;
  appliedStop: number;
  confirmedStop?: number | null;
  lastConfirmedStop?: number | null;
  pendingStop?: number | null;
}

export interface StopDisciplineRule {
  symbol: string;
  strategyId: string;
  initialStopRequired: boolean;
  breakEvenThresholdR: number; // e.g. 1.5R or 1.5 ATR
  breakEvenBufferPips: number; // spread + cost cushion
  trailingType: 'ATR_CHANDELIER' | 'SWING_STRUCTURE' | 'FIXED_R' | 'NONE';
  trailingParam: number; // e.g. 2.0 ATR
  stopWideningProhibited: true; // immutable invariant: stops can NEVER be widened
}

export interface BrokerTruthState {
  connection: BrokerConnectionInfo;
  accountSnapshot: BrokerAccountSnapshot;
  quotes: QuoteProvenanceRecord[];
  positions: BrokerPositionRecord[];
  deals: BrokerDealRecord[];
  pnlVerification: PnLVerificationSummary;
  stopRules: StopDisciplineRule[];
  reconciliationStatus: {
    inSync: boolean;
    status: 'RECONCILED' | 'DISCREPANCY' | 'UNAVAILABLE';
    unresolvedDiscrepancies: number | null;
    lastReconciledAt: number | null;
    details: string;
  };
}
