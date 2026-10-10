import { createHash, randomUUID } from 'crypto';
import {
  BrokerTruthState,
  HealthState,
  Instrument,
  MarketQuote,
  Order,
  OrderSide,
  OrderType,
  PermissionGateResult,
  PortfolioSummary,
  Position,
  QuoteProvenanceRecord,
  RiskLimits,
  RiskValidationResult,
} from '../../src/types/trading';
import type { OrderIntent } from '../risk/permission-gate';
import { auditLogger } from '../audit/audit-logger';
import { PortfolioRiskService } from '../risk/portfolio-risk-service';
import { marketDataService } from '../data/market-data-service';

export interface BrokerInstrumentConstraints {
  appSymbol: string;
  brokerSymbol: string;
  asOf: number;
  provenance: 'BROKER_CONFIRMED' | 'UNAVAILABLE' | 'STALE';
  minimumVolume: number;
  maximumVolume: number;
  volumeStep: number;
  contractSize: number;
  tickSize: number;
  tickValue: number;
  profitCurrency: string;
  marginCurrency: string;
  marginRequirement: number;
  commissionPerUnit: number;
  commissionType: Instrument['commissionType'];
  minimumStopDistance: number;
  freezeLevel: number;
  allowedOrderTypes: OrderType[];
  executionMode: string;
  allowedFillPolicies: string[];
  expirationRules: string[];
  tradingAllowed: boolean;
  closeOnly: boolean;
  tradingSessionOpen: boolean;
}

export interface OrderAuthorizationContext {
  intent: OrderIntent;
  brokerTruth: BrokerTruthState;
  brokerQuote: QuoteProvenanceRecord | null;
  brokerInstrument: BrokerInstrumentConstraints | null;
  quote: MarketQuote | null;
  instrument: Instrument | null;
  portfolio: PortfolioSummary;
  positions: Position[];
  orders: Order[];
  limits: RiskLimits;
  health: HealthState;
  permissionGate: PermissionGateResult;
  riskApproval: RiskValidationResult;
}

export interface OrderAuthorizationApproval {
  approvalId: string;
  snapshotFingerprint: string;
  approvedAt: number;
  expiresAt: number;
}

export interface OrderAuthorizationDecision {
  approved: boolean;
  approval?: OrderAuthorizationApproval;
  message: string;
  checks: Array<{ name: string; passed: boolean; details: string }>;
  timestamp: number;
}

export interface BrokerAwarePositionSize {
  maximumQuantity: number;
  riskBudget: number;
  estimatedWorstCaseLoss: number;
  lossPerVolumeUnit: number;
}

