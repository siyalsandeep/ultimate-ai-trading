import {
  BacktestRequest,
  BacktestResult,
  BacktestTrade,
  CandleOHLCV,
  MarketRegimeType,
} from '../../src/types/trading';
import { marketDataService } from '../data/market-data-service';
import { STRATEGY_DEFINITIONS } from '../strategies/strategy-selection';

export class BacktestEngine {
  public runBacktest(req: BacktestRequest): BacktestResult {
    const symbol = req.symbol || 'SPY';
    const strategyDefinition = STRATEGY_DEFINITIONS.find((definition) => definition.id === req.strategyId);
    if (!strategyDefinition || req.strategyId === 'strat_regime') {
      throw new Error(`Unsupported entry strategy for backtesting: ${req.strategyId}`);
    }
    const overrides = req.parameters || {};
    const invalidOverride = Object.entries(overrides).some(([key, value]) =>
      !(key in strategyDefinition.parameters) ||
      typeof value !== typeof strategyDefinition.parameters[key] ||
      (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) ||
      (['fastEmaPeriod', 'slowEmaPeriod'].includes(key) &&
        (typeof value !== 'number' || !Number.isInteger(value) || ![20, 50].includes(value))) ||
      (['bbPeriod', 'bbStdDev', 'rsiPeriod'].includes(key) && value !== strategyDefinition.parameters[key]) ||
      (['rsiMinimum', 'rsiMaximum', 'rsiOversold'].includes(key) &&
        (typeof value !== 'number' || value > 100))
    );
    if (invalidOverride) throw new Error('Backtest parameters contain an unknown or invalid strategy setting.');
    const parameters = { ...strategyDefinition.parameters, ...overrides };
    if (
      Number(parameters.fastEmaPeriod) >= Number(parameters.slowEmaPeriod) ||
      Number(parameters.rsiMinimum) >= Number(parameters.rsiMaximum)
    ) throw new Error('Backtest strategy parameters are internally inconsistent.');
    const adxThreshold = typeof parameters.adxThreshold === 'number' && Number.isFinite(parameters.adxThreshold)
      ? parameters.adxThreshold
      : 25;
    const numericParameter = (name: string): number => {
      const value = parameters[name];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Invalid backtest parameter: ${name}`);
      }
      return value;
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(req.endDate)) {
      throw new Error('Backtest startDate and endDate must use YYYY-MM-DD.');
    }
    const startTimestamp = Date.parse(`${req.startDate}T00:00:00.000Z`);
    const endTimestamp = Date.parse(`${req.endDate}T23:59:59.999Z`);
    if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp) || startTimestamp > endTimestamp) {
      throw new Error('Backtest date range is invalid.');
    }
    const initialCapital = req.initialCapital ?? 100000;
    const slippagePct = req.slippageModelPct ?? 0.0002;
    const commissionPerTrade = req.commissionPerTrade ?? 1.5;
    if (!Number.isFinite(initialCapital) || initialCapital <= 0 ||
      !Number.isFinite(slippagePct) || slippagePct < 0 ||
      !Number.isFinite(commissionPerTrade) || commissionPerTrade < 0) {
      throw new Error('Backtest capital, slippage, and commission inputs must be finite and non-negative (capital must be positive).');
    }
    const instrument = marketDataService.getInstrument(symbol);
    const allCandles = marketDataService.getCandles(symbol, 150)
      .filter((candle) => candle.time >= startTimestamp && candle.time <= endTimestamp);
    if (allCandles.length < 30) throw new Error(`Insufficient candle history for backtesting: ${symbol}`);

    let equity = initialCapital;
    let peakEquity = initialCapital;
    let maxDrawdownUSD = 0;
    let maxDrawdownPct = 0;
    let drawdownStartIdx = 0;
    let maxDrawdownDurationDays = 0;

    const trades: BacktestTrade[] = [];
    const equityCurve: { time: number; equity: number; benchmark: number; drawdown: number }[] = [];
    const inSampleReturns: number[] = [];
    const outOfSampleReturns: number[] = [];
    let priorEquity = initialCapital;

    const benchmarkStartPrice = allCandles[25]?.close || allCandles[0]?.close || 1;
    let inSampleWins = 0;
    let inSampleTrades = 0;
    let outSampleWins = 0;
    let outSampleTrades = 0;

    const splitIdx = Math.floor(allCandles.length * 0.7); // 70% In-Sample, 30% Out-of-Sample

    // Regime performance map
    const regimeStats: Record<MarketRegimeType, { trades: number; wins: number; netPnL: number }> = {
      TRENDING_BULL: { trades: 0, wins: 0, netPnL: 0 },
      TRENDING_BEAR: { trades: 0, wins: 0, netPnL: 0 },
      RANGING_LOW_VOL: { trades: 0, wins: 0, netPnL: 0 },
      RANGING_HIGH_VOL: { trades: 0, wins: 0, netPnL: 0 },
      UNCERTAIN_SHOCK: { trades: 0, wins: 0, netPnL: 0 },
    };

    type ActiveTrade = {
      entryTime: number;
      entryPrice: number;
      quantity: number;
      stopLoss: number;
      takeProfit: number;
      regime: MarketRegimeType;
      side: 'BUY' | 'SELL';
    };
    let activeTrade: ActiveTrade | null = null;
    const closeActiveTrade = (
      exitPrice: number,
      exitReason: BacktestTrade['exitReason'],
      bar: CandleOHLCV,
      barIndex: number,
    ) => {
      if (!activeTrade) return;
      const spreadCost = exitPrice * (instrument?.typicalSpreadPct || 0.0003);
      const slippageCost = exitPrice * slippagePct;
      const adjustedExitPrice = exitPrice - spreadCost - slippageCost;
      const grossPnL = (adjustedExitPrice - activeTrade.entryPrice) * activeTrade.quantity;
      const totalFees = commissionPerTrade * 2;
      const netPnL = grossPnL - totalFees;

      equity += netPnL;
      trades.push({
        id: `bt_${trades.length + 1}`,
        entryTime: activeTrade.entryTime,
        exitTime: bar.time,
        symbol,
        side: activeTrade.side,
        entryPrice: activeTrade.entryPrice,
        exitPrice: Number(exitPrice.toFixed(2)),
        quantity: activeTrade.quantity,
        netPnL: Number(netPnL.toFixed(2)),
        netReturnPct: Number(((netPnL / (activeTrade.entryPrice * activeTrade.quantity)) * 100).toFixed(2)),
        fees: totalFees,
        slippageUSD: Number(((spreadCost + slippageCost) * activeTrade.quantity).toFixed(2)),
        exitReason,
        regime: activeTrade.regime,
      });
      const regStat = regimeStats[activeTrade.regime];
      regStat.trades++;
      if (netPnL > 0) regStat.wins++;
      regStat.netPnL += netPnL;
      if (barIndex < splitIdx) {
        inSampleTrades++;
        if (netPnL > 0) inSampleWins++;
      } else {
        outSampleTrades++;
        if (netPnL > 0) outSampleWins++;
      }
      activeTrade = null;
    };

    for (let i = 25; i < allCandles.length; i++) {
      const bar = allCandles[i];
      const prevBar = allCandles[i - 1];
      const ind = prevBar.indicators; // No look-ahead bias: make decisions strictly on closed bar i-1!
      if (!ind) continue;

      const currentRegime: MarketRegimeType =
        (ind.volatility || 1) > 3.0
          ? 'UNCERTAIN_SHOCK'
          : (ind.adx14 || 0) >= adxThreshold
          ? (ind.rsi14 || 50) > 50
            ? 'TRENDING_BULL'
            : 'TRENDING_BEAR'
          : (ind.volatility || 1) < 1.2
          ? 'RANGING_LOW_VOL'
          : 'RANGING_HIGH_VOL';

      if (activeTrade && i === splitIdx) {
        closeActiveTrade(bar.open, 'TIME_EXIT', bar, splitIdx - 1);
        priorEquity = equity;
      }

      // 1. Manage existing trade exit
      if (activeTrade) {
        if (bar.open <= activeTrade.stopLoss || bar.low <= activeTrade.stopLoss) {
          closeActiveTrade(bar.open <= activeTrade.stopLoss ? bar.open : activeTrade.stopLoss, 'STOP_LOSS', bar, i);
        } else if (bar.open >= activeTrade.takeProfit || bar.high >= activeTrade.takeProfit) {
          closeActiveTrade(bar.open >= activeTrade.takeProfit ? bar.open : activeTrade.takeProfit, 'TAKE_PROFIT', bar, i);
        } else if (currentRegime === 'UNCERTAIN_SHOCK') {
          closeActiveTrade(bar.open, 'REGIME_INVALIDATION', bar, i);
        }
      }

      // 2. Generate new entry if no active trade
      if (!activeTrade) {
        let shouldEnter = false;
        let stopDistance = (ind.atr14 || prevBar.close * 0.02) * numericParameter('atrStopMultiplier');
        let targetPrice: number | null = null;

        if (req.strategyId === 'strat_trend') {
          const emaValues: Record<number, number | undefined> = {
            20: ind.ema20,
            50: ind.ema50,
          };
          const fastEma = emaValues[numericParameter('fastEmaPeriod')];
          const slowEma = emaValues[numericParameter('slowEmaPeriod')];
          shouldEnter = currentRegime === 'TRENDING_BULL' &&
            Number.isFinite(fastEma) && Number.isFinite(slowEma) &&
            prevBar.close > fastEma! && fastEma! > slowEma! &&
            (ind.rsi14 ?? Number.NEGATIVE_INFINITY) > numericParameter('rsiMinimum') &&
            (ind.rsi14 ?? Number.POSITIVE_INFINITY) < numericParameter('rsiMaximum') &&
            (ind.adx14 ?? Number.NEGATIVE_INFINITY) >= numericParameter('adxThreshold');
          targetPrice = prevBar.close + (ind.atr14 || 0) * numericParameter('takeProfitAtrMultiple');
        } else if (req.strategyId === 'strat_mean_reversion') {
          shouldEnter = ['RANGING_LOW_VOL', 'RANGING_HIGH_VOL'].includes(currentRegime) &&
            Number.isFinite(ind.bbLower) && Number.isFinite(ind.bbMiddle) &&
            prevBar.close <= ind.bbLower! * (1 + numericParameter('lowerBandTolerance')) &&
            (ind.rsi14 ?? Number.POSITIVE_INFINITY) <= numericParameter('rsiOversold');
          stopDistance = (ind.atr14 || prevBar.close * 0.015) * numericParameter('atrStopMultiplier');
          targetPrice = ind.bbMiddle ?? null;
        } else if (req.strategyId === 'strat_momentum') {
          const lookbackBars = numericParameter('lookbackBars');
          const referenceBar = Number.isInteger(lookbackBars) && lookbackBars > 0
            ? allCandles[i - 1 - lookbackBars]
            : undefined;
          const volatility = ind.volatility;
          const momentumScore = referenceBar && referenceBar.close > 0 && Number.isFinite(volatility)
            ? ((prevBar.close - referenceBar.close) / referenceBar.close * 100) / Math.max(0.1, volatility!)
            : Number.NEGATIVE_INFINITY;
          shouldEnter = ['TRENDING_BULL', 'RANGING_LOW_VOL'].includes(currentRegime) &&
            Number.isFinite(volatility) && volatility! <= numericParameter('volatilityFilterMax') &&
            momentumScore >= numericParameter('minMomentumScore');
          stopDistance = (ind.atr14 || prevBar.close * 0.02) * numericParameter('atrStopMultiplier');
          targetPrice = prevBar.close + (ind.atr14 || 0) * numericParameter('takeProfitAtrMultiple');
        }

        if (shouldEnter && targetPrice !== null) {
          const entryPrice = bar.open * (1 + slippagePct);
          const stopLoss = entryPrice - stopDistance;
          const takeProfit = targetPrice;
          if (takeProfit > entryPrice && stopLoss > 0 && stopLoss < entryPrice) {
            const riskAmountUSD = equity * 0.0025; // 0.25% risk per trade
            const canValueInUsd = instrument?.currency === 'USD';
            const validLotRules = instrument &&
              Number.isFinite(instrument.minLotSize) && instrument.minLotSize > 0 &&
              Number.isFinite(instrument.lotStep) && instrument.lotStep > 0;
            if (canValueInUsd && validLotRules && Number.isFinite(stopDistance) && stopDistance > 0) {
              const rawQuantity = riskAmountUSD / stopDistance;
              const quantity = Math.floor(rawQuantity / instrument.lotStep) * instrument.lotStep;
              if (Number.isFinite(quantity) && quantity >= instrument.minLotSize) {
                activeTrade = {
                  entryTime: bar.time,
                  entryPrice,
                  quantity,
                  stopLoss,
                  takeProfit,
                  regime: currentRegime,
                  side: 'BUY',
                };
                if (bar.low <= stopLoss) {
                  closeActiveTrade(stopLoss, 'STOP_LOSS', bar, i);
                } else if (bar.high >= takeProfit) {
                  closeActiveTrade(takeProfit, 'TAKE_PROFIT', bar, i);
                }
              }
            }
          }
        }
      }

      // Track peak and drawdown
      if (equity > peakEquity) {
        peakEquity = equity;
        drawdownStartIdx = i;
      }
      const currentDD = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      if (currentDD > maxDrawdownPct) {
        maxDrawdownPct = currentDD;
        maxDrawdownUSD = peakEquity - equity;
        maxDrawdownDurationDays = i - drawdownStartIdx;
      }

      const benchmarkPrice = bar.close;
      const benchmarkReturnPct = ((benchmarkPrice - benchmarkStartPrice) / benchmarkStartPrice) * 100;
      const benchmarkEquity = initialCapital * (1 + benchmarkReturnPct / 100);

      equityCurve.push({
        time: bar.time,
        equity: Number(equity.toFixed(2)),
        benchmark: Number(benchmarkEquity.toFixed(2)),
        drawdown: Number(currentDD.toFixed(2)),
      });
      const dailyReturn = priorEquity > 0 ? (equity - priorEquity) / priorEquity : 0;
      if (i < splitIdx) inSampleReturns.push(dailyReturn);
      else outOfSampleReturns.push(dailyReturn);
      priorEquity = equity;
    }
    if (activeTrade) {
      const finalIndex = allCandles.length - 1;
      const finalBar = allCandles[finalIndex];
      const equityBeforeFinalExit = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
      closeActiveTrade(finalBar.close, 'TIME_EXIT', finalBar, finalIndex);
      if (equityCurve.length > 0) {
        if (equity > peakEquity) {
          peakEquity = equity;
          drawdownStartIdx = finalIndex;
        }
        const correctedDrawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
        if (correctedDrawdown > maxDrawdownPct) {
          maxDrawdownPct = correctedDrawdown;
          maxDrawdownUSD = peakEquity - equity;
          maxDrawdownDurationDays = finalIndex - drawdownStartIdx;
        }
        equityCurve[equityCurve.length - 1].equity = Number(equity.toFixed(2));
        equityCurve[equityCurve.length - 1].drawdown = Number(correctedDrawdown.toFixed(2));
        const correctedReturn = equityBeforeFinalExit > 0
          ? (equity - equityBeforeFinalExit) / equityBeforeFinalExit
          : 0;
        const sampleReturns = finalIndex < splitIdx ? inSampleReturns : outOfSampleReturns;
        if (sampleReturns.length > 0) sampleReturns[sampleReturns.length - 1] = correctedReturn;
      }
    }

    // Performance statistics
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.netPnL > 0);
    const losingTrades = trades.filter(t => t.netPnL <= 0);
    const totalWinsUSD = winningTrades.reduce((acc, t) => acc + t.netPnL, 0);
    const totalLossesUSD = Math.abs(losingTrades.reduce((acc, t) => acc + t.netPnL, 0));

    const winRatePct = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
    const profitFactor = totalLossesUSD > 0 ? totalWinsUSD / totalLossesUSD : totalWinsUSD > 0 ? 99 : 0;
    const avgWinUSD = winningTrades.length > 0 ? totalWinsUSD / winningTrades.length : 0;
    const avgLossUSD = losingTrades.length > 0 ? totalLossesUSD / losingTrades.length : 0;
    const expectancyUSD = totalTrades > 0 ? (totalWinsUSD - totalLossesUSD) / totalTrades : 0;

    const netReturnPct = ((equity - initialCapital) / initialCapital) * 100;
    const annualizedReturnPct = netReturnPct * (252 / Math.max(30, allCandles.length));

    // Calculate Sharpe & Sortino ratios from observed returns, without synthetic floors or multipliers.
    const returns: number[] = [];
    for (let k = 1; k < equityCurve.length; k++) {
      const ret = (equityCurve[k].equity - equityCurve[k - 1].equity) / equityCurve[k - 1].equity;
      returns.push(ret);
    }
    const meanReturn = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
    const variance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / Math.max(1, returns.length);
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

    const downsideVariance = returns.filter(r => r < 0).reduce((a, b) => a + Math.pow(b, 2), 0) / Math.max(1, returns.length);
    const downsideDev = Math.sqrt(downsideVariance);
    const sortinoRatio = downsideDev > 0 ? (meanReturn / downsideDev) * Math.sqrt(252) : 0;

    const calculateSharpe = (sampleReturns: number[]): number => {
      if (sampleReturns.length < 2) return 0;
      const sampleMean = sampleReturns.reduce((sum, value) => sum + value, 0) / sampleReturns.length;
      const sampleVariance = sampleReturns.reduce((sum, value) => sum + (value - sampleMean) ** 2, 0) / sampleReturns.length;
      const sampleDeviation = Math.sqrt(sampleVariance);
      return sampleDeviation > 0 ? (sampleMean / sampleDeviation) * Math.sqrt(252) : 0;
    };
    const inSampleSharpe = Number(calculateSharpe(inSampleReturns).toFixed(2));
    const outOfSampleSharpe = Number(calculateSharpe(outOfSampleReturns).toFixed(2));
    const degradationPct = Number((
      inSampleSharpe === 0
        ? 0
        : ((inSampleSharpe - outOfSampleSharpe) / Math.abs(inSampleSharpe)) * 100
    ).toFixed(1));

    const benchmarkFinal = allCandles[allCandles.length - 1]?.close || 1;
    const benchmarkTotalReturn = ((benchmarkFinal - benchmarkStartPrice) / benchmarkStartPrice) * 100;

    const totalFeesPaid = trades.reduce((acc, t) => acc + t.fees, 0);
    const totalSlippageCost = trades.reduce((acc, t) => acc + t.slippageUSD, 0);

    return {
      id: `bt_res_${Date.now()}`,
      strategyId: req.strategyId,
      strategyName: strategyDefinition.name,
      symbol,
      period: {
        start: new Date(allCandles[0]?.time || Date.now()).toISOString().split('T')[0],
        end: new Date(allCandles[allCandles.length - 1]?.time || Date.now()).toISOString().split('T')[0],
      },
      initialCapital,
      finalEquity: Number(equity.toFixed(2)),
      netReturnPct: Number(netReturnPct.toFixed(2)),
      annualizedReturnPct: Number(annualizedReturnPct.toFixed(2)),
      benchmarkReturnPct: Number(benchmarkTotalReturn.toFixed(2)),
      noTradeReturnPct: 0,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      maxDrawdownDurationDays,
      sharpeRatio: Number(sharpeRatio.toFixed(2)),
      sortinoRatio: Number(sortinoRatio.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
      expectancyUSD: Number(expectancyUSD.toFixed(2)),
      winRatePct: Number(winRatePct.toFixed(1)),
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      avgWinUSD: Number(avgWinUSD.toFixed(2)),
      avgLossUSD: Number(avgLossUSD.toFixed(2)),
      totalFeesPaid: Number(totalFeesPaid.toFixed(2)),
      totalSlippageCost: Number(totalSlippageCost.toFixed(2)),
      trades: trades.slice(-30), // include latest 30 trades for detail
      equityCurve: equityCurve.filter((_, idx) => idx % 2 === 0), // sampled for lightweight transmission
      regimePerformance: (Object.keys(regimeStats) as MarketRegimeType[]).map(r => ({
        regime: r,
        trades: regimeStats[r].trades,
        winRate: regimeStats[r].trades > 0 ? Number(((regimeStats[r].wins / regimeStats[r].trades) * 100).toFixed(1)) : 0,
        netPnL: Number(regimeStats[r].netPnL.toFixed(2)),
      })),
      validationMetrics: {
        inSampleSharpe,
        outOfSampleSharpe,
        degradationPct,
        inSampleTrades,
        outOfSampleTrades: outSampleTrades,
      },
    };
  }
}

export const backtestEngine = new BacktestEngine();
