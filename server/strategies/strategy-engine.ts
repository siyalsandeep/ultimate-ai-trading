import {
  StrategyConfig,
  TradeSignal,
} from '../../src/types/trading';
import { marketDataService } from '../data/market-data-service';
import { riskEngine } from '../risk/risk-engine';
import { executionEngine } from '../execution/execution-engine';
import { auditLogger } from '../audit/audit-logger';
import {
  evaluateStrategySelection,
  STRATEGY_DEFINITIONS,
} from './strategy-selection';
import { evaluateResearchSignal } from './strategy-signals';
import { StrategySelectionDecision } from '../../src/types/trading';

export class StrategyEngine {
  private strategies: StrategyConfig[] = [
    {
      id: 'strat_trend',
      name: 'Trend Following (EMA + ADX + ATR)',
      version: '1.1.0',
      type: 'TREND_FOLLOWING',
      enabled: false,
      targetAssetClasses: ['EQUITY', 'CRYPTO', 'INDEX', 'COMMODITY'],
      parameters: {
        adxThreshold: 25,
        fastEmaPeriod: 20,
        slowEmaPeriod: 50,
        rsiMinimum: 52,
        rsiMaximum: 75,
        atrStopMultiplier: 2,
        takeProfitAtrMultiple: 4,
      },
      allowedRegimes: ['TRENDING_BULL'],
      allocationPct: 35,
      activeSignalsCount: 0,
      isSuspended: false,
      consecutiveLosses: 0,
    },
    {
      id: 'strat_mean_reversion',
      name: 'Statistical Mean Reversion (Bollinger + RSI)',
      version: '1.1.0',
      type: 'MEAN_REVERSION',
      enabled: false,
      targetAssetClasses: ['EQUITY', 'FOREX', 'INDEX'],
      parameters: {
        bbPeriod: 20,
        bbStdDev: 2,
        rsiPeriod: 14,
        rsiOversold: 30,
        atrStopMultiplier: 1.5,
        lowerBandTolerance: 0.004,
      },
      allowedRegimes: ['RANGING_LOW_VOL', 'RANGING_HIGH_VOL'],
      allocationPct: 30,
      activeSignalsCount: 0,
      isSuspended: false,
      consecutiveLosses: 0,
    },
    {
      id: 'strat_momentum',
      name: 'Cross-Asset Risk-Adjusted Momentum',
      version: '1.1.0',
      type: 'MOMENTUM_RELATIVE_STRENGTH',
      enabled: false,
      targetAssetClasses: ['EQUITY', 'CRYPTO', 'COMMODITY', 'INDEX'],
      parameters: {
        lookbackBars: 20,
        volatilityFilterMax: 2.5,
        minMomentumScore: 1.2,
        atrStopMultiplier: 1.8,
        takeProfitAtrMultiple: 3.6,
      },
      allowedRegimes: ['TRENDING_BULL', 'RANGING_LOW_VOL'],
      allocationPct: 35,
      activeSignalsCount: 0,
      isSuspended: false,
      consecutiveLosses: 0,
    },
    {
      id: 'strat_regime',
      name: 'Adaptive Market Regime Classifier',
      version: '1.1.0',
      type: 'REGIME_CLASSIFIER',
      enabled: false,
      targetAssetClasses: ['EQUITY', 'CRYPTO', 'FOREX', 'COMMODITY', 'INDEX'],
      parameters: {
        adxThreshold: 25,
        volatilityCeiling: 3.5,
        lowVolatilityCeiling: 1.2,
        minimumHistoryBars: 20,
      },
      allowedRegimes: ['TRENDING_BULL', 'TRENDING_BEAR', 'RANGING_LOW_VOL', 'RANGING_HIGH_VOL', 'UNCERTAIN_SHOCK'],
      allocationPct: 0,
      activeSignalsCount: 0,
      isSuspended: false,
      consecutiveLosses: 0,
    },
  ];

  private generatedSignals: TradeSignal[] = [];

  constructor() {
    this.scanForSignals();
    // Run automated strategy scanner periodically
    setInterval(() => {
      this.scanForSignals();
    }, 10000).unref();
  }

  public getStrategies(): StrategyConfig[] {
    const lossesByStrat = executionEngine.getConsecutiveLossesByStrategy();
    return this.strategies.map(s => {
      const cooldown = riskEngine.getCooldown(s.id);
      const isCooldownActive = !!cooldown && cooldown.active && cooldown.remainingSeconds > 0;
      const isSuspended = riskEngine.isStrategySuspended(s.id);
      return {
        ...s,
        consecutiveLosses: lossesByStrat[s.id] || 0,
        isSuspended,
        cooldown: isCooldownActive ? cooldown : undefined,
        autoExecutionDisabled: true,
      };
    });
  }

