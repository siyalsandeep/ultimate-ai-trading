import {
  AssetClass,
  MarketRegimeType,
  StrategyCandidateAssessment,
  StrategyDefinition,
  StrategySelectionDecision,
  StrategyValidationSummary,
} from '../../src/types/trading';

export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [
  {
    id: 'strat_trend',
    name: 'Trend Following (EMA + ADX + ATR)',
    version: '1.1.0',
    parameters: {
      adxThreshold: 25,
      fastEmaPeriod: 20,
      slowEmaPeriod: 50,
      rsiMinimum: 52,
      rsiMaximum: 75,
      atrStopMultiplier: 2,
      takeProfitAtrMultiple: 4,
    },
    purpose: 'Participate in established directional moves with volatility-based protective exits.',
    eligibleSymbols: ['SPY', 'QQQ', 'AAPL', 'NVDA', 'MSFT', 'BTC/USDT', 'ETH/USDT'],
    eligibleAssetClasses: ['EQUITY', 'CRYPTO', 'INDEX', 'COMMODITY'],
    eligibleTimeframes: ['1d'],
    marketConditions: ['TRENDING_BULL'],
    candleRules: 'Use at least 50 complete daily candles; evaluate indicators only at the close of the latest completed candle and make any hypothetical fill no earlier than the next candle open.',
    comparisonBaselines: ['Buy-and-hold of the same instrument over the identical dates', 'Cash/no-trade with unchanged initial capital'],
    maximumSpreadBasisPoints: 15,
    maximumCostsPctOfGrossNotional: 0.3,
    entryRules: 'Long-only: close above configured fast EMA, fast EMA above configured slow EMA, and RSI within configured bounds; shorts and bearish entries are not implemented.',
    confirmationRules: 'ADX14 at or above the configured threshold and a fresh, source-verified quote.',
    invalidationRules: 'Trend regime no longer applies or price crosses the initial ATR-based stop.',
    exitRules: 'Initial ATR stop, predefined take-profit, or regime invalidation; no stop widening.',
    expectedHoldingPeriod: 'Several daily bars; exact maximum holding period is not validated.',
    requiredData: ['Verified daily OHLCV and indicators', 'Fresh bid/ask quote', 'Instrument tick, spread, and cost specifications'],
    executionAssumptions: ['Limit and market execution behavior must be calibrated per venue', 'Spread, commission, slippage, gaps, and rejects included in validation'],
    positionSizing: 'Quantity from stop distance and approved account risk budget; no size increase from performance.',
    maximumRiskPct: 0.25,
    noTradeConditions: ['Unknown or shock regime', 'Missing or stale data', 'No version-matched out-of-sample evidence', 'Risk gate or cooldown blocks entry'],
    knownLimitations: ['Current implementation uses simulated candles and does not validate short entries or holding duration.'],
  },
  {
    id: 'strat_mean_reversion',
    name: 'Statistical Mean Reversion (Bollinger + RSI)',
    version: '1.1.0',
    parameters: {
      bbPeriod: 20,
      bbStdDev: 2,
      rsiPeriod: 14,
      rsiOversold: 30,
      atrStopMultiplier: 1.5,
      lowerBandTolerance: 0.004,
    },
    purpose: 'Evaluate reversions toward a range mean only in validated range conditions.',
    eligibleSymbols: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'EUR/USD', 'USD/JPY'],
    eligibleAssetClasses: ['EQUITY', 'FOREX', 'INDEX'],
    eligibleTimeframes: ['1d'],
    marketConditions: ['RANGING_LOW_VOL', 'RANGING_HIGH_VOL'],
    candleRules: 'Use at least 20 complete daily candles; the lower-band/RSI test uses only the latest completed candle, with hypothetical entry no earlier than the next candle open.',
    comparisonBaselines: ['Buy-and-hold of the same instrument over the identical dates', 'Cash/no-trade with unchanged initial capital'],
    maximumSpreadBasisPoints: 10,
    maximumCostsPctOfGrossNotional: 0.2,
    entryRules: 'Close near/beyond the lower Bollinger band with RSI at/below the configured oversold threshold for long entries; short-side symmetry requires separate validation.',
    confirmationRules: 'Range regime and fresh, source-verified quote; spread and estimated round-trip costs below the validated cost hurdle.',
    invalidationRules: 'Range regime ends, event/gap risk exceeds validated bounds, or initial ATR stop is reached.',
    exitRules: 'Predefined mean target or ATR stop; no widening or unconfirmed stop change.',
    expectedHoldingPeriod: 'Until mean target or invalidation; maximum duration is not yet validated.',
    requiredData: ['Verified daily OHLCV and Bollinger/RSI/ATR values', 'Fresh bid/ask quote', 'Instrument calendar and cost specifications'],
    executionAssumptions: ['Reversion fills account for spread, fees, slippage, gaps, and rejected orders'],
    positionSizing: 'Quantity from initial stop distance and approved account risk budget.',
    maximumRiskPct: 0.25,
    noTradeConditions: ['Trending or unknown regime', 'Stale/conflicting data', 'Unmodeled event risk', 'No qualifying out-of-sample evidence'],
    knownLimitations: ['A range can transition into a persistent trend; current backtests do not establish live execution quality.'],
  },
  {
    id: 'strat_momentum',
    name: 'Cross-Asset Risk-Adjusted Momentum',
    version: '1.1.0',
    parameters: {
      lookbackBars: 20,
      volatilityFilterMax: 2.5,
      minMomentumScore: 1.2,
      atrStopMultiplier: 1.8,
      takeProfitAtrMultiple: 3.6,
    },
    purpose: 'Evaluate positive risk-adjusted medium-term momentum after a cost hurdle.',
    eligibleSymbols: ['SPY', 'QQQ', 'AAPL', 'NVDA', 'MSFT', 'BTC/USDT', 'ETH/USDT'],
    eligibleAssetClasses: ['EQUITY', 'CRYPTO', 'COMMODITY', 'INDEX'],
    eligibleTimeframes: ['1d'],
    marketConditions: ['TRENDING_BULL', 'RANGING_LOW_VOL'],
    candleRules: 'Use at least 21 complete daily candles; compute lookback return and volatility using data available at the latest completed candle, with hypothetical entry no earlier than the next candle open.',
    comparisonBaselines: ['Buy-and-hold of the same instrument over the identical dates', 'Cash/no-trade with unchanged initial capital'],
    maximumSpreadBasisPoints: 15,
    maximumCostsPctOfGrossNotional: 0.3,
    entryRules: 'Positive lookback return normalized by volatility exceeds the configured minimum score.',
    confirmationRules: 'Volatility remains within the configured range and expected round-trip costs remain below the validated hurdle.',
    invalidationRules: 'Momentum or volatility filter fails, regime becomes unknown/shock, or initial ATR stop is reached.',
    exitRules: 'Predefined ATR stop, target, or signal invalidation.',
    expectedHoldingPeriod: 'Multi-session; exact duration is not validated.',
    requiredData: ['Verified daily OHLCV history', 'Fresh executable quote', 'Comparable cross-asset mappings and transaction costs'],
    executionAssumptions: ['Rebalance and turnover costs, spread, slippage, gaps, and unavailable/rejected fills included'],
    positionSizing: 'Quantity from initial stop distance and approved account risk budget.',
    maximumRiskPct: 0.25,
    noTradeConditions: ['Insufficient history', 'Unknown regime', 'Cost hurdle not met', 'No qualifying out-of-sample evidence'],
    knownLimitations: ['Cross-asset comparability, survivorship effects, and turnover have not been validated.'],
  },
  {
    id: 'strat_regime',
    name: 'Adaptive Market Regime Classifier',
    version: '1.1.0',
    parameters: {
      adxThreshold: 25,
      volatilityCeiling: 3.5,
      lowVolatilityCeiling: 1.2,
      minimumHistoryBars: 20,
    },
    purpose: 'Classify market conditions to inform suitability checks; it is not an entry strategy.',
    eligibleSymbols: ['SPY', 'QQQ', 'AAPL', 'NVDA', 'MSFT', 'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'EUR/USD', 'USD/JPY', 'XAU/USD', 'WTI/USD'],
    eligibleAssetClasses: ['EQUITY', 'CRYPTO', 'FOREX', 'COMMODITY', 'INDEX'],
    eligibleTimeframes: ['1d'],
    marketConditions: ['TRENDING_BULL', 'TRENDING_BEAR', 'RANGING_LOW_VOL', 'RANGING_HIGH_VOL', 'UNCERTAIN_SHOCK'],
    candleRules: 'Classify only from at least 20 complete daily candles and indicators computed through the latest completed candle; output is informational and never an entry signal.',
    comparisonBaselines: ['Cash/no-trade; the classifier has no entry or order baseline'],
    maximumSpreadBasisPoints: 0,
    maximumCostsPctOfGrossNotional: 0,
    entryRules: 'No entry rule; classifier only.',
    confirmationRules: 'Requires valid indicators from source-verified, timestamped daily history.',
    invalidationRules: 'Insufficient, stale, conflicting, or out-of-range observations produce UNKNOWN.',
    exitRules: 'Not applicable.',
    expectedHoldingPeriod: 'Not applicable.',
    requiredData: ['Verified daily OHLCV and documented indicator calculations'],
    executionAssumptions: ['No execution; classifier output is informational and uncertain'],
    positionSizing: 'Not applicable.',
    maximumRiskPct: 0,
    noTradeConditions: ['Unknown or low-confidence classification'],
    knownLimitations: ['Current classifier is based on synthetic data and lacks calibrated confidence.'],
  },
];

