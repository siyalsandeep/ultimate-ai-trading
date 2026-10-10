import {
  RiskLimits,
  RiskValidationResult,
  Order,
  Position,
  PortfolioSummary,
  TradeSignal,
  MarketQuote,
  Instrument,
  HealthState,
  CooldownState,
} from '../../src/types/trading';
import { auditLogger } from '../audit/audit-logger';
import { isConfiguredEntrySessionOpen } from './trading-session';

export interface PersistedRiskSafetyState {
  globalKillSwitchActive: boolean;
  dailyLossTripped: boolean;
  suspendedStrategies: string[];
  suspendedInstruments: string[];
  suspendedBrokers: string[];
}

function isAlignedToIncrement(value: number, increment: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) return false;
  const units = value / increment;
  return Number.isFinite(units) &&
    Math.abs(units - Math.round(units)) <= Number.EPSILON * Math.max(1, Math.abs(units)) * 8;
}

function isPersistedRiskSafetyState(value: unknown): value is PersistedRiskSafetyState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return typeof state.globalKillSwitchActive === 'boolean' &&
    typeof state.dailyLossTripped === 'boolean' &&
    Array.isArray(state.suspendedStrategies) &&
    state.suspendedStrategies.every((item) => typeof item === 'string') &&
    Array.isArray(state.suspendedInstruments) &&
    state.suspendedInstruments.every((item) => typeof item === 'string') &&
    Array.isArray(state.suspendedBrokers) &&
    state.suspendedBrokers.every((item) => typeof item === 'string');
}

function isPersistedCooldown(value: unknown, target: string): value is CooldownState {
  if (typeof value !== 'object' || value === null) return false;
  const cooldown = value as Record<string, unknown>;
  return cooldown.target === target &&
    typeof cooldown.active === 'boolean' &&
    Number.isFinite(cooldown.startTime) &&
    Number.isFinite(cooldown.cooldownEndTime) &&
    Number.isFinite(cooldown.durationMinutes) &&
    (cooldown.durationMinutes as number) >= 30 &&
    Number.isFinite(cooldown.consecutiveLosses) &&
    (cooldown.consecutiveLosses as number) >= 1 &&
    Array.isArray(cooldown.triggeringTradeIds) &&
    cooldown.triggeringTradeIds.every((tradeId) => typeof tradeId === 'string') &&
    typeof cooldown.pauseReason === 'string' &&
    typeof cooldown.autoExecutionDisabled === 'boolean';
}

export class RiskEngine {
  private limits: RiskLimits = {
    maxRiskPerTradePct: 0.25, // 0.25% equity per trade
    dailyLossShutdownPct: 1.0, // 1.0% of SOD equity
    portfolioOpenRiskBudgetPct: 2.0, // 2.0% equity total
    maxDrawdownPausePct: 5.0, // 5.0%
    maxDrawdownHaltPct: 10.0, // 10.0%
    maxSingleAssetExposurePct: 15.0, // 15.0%
    maxAssetClassExposurePct: 35.0, // 35.0%
    maxStrategyExposurePct: 30.0, // 30.0%
    maxLeverage: 1.5,
    maxSimultaneousPositions: 8,
    maxSpreadTolerancePct: 0.15, // 0.15%
    maxSlippageTolerancePct: 0.20, // 0.20%
    maxQuoteAgeMs: 30000, // 30s
    maxConsecutiveLosses: 5, // 5 consecutive closed losses trigger mandatory 30m cooldown
    consecutiveLossCooldownMinutes: 30, // Minimum 30 minutes mandatory cooldown
  };

  private isGlobalKillSwitchActive: boolean = false;
  private suspendedStrategies: Set<string> = new Set();
  private suspendedInstruments: Set<string> = new Set();
  private suspendedBrokers: Set<string> = new Set();
  private isDailyLossTripped: boolean = false;
  private failClosedArmed: boolean = true;
  private cooldowns: Map<string, CooldownState> = new Map(); // 'ACCOUNT' or strategyId -> CooldownState

  public getLimits(): RiskLimits {
    return { ...this.limits };
  }

  public getPersistedSafetyState(): PersistedRiskSafetyState {
    return {
      globalKillSwitchActive: this.isGlobalKillSwitchActive,
      dailyLossTripped: this.isDailyLossTripped,
      suspendedStrategies: Array.from(this.suspendedStrategies).sort(),
      suspendedInstruments: this.getSuspendedInstruments(),
      suspendedBrokers: Array.from(this.suspendedBrokers).sort(),
    };
  }