  public toggleStrategy(strategyId: string, enabled: boolean): StrategyConfig | undefined {
    const strat = this.strategies.find(s => s.id === strategyId);
    if (strat) {
      const isCooldownActive = riskEngine.isCooldownActive(strategyId);
      strat.enabled = enabled;

      auditLogger.record({
        category: 'STRATEGY_SIGNAL',
        level: isCooldownActive && enabled ? 'WARNING' : 'INFO',
        action: enabled ? 'STRATEGY_ENABLED' : 'STRATEGY_DISABLED',
        details: {
          strategyId,
          enabled,
          cooldownActive: isCooldownActive,
          notice: isCooldownActive && enabled
            ? 'Strategy enabled by operator, but auto-execution and entry orders remain paused until cooldown elapses.'
            : undefined,
        },
        actor: 'OPERATOR',
      });

      const lossesByStrat = executionEngine.getConsecutiveLossesByStrategy();
      const cooldown = riskEngine.getCooldown(strat.id);
      return {
        ...strat,
        consecutiveLosses: lossesByStrat[strat.id] || 0,
        isSuspended: riskEngine.isStrategySuspended(strat.id),
        cooldown: isCooldownActive ? cooldown : undefined,
        autoExecutionDisabled: true,
      };
    }
    return undefined;
  }

  public updateParameters(strategyId: string, params: Record<string, number | string | boolean>): boolean {
    const strat = this.strategies.find(s => s.id === strategyId);
    if (!strat) return false;
    const definition = STRATEGY_DEFINITIONS.find(candidate => candidate.id === strategyId);
    if (!definition || Object.entries(params).length === 0) return false;
    const validParameters = Object.entries(params).every(([key, value]) => {
      const defaultValue = definition.parameters[key];
      return defaultValue !== undefined &&
        typeof value === typeof defaultValue &&
        (typeof value !== 'number' || Number.isFinite(value)) &&
        (typeof value !== 'number' || value >= 0) &&
        (!['fastEmaPeriod', 'slowEmaPeriod'].includes(key) ||
          (typeof value === 'number' && Number.isInteger(value) && [20, 50].includes(value))) &&
        (!['bbPeriod', 'bbStdDev', 'rsiPeriod'].includes(key) || value === defaultValue) &&
        (!['rsiMinimum', 'rsiMaximum', 'rsiOversold'].includes(key) ||
          (typeof value === 'number' && value <= 100));
    });
    if (!validParameters) return false;
    const candidateParameters = { ...strat.parameters, ...params };
    if (
      Number(candidateParameters.fastEmaPeriod) >= Number(candidateParameters.slowEmaPeriod) ||
      Number(candidateParameters.rsiMinimum) >= Number(candidateParameters.rsiMaximum)
    ) return false;
    const previousVersion = strat.version;
    strat.parameters = { ...strat.parameters, ...params };
    const versionParts = strat.version.split('.').map(Number);
    strat.version = versionParts.length === 3 && versionParts.every(Number.isInteger)
      ? `${versionParts[0]}.${versionParts[1]}.${versionParts[2] + 1}`
      : `${strat.version}+operator-${Date.now()}`;
    auditLogger.record({
      category: 'STRATEGY_SIGNAL',
      level: 'WARNING',
      action: 'STRATEGY_PARAMETERS_UPDATED',
      details: { strategyId, previousVersion, version: strat.version, params },
      actor: 'OPERATOR',
    });
    return true;
  }

  public getRecentSignals(limit: number = 50): TradeSignal[] {
    return this.generatedSignals.slice(0, limit);
  }

  public getStrategyDefinitions() {
    return STRATEGY_DEFINITIONS.map((definition) => ({
      ...definition,
      version: this.strategies.find(strategy => strategy.id === definition.id)?.version || definition.version,
      parameters: { ...(this.strategies.find(strategy => strategy.id === definition.id)?.parameters || definition.parameters) },
    }));
  }