export interface StrategyValidationEvidence {
  evidenceId: string;
  dataSetId: string;
  codeRevision: string;
  completedAt: number;
  strategyId: string;
  strategyVersion: string;
  symbol: string;
  timeframe: string;
  marketCondition: MarketRegimeType;
  outOfSampleTrades: number;
  walkForwardWindows: number;
  outOfSampleNetExpectancyPct: number;
  netExpectancyLower95Pct: number;
  outOfSampleSharpe: number;
  annualizedTurnover: number;
  totalCostsPctOfGrossNotional: number;
  includesRealisticCosts: boolean;
  includesAdverseExecution: boolean;
  passedBiasReview: boolean;
  maxDrawdownPct: number;
  stableAcrossWindows: boolean;
}

export interface StrategySelectionInput {
  symbol: string;
  assetClass: AssetClass | null;
  timeframe: string;
  marketCondition: MarketRegimeType | 'UNKNOWN';
  regimeConfidence: number | null;
  regimeConfidenceMethod: string | null;
  regimeConfidenceCalibrated: boolean;
  quoteStatus: 'LIVE' | 'DELAYED' | 'SNAPSHOT' | 'HISTORICAL' | 'SIMULATED' | 'UNAVAILABLE' | null;
  quoteProvider: string | null;
  quoteTimestamp: number | null;
  quoteIsBrokerExecutable: boolean;
  quoteAgeMs: number | null;
  spreadBasisPoints: number | null;
  candlesVerified: boolean;
  candleProvider: string | null;
  candleTimestamp: number | null;
  candleAgeMs: number | null;
  sessionStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  strategyEnabled: Record<string, boolean>;
  blockedStrategyReasons: Record<string, string[]>;
  accountRiskBlocked: boolean;
  evidence: StrategyValidationEvidence[];
  now: number;
}