  public restorePersistedSafetyState(state: unknown): void {
    if (isPersistedRiskSafetyState(state)) {
      this.isGlobalKillSwitchActive = state.globalKillSwitchActive;
      this.isDailyLossTripped = state.dailyLossTripped;
      this.suspendedStrategies = new Set(state.suspendedStrategies);
      this.restoreSuspendedInstruments(state.suspendedInstruments);
      this.suspendedBrokers = new Set(state.suspendedBrokers);
    } else {
      this.isGlobalKillSwitchActive = true;
      this.isDailyLossTripped = true;
      this.suspendedStrategies.clear();
      this.suspendedInstruments.clear();
      this.suspendedBrokers.clear();
      auditLogger.record({
        category: 'RISK_DECISION',
        level: 'CRITICAL',
        action: 'INVALID_RISK_STATE_RESTORED_HALTED',
        details: {
          reason: 'Persisted safety breaker state is missing or invalid; trading remains halted pending operator review.',
        },
        actor: 'RISK_ENGINE',
      });
    }
  }

  public updateLimits(newLimits: Partial<RiskLimits>): { success: boolean; message: string } {
    const numericLimits = Object.entries(newLimits).filter(([, value]) => value !== undefined);
    if (numericLimits.some(([, value]) => typeof value !== 'number' || !Number.isFinite(value))) {
      return { success: false, message: 'Risk limits must be finite numbers.' };
    }
    if (numericLimits.some(([, value]) => (value as number) <= 0)) {
      return { success: false, message: 'Risk limits must be greater than zero.' };
    }
    // Hard protective ceilings that can NEVER be violated even by UI inputs:
    if (newLimits.maxRiskPerTradePct !== undefined && newLimits.maxRiskPerTradePct > 1.0) {
      return { success: false, message: 'Institutional ceiling: Max risk per trade cannot exceed 1.00%' };
    }
    if (newLimits.dailyLossShutdownPct !== undefined && newLimits.dailyLossShutdownPct > 2.5) {
      return { success: false, message: 'Institutional ceiling: Daily loss shutdown cannot exceed 2.50%' };
    }
    if (newLimits.maxLeverage !== undefined && newLimits.maxLeverage > 3.0) {
      return { success: false, message: 'Institutional ceiling: Max leverage cannot exceed 3.0x' };
    }
    if (newLimits.consecutiveLossCooldownMinutes !== undefined && newLimits.consecutiveLossCooldownMinutes < 30) {
      return { success: false, message: 'Institutional ceiling: Consecutive loss cooldown duration cannot be below 30 minutes' };
    }
    if (newLimits.maxConsecutiveLosses !== undefined && (newLimits.maxConsecutiveLosses < 1 || newLimits.maxConsecutiveLosses > 10)) {
      return { success: false, message: 'Institutional ceiling: Max consecutive losses must be between 1 and 10' };
    }

    this.limits = { ...this.limits, ...newLimits };
    auditLogger.record({
      category: 'RISK_DECISION',
      level: 'INFO',
      action: 'RISK_LIMITS_UPDATED',
      details: { updatedLimits: this.limits },
      actor: 'OPERATOR',
    });
    return { success: true, message: 'Risk limits safely updated within institutional bounds' };
  }

  /**
   * Consecutive-Loss Cooldown Management (Revenge-Trading Prevention)
   */
  public triggerCooldown(
    target: string, // strategyId or 'ACCOUNT'
    triggeringTradeIds: string[],
    consecutiveLosses: number = 5,
    reason: string = '5 consecutive closed losing trades exceeded safety threshold'
  ): CooldownState {
    const durationMinutes = Math.max(30, this.limits.consecutiveLossCooldownMinutes || 30);
    const now = Date.now();
    const cooldownEndTime = now + durationMinutes * 60 * 1000;

    const state: CooldownState = {
      target,
      active: true,
      startTime: now,
      cooldownEndTime,
      durationMinutes,
      remainingSeconds: durationMinutes * 60,
      triggeringTradeIds: [...triggeringTradeIds],
      consecutiveLosses,
      pauseReason: reason,
      autoExecutionDisabled: true,
    };

    this.cooldowns.set(target, state);

    auditLogger.record({
      category: 'RISK_DECISION',
      level: 'CRITICAL',
      action: 'CONSECUTIVE_LOSS_COOLDOWN_TRIGGERED',
      details: {
        target,
        consecutiveLosses,
        durationMinutes,
        startTime: new Date(now).toISOString(),
        cooldownEndTime: new Date(cooldownEndTime).toISOString(),
        triggeringTradeIds,
        pauseReason: reason,
        autoExecutionDisabled: true,
      },
      actor: 'RISK_ENGINE',
    });

    return state;
  }