  public evaluateSelection(symbol: string): StrategySelectionDecision {
    const now = Date.now();
    const instrument = marketDataService.getInstrument(symbol);
    const quote = marketDataService.getQuote(symbol);
    const candleProvenance = marketDataService.getCandleProvenance(symbol);
    const portfolio = executionEngine.getPortfolio();
    const drawdown = riskEngine.checkDrawdownBreach(portfolio);
    const blockedStrategyReasons: Record<string, string[]> = {};
    const strategyEnabled: Record<string, boolean> = {};

    for (const strategy of this.strategies) {
      strategyEnabled[strategy.id] = strategy.enabled;
      const reasons: string[] = [];
      if (riskEngine.isStrategySuspended(strategy.id)) reasons.push('Strategy is suspended by a risk control.');
      if (riskEngine.isCooldownActive(strategy.id)) reasons.push('Strategy cooldown is active.');
      if (reasons.length > 0) blockedStrategyReasons[strategy.id] = reasons;
    }

    const decision = evaluateStrategySelection({
      symbol,
      assetClass: instrument?.assetClass || null,
      timeframe: '1d',
      marketCondition: quote?.quality === 'LIVE'
        ? marketDataService.classifyMarketRegime(symbol)
        : 'UNKNOWN',
      regimeConfidence: null,
      regimeConfidenceMethod: null,
      regimeConfidenceCalibrated: false,
      quoteStatus: quote?.quality || null,
      quoteProvider: quote?.provider || null,
      quoteTimestamp: quote?.timestamp || null,
      quoteIsBrokerExecutable: quote?.isLiveBrokerExecutable === true,
      quoteAgeMs: quote ? now - quote.timestamp : null,
      spreadBasisPoints: quote ? quote.spreadPct * 10_000 : null,
      candlesVerified: candleProvenance.quality === 'LIVE' || candleProvenance.quality === 'DELAYED',
      candleProvider: candleProvenance.provider,
      candleTimestamp: candleProvenance.latestTimestamp,
      candleAgeMs: candleProvenance.latestTimestamp === null ? null : now - candleProvenance.latestTimestamp,
      sessionStatus: 'UNKNOWN',
      strategyEnabled,
      blockedStrategyReasons,
      accountRiskBlocked:
        executionEngine.getMode() !== 'PAPER' ||
        riskEngine.isGlobalKillSwitched() ||
        riskEngine.isCooldownActive('ACCOUNT') ||
        riskEngine.checkDailyLossBreach(portfolio) ||
        drawdown.breached ||
        executionEngine.hasUncertainOrderIntents(),
      evidence: [],
      now,
    }, this.getStrategyDefinitions());

    auditLogger.record({
      category: 'STRATEGY_SIGNAL',
      level: decision.decision === 'SELECT' ? 'INFO' : 'WARNING',
      action: 'STRATEGY_SELECTION_EVALUATED',
      details: {
        symbol: decision.symbol,
        timeframe: decision.timeframe,
        decision: decision.decision,
        selectedStrategyId: decision.selectedStrategyId,
        marketCondition: decision.marketCondition,
        regimeConfidence: decision.regimeConfidence,
        regimeConfidenceMethod: decision.regimeConfidenceMethod,
        dataStatus: decision.dataStatus,
        dataProvider: decision.dataProvider,
        sourceTimestamp: decision.sourceTimestamp,
        candleProvider: decision.candleProvider,
        candleTimestamp: decision.candleTimestamp,
        spreadBasisPoints: decision.spreadBasisPoints,
        sessionStatus: decision.sessionStatus,
        reasons: decision.reasons,
        candidates: decision.candidates.map(({ strategyId, strategyVersion, suitable, validationStatus, reasons, validationEvidence }) => ({
          strategyId,
          strategyVersion,
          suitable,
          validationStatus,
          reasons,
          validationEvidence,
        })),
      },
      actor: 'STRATEGY_ENGINE',
    });
    return decision;
  }

  public scanForSignals(): TradeSignal[] {
    const newSignals: TradeSignal[] = [];
    const instruments = marketDataService.getSupportedInstruments();
    const now = Date.now();

    for (const inst of instruments) {
      const quote = marketDataService.getQuote(inst.symbol);
      const candles = marketDataService.getCandles(inst.symbol, 60);
      if (!quote || candles.length < 30) continue;

      const currentRegime = marketDataService.classifyMarketRegime(inst.symbol);
      for (const strategy of this.strategies) {
        if (riskEngine.isStrategySuspended(strategy.id) || riskEngine.isCooldownActive(strategy.id)) continue;
        const signal = evaluateResearchSignal({
          strategy,
          symbol: inst.symbol,
          instrument: inst,
          quote,
          completedCandles: candles,
          regime: currentRegime,
          now,
        });
        if (signal) newSignals.push(signal);
      }
    }

    // Deduplicate and prepend to generatedSignals
    for (const sig of newSignals) {
      const exists = this.generatedSignals.some(
        s => s.symbol === sig.symbol && s.strategyId === sig.strategyId && now - s.timestamp < 60000
      );
      if (!exists) {
        this.generatedSignals.unshift(sig);
      }
    }

    if (this.generatedSignals.length > 200) {
      this.generatedSignals = this.generatedSignals.slice(0, 200);
    }

    // Update active signals count on strategies
    for (const strat of this.strategies) {
      strat.activeSignalsCount = this.generatedSignals.filter(
        s => s.strategyId === strat.id && now - s.timestamp < 120000
      ).length;
    }

    return this.generatedSignals;
  }
}

export const strategyEngine = new StrategyEngine();