const MIN_REGIME_CONFIDENCE = 0.75;
const MIN_OUT_OF_SAMPLE_TRADES = 100;
const MIN_WALK_FORWARD_WINDOWS = 3;
const MAX_VALIDATED_DRAWDOWN_PCT = 5;
const MAX_QUOTE_AGE_MS = 30_000;
const MAX_CANDLE_AGE_MS = 36 * 60 * 60 * 1000;

function validationEvidenceFailures(definition: StrategyDefinition, input: StrategySelectionInput): string[] {
  const evidence = findEvidence(definition, input);
  if (!evidence) return ['No validation record matches this strategy version, instrument, timeframe, and market condition.'];
  const failures: string[] = [];
  if (!Number.isInteger(evidence.outOfSampleTrades) || evidence.outOfSampleTrades < MIN_OUT_OF_SAMPLE_TRADES) {
    failures.push(`Out-of-sample sample size must be at least ${MIN_OUT_OF_SAMPLE_TRADES} trades.`);
  }
  if (!Number.isInteger(evidence.walkForwardWindows) || evidence.walkForwardWindows < MIN_WALK_FORWARD_WINDOWS) {
    failures.push(`At least ${MIN_WALK_FORWARD_WINDOWS} walk-forward windows are required.`);
  }
  if (!Number.isFinite(evidence.outOfSampleNetExpectancyPct) || evidence.outOfSampleNetExpectancyPct <= 0) {
    failures.push('Cost-inclusive out-of-sample net expectancy must be positive.');
  }
  if (!Number.isFinite(evidence.netExpectancyLower95Pct) || evidence.netExpectancyLower95Pct <= 0) {
    failures.push('The 95% lower confidence bound for net expectancy must be positive.');
  }
  if (!Number.isFinite(evidence.outOfSampleSharpe)) failures.push('Out-of-sample risk-adjusted performance metric is missing.');
  if (!Number.isFinite(evidence.annualizedTurnover) || evidence.annualizedTurnover < 0) failures.push('Annualized turnover metric is invalid.');
  if (!Number.isFinite(evidence.totalCostsPctOfGrossNotional) || evidence.totalCostsPctOfGrossNotional < 0) {
    failures.push('Total transaction-cost metric is invalid.');
  } else if (evidence.totalCostsPctOfGrossNotional > definition.maximumCostsPctOfGrossNotional) {
    failures.push(`Total transaction costs exceed the strategy limit of ${definition.maximumCostsPctOfGrossNotional}% of gross notional.`);
  }
  if (!evidence.includesRealisticCosts) failures.push('Validation does not include realistic transaction costs.');
  if (!evidence.includesAdverseExecution) failures.push('Validation does not include adverse execution conditions.');
  if (!evidence.passedBiasReview) failures.push('Look-ahead, survivorship, and overfitting review has not passed.');
  if (!evidence.evidenceId || !evidence.dataSetId || !evidence.codeRevision) failures.push('Evidence, dataset, and code revision identifiers are required for reproduction.');
  if (!Number.isFinite(evidence.completedAt) || evidence.completedAt <= 0 || evidence.completedAt > input.now) {
    failures.push('Validation run timestamp is invalid.');
  }
  if (!Number.isFinite(evidence.maxDrawdownPct) || evidence.maxDrawdownPct < 0 || evidence.maxDrawdownPct > MAX_VALIDATED_DRAWDOWN_PCT) {
    failures.push(`Maximum drawdown must be between 0% and ${MAX_VALIDATED_DRAWDOWN_PCT}%.`);
  }
  if (!evidence.stableAcrossWindows) failures.push('Results are not stable across walk-forward windows.');
  return failures;
}