export function calculateBrokerAwarePositionSize(input: {
  equity: number;
  riskPercent: number;
  entryPrice: number;
  stopLossPrice: number;
  accountCurrency: string;
  constraints: BrokerInstrumentConstraints;
  maxSlippagePercent: number;
}): BrokerAwarePositionSize | null {
  const { constraints } = input;
  const numericInputs = [
    input.equity,
    input.riskPercent,
    input.entryPrice,
    input.stopLossPrice,
    input.maxSlippagePercent,
    constraints.minimumVolume,
    constraints.maximumVolume,
    constraints.volumeStep,
    constraints.contractSize,
    constraints.tickSize,
    constraints.tickValue,
    constraints.commissionPerUnit,
  ];
  if (
    !numericInputs.every(Number.isFinite) ||
    input.equity <= 0 ||
    input.riskPercent <= 0 ||
    input.entryPrice <= 0 ||
    input.stopLossPrice <= 0 ||
    input.entryPrice === input.stopLossPrice ||
    input.maxSlippagePercent < 0 ||
    constraints.minimumVolume <= 0 ||
    constraints.maximumVolume < constraints.minimumVolume ||
    constraints.volumeStep <= 0 ||
    constraints.contractSize <= 0 ||
    constraints.tickSize <= 0 ||
    constraints.tickValue <= 0 ||
    constraints.commissionPerUnit < 0 ||
    constraints.profitCurrency !== input.accountCurrency ||
    constraints.marginCurrency !== input.accountCurrency
  ) {
    return null;
  }

  const stopTicks = Math.ceil(Math.abs(input.entryPrice - input.stopLossPrice) / constraints.tickSize);
  const adverseSlippageTicks = Math.ceil(
    input.entryPrice * (input.maxSlippagePercent / 100) / constraints.tickSize
  );
  const roundTripCommission = constraints.commissionType === 'PERCENTAGE'
    ? (input.entryPrice + input.stopLossPrice) * constraints.contractSize * constraints.commissionPerUnit
    : constraints.commissionPerUnit * 2;
  const lossPerVolumeUnit =
    (stopTicks + adverseSlippageTicks * 2) * constraints.tickValue + roundTripCommission;
  const riskBudget = input.equity * input.riskPercent / 100;
  if (!Number.isFinite(lossPerVolumeUnit) || lossPerVolumeUnit <= 0 || !Number.isFinite(riskBudget)) {
    return null;
  }

  const rawQuantity = Math.min(constraints.maximumVolume, riskBudget / lossPerVolumeUnit);
  if (rawQuantity < constraints.minimumVolume) {
    return {
      maximumQuantity: 0,
      riskBudget,
      estimatedWorstCaseLoss: 0,
      lossPerVolumeUnit,
    };
  }

  const stepCount = Math.floor(
    (rawQuantity - constraints.minimumVolume) / constraints.volumeStep + Number.EPSILON * 8
  );
  const maximumQuantity = constraints.minimumVolume + stepCount * constraints.volumeStep;
  const estimatedWorstCaseLoss = maximumQuantity * lossPerVolumeUnit;
  if (
    !Number.isFinite(maximumQuantity) ||
    maximumQuantity > constraints.maximumVolume ||
    estimatedWorstCaseLoss > riskBudget
  ) {
    return null;
  }

  return { maximumQuantity, riskBudget, estimatedWorstCaseLoss, lossPerVolumeUnit };
}

interface IssuedApproval {
  fingerprint: string;
  approvedAt: number;
  expiresAt: number;
}

function isFreshTimestamp(timestamp: number | null | undefined, now: number, maxAgeMs: number): boolean {
  return Number.isFinite(timestamp) && timestamp! <= now && now - timestamp! <= maxAgeMs;
}

function isAligned(value: number, increment: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) return false;
  const units = value / increment;
  return Number.isFinite(units) &&
    Math.abs(units - Math.round(units)) <= Number.EPSILON * Math.max(1, Math.abs(units)) * 8;
}

function isCloseTo(left: number | null, right: number, tolerance = 0.01): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left! - right) <= tolerance;
}

function safeAccountFingerprint(state: BrokerTruthState): string {
  return createHash('sha256')
    .update(`${state.connection.brokerName ?? ''}|${state.connection.server ?? ''}|${state.connection.accountId ?? ''}`)
    .digest('hex');
}

function stableSnapshot(context: OrderAuthorizationContext): string {
  const { brokerTruth, brokerQuote, brokerInstrument, quote, instrument, portfolio, positions, orders, limits, health, intent } = context;
  const relevantTruth = {
    connection: brokerTruth.connection,
    accountSnapshot: brokerTruth.accountSnapshot,
    positions: [...brokerTruth.positions].sort((a, b) => a.ticket.localeCompare(b.ticket)),
    deals: [...brokerTruth.deals].sort((a, b) => a.ticket.localeCompare(b.ticket)),
    reconciliationStatus: brokerTruth.reconciliationStatus,
  };
  const relevantBrokerQuote = brokerQuote && {
    appSymbol: brokerQuote.appSymbol,
    brokerSymbol: brokerQuote.brokerSymbol,
    bid: brokerQuote.bid,
    ask: brokerQuote.ask,
    sourceTimestamp: brokerQuote.sourceTimestamp,
    receiptTimestamp: brokerQuote.receiptTimestamp,
    quoteAgeMs: brokerQuote.quoteAgeMs,
    ticketOrSeq: brokerQuote.ticketOrSeq,
    provenance: brokerQuote.provenance,
    connectionHealth: brokerQuote.connectionHealth,
    isStale: brokerQuote.isStale,
  };
  const checks = {
    permissionGate: {
      approved: context.permissionGate.approved,
      gateCode: context.permissionGate.gateCode,
      checks: context.permissionGate.checks.map(({ name, code, passed, critical }) => ({ name, code, passed, critical })),
    },
    riskApproval: {
      approved: context.riskApproval.approved,
      code: context.riskApproval.code,
      checks: context.riskApproval.checks.map(({ name, passed }) => ({ name, passed })),
    },
  };
  return JSON.stringify({
    intent,
    relevantTruth,
    brokerQuote: relevantBrokerQuote,
    brokerInstrument,
    quote,
    instrument,
    portfolio,
    positions: [...positions].sort((a, b) => a.id.localeCompare(b.id)),
    orders: orders.filter((order) => order.id !== intent.orderId).sort((a, b) => a.id.localeCompare(b.id)),
    limits,
    health,
    checks,
  });
}

