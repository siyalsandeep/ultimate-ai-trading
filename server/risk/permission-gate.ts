import {
  Order,
  Position,
  PortfolioSummary,
  RiskLimits,
  Instrument,
  MarketQuote,
  HealthState,
  PermissionGateResult,
  PermissionGateCheck,
  QuoteProvenanceRecord,
} from '../../src/types/trading';
import { brokerTruthService } from '../broker/broker-truth-service';
import { auditLogger } from '../audit/audit-logger';
import { portfolioRiskService } from './portfolio-risk-service';
import { isConfiguredEntrySessionOpen } from './trading-session';
import { marketDataService } from '../data/market-data-service';

function isAlignedToIncrement(value: number, increment: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) return false;
  const units = value / increment;
  const nearestUnit = Math.round(units);
  return Number.isFinite(units) &&
    Math.abs(units - nearestUnit) <= Number.EPSILON * Math.max(1, Math.abs(units)) * 8;
}

export interface OrderIntent {
  orderId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type?: 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'TAKE_PROFIT';
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  strategyId: string;
  broker: string;
  clientOrderId?: string;
  idempotencyKey?: string;
}

export class CentralPermissionGate {
  /**
   * The single, unified server-side risk and data-validation gate.
   * All automated and manual entry paths must pass through this method.
   */
  public evaluateGate(
    intent: OrderIntent,
    quote: MarketQuote | QuoteProvenanceRecord | null,
    instrument: Instrument | null,
    portfolio: PortfolioSummary,
    positions: Position[],
    existingOrders: Order[],
    limits: RiskLimits,
    healthState: HealthState,
    isCooldownActive: (target: string) => boolean,
    isStrategySuspended: (strategyId: string) => boolean,
    isBrokerSuspended: (broker: string) => boolean,
    isGlobalKillSwitched: () => boolean,
    checkDailyLossBreach: (portfolio: PortfolioSummary) => boolean,
    checkDrawdownBreach: (portfolio: PortfolioSummary) => { breached: boolean; action: 'NONE' | 'PAUSE' | 'HALT' },
    hasUnresolvedOrderIntents: boolean | (() => boolean) = false,
    isInstrumentSuspended?: (symbol: string) => boolean
  ): PermissionGateResult {
    const checks: PermissionGateCheck[] = [];
    const timestamp = Date.now();

    const addCheck = (name: string, code: string, passed: boolean, critical: boolean, details: string) => {
      checks.push({ name, code, passed, critical, details });
    };

    // -------------------------------------------------------------
    // STAGE 0: Controlled Rollout Gate (PAPER_ONLY / SHADOW / DEMO / LIVE_PILOT)
    // -------------------------------------------------------------
    const rolloutStage = portfolio.rolloutStage || 'PAPER_ONLY';
    const liveExecutionAuthorized = !!portfolio.liveExecutionAuthorized;
    let stage0Passed = true;
    let stage0Details = `Rollout stage ${rolloutStage} is in a safe, explicit control state.`;

    if (portfolio.mode === 'LIVE' && (!liveExecutionAuthorized || rolloutStage !== 'LIVE_PILOT')) {
      stage0Passed = false;
      stage0Details = 'REJECTED: Live rollout is not authorized. Explicit operator approval, audited readiness, and broker reconciliation are required before LIVE_PILOT may advance.';
    }

    addCheck(
      'Controlled Rollout Authorization',
      'GATE_STAGE_0_LIVE_ROLLOUT_AUTH',
      stage0Passed,
      false,
      stage0Details
    );

    // -------------------------------------------------------------
    // STAGE 1: Verified Account Identity & Authorized Execution Mode
    // -------------------------------------------------------------
    const brokerConn = brokerTruthService.getConnectionInfo();
    let stage1Passed = true;
    let stage1Details = portfolio.mode === 'PAPER'
      ? 'PAPER mode is isolated from any broker account or execution connection.'
      : 'Broker account identity and execution authorization are not verified.';

    if (brokerConn.connectionHealth === 'DISCONNECTED') {
      stage1Passed = false;
      stage1Details = 'REJECTED: Broker connection is disconnected. Fail-closed armed.';
    } else if (portfolio.mode === 'LIVE') {
      if (
        !brokerConn.executionPermitted ||
        !brokerConn.readOnlyAuthenticated ||
        !brokerConn.accountId ||
        brokerConn.connectionHealth !== 'AUTHENTICATED_READ_ONLY'
      ) {
        stage1Passed = false;
        stage1Details = 'REJECTED: Verified live account identity, authenticated read-only account access, and authorized execution are required.';
      }
    }

    addCheck(
      'Account Identity & Execution Mode',
      'GATE_STAGE_1_ACCOUNT_AUTH',
      stage1Passed,
      true,
      stage1Details
    );

    // -------------------------------------------------------------
    // STAGE 2: Fresh, Valid Prices & Required Source Provenance
    // -------------------------------------------------------------
    let stage2Passed = true;
    let stage2Details = 'Valid fresh market quote confirmed';
    const quoteTimestamp = quote ? ('timestamp' in quote ? quote.timestamp : quote.sourceTimestamp) : 0;
    const quoteAge = quote ? Math.max(0, timestamp - quoteTimestamp) : 999999;
    const maxAge = limits.maxQuoteAgeMs || 30000;

    if (!quote) {
      stage2Passed = false;
      stage2Details = 'REJECTED: No market quote available for instrument';
    } else if (
      !Number.isFinite(quoteTimestamp) ||
      quoteTimestamp > timestamp
    ) {
      stage2Passed = false;
      stage2Details = 'REJECTED: Quote source timestamp is invalid or in the future';
    } else if (
      !Number.isFinite(quote.bid) ||
      !Number.isFinite(quote.ask) ||
      quote.bid <= 0 ||
      quote.ask <= 0 ||
      quote.ask < quote.bid
    ) {
      stage2Passed = false;
      stage2Details = `REJECTED: Inverted or non-positive spread: Bid ${quote.bid}, Ask ${quote.ask}`;
    } else if (quoteAge > maxAge || quote.isStale) {
      stage2Passed = false;
      stage2Details = `REJECTED: Market feed stale (age: ${quoteAge}ms > limit: ${maxAge}ms)`;
    } else if (
      portfolio.mode === 'LIVE' &&
      (!('provenance' in quote) || quote.provenance !== 'BROKER_CONFIRMED')
    ) {
      stage2Passed = false;
      stage2Details = 'REJECTED: LIVE entries require a fresh broker-confirmed quote; third-party, simulated, cached, historical, or app-estimated prices are not eligible.';
    } else {
      const spreadPct = ((quote.ask - quote.bid) / quote.bid) * 100;
      if (spreadPct > limits.maxSpreadTolerancePct) {
        stage2Passed = false;
        stage2Details = `REJECTED: Spread ${spreadPct.toFixed(3)}% exceeds tolerance ${limits.maxSpreadTolerancePct.toFixed(3)}%`;
      }
      // Check provenance if available
      if ('provenance' in quote && (quote.provenance === 'UNAVAILABLE' || quote.provenance === 'STALE')) {
        stage2Passed = false;
        stage2Details = `REJECTED: Quote provenance is ${quote.provenance} (${quote.unavailableReason || 'feed unverified'})`;
      }
    }

    addCheck(
      'Fresh & Valid Market Price Source',
      'GATE_STAGE_2_PRICE_PROVENANCE',
      stage2Passed,
      true,
      stage2Details
    );

    // -------------------------------------------------------------
    // STAGE 3: Correct Symbol Mapping & Instrument Specifications
    // -------------------------------------------------------------
    let stage3Passed = true;
    let stage3Details = `Symbol ${intent.symbol} verified with instrument specifications`;

    if (!instrument) {
      stage3Passed = false;
      stage3Details = `REJECTED: Symbol ${intent.symbol} not in supported instrument registry`;
    } else if (
      !Number.isFinite(instrument.minLotSize) || instrument.minLotSize <= 0 ||
      !Number.isFinite(instrument.lotStep) || instrument.lotStep <= 0 ||
      !Number.isFinite(instrument.tickSize) || instrument.tickSize <= 0 ||
      !Number.isFinite(instrument.marginRequirement) || instrument.marginRequirement <= 0 ||
      typeof instrument.currency !== 'string' || instrument.currency.trim() === ''
    ) {
      stage3Passed = false;
      stage3Details = `REJECTED: Instrument ${intent.symbol} has missing or invalid local trading constraints`;
    } else if (!Number.isFinite(intent.quantity) || intent.quantity <= 0) {
      stage3Passed = false;
      stage3Details = `REJECTED: Quantity ${intent.quantity} must be a finite positive number`;
    } else {
      if (intent.quantity < instrument.minLotSize) {
        stage3Passed = false;
        stage3Details = `REJECTED: Quantity ${intent.quantity} below minimum lot size ${instrument.minLotSize}`;
      } else if (!isAlignedToIncrement(intent.quantity, instrument.lotStep)) {
        stage3Passed = false;
        stage3Details = `REJECTED: Quantity ${intent.quantity} must be an exact multiple of lot step ${instrument.lotStep}`;
      } else if (intent.type === 'LIMIT' && intent.price === undefined) {
        stage3Passed = false;
        stage3Details = 'REJECTED: LIMIT orders require an explicit limit price';
      } else if (intent.price !== undefined && (!Number.isFinite(intent.price) || intent.price <= 0)) {
        stage3Passed = false;
        stage3Details = `REJECTED: Explicit order price ${intent.price} must be finite and positive`;
      } else if (intent.price !== undefined && !isAlignedToIncrement(intent.price, instrument.tickSize)) {
        stage3Passed = false;
        stage3Details = `REJECTED: Order price ${intent.price} must align to tick size ${instrument.tickSize}`;
      } else if (
        intent.stopLoss !== undefined &&
        (!Number.isFinite(intent.stopLoss) || intent.stopLoss <= 0)
      ) {
        stage3Passed = false;
        stage3Details = `REJECTED: Stop-loss price ${intent.stopLoss} must be finite and positive`;
      } else if (intent.stopLoss !== undefined && !isAlignedToIncrement(intent.stopLoss, instrument.tickSize)) {
        stage3Passed = false;
        stage3Details = `REJECTED: Stop-loss price ${intent.stopLoss} must align to tick size ${instrument.tickSize}`;
      } else if (
        intent.takeProfit !== undefined &&
        (!Number.isFinite(intent.takeProfit) || intent.takeProfit <= 0)
      ) {
        stage3Passed = false;
        stage3Details = `REJECTED: Take-profit price ${intent.takeProfit} must be finite and positive`;
      } else if (intent.takeProfit !== undefined && !isAlignedToIncrement(intent.takeProfit, instrument.tickSize)) {
        stage3Passed = false;
        stage3Details = `REJECTED: Take-profit price ${intent.takeProfit} must align to tick size ${instrument.tickSize}`;
      }

      if (stage3Passed && !isConfiguredEntrySessionOpen(instrument, timestamp)) {
        stage3Passed = false;
        stage3Details = `REJECTED: No configured open entry session for ${instrument.symbol}.`;
      }
    }

    addCheck(
      'Symbol Mapping & Specifications',
      'GATE_STAGE_3_INSTRUMENT_SPEC',
      stage3Passed,
      true,
      stage3Details
    );

    // -------------------------------------------------------------
    // STAGE 4: Reconciled Account, Positions & Outstanding Orders
    // -------------------------------------------------------------
    let stage4Passed = true;
    let stage4Details = 'PAPER mode uses the isolated local ledger; no broker reconciliation is claimed.';
    const brokerTruth = brokerTruthService.getBrokerTruthState();

    if (portfolio.mode === 'LIVE' && brokerTruth.reconciliationStatus.status !== 'RECONCILED') {
      stage4Passed = false;
      stage4Details = `REJECTED: ${brokerTruth.reconciliationStatus.details} New entries blocked until broker reconciliation is complete.`;
    }

    addCheck(
      'Account & Position Reconciliation',
      'GATE_STAGE_4_RECONCILIATION',
      stage4Passed,
      true,
      stage4Details
    );

    // -------------------------------------------------------------
    // STAGE 5: Valid Initial Stop-Loss & Position Risk Limit
    // -------------------------------------------------------------
    let stage5Passed = true;
    let stage5Details = 'Valid initial protective stop-loss confirmed';
    const currentPrice = quote ? (intent.side === 'BUY' ? quote.ask : quote.bid) : 0;
    const stopLoss = intent.stopLoss ?? 0;

    if (!stopLoss || stopLoss <= 0 || isNaN(stopLoss)) {
      stage5Passed = false;
      stage5Details = 'REJECTED: Protective stop-loss is mandatory for all entries. Unprotected risk prohibited.';
    } else if (intent.side === 'BUY' && stopLoss >= currentPrice) {
      stage5Passed = false;
      stage5Details = `REJECTED: BUY stop-loss $${stopLoss} must be strictly below market entry $${currentPrice}`;
    } else if (intent.side === 'SELL' && stopLoss <= currentPrice) {
      stage5Passed = false;
      stage5Details = `REJECTED: SELL stop-loss $${stopLoss} must be strictly above market entry $${currentPrice}`;
    } else {
      const stopDistance = Math.abs(currentPrice - stopLoss);
      const riskDollar = intent.quantity * stopDistance;
      const riskPct = portfolio.totalEquity > 0 ? (riskDollar / portfolio.totalEquity) * 100 : 999;
      const maxAllowedRiskPct = limits.maxRiskPerTradePct;

      if (riskPct > maxAllowedRiskPct) {
        stage5Passed = false;
        stage5Details = `REJECTED: Calculated trade risk ${riskPct.toFixed(2)}% ($${riskDollar.toFixed(2)}) exceeds max allowed per-trade limit ${limits.maxRiskPerTradePct}%`;
      } else {
        stage5Details = `Protective stop valid at $${stopLoss} (${riskPct.toFixed(2)}% equity risk)`;
      }
    }

    addCheck(
      'Initial Protective Stop & Position Risk',
      'GATE_STAGE_5_PROTECTIVE_STOP',
      stage5Passed,
      true,
      stage5Details
    );

    // -------------------------------------------------------------
    // STAGE 6: Account Exposure, Margin, Daily Loss & Drawdown
    // -------------------------------------------------------------
    let stage6Passed = true;
    let stage6Details = 'Account exposure and margin limits verified';

    if (checkDailyLossBreach(portfolio) || portfolio.isDailyLossHalted) {
      stage6Passed = false;
      stage6Details = `REJECTED: Daily loss limit breached (${portfolio.dailyLossPct.toFixed(2)}% >= ${limits.dailyLossShutdownPct}%). Entry locked.`;
    } else {
      const ddStatus = checkDrawdownBreach(portfolio);
      if (ddStatus.breached) {
        stage6Passed = false;
        stage6Details = `REJECTED: Portfolio max drawdown circuit breaker active (${portfolio.currentDrawdownPct.toFixed(2)}%).`;
      } else {
        const notional = intent.quantity * currentPrice;
        const requiredMargin = instrument ? notional * instrument.marginRequirement : notional;
        if (requiredMargin > portfolio.availableMargin) {
          stage6Passed = false;
          stage6Details = `REJECTED: Insufficient available margin: required $${requiredMargin.toFixed(2)}, available $${portfolio.availableMargin.toFixed(2)}`;
        }
      }
    }

    if (stage6Passed) {
      const portfolioRisk = portfolioRiskService.assess({
        equity: portfolio.totalEquity,
        positions,
        orders: existingOrders.filter((order) => order.id !== intent.orderId),
        proposed: instrument && currentPrice > 0
          ? {
              clientOrderId: intent.clientOrderId,
              symbol: intent.symbol,
              side: intent.side,
              quantity: intent.quantity,
              price: currentPrice,
              stopLoss: intent.stopLoss,
              strategyId: intent.strategyId,
              instrument,
            }
          : undefined,
        getInstrument: (symbol) => marketDataService.getInstrument(symbol),
        limits,
        now: timestamp,
      });
      if (!portfolioRisk.entryAllowed) {
        stage6Passed = false;
        stage6Details = `REJECTED: Portfolio risk assessment ${portfolioRisk.status.toLowerCase()}: ${portfolioRisk.reasons.join(' ')}`;
      } else if (portfolioRisk.status !== 'ESTIMATED_PAPER_ONLY') {
        stage6Passed = false;
        stage6Details = `REJECTED: Portfolio risk assessment unavailable: ${portfolioRisk.reasons.join(' ')}`;
      } else {
        stage6Details = `Estimated local-ledger portfolio stress and exposure checks passed (${portfolioRisk.grossLeverage?.toFixed(2)}x gross leverage; ${portfolioRisk.exposureBySymbol.length} symbol groups). Not broker-reconciled.`;
      }
    }

    addCheck(
      'Account Exposure, Margin & Drawdown',
      'GATE_STAGE_6_EXPOSURE_MARGIN',
      stage6Passed,
      true,
      stage6Details
    );

    // -------------------------------------------------------------
    // STAGE 7: Trading Schedule, Sessions & Active Cooldowns
    // -------------------------------------------------------------
    let stage7Passed = true;
    let stage7Details = 'Schedule and cooldown conditions satisfied';

    if (isGlobalKillSwitched() || portfolio.isGlobalKillSwitched) {
      stage7Passed = false;
      stage7Details = 'REJECTED: Global emergency kill switch is engaged.';
    } else if (isCooldownActive('ACCOUNT')) {
      stage7Passed = false;
      stage7Details = 'REJECTED: Account-wide revenge-trading cooldown active (5 consecutive losses). Entries paused for 30m.';
    } else if (isCooldownActive(intent.strategyId)) {
      stage7Passed = false;
      stage7Details = `REJECTED: Strategy ${intent.strategyId} is in 30-minute revenge-trading cooldown after 5 consecutive losses.`;
    } else if (isStrategySuspended(intent.strategyId)) {
      stage7Passed = false;
      stage7Details = `REJECTED: Strategy ${intent.strategyId} is quarantined by risk monitor.`;
    } else if (isInstrumentSuspended?.(intent.symbol) === true) {
      stage7Passed = false;
      stage7Details = `REJECTED: Instrument ${intent.symbol} is paused by the operator and blocks all new entries.`;
    } else if (isBrokerSuspended(intent.broker)) {
      stage7Passed = false;
      stage7Details = `REJECTED: Broker ${intent.broker} is isolated.`;
    }

    addCheck(
      'Trading Schedule & Revenge Cooldowns',
      'GATE_STAGE_7_COOLDOWNS_SESSIONS',
      stage7Passed,
      true,
      stage7Details
    );

    // -------------------------------------------------------------
    // STAGE 8: Duplicate Order Protection & Execution Service Health
    // -------------------------------------------------------------
    let stage8Passed = true;
    let stage8Details = 'Idempotency and execution service health confirmed';

    if (healthState !== 'HEALTHY') {
      stage8Passed = false;
      stage8Details = `REJECTED: Execution service health is ${healthState}; new entries require HEALTHY status. Fail-closed armed.`;
    } else if (
      typeof hasUnresolvedOrderIntents === 'function'
        ? hasUnresolvedOrderIntents()
        : hasUnresolvedOrderIntents
    ) {
      stage8Passed = false;
      stage8Details = 'REJECTED: An order submission has an uncertain outcome. New entries are blocked until its broker-confirmed outcome is reconciled.';
    } else if (intent.clientOrderId) {
      // Idempotency check: verify this clientOrderId is not already in previously submitted/filled orders
      const duplicate = existingOrders.find(
        (o) =>
          o.clientOrderId === intent.clientOrderId &&
          o.id !== intent.orderId &&
          ['VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED'].includes(o.status)
      );
      if (duplicate) {
        stage8Passed = false;
        stage8Details = `REJECTED: Duplicate clientOrderId detected (${intent.clientOrderId}). Order already processed with state ${duplicate.status}.`;
      }
    }

    addCheck(
      'Duplicate Protection & System Health',
      'GATE_STAGE_8_IDEMPOTENCY_HEALTH',
      stage8Passed,
      true,
      stage8Details
    );

    // Determine aggregate result
    const criticalFailure = checks.find((c) => c.critical && !c.passed);
    const approved = !criticalFailure;
    const gateCode = approved ? 'GATE_PASSED' : criticalFailure?.code || 'GATE_REJECTED';
    const message = approved
      ? 'All 8 permission gate stages verified. Order permitted to route.'
      : criticalFailure?.details || 'Permission gate rejected order intent.';

    // Durable audit logging on failure
    if (!approved) {
      auditLogger.record({
        category: 'RISK_DECISION',
        level: 'WARNING',
        action: 'PERMISSION_GATE_REJECTION',
        details: {
          symbol: intent.symbol,
          side: intent.side,
          quantity: intent.quantity,
          strategyId: intent.strategyId,
          gateCode,
          reason: message,
          failedCheck: criticalFailure?.name,
        },
        actor: 'RISK_ENGINE',
      });
    }

    return {
      approved,
      gateCode,
      message,
      checks,
      timestamp,
    };
  }
}

export const centralPermissionGate = new CentralPermissionGate();