function findEvidence(definition: StrategyDefinition, input: StrategySelectionInput): StrategyValidationEvidence | undefined {
  return input.evidence.find((record) =>
    record.strategyId === definition.id &&
    record.strategyVersion === definition.version &&
    record.symbol === input.symbol &&
    record.timeframe === input.timeframe &&
    record.marketCondition === input.marketCondition
  );
}

function toValidationSummary(
  evidence: StrategyValidationEvidence,
  definition: StrategyDefinition
): StrategyValidationSummary {
  return {
    evidenceId: evidence.evidenceId,
    dataSetId: evidence.dataSetId,
    codeRevision: evidence.codeRevision,
    completedAt: evidence.completedAt,
    outOfSampleTrades: evidence.outOfSampleTrades,
    walkForwardWindows: evidence.walkForwardWindows,
    outOfSampleNetExpectancyPct: evidence.outOfSampleNetExpectancyPct,
    netExpectancyLower95Pct: evidence.netExpectancyLower95Pct,
    outOfSampleSharpe: evidence.outOfSampleSharpe,
    annualizedTurnover: evidence.annualizedTurnover,
    totalCostsPctOfGrossNotional: evidence.totalCostsPctOfGrossNotional,
    maximumCostsPctOfGrossNotional: definition.maximumCostsPctOfGrossNotional,
    includesRealisticCosts: evidence.includesRealisticCosts,
    includesAdverseExecution: evidence.includesAdverseExecution,
    passedBiasReview: evidence.passedBiasReview,
    maxDrawdownPct: evidence.maxDrawdownPct,
    stableAcrossWindows: evidence.stableAcrossWindows,
  };
}