export class OrderAuthorizationService {
  private readonly issuedApprovals = new Map<string, IssuedApproval>();
  private readonly portfolioRiskService = new PortfolioRiskService();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly approvalTtlMs: number = 1500
  ) {}

  public authorize(context: OrderAuthorizationContext): OrderAuthorizationDecision {
    const timestamp = this.now();
    this.removeExpiredApprovals(timestamp);
    const checks = this.evaluate(context, timestamp);
    const approved = checks.every((check) => check.passed);
    const fingerprint = this.fingerprint(context);
    const approvalId = randomUUID();
    const expiresAt = timestamp + this.approvalTtlMs;
    const approval = approved
      ? { approvalId, snapshotFingerprint: fingerprint, approvedAt: timestamp, expiresAt }
      : undefined;

    if (approval) {
      this.issuedApprovals.set(approvalId, { fingerprint, approvedAt: timestamp, expiresAt });
    }
    this.recordDecision(context, timestamp, approval ? 'APPROVED' : 'REJECTED', checks, fingerprint, approvalId);
    return {
      approved,
      approval,
      checks,
      timestamp,
      message: approved
        ? 'All three independent authorization approvals passed.'
        : checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.details}`).join(' '),
    };
  }

  public revalidate(
    approval: OrderAuthorizationApproval,
    context: OrderAuthorizationContext
  ): OrderAuthorizationDecision {
    const timestamp = this.now();
    const issued = this.issuedApprovals.get(approval.approvalId);
    this.issuedApprovals.delete(approval.approvalId);
    const checks = this.evaluate(context, timestamp);
    const fingerprint = this.fingerprint(context);
    const approvalValid = !!issued &&
      issued.approvedAt === approval.approvedAt &&
      issued.expiresAt === approval.expiresAt &&
      timestamp <= issued.expiresAt &&
      issued.fingerprint === approval.snapshotFingerprint &&
      fingerprint === approval.snapshotFingerprint;
    checks.push({
      name: 'Authorization freshness and intent binding',
      passed: approvalValid,
      details: approvalValid
        ? 'Single-use approval remains unexpired and is bound to the unchanged order/account/data/risk snapshot.'
        : !issued
        ? 'Approval is unknown, already used, or invalidated.'
        : timestamp > issued.expiresAt
        ? 'Approval expired before submission.'
        : 'Order intent or material account, quote, instrument, position, order, health, or risk state changed after approval.',
    });
    const approved = checks.every((check) => check.passed);
    this.recordDecision(context, timestamp, approved ? 'REVALIDATED' : 'REJECTED', checks, fingerprint, approval.approvalId);
    return {
      approved,
      checks,
      timestamp,
      message: approved
        ? 'All authorization approvals were revalidated immediately before submission.'
        : checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.details}`).join(' '),
    };
  }

  public recordServiceFailure(intent: OrderIntent, reason: string): void {
    auditLogger.record({
      category: 'RISK_DECISION',
      level: 'CRITICAL',
      action: 'ORDER_AUTHORIZATION_SERVICE_FAILURE',
      details: {
        timestamp: this.now(),
        decision: 'REJECTED',
        orderIntent: intent,
        checks: [{ name: 'Authorization service availability', passed: false, details: reason }],
        rejectionReason: reason,
        brokerResponse: { status: 'NOT_SUBMITTED', reason: 'Authorization did not complete; no broker request was sent.' },
      },
      actor: 'RISK_ENGINE',
    });
  }

  private evaluate(context: OrderAuthorizationContext, timestamp: number): OrderAuthorizationDecision['checks'] {
    const maxAgeMs = Number.isFinite(context.limits.maxQuoteAgeMs) && context.limits.maxQuoteAgeMs > 0
      ? context.limits.maxQuoteAgeMs
      : 0;
    const { connection, accountSnapshot } = context.brokerTruth;
    const accountFresh = isFreshTimestamp(accountSnapshot.asOf, timestamp, maxAgeMs) &&
      isFreshTimestamp(connection.lastSyncTimestamp, timestamp, maxAgeMs) &&
      isFreshTimestamp(context.brokerTruth.reconciliationStatus.lastReconciledAt, timestamp, maxAgeMs);
    const accountValuesValid = [accountSnapshot.balance, accountSnapshot.equity, accountSnapshot.margin, accountSnapshot.freeMargin]
      .every((value) => Number.isFinite(value) && value! >= 0);
    const marginMetricsValid = (accountSnapshot.margin ?? 0) === 0 ||
      (Number.isFinite(accountSnapshot.marginLevelPct) && accountSnapshot.marginLevelPct! >= 0);
    const accountPositionRecordsValid = context.brokerTruth.positions.every((position) =>
      position.provenance === 'BROKER_CONFIRMED'
    );
    const accountDealRecordsValid = context.brokerTruth.deals.every((deal) =>
      deal.provenance === 'BROKER_CONFIRMED'
    );
    const verifiedPnl = context.brokerTruth.pnlVerification;
    const pnlVerified = verifiedPnl.provenance === 'BROKER_CONFIRMED' &&
      verifiedPnl.hasDiscrepancy === false &&
      isFreshTimestamp(verifiedPnl.verifiedAsOf, timestamp, maxAgeMs) &&
      [verifiedPnl.realizedPnL, verifiedPnl.unrealizedPnL, verifiedPnl.brokerReportedTotalPnL,
        verifiedPnl.appCalculatedTotalPnL, verifiedPnl.netDiscrepancy]
        .every((value) => Number.isFinite(value)) &&
      Math.abs(verifiedPnl.netDiscrepancy ?? Number.POSITIVE_INFINITY) <= 0.01 &&
      Math.abs((verifiedPnl.brokerReportedTotalPnL ?? Number.POSITIVE_INFINITY) -
        (verifiedPnl.appCalculatedTotalPnL ?? Number.NEGATIVE_INFINITY)) <= 0.01;
    const riskAccountMatchesBroker = isCloseTo(accountSnapshot.equity, context.portfolio.totalEquity) &&
      isCloseTo(accountSnapshot.balance, context.portfolio.cashBalance) &&
      isCloseTo(accountSnapshot.margin, context.portfolio.usedMargin) &&
      isCloseTo(accountSnapshot.freeMargin, context.portfolio.availableMargin);
    const accountPassed = context.portfolio.mode === 'PAPER' &&
      connection.accountMode === 'DEMO' &&
      connection.connectionHealth === 'AUTHENTICATED_READ_ONLY' &&
      Number.isFinite(connection.leverage) &&
      (connection.leverage ?? 0) > 0 &&
      connection.readOnlyAuthenticated &&
      connection.executionPermitted &&
      !!connection.brokerName?.trim() &&
      !!connection.server?.trim() &&
      !!connection.accountId?.trim() &&
      !!connection.currency?.trim() &&
      accountSnapshot.provenance === 'BROKER_CONFIRMED' &&
      (accountSnapshot.equity ?? 0) > 0 &&
      accountSnapshot.currency === connection.currency &&
      accountValuesValid &&
      marginMetricsValid &&
      accountPositionRecordsValid &&
      accountDealRecordsValid &&
      pnlVerified &&
      riskAccountMatchesBroker &&
      Math.abs((verifiedPnl.unrealizedPnL ?? Number.POSITIVE_INFINITY) - context.portfolio.unrealizedPnL) < 0.01 &&
      accountFresh &&
      context.brokerTruth.reconciliationStatus.status === 'RECONCILED' &&
      context.brokerTruth.reconciliationStatus.inSync &&
      context.brokerTruth.reconciliationStatus.unresolvedDiscrepancies === 0;
    const accountDetails = accountPassed
      ? 'Fresh authenticated demo-account state and broker reconciliation are verified.'
      : 'REJECTED: fresh authenticated demo-account state, broker-confirmed account values, authorized mode, and zero-discrepancy broker reconciliation are required.';

    const brokerQuote = context.brokerQuote;
    const quoteFresh = !!brokerQuote &&
      brokerQuote.provenance === 'BROKER_CONFIRMED' &&
      brokerQuote.connectionHealth === 'HEALTHY' &&
      !brokerQuote.isStale &&
      isFreshTimestamp(brokerQuote.sourceTimestamp, timestamp, maxAgeMs) &&
      isFreshTimestamp(brokerQuote.receiptTimestamp, timestamp, maxAgeMs) &&
      Number.isFinite(brokerQuote.quoteAgeMs) &&
      (brokerQuote.quoteAgeMs ?? -1) >= 0 &&
      (brokerQuote.quoteAgeMs ?? Number.POSITIVE_INFINITY) <= maxAgeMs &&
      Number.isFinite(brokerQuote.bid) &&
      Number.isFinite(brokerQuote.ask) &&
      brokerQuote.bid > 0 &&
      brokerQuote.ask >= brokerQuote.bid;
    const quoteMatches = !!brokerQuote && !!context.quote &&
      brokerQuote.appSymbol === context.intent.symbol &&
      context.quote.symbol === context.intent.symbol &&
      context.quote.quality === 'LIVE' &&
      context.quote.isLiveBrokerExecutable &&
      !context.quote.isStale &&
      context.quote.bid === brokerQuote.bid &&
      context.quote.ask === brokerQuote.ask &&
      context.quote.timestamp === brokerQuote.sourceTimestamp;
    const quoteRegistered = !!brokerQuote && context.brokerTruth.quotes.some((candidate) =>
      candidate.appSymbol === brokerQuote.appSymbol &&
      candidate.brokerSymbol === brokerQuote.brokerSymbol &&
      candidate.sourceTimestamp === brokerQuote.sourceTimestamp &&
      candidate.provenance === 'BROKER_CONFIRMED'
    );
    const constraints = context.brokerInstrument;
    const constraintsFresh = !!constraints &&
      constraints.provenance === 'BROKER_CONFIRMED' &&
      isFreshTimestamp(constraints.asOf, timestamp, maxAgeMs);
    const constraintsValid = !!constraints &&
      constraints.appSymbol === context.intent.symbol &&
      !!constraints.brokerSymbol.trim() &&
      constraints.minimumVolume > 0 &&
      constraints.maximumVolume >= constraints.minimumVolume &&
      constraints.volumeStep > 0 &&
      constraints.contractSize > 0 &&
      constraints.tickSize > 0 &&
      constraints.tickValue > 0 &&
      constraints.marginRequirement > 0 &&
      constraints.commissionPerUnit >= 0 &&
      (constraints.commissionType === 'FIXED_PER_UNIT' || constraints.commissionType === 'PERCENTAGE') &&
      Number.isFinite(constraints.minimumStopDistance) &&
      constraints.minimumStopDistance >= 0 &&
      Number.isFinite(constraints.freezeLevel) &&
      constraints.freezeLevel >= 0 &&
      [constraints.minimumVolume, constraints.maximumVolume, constraints.volumeStep, constraints.contractSize,
        constraints.tickSize, constraints.tickValue, constraints.marginRequirement, constraints.commissionPerUnit]
        .every(Number.isFinite) &&
      !!constraints.profitCurrency.trim() &&
      !!constraints.marginCurrency.trim() &&
      !!constraints.executionMode.trim() &&
      constraints.allowedOrderTypes.length > 0 &&
      constraints.allowedFillPolicies.length > 0 &&
      constraints.expirationRules.length > 0;
    const localInstrumentMappingValid = !!constraints && !!context.instrument &&
      context.instrument.symbol === context.intent.symbol &&
      constraints.brokerSymbol === context.brokerQuote?.brokerSymbol &&
      context.instrument.currency === constraints.profitCurrency &&
      constraints.profitCurrency === context.brokerTruth.accountSnapshot.currency &&
      constraints.marginCurrency === context.brokerTruth.accountSnapshot.currency;
    const requestedType = context.intent.type || 'MARKET';
    const supportedExecutionSemantics = constraints?.executionMode === 'MARKET' &&
      requestedType === 'MARKET' &&
      constraints.allowedFillPolicies.includes('FOK') &&
      constraints.expirationRules.includes('GTC');
    const executablePrice = brokerQuote && context.intent.side === 'BUY' ? brokerQuote.ask : brokerQuote?.bid;
    const validQuotePrices = !!constraints && !!brokerQuote &&
      isAligned(brokerQuote.bid, constraints.tickSize) &&
      isAligned(brokerQuote.ask, constraints.tickSize);
    const stopLoss = context.intent.stopLoss;
    const validStop = Number.isFinite(stopLoss) &&
      Number.isFinite(executablePrice) &&
      (context.intent.side === 'BUY' ? stopLoss! < executablePrice! : stopLoss! > executablePrice!) &&
      Math.abs(executablePrice! - stopLoss!) >= Math.max(
        constraints?.minimumStopDistance ?? Number.POSITIVE_INFINITY,
        constraints?.freezeLevel ?? Number.POSITIVE_INFINITY
      );
    const validVolume = !!constraints &&
      Number.isFinite(context.intent.quantity) &&
      context.intent.quantity >= constraints.minimumVolume &&
      context.intent.quantity <= constraints.maximumVolume &&
      isAligned(context.intent.quantity - constraints.minimumVolume, constraints.volumeStep);
    const validPrices = !!constraints &&
      (context.intent.price === undefined ||
        (Number.isFinite(context.intent.price) && context.intent.price > 0 && isAligned(context.intent.price, constraints.tickSize))) &&
      (context.intent.stopLoss === undefined || isAligned(context.intent.stopLoss, constraints.tickSize)) &&
      (context.intent.takeProfit === undefined || isAligned(context.intent.takeProfit, constraints.tickSize));
    const validLimitPrice = requestedType !== 'LIMIT' || (!!brokerQuote && context.intent.price !== undefined &&
      (context.intent.side === 'BUY' ? context.intent.price <= brokerQuote.ask : context.intent.price >= brokerQuote.bid));
    const validTakeProfit = context.intent.takeProfit === undefined ||
      (Number.isFinite(context.intent.takeProfit) &&
        context.intent.takeProfit > 0 &&
        Number.isFinite(executablePrice) &&
        (context.intent.side === 'BUY'
          ? context.intent.takeProfit > executablePrice!
          : context.intent.takeProfit < executablePrice!));
    const brokerSpreadPct = brokerQuote && brokerQuote.bid > 0
    ? ((brokerQuote.ask - brokerQuote.bid) / brokerQuote.bid) * 100
    : Number.POSITIVE_INFINITY;
    const validSpread = Number.isFinite(brokerSpreadPct) &&
    brokerSpreadPct <= context.limits.maxSpreadTolerancePct;
    const brokerSizing = constraints && Number.isFinite(executablePrice) && Number.isFinite(stopLoss)
    ? calculateBrokerAwarePositionSize({
        equity: context.brokerTruth.accountSnapshot.equity ?? 0,
        riskPercent: context.limits.maxRiskPerTradePct,
        entryPrice: executablePrice!,
        stopLossPrice: stopLoss!,
        accountCurrency: context.brokerTruth.accountSnapshot.currency ?? '',
        constraints,
        maxSlippagePercent: context.limits.maxSlippageTolerancePct,
      })
    : null;
    const withinBrokerRiskBudget = !!brokerSizing &&
    brokerSizing.maximumQuantity > 0 &&
    context.intent.quantity <= brokerSizing.maximumQuantity &&
    context.intent.quantity * brokerSizing.lossPerVolumeUnit <= brokerSizing.riskBudget;
    const brokerInstrumentPassed = constraintsFresh &&
    constraintsValid &&
    localInstrumentMappingValid &&
    context.health === 'HEALTHY' &&
      constraints!.tradingAllowed &&
      !constraints!.closeOnly &&
      constraints!.tradingSessionOpen &&
      constraints!.allowedOrderTypes.includes(requestedType) &&
      supportedExecutionSemantics &&
      validQuotePrices &&
      validSpread &&
      validVolume &&
      validPrices &&
      validLimitPrice &&
      validTakeProfit &&
      validStop &&
      withinBrokerRiskBudget;
    const instrumentDetails = brokerInstrumentPassed
      ? 'Fresh broker instrument rules, executable quote, volume, order type, session, and protective stop are valid.'
      : `REJECTED: fresh broker symbol rules, executable quote, spread within ${context.limits.maxSpreadTolerancePct}%, volume bounds/step, tick alignment, compatible account currency, active session, order/fill/expiration policies, permission, valid minimum-distance protective stop, and worst-case stop/slippage/commission loss within ${context.limits.maxRiskPerTradePct}% risk (${brokerSizing ? `max size ${brokerSizing.maximumQuantity}` : 'sizing unavailable'}).`;

    const permissionPassed = context.permissionGate.approved;
    const riskPassed = context.riskApproval.approved;
    const portfolioRisk = this.portfolioRiskService.assess({
      equity: context.brokerTruth.accountSnapshot.equity ?? 0,
      positions: context.positions,
      orders: context.orders.filter((order) => order.id !== context.intent.orderId),
      proposed: context.instrument && Number.isFinite(executablePrice)
        ? {
            clientOrderId: context.intent.clientOrderId,
            symbol: context.intent.symbol,
            side: context.intent.side,
            quantity: context.intent.quantity,
            price: executablePrice!,
            stopLoss: context.intent.stopLoss,
            strategyId: context.intent.strategyId,
            instrument: context.instrument,
          }
        : undefined,
      getInstrument: (symbol) => symbol === context.instrument?.symbol
        ? context.instrument
        : marketDataService.getInstrument(symbol),
      limits: context.limits,
      accountCurrency: context.brokerTruth.accountSnapshot.currency ?? undefined,
      now: timestamp,
    });
    const unmappedBrokerPositions = context.brokerTruth.positions.length > 0;
    const portfolioRiskPassed = !unmappedBrokerPositions &&
      portfolioRisk.status === 'ESTIMATED_PAPER_ONLY' &&
      portfolioRisk.entryAllowed;
    return [
      { name: 'A. Verified broker and account state', passed: accountPassed && quoteFresh && quoteMatches && quoteRegistered, details: !accountPassed ? accountDetails : quoteFresh && quoteMatches && quoteRegistered ? 'Fresh broker-confirmed quote matches the authenticated, reconciled account.' : 'REJECTED: a fresh broker-confirmed quote registered to this instrument is required.' },
      {
        name: 'B. Order parameters and current broker instrument constraints',
        passed: brokerInstrumentPassed && permissionPassed,
        details: [
          !brokerInstrumentPassed ? instrumentDetails : '',
          context.health !== 'HEALTHY' ? `REJECTED: execution health is ${context.health}; HEALTHY is required.` : '',
          !permissionPassed ? `Central order validation: ${context.permissionGate.message}` : '',
        ].filter(Boolean).join(' '),
      },
      { name: 'C. Deterministic risk-engine approval', passed: riskPassed, details: riskPassed ? context.riskApproval.message : `REJECTED: ${context.riskApproval.code}: ${context.riskApproval.message}` },
      {
        name: 'D. Independent account-wide risk assessment',
        passed: portfolioRiskPassed,
        details: portfolioRiskPassed
          ? `Account-wide open risk and exposure remain within policy (${portfolioRisk.grossLeverage?.toFixed(2)}x leverage).`
          : unmappedBrokerPositions
          ? `REJECTED: ${context.brokerTruth.positions.length} broker-confirmed position(s) lack a verified broker-constraint mapping into the independent account risk ledger.`
          : `REJECTED: ${portfolioRisk.status}: ${portfolioRisk.reasons.join(' ')}`,
      },
    ];
  }

  private fingerprint(context: OrderAuthorizationContext): string {
    return createHash('sha256').update(stableSnapshot(context)).digest('hex');
  }

  private removeExpiredApprovals(timestamp: number): void {
    for (const [approvalId, approval] of this.issuedApprovals) {
      if (timestamp > approval.expiresAt) this.issuedApprovals.delete(approvalId);
    }
  }

  private recordDecision(
    context: OrderAuthorizationContext,
    timestamp: number,
    decision: 'APPROVED' | 'REVALIDATED' | 'REJECTED',
    checks: OrderAuthorizationDecision['checks'],
    fingerprint: string,
    approvalId: string
  ): void {
    auditLogger.record({
      category: 'RISK_DECISION',
      level: decision === 'REJECTED' ? 'CRITICAL' : 'INFO',
      action: 'ORDER_AUTHORIZATION_EVALUATED',
      details: {
        timestamp,
        decision,
        approvalId,
        snapshotFingerprint: fingerprint,
        orderIntent: context.intent,
        account: {
          identityFingerprint: safeAccountFingerprint(context.brokerTruth),
          mode: context.brokerTruth.connection.accountMode,
          currency: context.brokerTruth.connection.currency,
          asOf: context.brokerTruth.accountSnapshot.asOf,
          provenance: context.brokerTruth.accountSnapshot.provenance,
          reconciliation: context.brokerTruth.reconciliationStatus,
        },
        positions: context.brokerTruth.positions,
        deals: context.brokerTruth.deals,
        pnlVerification: context.brokerTruth.pnlVerification,
        quote: context.brokerQuote
          ? {
              appSymbol: context.brokerQuote.appSymbol,
              brokerSymbol: context.brokerQuote.brokerSymbol,
              bid: context.brokerQuote.bid,
              ask: context.brokerQuote.ask,
              sourceTimestamp: context.brokerQuote.sourceTimestamp,
              receiptTimestamp: context.brokerQuote.receiptTimestamp,
              provenance: context.brokerQuote.provenance,
            }
          : null,
        brokerInstrument: context.brokerInstrument,
        localMarketQuote: context.quote
          ? {
              symbol: context.quote.symbol,
              bid: context.quote.bid,
              ask: context.quote.ask,
              lastPrice: context.quote.lastPrice,
              sourceTimestamp: context.quote.timestamp,
              quality: context.quote.quality,
              isLiveBrokerExecutable: context.quote.isLiveBrokerExecutable,
            }
          : null,
        localInstrument: context.instrument,
        portfolio: context.portfolio,
        localPositions: context.positions,
        localOrders: context.orders
          .filter((order) => order.id !== context.intent.orderId)
          .map((order) => ({
            id: order.id,
            clientOrderId: order.clientOrderId,
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            quantity: order.quantity,
            filledQuantity: order.filledQuantity,
            price: order.price,
            stopLoss: order.stopLoss,
            status: order.status,
            updatedAt: order.updatedAt,
          })),
        executionHealth: context.health,
        riskLimits: context.limits,
        permissionGate: {
          approved: context.permissionGate.approved,
          gateCode: context.permissionGate.gateCode,
          checks: context.permissionGate.checks,
        },
        deterministicRisk: {
          approved: context.riskApproval.approved,
          code: context.riskApproval.code,
          checks: context.riskApproval.checks,
          riskAmountUSD: context.riskApproval.riskAmountUSD,
        },
        checks,
        rejectionReason: decision === 'REJECTED' ? checks.filter((check) => !check.passed).map((check) => check.details).join(' ') : null,
        brokerResponse: { status: 'NOT_SUBMITTED', reason: 'No broker execution adapter is configured; no broker request was sent.' },
      },
      actor: 'RISK_ENGINE',
    });
  }
}

export const orderAuthorizationService = new OrderAuthorizationService();