  public getCooldown(target: string): CooldownState | undefined {
    const c = this.cooldowns.get(target);
    if (!c) return undefined;
    const remainingSeconds = Math.max(0, Math.ceil((c.cooldownEndTime - Date.now()) / 1000));
    const active = c.active && remainingSeconds > 0;
    return {
      ...c,
      active,
      remainingSeconds,
    };
  }

  public getAllCooldowns(): CooldownState[] {
    const list: CooldownState[] = [];
    for (const target of this.cooldowns.keys()) {
      const cd = this.getCooldown(target);
      if (cd) list.push(cd);
    }
    return list;
  }

  public isCooldownActive(target: string): boolean {
    const cd = this.getCooldown(target);
    return !!cd && cd.active && cd.remainingSeconds > 0;
  }

  public restoreCooldowns(persisted: unknown): void {
    if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
      this.isGlobalKillSwitchActive = true;
      this.isDailyLossTripped = true;
      auditLogger.record({
        category: 'RISK_DECISION',
        level: 'CRITICAL',
        action: 'INVALID_COOLDOWN_STATE_RESTORED_HALTED',
        details: { reason: 'Persisted cooldown collection is missing or invalid; entries remain blocked pending review.' },
        actor: 'RISK_ENGINE',
      });
      return;
    }
    this.cooldowns.clear();
    for (const [target, value] of Object.entries(persisted)) {
      if (!isPersistedCooldown(value, target)) {
        this.isGlobalKillSwitchActive = true;
        this.isDailyLossTripped = true;
        auditLogger.record({
          category: 'RISK_DECISION',
          level: 'CRITICAL',
          action: 'INVALID_COOLDOWN_STATE_RESTORED_HALTED',
          details: { target, reason: 'Persisted cooldown state is invalid; entries remain blocked pending review.' },
          actor: 'RISK_ENGINE',
        });
        continue;
      }
      const cd = value;
      const remainingSeconds = Math.max(0, Math.ceil((cd.cooldownEndTime - Date.now()) / 1000));
      const active = cd.active && remainingSeconds > 0;
      this.cooldowns.set(target, {
        ...cd,
        active,
        remainingSeconds,
      });
    }
  }

  public getCooldownsMap(): Record<string, CooldownState> {
    const map: Record<string, CooldownState> = {};
    for (const [target] of this.cooldowns.entries()) {
      const cd = this.getCooldown(target);
      if (cd) {
        map[target] = cd;
      }
    }
    return map;
  }

  public setGlobalKillSwitch(active: boolean, reason: string = 'Manual Operator Action') {
    this.isGlobalKillSwitchActive = active;
    auditLogger.record({
      category: 'KILL_SWITCH',
      level: active ? 'CRITICAL' : 'WARNING',
      action: active ? 'GLOBAL_KILL_SWITCH_ENGAGED' : 'GLOBAL_KILL_SWITCH_DISARMED',
      details: { reason, state: active },
      actor: 'OPERATOR',
    });
  }

  public isGlobalKillSwitched(): boolean {
    return this.isGlobalKillSwitchActive;
  }

  public isDailyLossCircuitBreakerTripped(): boolean {
    return this.isDailyLossTripped;
  }

  public setStrategySuspension(strategyId: string, suspended: boolean) {
    if (suspended) {
      this.suspendedStrategies.add(strategyId);
    } else {
      this.suspendedStrategies.delete(strategyId);
    }
    auditLogger.record({
      category: 'KILL_SWITCH',
      level: suspended ? 'WARNING' : 'INFO',
      action: suspended ? 'STRATEGY_SUSPENDED' : 'STRATEGY_RESUMED',
      details: { strategyId, suspended },
      actor: 'OPERATOR',
    });
  }

  public isStrategySuspended(strategyId: string): boolean {
    return this.suspendedStrategies.has(strategyId);
  }

  public setBrokerSuspension(broker: string, suspended: boolean) {
    if (suspended) {
      this.suspendedBrokers.add(broker);
    } else {
      this.suspendedBrokers.delete(broker);
    }
    auditLogger.record({
      category: 'KILL_SWITCH',
      level: suspended ? 'CRITICAL' : 'INFO',
      action: suspended ? 'BROKER_ISOLATED' : 'BROKER_RECONNECTED',
      details: { broker, suspended },
      actor: 'OPERATOR',
    });
  }

  public isBrokerSuspended(broker: string): boolean {
    return this.suspendedBrokers.has(broker);
  }

  public setInstrumentSuspension(symbol: string, suspended: boolean, reason: string = 'Manual Operator Action') {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;
    if (suspended) {
      this.suspendedInstruments.add(normalized);
    } else {
      this.suspendedInstruments.delete(normalized);
    }
    auditLogger.record({
      category: 'KILL_SWITCH',
      level: suspended ? 'WARNING' : 'INFO',
      action: suspended ? 'INSTRUMENT_PAUSED' : 'INSTRUMENT_RESUMED',
      details: { symbol: normalized, suspended, reason },
      actor: 'OPERATOR',
    });
  }

  public isInstrumentSuspended(symbol: string): boolean {
    return this.suspendedInstruments.has(symbol.trim().toUpperCase());
  }

  public getSuspendedInstruments(): string[] {
    return Array.from(this.suspendedInstruments).sort();
  }

  public restoreSuspendedInstruments(persisted: string[] | undefined): void {
    this.suspendedInstruments.clear();
    if (!Array.isArray(persisted)) return;
    for (const symbol of persisted) {
      if (typeof symbol === 'string' && symbol.trim()) {
        this.suspendedInstruments.add(symbol.trim().toUpperCase());
      }
    }
  }

  public checkDailyLossBreach(portfolio: PortfolioSummary): boolean {
    if (
      !Number.isFinite(portfolio.startOfDayEquity) ||
      portfolio.startOfDayEquity <= 0 ||
      !Number.isFinite(portfolio.realizedPnLToday) ||
      !Number.isFinite(portfolio.unrealizedPnL)
    ) {
      this.isDailyLossTripped = true;
      auditLogger.record({
        category: 'RISK_DECISION',
        level: 'CRITICAL',
        action: 'DAILY_LOSS_CHECK_UNAVAILABLE_HALTED',
        details: { reason: 'Daily loss inputs are invalid or unavailable.' },
        actor: 'RISK_ENGINE',
      });
      return true;
    }
    const totalPnlToday = portfolio.realizedPnLToday + portfolio.unrealizedPnL;
    const lossPct = portfolio.startOfDayEquity > 0 ? (-totalPnlToday / portfolio.startOfDayEquity) * 100 : 0;

    if (lossPct >= this.limits.dailyLossShutdownPct && !this.isDailyLossTripped) {
      this.isDailyLossTripped = true;
      auditLogger.record({
        category: 'RISK_DECISION',
        level: 'CRITICAL',
        action: 'DAILY_LOSS_LIMIT_BREACHED',
        details: {
          currentLossPct: lossPct,
          limitPct: this.limits.dailyLossShutdownPct,
          action: 'BLOCK_ALL_RISK_INCREASING_ORDERS',
        },
        actor: 'RISK_ENGINE',
      });
      return true;
    }

    return this.isDailyLossTripped;
  }

  public resetDailyLossCircuitBreaker(): void {
    this.isDailyLossTripped = false;
    auditLogger.record({
      category: 'RISK_DECISION',
      level: 'WARNING',
      action: 'DAILY_LOSS_BREAKER_RESET',
      details: { timestamp: new Date().toISOString() },
      actor: 'OPERATOR',
    });
  }

  public checkDrawdownBreach(portfolio: PortfolioSummary): { breached: boolean; action: 'NONE' | 'PAUSE' | 'HALT' } {
    if (!Number.isFinite(portfolio.currentDrawdownPct) || portfolio.currentDrawdownPct < 0) {
      return { breached: true, action: 'HALT' };
    }
    if (portfolio.currentDrawdownPct >= this.limits.maxDrawdownHaltPct) {
      return { breached: true, action: 'HALT' };
    }
    if (portfolio.currentDrawdownPct >= this.limits.maxDrawdownPausePct) {
      return { breached: true, action: 'PAUSE' };
    }
    return { breached: false, action: 'NONE' };
  }

  public calculatePositionSize(
    equity: number,
    entryPrice: number,
    stopLossPrice: number,
    instrument: Instrument
  ): { quantity: number; riskAmountUSD: number } {
    if (
      !Number.isFinite(equity) || equity <= 0 ||
      !Number.isFinite(entryPrice) || entryPrice <= 0 ||
      !Number.isFinite(stopLossPrice) || stopLossPrice <= 0 ||
      instrument.currency !== 'USD' ||
      !Number.isFinite(instrument.minLotSize) || instrument.minLotSize <= 0 ||
      !Number.isFinite(instrument.lotStep) || instrument.lotStep <= 0 ||
      !Number.isFinite(this.limits.maxRiskPerTradePct) || this.limits.maxRiskPerTradePct <= 0
    ) {
      return { quantity: 0, riskAmountUSD: 0 };
    }

    const priceDistance = Math.abs(entryPrice - stopLossPrice);
    if (!Number.isFinite(priceDistance) || priceDistance <= 0) {
      return { quantity: 0, riskAmountUSD: 0 };
    }

    // Risk budget in dollars = equity * maxRiskPerTradePct / 100
    const riskBudgetUSD = equity * (this.limits.maxRiskPerTradePct / 100);
    const rawQuantity = riskBudgetUSD / priceDistance;
    if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
      return { quantity: 0, riskAmountUSD: 0 };
    }

    const finalQuantity = Math.floor(rawQuantity / instrument.lotStep) * instrument.lotStep;
    if (!Number.isFinite(finalQuantity) || finalQuantity < instrument.minLotSize) {
      return { quantity: 0, riskAmountUSD: 0 };
    }

    const estimatedRiskUSD = finalQuantity * priceDistance;
    if (!Number.isFinite(estimatedRiskUSD) || estimatedRiskUSD > riskBudgetUSD) {
      return { quantity: 0, riskAmountUSD: 0 };
    }

    return { quantity: finalQuantity, riskAmountUSD: estimatedRiskUSD };
  }

  /**
   * Deterministic Pre-Trade Risk Verification
   * Evaluates all 12 institutional risk criteria before any order is submitted.
   */
  public evaluatePreTradeRisk(
    signalOrOrder: {
      symbol: string;
      side: 'BUY' | 'SELL';
      quantity: number;
      price?: number;
      stopLoss?: number;
      strategyId: string;
      broker: string;
    },
    quote: MarketQuote | undefined,
    instrument: Instrument | undefined,
    portfolio: PortfolioSummary,
    openPositions: Position[],
    systemHealthState: HealthState
  ): RiskValidationResult {
    const checks: { name: string; passed: boolean; detail: string }[] = [];

    // Check 0a: Account Revenge-Trading Cooldown Check (5 Consecutive Closed Losses)
    const accountCooldown = this.getCooldown('ACCOUNT');
    if (accountCooldown && accountCooldown.active && accountCooldown.remainingSeconds > 0) {
      const mins = Math.ceil(accountCooldown.remainingSeconds / 60);
      const detail = `Account-level 30-minute cooldown active due to ${accountCooldown.consecutiveLosses} consecutive closed losses. Remaining: ${mins}m (${accountCooldown.remainingSeconds}s). New entries paused to prevent revenge trading.`;
      checks.push({
        name: 'Account Revenge-Trading Cooldown Check',
        passed: false,
        detail,
      });
      return this.reject('ERR_CONSECUTIVE_LOSS_COOLDOWN', detail, checks);
    }

    // Check 0b: Strategy Revenge-Trading Cooldown Check (5 Consecutive Closed Losses, Isolated)
    const stratCooldown = this.getCooldown(signalOrOrder.strategyId);
    if (stratCooldown && stratCooldown.active && stratCooldown.remainingSeconds > 0) {
      const mins = Math.ceil(stratCooldown.remainingSeconds / 60);
      const detail = `Strategy ${signalOrOrder.strategyId} 30-minute cooldown active due to ${stratCooldown.consecutiveLosses} consecutive closed losses. Remaining: ${mins}m (${stratCooldown.remainingSeconds}s). Auto-execution disabled to prevent revenge trading.`;
      checks.push({
        name: 'Strategy Revenge-Trading Cooldown Check',
        passed: false,
        detail,
      });
      return this.reject('ERR_CONSECUTIVE_LOSS_COOLDOWN', detail, checks);
    }

    // Check 1: Global Kill Switch
    const check1 = !this.isGlobalKillSwitchActive;
    checks.push({
      name: 'Global Kill Switch Check',
      passed: check1,
      detail: check1 ? 'System active' : 'GLOBAL KILL SWITCH IS ENGAGED - ALL ORDERS BLOCKED',
    });
    if (!check1) {
      return this.reject('ERR_GLOBAL_KILL_SWITCH', 'Global kill switch is engaged', checks);
    }

    // Check 2: System Health & Fail-Closed State
    const check2 = systemHealthState === 'HEALTHY';
    checks.push({
      name: 'Fail-Closed System Health Check',
      passed: check2,
      detail: `Current System Health: ${systemHealthState}`,
    });
    if (!check2) {
      return this.reject('ERR_SYSTEM_UNHEALTHY', 'System in UNAVAILABLE state. Fail-closed policy active.', checks);
    }

    const orderInputsValid = Number.isFinite(signalOrOrder.quantity) &&
      signalOrOrder.quantity > 0 &&
      Number.isFinite(portfolio.totalEquity) &&
      portfolio.totalEquity > 0 &&
      Number.isFinite(portfolio.startOfDayEquity) &&
      portfolio.startOfDayEquity > 0 &&
      Number.isFinite(portfolio.dailyLossPct) &&
      Number.isFinite(portfolio.currentDrawdownPct) &&
      Number.isFinite(portfolio.realizedPnLToday) &&
      Number.isFinite(portfolio.unrealizedPnL);
    checks.push({
      name: 'Order Size and Portfolio State Check',
      passed: orderInputsValid,
      detail: orderInputsValid
        ? 'Order quantity and account risk inputs are finite and positive.'
        : 'REJECTED: invalid quantity or incomplete/non-finite account risk state.',
    });
    if (!orderInputsValid) {
      return this.reject('ERR_INVALID_ORDER_OR_PORTFOLIO_STATE', 'Order size or portfolio risk inputs are invalid.', checks);
    }

    // Check 3: Strategy Quarantine Check
    const check3 = !this.suspendedStrategies.has(signalOrOrder.strategyId);
    checks.push({
      name: 'Strategy Quarantine Check',
      passed: check3,
      detail: check3 ? 'Strategy active' : `Strategy ${signalOrOrder.strategyId} is suspended/quarantined`,
    });
    if (!check3) {
      return this.reject('ERR_STRATEGY_SUSPENDED', `Strategy ${signalOrOrder.strategyId} is suspended`, checks);
    }

    // Check 4: Instrument Entry Pause Check
    const check4 = !this.suspendedInstruments.has(signalOrOrder.symbol.toUpperCase());
    checks.push({
      name: 'Instrument Entry Pause Check',
      passed: check4,
      detail: check4 ? `Instrument ${signalOrOrder.symbol} active` : `Instrument ${signalOrOrder.symbol} is paused by operator and blocks new entries`,
    });
    if (!check4) {
      return this.reject('ERR_INSTRUMENT_SUSPENDED', `Instrument ${signalOrOrder.symbol} is paused and cannot accept new entries`, checks);
    }

    // Check 5: Broker Status Check
    const check5 = !this.suspendedBrokers.has(signalOrOrder.broker);
    checks.push({
      name: 'Broker Route Check',
      passed: check5,
      detail: check5 ? `Broker ${signalOrOrder.broker} online` : `Broker ${signalOrOrder.broker} isolated`,
    });
    if (!check5) {
      return this.reject('ERR_BROKER_ISOLATED', `Broker adapter ${signalOrOrder.broker} is suspended`, checks);
    }

    // Check 6: Daily Loss Shutdown Check
    const checkDailyLoss = !this.isDailyLossTripped && !this.checkDailyLossBreach(portfolio);
    checks.push({
      name: 'Daily Loss Circuit Breaker',
      passed: checkDailyLoss,
      detail: checkDailyLoss
        ? `Daily Loss: ${portfolio.dailyLossPct.toFixed(2)}% (Limit: ${this.limits.dailyLossShutdownPct}%)`
        : 'Daily loss limit breached! Entries locked until next session.',
    });
    if (!checkDailyLoss) {
      return this.reject('ERR_DAILY_LOSS_BREACH', 'Daily loss limit breached. Safe mode active.', checks);
    }

    // Check 6: Maximum Portfolio Drawdown Check
    const check6 = portfolio.currentDrawdownPct < this.limits.maxDrawdownHaltPct;
    checks.push({
      name: 'Max Drawdown Ceiling Check',
      passed: check6,
      detail: `Current Drawdown: ${portfolio.currentDrawdownPct.toFixed(2)}% (Halt: ${this.limits.maxDrawdownHaltPct}%)`,
    });
    if (!check6) {
      return this.reject('ERR_MAX_DRAWDOWN_BREACH', 'Maximum portfolio drawdown hard halt triggered.', checks);
    }

    // Check 7: Market Data Freshness & Staleness
    if (!quote) {
      checks.push({ name: 'Market Data Freshness', passed: false, detail: 'No quote available for symbol' });
      return this.reject('ERR_NO_QUOTE', 'Market quote unavailable for target symbol', checks);
    }
    const quoteAge = Date.now() - quote.timestamp;
    const check7 = Number.isFinite(quote.timestamp) &&
      quote.timestamp <= Date.now() &&
      quoteAge >= 0 &&
      quoteAge <= this.limits.maxQuoteAgeMs &&
      !quote.isStale &&
      quote.symbol === signalOrOrder.symbol &&
      Number.isFinite(quote.bid) &&
      Number.isFinite(quote.ask) &&
      quote.bid > 0 &&
      quote.ask >= quote.bid;
    checks.push({
      name: 'Market Data Freshness Check',
      passed: check7,
      detail: `Quote Age: ${quoteAge}ms (Max: ${this.limits.maxQuoteAgeMs}ms, Stale: ${quote.isStale})`,
    });
    if (!check7) {
      return this.reject('ERR_STALE_MARKET_DATA', `Market quote is stale (${quoteAge}ms old)`, checks);
    }

    // Check 8: Spread Tolerance Check
    const spreadPct = quote.bid > 0 ? ((quote.ask - quote.bid) / quote.bid) * 100 : Number.POSITIVE_INFINITY;
    const check8 = Number.isFinite(spreadPct) && spreadPct <= this.limits.maxSpreadTolerancePct;
    checks.push({
      name: 'Spread Tolerance Check',
      passed: check8,
      detail: `Current Spread: ${spreadPct.toFixed(4)}% (Max: ${this.limits.maxSpreadTolerancePct}%)`,
    });
    if (!check8) {
      return this.reject('ERR_EXCESSIVE_SPREAD', `Spread exceeds tolerance: ${spreadPct.toFixed(4)}%`, checks);
    }

    // Check 9: Mandatory Stop Loss Presence
    const executablePrice = signalOrOrder.price ?? (signalOrOrder.side === 'BUY' ? quote.ask : quote.bid);
    const check9 = Number.isFinite(signalOrOrder.stopLoss) &&
      Number.isFinite(executablePrice) &&
      signalOrOrder.stopLoss! > 0 &&
      (signalOrOrder.side === 'BUY'
        ? signalOrOrder.stopLoss! < executablePrice
        : signalOrOrder.stopLoss! > executablePrice) &&
      (!instrument || isAlignedToIncrement(signalOrOrder.stopLoss!, instrument.tickSize));
    checks.push({
      name: 'Mandatory Stop-Loss Requirement',
      passed: check9,
      detail: check9 ? `Stop-Loss: $${signalOrOrder.stopLoss}` : 'REJECTED: No stop-loss defined for order',
    });
    if (!check9) {
      return this.reject('ERR_NO_STOP_LOSS', 'Every order must include a protective stop loss.', checks);
    }

    // Check 10: Max Simultaneous Open Positions Count
    const existingPosition = openPositions.find(p => p.symbol === signalOrOrder.symbol);
    const newPositionWillBeCreated = !existingPosition;
    const check10 = !newPositionWillBeCreated || openPositions.length < this.limits.maxSimultaneousPositions;
    checks.push({
      name: 'Max Simultaneous Positions Check',
      passed: check10,
      detail: `Open Positions: ${openPositions.length} (Max: ${this.limits.maxSimultaneousPositions})`,
    });
    if (!check10) {
      return this.reject('ERR_MAX_POSITIONS_REACHED', 'Max simultaneous positions limit reached.', checks);
    }

    // Check 11: Single Asset Exposure Concentration
    const currentPrice = signalOrOrder.price ?? (signalOrOrder.side === 'BUY' ? quote.ask : quote.bid);
    const orderNotional = signalOrOrder.quantity * currentPrice;
    const currentAssetNotional = existingPosition ? existingPosition.quantity * existingPosition.currentPrice : 0;
    const totalAssetExposurePct = ((currentAssetNotional + orderNotional) / Math.max(1, portfolio.totalEquity)) * 100;
    const check11 = totalAssetExposurePct <= this.limits.maxSingleAssetExposurePct;
    checks.push({
      name: 'Asset Concentration Limit Check',
      passed: check11,
      detail: `Target Asset Exposure: ${totalAssetExposurePct.toFixed(2)}% (Max: ${this.limits.maxSingleAssetExposurePct}%)`,
    });
    if (!check11) {
      return this.reject('ERR_ASSET_CONCENTRATION', `Order exceeds asset concentration ceiling of ${this.limits.maxSingleAssetExposurePct}%`, checks);
    }

    // Check 12: Gross Portfolio Leverage Check
    const existingGrossNotional = openPositions.reduce((acc, p) => acc + p.quantity * p.currentPrice, 0);
    const targetGrossLeverage = (existingGrossNotional + orderNotional) / Math.max(1, portfolio.totalEquity);
    const check12 = targetGrossLeverage <= this.limits.maxLeverage;
    checks.push({
      name: 'Gross Portfolio Leverage Check',
      passed: check12,
      detail: `Target Leverage: ${targetGrossLeverage.toFixed(2)}x (Max: ${this.limits.maxLeverage}x)`,
    });
    if (!check12) {
      return this.reject('ERR_MAX_LEVERAGE_EXCEEDED', `Target leverage ${targetGrossLeverage.toFixed(2)}x exceeds ceiling ${this.limits.maxLeverage}x`, checks);
    }

    // Check 13: Instrument Calendar & Trading Session Boundary Check (Stage 6)
    const check13 = !!instrument && isConfiguredEntrySessionOpen(instrument, Date.now());
    const check13Detail = check13
      ? 'Configured instrument session is open and outside the pre-close entry buffer.'
      : `REJECTED: ${instrument?.symbol || signalOrOrder.symbol} has no verified open entry session in the configured calendar.`;
    checks.push({
      name: 'Instrument Calendar & Session Check',
      passed: check13,
      detail: check13Detail,
    });
    if (!check13) {
      return this.reject('ERR_MARKET_SESSION_CLOSED', check13Detail, checks);
    }

    // Sizing & Risk Dollar calculations
    const stopLoss = signalOrOrder.stopLoss || 0;
    const stopDistance = Math.abs(currentPrice - stopLoss);
    const riskDollarAmount = signalOrOrder.quantity * stopDistance;
    const riskPctOfEquity = (riskDollarAmount / Math.max(1, portfolio.totalEquity)) * 100;

    // Check 14: Revenge Sizing Ceiling Protection Check
    // Risk per trade must strictly stay within maxRiskPerTradePct ceiling (no sizing expansion to chase/recover losses)
    const maxAllowedRiskDollar = portfolio.totalEquity * (this.limits.maxRiskPerTradePct / 100);
    const check14 = Number.isFinite(riskDollarAmount) &&
      Number.isFinite(maxAllowedRiskDollar) &&
      riskDollarAmount <= maxAllowedRiskDollar;
    checks.push({
      name: 'Revenge-Trading Sizing Protection Check',
      passed: check14,
      detail: check14
        ? `Risk per trade: ${riskPctOfEquity.toFixed(3)}% (Cap: ${this.limits.maxRiskPerTradePct}%)`
        : `Order risk ${riskPctOfEquity.toFixed(3)}% ($${riskDollarAmount.toFixed(2)}) exceeds maximum allowed risk cap of ${this.limits.maxRiskPerTradePct}%. Sizing expansion after losses is strictly prohibited.`,
    });
    if (!check14) {
      return this.reject(
        'ERR_REVENGE_SIZING_VIOLATION',
        `Order risk (${riskPctOfEquity.toFixed(3)}%) exceeds max allowed risk per trade ceiling (${this.limits.maxRiskPerTradePct}%). Revenge sizing barred.`,
        checks
      );
    }

    auditLogger.record({
      category: 'RISK_DECISION',
      level: 'INFO',
      action: 'PRE_TRADE_RISK_APPROVED',
      details: {
        symbol: signalOrOrder.symbol,
        quantity: signalOrOrder.quantity,
        riskDollarAmount,
        riskPctOfEquity,
      },
      actor: 'RISK_ENGINE',
    });

    return {
      approved: true,
      code: 'RISK_APPROVED',
      message: 'All pre-trade deterministic risk & session calendar invariants passed.',
      calculatedPositionSize: signalOrOrder.quantity,
      riskAmountUSD: Number(riskDollarAmount.toFixed(2)),
      riskPercentOfEquity: Number(riskPctOfEquity.toFixed(3)),
      checks,
    };
  }

  private reject(
    code: string,
    message: string,
    checks: { name: string; passed: boolean; detail: string }[]
  ): RiskValidationResult {
    auditLogger.record({
      category: 'RISK_DECISION',
      level: 'WARNING',
      action: 'PRE_TRADE_RISK_REJECTED',
      details: { code, message },
      actor: 'RISK_ENGINE',
    });

    return {
      approved: false,
      code,
      message,
      calculatedPositionSize: 0,
      riskAmountUSD: 0,
      riskPercentOfEquity: 0,
      checks,
    };
  }
}

export const riskEngine = new RiskEngine();