export function evaluateStrategySelection(
  input: StrategySelectionInput,
  definitions: StrategyDefinition[] = STRATEGY_DEFINITIONS
): StrategySelectionDecision {
  const quoteFresh = input.quoteTimestamp !== null &&
    input.quoteAgeMs !== null &&
    input.quoteAgeMs >= 0 &&
    input.quoteAgeMs <= MAX_QUOTE_AGE_MS &&
    input.quoteTimestamp <= input.now;
  const candlesFresh = input.candleTimestamp !== null &&
    input.candleAgeMs !== null &&
    input.candleAgeMs >= 0 &&
    input.candleAgeMs <= MAX_CANDLE_AGE_MS &&
    input.candleTimestamp <= input.now &&
    Boolean(input.candleProvider);
  const providerVerified = Boolean(input.quoteProvider) &&
    input.quoteStatus === 'LIVE' &&
    input.quoteIsBrokerExecutable &&
    quoteFresh;
  const dataAvailable = providerVerified && input.candlesVerified && candlesFresh;
  const confidenceValid = input.regimeConfidence !== null &&
    input.regimeConfidenceCalibrated &&
    Boolean(input.regimeConfidenceMethod) &&
    Number.isFinite(input.regimeConfidence) &&
    input.regimeConfidence >= 0 &&
    input.regimeConfidence <= 1;
  const globalReasons: string[] = [];

  if (!providerVerified) {
    globalReasons.push('No fresh, verified broker-executable LIVE quote is available; third-party, delayed, snapshot, and simulated values cannot support a trade selection.');
  }
  if (!input.candlesVerified) {
    globalReasons.push('Required historical candles have not been verified from an authorized source.');
  } else if (!candlesFresh) {
    globalReasons.push('Verified candle history is missing a source timestamp, is stale, or is future-dated.');
  }
  if (input.marketCondition === 'UNKNOWN') {
    globalReasons.push('Market condition is UNKNOWN because data is insufficient, unreliable, or unvalidated.');
  }
  if (!confidenceValid || (input.regimeConfidence ?? -1) < MIN_REGIME_CONFIDENCE) {
    globalReasons.push(`A calibrated regime-confidence value of at least ${MIN_REGIME_CONFIDENCE.toFixed(2)} is required.`);
  }
  if (input.accountRiskBlocked) {
    globalReasons.push('Account-level risk, authorization, or cooldown controls block new entries.');
  }
  if (input.sessionStatus !== 'OPEN') {
    globalReasons.push(`Verified market session is ${input.sessionStatus}; new strategy selection is blocked.`);
  }

  const assessments: StrategyCandidateAssessment[] = definitions.map((definition) => {
    const reasons: string[] = [];
    if (!definition.eligibleAssetClasses.includes(input.assetClass as AssetClass)) {
      reasons.push('Instrument asset class is outside the strategy universe.');
    }
    if (!definition.eligibleSymbols.includes(input.symbol)) {
      reasons.push('Instrument is outside the explicitly versioned strategy universe.');
    }
    if (!definition.eligibleTimeframes.includes(input.timeframe)) {
      reasons.push('Timeframe is outside the strategy definition.');
    }
    if (!input.strategyEnabled[definition.id]) {
      reasons.push('Strategy is disabled by the operator or unavailable.');
    }
    if (definition.id === 'strat_regime') {
      reasons.push('The regime classifier is informational and cannot be selected for trade entry.');
    }
    if (input.accountRiskBlocked) {
      reasons.push('Account-level risk, authorization, or cooldown controls block new entries.');
    }
    if (input.marketCondition !== 'UNKNOWN' && !definition.marketConditions.includes(input.marketCondition)) {
      reasons.push(`Market condition ${input.marketCondition} is outside the strategy conditions.`);
    }
    if (
      input.spreadBasisPoints === null ||
      !Number.isFinite(input.spreadBasisPoints) ||
      input.spreadBasisPoints < 0 ||
      input.spreadBasisPoints > definition.maximumSpreadBasisPoints
    ) {
      reasons.push(`Spread is unavailable or exceeds the ${definition.maximumSpreadBasisPoints} bps strategy limit.`);
    }
    reasons.push(...(input.blockedStrategyReasons[definition.id] || []));

    const validationEvidence = findEvidence(definition, input);
    const validationFailures = validationEvidenceFailures(definition, input);
    reasons.push(...validationFailures);
    reasons.push(...globalReasons.filter((reason) => !reasons.includes(reason)));
    if (reasons.length === 0 && dataAvailable) {
      return {
        strategyId: definition.id,
        strategyName: definition.name,
        strategyVersion: definition.version,
        suitable: true,
        confidence: input.regimeConfidence,
        reasons: ['Conditions, data, risk controls, and version-matched validation evidence meet the configured suitability criteria.'],
        validationStatus: 'QUALIFIED' as const,
        validationEvidence: validationEvidence ? toValidationSummary(validationEvidence, definition) : null,
      };
    }
    return {
      strategyId: definition.id,
      strategyName: definition.name,
      strategyVersion: definition.version,
      suitable: false,
      confidence: dataAvailable && confidenceValid ? input.regimeConfidence : null,
      reasons,
      validationStatus: validationFailures.length === 0
        ? 'QUALIFIED' as const
        : validationEvidence
          ? 'INSUFFICIENT_EVIDENCE' as const
          : 'NOT_VALIDATED' as const,
      validationEvidence: validationEvidence ? toValidationSummary(validationEvidence, definition) : null,
    };
  });

  const candidates = assessments.filter((candidate) => candidate.suitable);
  const selected = candidates.length === 1 ? candidates[0] : null;
  if (candidates.length > 1) globalReasons.push('Multiple strategies qualify; selector abstains rather than ranking on recent returns.');
  if (candidates.length === 0 && globalReasons.length === 0) {
    globalReasons.push('No strategy passed its instrument-, regime-, risk-, and validation-specific suitability rules.');
  }

  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    decision: selected ? 'SELECT' : 'NO_TRADE',
    selectedStrategyId: selected?.strategyId || null,
    marketCondition: dataAvailable ? input.marketCondition : 'UNKNOWN',
    regimeConfidence: dataAvailable && confidenceValid ? input.regimeConfidence : null,
    regimeConfidenceMethod: confidenceValid ? input.regimeConfidenceMethod : null,
    dataStatus: dataAvailable ? 'VERIFIED' : providerVerified || input.candlesVerified ? 'DEGRADED' : 'UNAVAILABLE',
    dataProvider: input.quoteProvider,
    sourceTimestamp: input.quoteTimestamp,
    quoteIsBrokerExecutable: input.quoteIsBrokerExecutable,
    candleProvider: input.candleProvider,
    candleTimestamp: input.candleTimestamp,
    spreadBasisPoints: input.spreadBasisPoints,
    sessionStatus: input.sessionStatus,
    decidedAt: input.now,
    reasons: globalReasons,
    candidates: assessments,
  };
}
