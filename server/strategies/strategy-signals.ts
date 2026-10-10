import {
  CandleOHLCV,
  Instrument,
  MarketQuote,
  MarketRegimeType,
  StrategyConfig,
  TradeSignal,
} from '../../src/types/trading';
import { STRATEGY_DEFINITIONS } from './strategy-selection';

export interface StrategySignalInput {
  strategy: StrategyConfig;
  symbol: string;
  instrument: Instrument;
  quote: MarketQuote;
  completedCandles: CandleOHLCV[];
  regime: MarketRegimeType;
  now: number;
}

function finiteParameter(strategy: StrategyConfig, key: string): number | null {
  const value = strategy.parameters[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundToTick(price: number, tickSize: number): number {
  return Number((Math.round(price / tickSize) * tickSize).toFixed(
    Math.max(0, Math.ceil(-Math.log10(tickSize)))
  ));
}

export function evaluateResearchSignal(input: StrategySignalInput): TradeSignal | null {
  const { strategy, symbol, instrument, quote, completedCandles, regime, now } = input;
  if (!Number.isFinite(now) || now < 0) return null;
  if (!strategy.enabled || strategy.isSuspended || strategy.type === 'REGIME_CLASSIFIER') return null;
  if (!strategy.targetAssetClasses.includes(instrument.assetClass) || !strategy.allowedRegimes.includes(regime)) return null;
  if (
    quote.symbol !== symbol ||
    instrument.symbol !== symbol ||
    !Number.isFinite(quote.ask) ||
    quote.ask <= 0 ||
    quote.isStale ||
    !Number.isFinite(quote.timestamp) ||
    quote.timestamp > now ||
    now - quote.timestamp > 30_000 ||
    !Number.isFinite(instrument.tickSize) ||
    instrument.tickSize <= 0
  ) return null;

  const definition = STRATEGY_DEFINITIONS.find((candidate) => candidate.id === strategy.id);
  if (!definition || !definition.eligibleSymbols.includes(symbol) || !definition.eligibleTimeframes.includes('1d')) return null;

  const minimumBars = strategy.type === 'TREND_FOLLOWING' ? 50
    : strategy.type === 'MEAN_REVERSION' ? 20
      : 21;
  if (completedCandles.length < minimumBars) return null;
  if (completedCandles.some((bar, index) =>
    ![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) ||
    bar.time > now ||
    bar.open <= 0 ||
    bar.close <= 0 ||
    bar.low <= 0 ||
    bar.high < Math.max(bar.open, bar.close) ||
    bar.low > Math.min(bar.open, bar.close) ||
    bar.high < bar.low ||
    bar.volume < 0 ||
    (index > 0 && bar.time <= completedCandles[index - 1].time)
  )) return null;
  const candle = completedCandles[completedCandles.length - 1];
  const indicators = candle.indicators;
  if (
    !indicators ||
    !Number.isFinite(candle.close) ||
    candle.close <= 0 ||
    !Number.isFinite(candle.time) ||
    candle.time > now ||
    now - candle.time > 36 * 60 * 60 * 1000
  ) return null;

  const atr = indicators.atr14;
  if (!Number.isFinite(atr) || (atr ?? 0) <= 0) return null;

  let stopDistance: number;
  let takeProfit: number;
  let rationale: string;
  let factors: TradeSignal['factors'];

  if (strategy.type === 'TREND_FOLLOWING') {
    const adxThreshold = finiteParameter(strategy, 'adxThreshold');
    const fastEmaPeriod = finiteParameter(strategy, 'fastEmaPeriod');
    const slowEmaPeriod = finiteParameter(strategy, 'slowEmaPeriod');
    const rsiMinimum = finiteParameter(strategy, 'rsiMinimum');
    const rsiMaximum = finiteParameter(strategy, 'rsiMaximum');
    const atrMultiplier = finiteParameter(strategy, 'atrStopMultiplier');
    const targetMultiple = finiteParameter(strategy, 'takeProfitAtrMultiple');
    const emaValues: Record<number, number | undefined> = {
      20: indicators.ema20,
      50: indicators.ema50,
    };
    const fastEma = fastEmaPeriod === null ? undefined : emaValues[fastEmaPeriod];
    const slowEma = slowEmaPeriod === null ? undefined : emaValues[slowEmaPeriod];
    const { adx14, rsi14 } = indicators;
    if (
      adxThreshold === null || fastEmaPeriod === null || slowEmaPeriod === null ||
      fastEmaPeriod >= slowEmaPeriod || fastEma === undefined || slowEma === undefined ||
      rsiMinimum === null || rsiMaximum === null ||
      atrMultiplier === null || targetMultiple === null ||
      ![fastEma, slowEma, adx14, rsi14].every((value) => Number.isFinite(value))
    ) return null;
    if (!(candle.close > fastEma! && fastEma! > slowEma! && adx14! >= adxThreshold && rsi14! > rsiMinimum && rsi14! < rsiMaximum)) return null;
    stopDistance = atr! * atrMultiplier;
    takeProfit = roundToTick(quote.ask + atr! * targetMultiple, instrument.tickSize);
    rationale = 'Research rule match: completed daily close above EMA20 above EMA50, ADX threshold met, and RSI within configured range.';
    factors = [
      { name: 'ADX threshold', value: adx14!, status: 'FAVORABLE' },
      { name: `EMA${fastEmaPeriod} > EMA${slowEmaPeriod}`, value: `${fastEma} > ${slowEma}`, status: 'FAVORABLE' },
      { name: 'RSI range', value: rsi14!, status: 'FAVORABLE' },
      { name: 'ATR stop distance', value: stopDistance, status: 'FAVORABLE' },
    ];
  } else if (strategy.type === 'MEAN_REVERSION') {
    const rsiOversold = finiteParameter(strategy, 'rsiOversold');
    const atrMultiplier = finiteParameter(strategy, 'atrStopMultiplier');
    const tolerance = finiteParameter(strategy, 'lowerBandTolerance');
    const { bbLower, bbMiddle, rsi14 } = indicators;
    if (
      rsiOversold === null || atrMultiplier === null || tolerance === null ||
      ![bbLower, bbMiddle, rsi14].every((value) => Number.isFinite(value))
    ) return null;
    if (!(candle.close <= bbLower! * (1 + tolerance) && rsi14! <= rsiOversold && bbMiddle! > quote.ask)) return null;
    stopDistance = atr! * atrMultiplier;
    takeProfit = roundToTick(bbMiddle!, instrument.tickSize);
    rationale = 'Research rule match: completed daily close is within configured tolerance of the lower Bollinger band, RSI is oversold, and the mean target is above entry.';
    factors = [
      { name: 'Lower Bollinger band proximity', value: `${candle.close} / ${bbLower}`, status: 'FAVORABLE' },
      { name: 'RSI oversold threshold', value: rsi14!, status: 'FAVORABLE' },
      { name: 'Mean target', value: bbMiddle!, status: 'FAVORABLE' },
      { name: 'ATR stop distance', value: stopDistance, status: 'FAVORABLE' },
    ];
  } else if (strategy.type === 'MOMENTUM_RELATIVE_STRENGTH') {
    const lookbackBars = finiteParameter(strategy, 'lookbackBars');
    const maxVolatility = finiteParameter(strategy, 'volatilityFilterMax');
    const minMomentumScore = finiteParameter(strategy, 'minMomentumScore');
    const atrMultiplier = finiteParameter(strategy, 'atrStopMultiplier');
    const targetMultiple = finiteParameter(strategy, 'takeProfitAtrMultiple');
    const volatility = indicators.volatility;
    if (
      lookbackBars === null || !Number.isInteger(lookbackBars) || lookbackBars < 1 ||
      maxVolatility === null || minMomentumScore === null || atrMultiplier === null ||
      targetMultiple === null || !Number.isFinite(volatility) || (volatility ?? 0) < 0 ||
      completedCandles.length <= lookbackBars
    ) return null;
    const referenceClose = completedCandles[completedCandles.length - 1 - lookbackBars].close;
    if (!Number.isFinite(referenceClose) || referenceClose <= 0) return null;
    const returnPct = ((candle.close - referenceClose) / referenceClose) * 100;
    const riskAdjustedMomentum = returnPct / Math.max(0.1, volatility!);
    if (riskAdjustedMomentum < minMomentumScore || volatility! > maxVolatility) return null;
    stopDistance = atr! * atrMultiplier;
    takeProfit = roundToTick(quote.ask + atr! * targetMultiple, instrument.tickSize);
    rationale = `Research rule match: ${lookbackBars}-bar return normalized by volatility is ${riskAdjustedMomentum.toFixed(2)} and clears the configured threshold.`;
    factors = [
      { name: 'Risk-adjusted momentum', value: riskAdjustedMomentum, status: 'FAVORABLE' },
      { name: `${lookbackBars}-bar return`, value: returnPct, status: 'FAVORABLE' },
      { name: 'Volatility filter', value: volatility!, status: 'FAVORABLE' },
      { name: 'ATR stop distance', value: stopDistance, status: 'FAVORABLE' },
    ];
  } else {
    return null;
  }

  const stopLoss = roundToTick(quote.ask - stopDistance, instrument.tickSize);
  if (!Number.isFinite(stopLoss) || stopLoss <= 0 || stopLoss >= quote.ask || takeProfit <= quote.ask) return null;

  return {
    id: `sig_${now}_${symbol}_${strategy.id}`,
    strategyId: strategy.id,
    strategyName: strategy.name,
    symbol,
    side: 'BUY',
    confidence: null,
    entryPrice: quote.ask,
    stopLossPrice: stopLoss,
    takeProfitPrice: takeProfit,
    suggestedSize: 0,
    regime,
    rationale,
    factors,
    timestamp: now,
    status: 'NEW',
  };
}
