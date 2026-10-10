import {
  Order,
  Position,
  PortfolioSummary,
  SystemMode,
  HealthState,
  OrderStatus,
  OrderSide,
  OrderType,
  TradeSignal,
  Instrument,
  ClosedTradeRecord,
  CooldownState,
  BrokerTruthState,
} from '../../src/types/trading';
import { marketDataService } from '../data/market-data-service';
import { riskEngine } from '../risk/risk-engine';
import { auditLogger } from '../audit/audit-logger';
import { storageService, PersistedAppState, PersistedOrderIntent } from '../persistence/storage-service';
import { brokerTruthService } from '../broker/broker-truth-service';
import { centralPermissionGate } from '../risk/permission-gate';
import {
  OrderAuthorizationContext,
  orderAuthorizationService,
} from './order-authorization-service';

interface OrderSubmissionParams {
  clientOrderId?: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  strategyId: string;
  broker?: string;
}

interface OrderSubmissionResult {
  success: boolean;
  order?: Order;
  error?: string;
}

interface InFlightOrderSubmission {
  fingerprint: string;
  promise: Promise<OrderSubmissionResult>;
}

export function calculateDeterministicPaperFillPrice(
  referencePrice: number,
  side: OrderSide,
  tickSize: number,
  adverseSlippageRate: number
): number {
  if (
    !Number.isFinite(referencePrice) || referencePrice <= 0 ||
    !Number.isFinite(tickSize) || tickSize <= 0 ||
    !Number.isFinite(adverseSlippageRate) || adverseSlippageRate < 0
  ) {
    throw new Error('Cannot simulate a fill with invalid price, tick-size, or slippage assumptions.');
  }
  const direction = side === 'BUY' ? 1 : -1;
  const modeledPrice = referencePrice * (1 + adverseSlippageRate * direction);
  const [coefficient, exponentText] = tickSize.toString().split('e');
  const exponent = Number(exponentText || 0);
  const decimals = Math.max(0, (coefficient.split('.')[1] || '').length - exponent);
  return Number((Math.round(modeledPrice / tickSize) * tickSize).toFixed(decimals));
}

function isPriceAligned(price: number, tickSize: number): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) return false;
  const units = price / tickSize;
  return Number.isFinite(units) &&
    Math.abs(units - Math.round(units)) <= Number.EPSILON * Math.max(1, Math.abs(units)) * 8;
}

export function cancelNonTerminalPaperOrders(orders: Order[], updatedAt: number = Date.now()): number {
  let cancelledCount = 0;
  for (const order of orders) {
    if (['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED'].includes(order.status)) {
      order.status = 'CANCELLED';
      order.updatedAt = updatedAt;
      cancelledCount++;
    }
  }
  return cancelledCount;
}

export class ExecutionEngine {
  private readonly paperSlippageRate = 0.0002;
  // Prime Invariant: Default to PAPER on every startup, restart, and reconnect
  private mode: SystemMode = 'PAPER';
  private portfolio: PortfolioSummary = {
    mode: 'PAPER',
    totalEquity: 100000.0,
    cashBalance: 100000.0,
    availableMargin: 100000.0,
    usedMargin: 0.0,
    unrealizedPnL: 0.0,
    realizedPnLToday: 0.0,
    startOfDayEquity: 100000.0,
    dailyLossPct: 0.0,
    maxDrawdownPct: 0.0,
    currentDrawdownPct: 0.0,
    grossLeverage: 0.0,
    openRiskBudgetPct: 0.0,
    activePositionsCount: 0,
    activeOrdersCount: 0,
    consecutiveLosses: 0,
    isDailyLossHalted: false,
    isGlobalKillSwitched: false,
    rolloutStage: 'PAPER_ONLY',
    liveExecutionAuthorized: false,
    recoveryObjectives: {
      rtoSeconds: 300,
      rpoSeconds: 60,
      backupRestoreTested: false,
      restartRecoveryTested: false,
      notes: 'Operational recovery remains in staged validation; backup restore and broker reconcile workflows are not authorized for live traffic yet.',
    },
  };

  private orders: Map<string, Order> = new Map();
  private positions: Map<string, Position> = new Map();
  private idempotencyStore: Map<string, string> = new Map(); // clientOrderId -> orderId
  private pendingOrderIntents: Map<string, PersistedOrderIntent> = new Map();
  private inFlightSubmissions: Map<string, InFlightOrderSubmission> = new Map();
  private peakEquity: number = 100000.0;

  // Revenge-trading prevention: Consecutive closed losses tracking & audit records
  private closedTrades: ClosedTradeRecord[] = [];
  private consecutiveLossesByStrategy: Map<string, number> = new Map();
  private triggeringTradeIdsByStrategy: Map<string, string[]> = new Map();
  private accountConsecutiveLosses: number = 0;
  private accountTriggeringTradeIds: string[] = [];

  constructor() {
    this.restorePersistedStateOrInitialize();
    this.startOrderBookAndStopWatcher();
  }

  /**
   * Restore durable state from disk on startup/restart, or seed initial testbed positions
   */
  private restorePersistedStateOrInitialize(): void {
    const persisted = storageService.loadState();
    if (persisted) {
      this.portfolio.cashBalance = persisted.portfolio.cashBalance;
      this.portfolio.totalEquity = persisted.portfolio.totalEquity;
      this.portfolio.startOfDayEquity = persisted.portfolio.startOfDayEquity;
      this.portfolio.realizedPnLToday = persisted.portfolio.realizedPnLToday;
      this.peakEquity = persisted.portfolio.peakEquity || persisted.portfolio.totalEquity;

      // Restore positions and orders
      for (const pos of persisted.positions) {
        this.positions.set(pos.symbol, pos);
      }
      for (const ord of persisted.orders) {
        this.orders.set(ord.id, ord);
        if (ord.clientOrderId) {
          this.idempotencyStore.set(ord.clientOrderId, ord.id);
        }
      }
      for (const record of persisted.pendingOrderIntents || []) {
        this.pendingOrderIntents.set(record.clientOrderId, {
          ...record,
          status: 'UNCERTAIN',
        });
      }

      // Restore closed trades and consecutive loss counters
      if (Array.isArray(persisted.closedTrades)) {
        this.closedTrades = persisted.closedTrades;
      }
      if (persisted.consecutiveLossesByStrategy && typeof persisted.consecutiveLossesByStrategy === 'object') {
        this.consecutiveLossesByStrategy = new Map(Object.entries(persisted.consecutiveLossesByStrategy));
      }
      if (typeof persisted.accountConsecutiveLosses === 'number') {
        this.accountConsecutiveLosses = persisted.accountConsecutiveLosses;
      }
      riskEngine.restorePersistedSafetyState(persisted.riskSafetyState);
      riskEngine.restoreCooldowns(persisted.cooldowns);

      // Mandatory Invariant: Always restart in PAPER mode
      this.mode = 'PAPER';
      this.portfolio.mode = 'PAPER';

      auditLogger.record({
        category: 'RECONCILIATION',
        level: 'INFO',
        action: 'DURABLE_STATE_RESTORED_ON_STARTUP',
        details: {
          positionsRestored: this.positions.size,
          ordersRestored: this.orders.size,
          uncertainOrderIntentsRestored: this.pendingOrderIntents.size,
          closedTradesRestored: this.closedTrades.length,
          accountConsecutiveLosses: this.accountConsecutiveLosses,
          totalEquity: this.portfolio.totalEquity,
          mode: this.mode,
        },
        actor: 'OPERATOR',
      });

      this.reconcileState();
    } else if (storageService.getStorageHealth().exists) {
      riskEngine.restoreCooldowns(undefined);
      riskEngine.restorePersistedSafetyState(undefined);
      auditLogger.record({
        category: 'RECONCILIATION',
        level: 'CRITICAL',
        action: 'INVALID_DURABLE_STATE_STARTUP_HALTED',
        details: { reason: 'Persisted state exists but could not be validated; baseline positions were not seeded and entries remain blocked.' },
        actor: 'RISK_ENGINE',
      });
    } else {
      this.initializeBaselinePositions();
    }
  }

  public async persistCurrentState(): Promise<boolean> {
    return storageService.saveState({
      portfolio: {
        totalEquity: this.portfolio.totalEquity,
        cashBalance: this.portfolio.cashBalance,
        startOfDayEquity: this.portfolio.startOfDayEquity,
        realizedPnLToday: this.portfolio.realizedPnLToday,
        peakEquity: this.peakEquity,
      },
      positions: Array.from(this.positions.values()),
      orders: Array.from(this.orders.values()),
      pendingOrderIntents: Array.from(this.pendingOrderIntents.values()),
      closedTrades: this.closedTrades.slice(0, 200),
      consecutiveLossesByStrategy: Object.fromEntries(this.consecutiveLossesByStrategy),
      accountConsecutiveLosses: this.accountConsecutiveLosses,
      cooldowns: riskEngine.getCooldownsMap(),
      riskSafetyState: riskEngine.getPersistedSafetyState(),
      riskLimits: riskEngine.getLimits(),
      quarantinedStrategies: [],
      suspendedInstruments: riskEngine.getSuspendedInstruments(),
      isolatedBrokers: [],
      auditLogs: auditLogger.getRecentLogs(200),
      lastReconciliationAt: Date.now(),
    });
  }

  private initializeBaselinePositions() {
    // Seed 2 realistic initial simulated testbed positions
    const btcQuote = marketDataService.getQuote('BTC/USDT');
    const btcInst = marketDataService.getInstrument('BTC/USDT');
    if (btcQuote && btcInst) {
      const btcPos: Position = {
        id: 'pos_init_btc',
        symbol: 'BTC/USDT',
        assetClass: 'CRYPTO',
        side: 'BUY',
        quantity: 0.25,
        entryPrice: 66800.0,
        currentPrice: btcQuote.lastPrice,
        stopLossPrice: Number((btcQuote.bid * 0.98).toFixed(2)),
        takeProfitPrice: 71000.0,
        unrealizedPnL: Number(((btcQuote.lastPrice - 66800.0) * 0.25).toFixed(2)),
        unrealizedPnLPct: Number((((btcQuote.lastPrice - 66800.0) / 66800.0) * 100).toFixed(2)),
        realizedPnL: 0,
        marginUsed: 0.25 * btcQuote.lastPrice,
        openedAt: Date.now() - 3600000 * 5,
        strategyId: 'strat_trend',
        broker: 'SimulatedInstitutionalBroker',
      };
      this.positions.set(btcPos.symbol, btcPos);
    }

    const spyQuote = marketDataService.getQuote('SPY');
    const spyInst = marketDataService.getInstrument('SPY');
    if (spyQuote && spyInst) {
      const spyPos: Position = {
        id: 'pos_init_spy',
        symbol: 'SPY',
        assetClass: 'INDEX',
        side: 'BUY',
        quantity: 15,
        entryPrice: 582.10,
        currentPrice: spyQuote.lastPrice,
        stopLossPrice: Number((spyQuote.bid * 0.98).toFixed(2)),
        takeProfitPrice: 598.0,
        unrealizedPnL: Number(((spyQuote.lastPrice - 582.10) * 15).toFixed(2)),
        unrealizedPnLPct: Number((((spyQuote.lastPrice - 582.10) / 582.10) * 100).toFixed(2)),
        realizedPnL: 0,
        marginUsed: Number((15 * spyQuote.lastPrice * 0.25).toFixed(2)),
        openedAt: Date.now() - 3600000 * 8,
        strategyId: 'strat_momentum',
        broker: 'SimulatedInstitutionalBroker',
      };
      this.positions.set(spyPos.symbol, spyPos);
    }

    this.recalculatePortfolio();
    this.persistCurrentState();
  }

  public getMode(): SystemMode {
    return this.mode;
  }

  public setMode(newMode: SystemMode): { success: boolean; message: string } {
    if (newMode === 'LIVE') {
      this.portfolio.rolloutStage = 'PAPER_ONLY';
      this.portfolio.liveExecutionAuthorized = false;
      return {
        success: false,
        message: 'Live execution is technically disabled: No verified live broker gateway and explicit live-pilot approval are configured. System remains safely in PAPER mode.',
      };
    }
    this.mode = newMode;
    this.portfolio.mode = newMode;
    this.portfolio.rolloutStage = newMode === 'BACKTEST' ? 'DEMO_ONLY' : 'PAPER_ONLY';
    this.portfolio.liveExecutionAuthorized = false;
    auditLogger.record({
      category: 'ORDER_STATE',
      level: 'WARNING',
      action: 'SYSTEM_MODE_SWITCHED',
      details: { newMode, rolloutStage: this.portfolio.rolloutStage, liveExecutionAuthorized: this.portfolio.liveExecutionAuthorized },
      actor: 'OPERATOR',
    });
    this.persistCurrentState();
    return { success: true, message: `System operating mode switched to ${newMode}` };
  }

  public getControlledRolloutState(): {
    stage: 'PAPER_ONLY' | 'SHADOW_MODE' | 'DEMO_ONLY' | 'LIVE_PILOT' | 'LIVE';
    liveExecutionAuthorized: boolean;
    requireOperatorApproval: boolean;
    recoveryObjectives: { rtoSeconds: number; rpoSeconds: number; backupRestoreTested: boolean; restartRecoveryTested: boolean; notes: string };
    lastAuthorizedAt: number | null;
    lastReviewAt: number | null;
  } {
    return {
      stage: this.portfolio.rolloutStage || 'PAPER_ONLY',
      liveExecutionAuthorized: !!this.portfolio.liveExecutionAuthorized,
      requireOperatorApproval: true,
      recoveryObjectives: this.portfolio.recoveryObjectives || {
        rtoSeconds: 300,
        rpoSeconds: 60,
        backupRestoreTested: false,
        restartRecoveryTested: false,
        notes: 'Recovery and restore objectives are intentionally conservative until broker data integration and backup validation are complete.',
      },
      lastAuthorizedAt: null,
      lastReviewAt: null,
    };
  }

  public getPortfolio(): PortfolioSummary {
    this.recalculatePortfolio();
    return { ...this.portfolio };
  }

  public getPositions(): Position[] {
    this.recalculatePortfolio();
    return Array.from(this.positions.values());
  }

  public getOrders(limit: number = 100): Order[] {
    return Array.from(this.orders.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * Idempotent Order Submission following the Complete Order State Machine:
   * CREATED → VALIDATED → SUBMITTED → ACKNOWLEDGED → FILLED / REJECTED
   */
  private getOrderIntentFingerprint(params: OrderSubmissionParams, broker: string): string {
    return JSON.stringify({
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
      strategyId: params.strategyId,
      broker,
    });
  }

  private orderMatchesIntent(order: Order, params: OrderSubmissionParams, broker: string): boolean {
    return order.symbol === params.symbol &&
      order.side === params.side &&
      order.type === params.type &&
      order.quantity === params.quantity &&
      order.price === params.price &&
      order.stopLoss === params.stopLoss &&
      order.takeProfit === params.takeProfit &&
      order.strategyId === params.strategyId &&
      order.broker === broker;
  }

  private recordIdempotencyConflict(clientOrderId: string, reason: string): void {
    auditLogger.record({
      category: 'RISK_DECISION',
      level: 'WARNING',
      action: 'IDEMPOTENCY_KEY_REUSE_REJECTED',
      details: { clientOrderId, reason },
      actor: 'RISK_ENGINE',
    });
  }

  public async submitOrder(
    params: OrderSubmissionParams,
    systemHealthState: HealthState | (() => HealthState)
  ): Promise<OrderSubmissionResult> {
    const clientOrderId = params.clientOrderId || `coid_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const broker = params.broker || 'SimulatedInstitutionalBroker';
    const fingerprint = this.getOrderIntentFingerprint(params, broker);

    const inFlight = this.inFlightSubmissions.get(clientOrderId);
    if (inFlight) {
      if (inFlight.fingerprint !== fingerprint) {
        const reason = 'The idempotency key is already being used for a different order intent.';
        this.recordIdempotencyConflict(clientOrderId, reason);
        return {
          success: false,
          error: `Idempotency key ${clientOrderId} is already being used for a different order intent.`,
        };
      }
      return inFlight.promise;
    }

    // 1. Idempotency Check: return the existing outcome without masking uncertainty or rejection
    const pendingIntent = this.pendingOrderIntents.get(clientOrderId);
    if (pendingIntent?.status === 'UNCERTAIN') {
      return {
        success: false,
        error: `Order outcome for ${clientOrderId} is UNCERTAIN; reconcile authoritative records before retrying.`,
      };
    }
    if (this.idempotencyStore.has(clientOrderId)) {
      const existingOrderId = this.idempotencyStore.get(clientOrderId)!;
      const existingOrder = this.orders.get(existingOrderId);
      if (existingOrder) {
        if (!this.orderMatchesIntent(existingOrder, params, broker)) {
          const reason = 'The idempotency key was already used for a different order intent.';
          this.recordIdempotencyConflict(clientOrderId, reason);
          return {
            success: false,
            order: existingOrder,
            error: `Idempotency key ${clientOrderId} was already used for a different order intent.`,
          };
        }
        const isFilled = existingOrder.status === 'FILLED';
        return {
          success: isFilled,
          order: existingOrder,
          ...(!isFilled
            ? { error: existingOrder.rejectReason || `Order outcome is not confirmed as filled; current state is ${existingOrder.status}.` }
            : {}),
        };
      }
    }

    const getSystemHealthState = typeof systemHealthState === 'function'
      ? systemHealthState
      : () => systemHealthState;
    const submission = this.submitOrderOnce(params, clientOrderId, broker, getSystemHealthState);
    this.inFlightSubmissions.set(clientOrderId, { fingerprint, promise: submission });
    try {
      return await submission;
    } finally {
      if (this.inFlightSubmissions.get(clientOrderId)?.promise === submission) {
        this.inFlightSubmissions.delete(clientOrderId);
      }
    }
  }

  private async submitOrderOnce(
    params: OrderSubmissionParams,
    clientOrderId: string,
    broker: string,
    getSystemHealthState: () => HealthState
  ): Promise<OrderSubmissionResult> {
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.idempotencyStore.set(clientOrderId, orderId);

    // Initial state: CREATED
    const order: Order = {
      id: orderId,
      clientOrderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
      status: 'CREATED',
      filledQuantity: 0,
      feePaid: 0,
      estimatedSlippage: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      strategyId: params.strategyId,
      broker,
    };
    this.orders.set(orderId, order);

    // Hard Technical Lock: Prevent live order routing when unconfigured
    if (this.mode === 'LIVE' || broker !== 'SimulatedInstitutionalBroker') {
      order.status = 'REJECTED';
      order.rejectReason = 'Live order routing is strictly disabled: No verified live broker connection is configured in this deployment.';
      order.updatedAt = Date.now();
      auditLogger.record({
        category: 'ORDER_STATE',
        level: 'CRITICAL',
        action: 'LIVE_EXECUTION_ATTEMPT_BLOCKED',
        details: { orderId, broker, mode: this.mode },
        actor: 'RISK_ENGINE',
      });
      this.persistCurrentState();
      return { success: false, order, error: order.rejectReason };
    }

    let authorizationContext: OrderAuthorizationContext;
    let authorization;
    try {
      authorizationContext = this.buildOrderAuthorizationContext(params, order, broker, clientOrderId, getSystemHealthState());
      authorization = orderAuthorizationService.authorize(authorizationContext);
    } catch (error) {
      const reason = `Authorization service failed closed (${error instanceof Error ? error.name : 'UnknownError'}).`;
      orderAuthorizationService.recordServiceFailure(
        { ...params, broker, clientOrderId },
        reason
      );
      order.status = 'REJECTED';
      order.rejectReason = reason;
      order.updatedAt = Date.now();
      const auditPersisted = await this.persistCurrentState();
      const failureMessage = auditPersisted
        ? reason
        : `${reason} Authorization rejection could not be durably persisted.`;
      return { success: false, order, error: failureMessage };
    }

    if (!authorization.approved || !authorization.approval) {
      order.status = 'REJECTED';
      order.rejectReason = authorization.message;
      order.updatedAt = Date.now();
      const auditPersisted = await this.persistCurrentState();
      const failureMessage = auditPersisted
        ? authorization.message
        : `${authorization.message} Authorization rejection could not be durably persisted.`;
      return { success: false, order, error: failureMessage };
    }

    // State is checked a second time after durable intent persistence and immediately before routing.
    order.status = 'VALIDATED';
    order.updatedAt = Date.now();

    // Persist intent before a simulated submission can proceed. A restart from this
    // point must preserve ambiguity and prevent an unsafe retry.
    this.registerOrderIntent(clientOrderId, params);
    const intentPersisted = await this.persistCurrentState();
    if (!intentPersisted) {
      order.status = 'REJECTED';
      order.rejectReason = 'Order blocked: unable to durably persist its idempotency intent before submission.';
      order.updatedAt = Date.now();
      await this.markOrderIntentUncertain(clientOrderId);
      await this.persistCurrentState();
      return { success: false, order, error: order.rejectReason };
    }

    let finalAuthorizationContext: OrderAuthorizationContext;
    try {
      finalAuthorizationContext = this.buildOrderAuthorizationContext(
        params,
        order,
        broker,
        clientOrderId,
        getSystemHealthState()
      );
      const finalAuthorization = orderAuthorizationService.revalidate(
        authorization.approval,
        finalAuthorizationContext
      );
      if (!finalAuthorization.approved) {
        order.status = 'REJECTED';
        order.rejectReason = finalAuthorization.message;
        order.updatedAt = Date.now();
        this.pendingOrderIntents.delete(clientOrderId);
        const rejectionPersisted = await this.persistCurrentState();
        if (!rejectionPersisted) {
          this.registerOrderIntent(clientOrderId, params);
          await this.markOrderIntentUncertain(clientOrderId);
        }
        return { success: false, order, error: finalAuthorization.message };
      }
    } catch (error) {
      const reason = `Authorization revalidation failed closed (${error instanceof Error ? error.name : 'UnknownError'}).`;
      orderAuthorizationService.recordServiceFailure(
        { ...params, broker, clientOrderId },
        reason
      );
      order.status = 'REJECTED';
      order.rejectReason = reason;
      order.updatedAt = Date.now();
      this.pendingOrderIntents.delete(clientOrderId);
      const rejectionPersisted = await this.persistCurrentState();
      if (!rejectionPersisted) {
        this.registerOrderIntent(clientOrderId, params);
        await this.markOrderIntentUncertain(clientOrderId);
        auditLogger.record({
          category: 'ORDER_STATE',
          level: 'CRITICAL',
          action: 'REJECTED_ORDER_CLEANUP_PERSISTENCE_FAILED',
          details: { orderId, clientOrderId },
          actor: 'PAPER_EXECUTION',
        });
      }
      return { success: false, order, error: reason };
    }

    const quote = finalAuthorizationContext.quote || undefined;
    const instrument = finalAuthorizationContext.instrument || undefined;
    const submissionTimestamp = Date.now();
    const isMarket = params.type === 'MARKET' || params.price === undefined;
    const referencePrice = quote && instrument
      ? (isMarket ? (params.side === 'BUY' ? quote.ask : quote.bid) : params.price!)
      : 0;

    // 3. State transition: SUBMITTED to the isolated paper simulator
    order.status = 'SUBMITTED';
    order.updatedAt = submissionTimestamp;

    // 4. Paper acknowledgement is simulated, not broker-confirmed.
    const acknowledgementTimestamp = Date.now();
    order.status = 'ACKNOWLEDGED';
    order.updatedAt = acknowledgementTimestamp;
    if (quote) {
      order.executionTelemetry = {
        provenance: 'PAPER_SIMULATION',
        quoteProvider: quote.provider,
        quoteQuality: quote.quality,
        quoteTimestamp: quote.timestamp,
        submissionTimestamp,
        acknowledgementTimestamp,
        referencePrice,
        slippageModel: `Deterministic adverse ${this.paperSlippageRate * 100}% of reference price, rounded to configured local tick size; simulation only.`,
      };
    }

    // 5. Execution Fill Simulation (with half-spread, slippage friction, and broker fees)
    if (quote && instrument) {
      const fillPrice = calculateDeterministicPaperFillPrice(
        referencePrice,
        params.side,
        instrument.tickSize,
        this.paperSlippageRate
      );
      const slippageUSD = Math.abs(fillPrice - referencePrice) * params.quantity;

      // Commission calculation
      let feeUSD = 0;
      if (instrument.commissionType === 'FIXED_PER_UNIT') {
        feeUSD = params.quantity * instrument.commissionPerUnit;
      } else {
        feeUSD = params.quantity * fillPrice * instrument.commissionPerUnit;
      }
      feeUSD = Number(Math.max(1.0, feeUSD).toFixed(2)); // $1 minimum commission

      order.status = 'FILLED';
      order.filledQuantity = params.quantity;
      order.avgFillPrice = fillPrice;
      order.feePaid = feeUSD;
      order.estimatedSlippage = Number(slippageUSD.toFixed(2));
      const fillTimestamp = Date.now();
      order.updatedAt = fillTimestamp;
      if (order.executionTelemetry) {
        order.executionTelemetry.fillTimestamp = fillTimestamp;
        order.executionTelemetry.simulatedProcessingDurationMs = Math.max(0, fillTimestamp - submissionTimestamp);
      }

      // Update positions
      this.applyFillToPositions(order, fillPrice, feeUSD, instrument);

      auditLogger.record({
        category: 'ORDER_STATE',
        level: 'INFO',
        action: 'ORDER_FILLED',
        details: {
          orderId,
          symbol: order.symbol,
          side: order.side,
          fillPrice,
          quantity: order.filledQuantity,
          feeUSD,
          slippageUSD,
        },
        actor: 'PAPER_EXECUTION',
      });
    }

    this.recalculatePortfolio();
    this.pendingOrderIntents.delete(clientOrderId);
    const finalStatePersisted = await this.persistCurrentState();
    if (!finalStatePersisted) {
      this.registerOrderIntent(clientOrderId, params);
      await this.markOrderIntentUncertain(clientOrderId);
      auditLogger.record({
        category: 'ORDER_STATE',
        level: 'CRITICAL',
        action: 'PAPER_ORDER_RESULT_PERSISTENCE_FAILED',
        details: { orderId, clientOrderId, status: order.status },
        actor: 'PAPER_EXECUTION',
      });
      return {
        success: false,
        order,
        error: 'Paper order outcome is present in memory but could not be durably saved. It is marked uncertain and further entries are blocked.',
      };
    }
    return { success: true, order };
  }

  private buildOrderAuthorizationContext(
    params: OrderSubmissionParams,
    order: Order,
    broker: string,
    clientOrderId: string,
    systemHealthState: HealthState
  ): OrderAuthorizationContext {
    const quote = marketDataService.getQuote(params.symbol) || null;
    const instrument = marketDataService.getInstrument(params.symbol) || null;
    const portfolio = this.getPortfolio();
    const positions = this.getPositions();
    const orders = this.getOrders(Number.MAX_SAFE_INTEGER);
    const limits = riskEngine.getLimits();
    const intent = {
      orderId: order.id,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price ?? quote?.lastPrice,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
      strategyId: params.strategyId,
      broker,
      clientOrderId,
    };
    const permissionGate = centralPermissionGate.evaluateGate(
      intent,
      quote,
      instrument,
      portfolio,
      positions,
      orders,
      limits,
      systemHealthState,
      (target) => riskEngine.isCooldownActive(target),
      (strategyId) => riskEngine.isStrategySuspended(strategyId),
      (brokerName) => riskEngine.isBrokerSuspended(brokerName),
      () => riskEngine.isGlobalKillSwitched(),
      (currentPortfolio) => riskEngine.checkDailyLossBreach(currentPortfolio),
      (currentPortfolio) => riskEngine.checkDrawdownBreach(currentPortfolio),
      this.hasUncertainOrderIntents(),
      (symbol) => riskEngine.isInstrumentSuspended(symbol)
    );
    const riskApproval = riskEngine.evaluatePreTradeRisk(
      {
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        price: params.price ?? (quote ? (params.side === 'BUY' ? quote.ask : quote.bid) : undefined),
        stopLoss: params.stopLoss,
        strategyId: params.strategyId,
        broker,
      },
      quote || undefined,
      instrument || undefined,
      portfolio,
      positions,
      systemHealthState
    );
    return {
      intent,
      brokerTruth: brokerTruthService.getBrokerTruthState(),
      brokerQuote: brokerTruthService.getQuoteWithProvenance(params.symbol),
      brokerInstrument: brokerTruthService.getInstrumentConstraints(params.symbol),
      quote,
      instrument,
      portfolio,
      positions,
      orders,
      limits,
      health: systemHealthState,
      permissionGate,
      riskApproval,
    };
  }

  private applyFillToPositions(order: Order, fillPrice: number, feePaid: number, instrument: Instrument) {
    this.portfolio.cashBalance -= feePaid;
    this.portfolio.realizedPnLToday -= feePaid;

    const existingPos = this.positions.get(order.symbol);

    if (!existingPos) {
      // Create new position
      const marginReq = fillPrice * order.filledQuantity * instrument.marginRequirement;
      const initialStop = order.stopLoss || fillPrice * 0.98;
      const newPos: Position = {
        id: `pos_${Date.now()}_${order.symbol}`,
        symbol: order.symbol,
        assetClass: instrument.assetClass,
        side: order.side,
        quantity: order.filledQuantity,
        entryPrice: fillPrice,
        currentPrice: fillPrice,
        stopLossPrice: initialStop,
        initialStopPrice: initialStop,
        lastConfirmedStopPrice: null,
        brokerConfirmedStopPrice: null,
        pendingStopPrice: null,
        stopModificationPending: false,
        stopRule: 'ATR-based ratchet: risk-reducing only; break-even after 1.5R with cost buffer; no stop widening.',
        takeProfitPrice: order.takeProfit,
        unrealizedPnL: 0,
        unrealizedPnLPct: 0,
        realizedPnL: 0,
        marginUsed: Number(marginReq.toFixed(2)),
        openedAt: Date.now(),
        strategyId: order.strategyId,
        broker: order.broker,
      };
      this.positions.set(order.symbol, newPos);
    } else {
      if (existingPos.side === order.side) {
        // Adding to position (weighted average price)
        const totalQty = existingPos.quantity + order.filledQuantity;
        const totalCost = existingPos.quantity * existingPos.entryPrice + order.filledQuantity * fillPrice;
        existingPos.entryPrice = Number((totalCost / totalQty).toFixed(instrument.tickSize < 0.001 ? 5 : 2));
        existingPos.quantity = totalQty;
        existingPos.marginUsed = Number((totalQty * fillPrice * instrument.marginRequirement).toFixed(2));
      } else {
        // Reducing or closing position
        if (order.filledQuantity >= existingPos.quantity) {
          // Closed completely
          const grossPnl = (fillPrice - existingPos.entryPrice) * existingPos.quantity * (existingPos.side === 'BUY' ? 1 : -1);
          this.portfolio.cashBalance += grossPnl;
          this.portfolio.realizedPnLToday += grossPnl;
          this.recordClosedTrade({
            orderId: order.id,
            symbol: order.symbol,
            strategyId: existingPos.strategyId || order.strategyId,
            side: existingPos.side,
            quantity: existingPos.quantity,
            entryPrice: existingPos.entryPrice,
            exitPrice: fillPrice,
            grossPnL: grossPnl,
            feePaid,
            exitReason: `Opposite order execution (${order.type})`,
            isPartial: false,
          });
          this.positions.delete(order.symbol);
        } else {
          // Partially reduced
          const grossPnl = (fillPrice - existingPos.entryPrice) * order.filledQuantity * (existingPos.side === 'BUY' ? 1 : -1);
          existingPos.quantity -= order.filledQuantity;
          this.portfolio.cashBalance += grossPnl;
          this.portfolio.realizedPnLToday += grossPnl;
          this.recordClosedTrade({
            orderId: order.id,
            symbol: order.symbol,
            strategyId: existingPos.strategyId || order.strategyId,
            side: existingPos.side,
            quantity: order.filledQuantity,
            entryPrice: existingPos.entryPrice,
            exitPrice: fillPrice,
            grossPnL: grossPnl,
            feePaid,
            exitReason: `Partial position reduction (${order.type})`,
            isPartial: true,
          });
        }
      }
    }
  }

  public recordClosedTrade(params: {
    orderId?: string;
    symbol: string;
    strategyId: string;
    side: OrderSide;
    quantity: number;
    entryPrice: number;
    exitPrice: number;
    grossPnL: number;
    feePaid: number;
    exitReason: string;
    isPartial: boolean;
  }): ClosedTradeRecord {
    const netPnL = Number((params.grossPnL - params.feePaid).toFixed(2));
    let result: 'LOSS' | 'WIN' | 'BREAKEVEN';
    if (netPnL < -0.001) {
      result = 'LOSS';
    } else if (netPnL > 0.001) {
      result = 'WIN';
    } else {
      result = 'BREAKEVEN';
    }

    const tradeRecord: ClosedTradeRecord = {
      id: `trd_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      orderId: params.orderId,
      symbol: params.symbol,
      strategyId: params.strategyId,
      side: params.side,
      quantity: params.quantity,
      entryPrice: params.entryPrice,
      exitPrice: params.exitPrice,
      grossPnL: Number(params.grossPnL.toFixed(2)),
      feePaid: Number(params.feePaid.toFixed(2)),
      netPnL,
      closedAt: Date.now(),
      exitReason: params.exitReason,
      isPartial: params.isPartial,
      result,
    };

    this.closedTrades.unshift(tradeRecord);
    if (this.closedTrades.length > 500) {
      this.closedTrades = this.closedTrades.slice(0, 500);
    }

    // Consecutive Losses State Machine & Revenge-Trading Invariant Enforcement:
    if (result === 'LOSS') {
      // 1. Increment Strategy Consecutive Losses
      const stratPrev = this.consecutiveLossesByStrategy.get(params.strategyId) || 0;
      const stratNew = stratPrev + 1;
      this.consecutiveLossesByStrategy.set(params.strategyId, stratNew);

      const stratIds = this.triggeringTradeIdsByStrategy.get(params.strategyId) || [];
      stratIds.push(tradeRecord.id);
      this.triggeringTradeIdsByStrategy.set(params.strategyId, stratIds);

      // 2. Increment Account Consecutive Losses
      this.accountConsecutiveLosses += 1;
      this.accountTriggeringTradeIds.push(tradeRecord.id);

      // 3. Trigger 30-minute cooldown if strategy hits 5 consecutive losses
      if (stratNew >= 5) {
        const triggering5 = stratIds.slice(-5);
        riskEngine.triggerCooldown(
          params.strategyId,
          triggering5,
          5,
          `Strategy ${params.strategyId} reached 5 consecutive closed losses. Entries paused and auto-execution disabled for 30 minutes.`
        );
        // Reset counter after cooldown triggered
        this.consecutiveLossesByStrategy.set(params.strategyId, 0);
        this.triggeringTradeIdsByStrategy.set(params.strategyId, []);
      }

      // 4. Trigger 30-minute cooldown if account hits 5 consecutive losses
      if (this.accountConsecutiveLosses >= 5) {
        const triggering5 = this.accountTriggeringTradeIds.slice(-5);
        riskEngine.triggerCooldown(
          'ACCOUNT',
          triggering5,
          5,
          `Account reached 5 consecutive closed losses across strategies. New entries paused for 30 minutes to prevent revenge trading.`
        );
        this.accountConsecutiveLosses = 0;
        this.accountTriggeringTradeIds = [];
      }
    } else if (result === 'BREAKEVEN') {
      // Breakeven trade does not count as a loss and does not count as a win
      // It leaves the consecutive loss counters unchanged.
    } else if (result === 'WIN') {
      // "Reset the counter only according to the documented policy; a win must not be used to bypass an active cooldown."
      if (!riskEngine.isCooldownActive(params.strategyId)) {
        this.consecutiveLossesByStrategy.set(params.strategyId, 0);
        this.triggeringTradeIdsByStrategy.set(params.strategyId, []);
      }
      if (!riskEngine.isCooldownActive('ACCOUNT')) {
        this.accountConsecutiveLosses = 0;
        this.accountTriggeringTradeIds = [];
      }
    }

    return tradeRecord;
  }

  public getClosedTrades(limit: number = 100): ClosedTradeRecord[] {
    return this.closedTrades.slice(0, limit);
  }

  public getConsecutiveLossesByStrategy(): Record<string, number> {
    return Object.fromEntries(this.consecutiveLossesByStrategy);
  }

  public getAccountConsecutiveLosses(): number {
    return this.accountConsecutiveLosses;
  }

  public async closePosition(symbol: string, reason: string = 'Manual Close'): Promise<{ success: boolean; message: string }> {
    const pos = this.positions.get(symbol);
    if (!pos) {
      return { success: false, message: `No open position for ${symbol}` };
    }

    const quote = marketDataService.getQuote(symbol);
    const instrument = marketDataService.getInstrument(symbol);
    const now = Date.now();
    if (!quote || !instrument || quote.symbol !== symbol || quote.isStale ||
      !Number.isFinite(quote.timestamp) || quote.timestamp > now ||
      now - quote.timestamp > riskEngine.getLimits().maxQuoteAgeMs ||
      !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) ||
      quote.bid <= 0 || quote.ask < quote.bid) {
      return { success: false, message: `Cannot safely close ${symbol}: a fresh, valid local paper quote and instrument definition are required.` };
    }
    const exitPrice = pos.side === 'BUY' ? quote.bid : quote.ask;
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      return { success: false, message: `Cannot safely close ${symbol}: executable-side quote is invalid.` };
    }

    // Calculate realized P&L
    const pnl = (exitPrice - pos.entryPrice) * pos.quantity * (pos.side === 'BUY' ? 1 : -1);
    const fee = instrument.commissionType === 'PERCENTAGE'
      ? pos.quantity * exitPrice * instrument.commissionPerUnit
      : pos.quantity * instrument.commissionPerUnit;

    const netPnL = pnl - fee;
    this.portfolio.cashBalance += netPnL;
    this.portfolio.realizedPnLToday += netPnL;

    this.recordClosedTrade({
      symbol,
      strategyId: pos.strategyId,
      side: pos.side,
      quantity: pos.quantity,
      entryPrice: pos.entryPrice,
      exitPrice,
      grossPnL: pnl,
      feePaid: fee,
      exitReason: reason,
      isPartial: false,
    });

    this.positions.delete(symbol);

    auditLogger.record({
      category: 'ORDER_STATE',
      level: 'INFO',
      action: 'POSITION_CLOSED',
      details: { symbol, exitPrice, netPnL, reason },
      actor: 'OPERATOR',
    });

    this.recalculatePortfolio();
    if (!await this.persistCurrentState()) {
      riskEngine.setGlobalKillSwitch(true, 'Position close could not be durably persisted');
      await this.persistCurrentState();
      return { success: false, message: `Position ${symbol} was closed in the local paper ledger, but persistence failed; emergency halt engaged and entries must remain blocked.` };
    }
    return { success: true, message: `Position ${symbol} closed at $${exitPrice} (Net P&L: $${netPnL.toFixed(2)})` };
  }

  public async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) return false;
    if (['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED'].includes(order.status)) {
      order.status = 'CANCELLED';
      order.updatedAt = Date.now();
      auditLogger.record({
        category: 'ORDER_STATE',
        level: 'INFO',
        action: 'ORDER_CANCELLED',
        details: { orderId, symbol: order.symbol },
        actor: 'OPERATOR',
      });
      if (await this.persistCurrentState()) return true;
      riskEngine.setGlobalKillSwitch(true, 'Order cancellation could not be durably persisted');
      await this.persistCurrentState();
      return false;
    }
    return false;
  }

  public async cancelAllOpenOrders(reason: string = 'Emergency Halt'): Promise<number> {
    const cancelledCount = cancelNonTerminalPaperOrders(Array.from(this.orders.values()));
    auditLogger.record({
      category: 'KILL_SWITCH',
      level: 'CRITICAL',
      action: 'EMERGENCY_CANCEL_ALL_ORDERS',
      details: { cancelledCount, reason },
      actor: 'OPERATOR',
    });
    if (!await this.persistCurrentState()) {
      riskEngine.setGlobalKillSwitch(true, 'Bulk order cancellation could not be durably persisted');
      await this.persistCurrentState();
    }
    return cancelledCount;
  }

  // Pending order intents for idempotency and uncertainty reconciliation
  public hasUncertainOrderIntents(): boolean {
    return Array.from(this.pendingOrderIntents.values()).some((record) => record.status === 'UNCERTAIN');
  }

  public registerOrderIntent(clientOrderId: string, intent: unknown): void {
    this.pendingOrderIntents.set(clientOrderId, {
      clientOrderId,
      intent,
      status: 'PENDING_ACK',
      timestamp: Date.now(),
    });
  }

  public async markOrderIntentUncertain(clientOrderId: string): Promise<void> {
    const record = this.pendingOrderIntents.get(clientOrderId);
    if (record) {
      record.status = 'UNCERTAIN';
      auditLogger.record({
        category: 'ORDER_STATE',
        level: 'CRITICAL',
        action: 'ORDER_INTENT_UNCERTAIN_OUTCOME',
        details: { clientOrderId, intent: record.intent },
        actor: 'OPERATOR',
      });
      await this.persistCurrentState();
    }
  }

  public recoverUncertainOrderIntents(): { recoveredCount: number; details: string[] } {
    const recoveredCount = 0;
    const details: string[] = [];

    for (const [coid, record] of this.pendingOrderIntents.entries()) {
      if (record.status === 'UNCERTAIN') {
        details.push(`Order ${coid} remains UNCERTAIN: broker records are unavailable; do not resubmit.`);
      }
    }
    return { recoveredCount, details };
  }

  public async modifyPositionStopLoss(symbol: string, newStopPrice: number): Promise<{ success: boolean; message: string; appliedStop?: number }> {
    const pos = this.positions.get(symbol);
    if (!pos) {
      return { success: false, message: `No active position for ${symbol}` };
    }
    const quote = marketDataService.getQuote(symbol);
    const instrument = marketDataService.getInstrument(symbol);
    const now = Date.now();
    const currentPrice = quote && pos.side === 'BUY' ? quote.bid : quote?.ask;
    if (!quote || !instrument || quote.isStale || !Number.isFinite(quote.timestamp) ||
      quote.timestamp > now || now - quote.timestamp > riskEngine.getLimits().maxQuoteAgeMs ||
      !Number.isFinite(currentPrice) || !Number.isFinite(newStopPrice) ||
      !isPriceAligned(newStopPrice, instrument.tickSize)) {
      return { success: false, message: `Cannot modify ${symbol} stop: a fresh quote, known tick size, and tick-aligned stop are required.` };
    }
    const result = brokerTruthService.evaluateStopModification({
      symbol,
      side: pos.side,
      currentStopLoss: pos.stopLossPrice,
      newStopLoss: newStopPrice,
      entryPrice: pos.entryPrice,
      currentPrice: currentPrice!,
    });
    if (!result.approved) {
      return { success: false, message: result.message };
    }

    const previousConfirmedStop = pos.lastConfirmedStopPrice ?? pos.brokerConfirmedStopPrice ?? pos.initialStopPrice ?? pos.stopLossPrice;
    pos.stopLossPrice = result.appliedStop;
    pos.brokerConfirmedStopPrice = result.confirmedStop ?? null;
    pos.lastConfirmedStopPrice = result.lastConfirmedStop ?? previousConfirmedStop;
    pos.pendingStopPrice = result.pendingStop ?? null;
    pos.stopModificationPending = !!result.pendingStop && result.confirmedStop === null;
    if (!await this.persistCurrentState()) {
      riskEngine.setGlobalKillSwitch(true, 'Stop modification could not be durably persisted');
      await this.persistCurrentState();
      return { success: false, message: 'Stop modification was applied in the local paper ledger, but persistence failed; emergency halt engaged.' };
    }
    return { success: true, message: result.message, appliedStop: result.appliedStop };
  }

  public getBrokerTruthState(): BrokerTruthState {
    return brokerTruthService.getBrokerTruthState();
  }

  public reconcileState(): {
    reconciled: boolean;
    ordersCount: number;
    positionsCount: number;
    discrepancies: number;
    details?: string;
  } {
    // 1. Keep ambiguous submissions blocked until an authoritative outcome is available
    const intentRecovery = this.recoverUncertainOrderIntents();

    // 2. Audit positions against broker quotes
    let discrepancies = 0;
    for (const [symbol, pos] of this.positions.entries()) {
      const quote = marketDataService.getQuote(symbol);
      if (!quote) {
        discrepancies++;
      } else {
        pos.currentPrice = quote.lastPrice;
      }
    }

    // 3. Broker reconciliation is only meaningful for LIVE; this deployment has no live adapter.
    const brokerState = brokerTruthService.getBrokerTruthState();
    if (this.mode === 'LIVE' && brokerState.reconciliationStatus.status !== 'RECONCILED') {
      discrepancies++;
    }
    if (this.hasUncertainOrderIntents()) discrepancies++;

    this.recalculatePortfolio();
    this.persistCurrentState();

    auditLogger.record({
      category: 'RECONCILIATION',
      level: discrepancies === 0 ? 'INFO' : 'WARNING',
      action: 'RECONCILIATION_COMPLETED',
      details: {
        positionsCount: this.positions.size,
        ordersCount: this.orders.size,
        discrepancies,
        recoveredIntents: intentRecovery.recoveredCount,
        brokerSync: brokerState.reconciliationStatus.status,
        timestamp: new Date().toISOString(),
      },
      actor: 'OPERATOR',
    });

    return {
      reconciled: discrepancies === 0,
      ordersCount: this.orders.size,
      positionsCount: this.positions.size,
      discrepancies,
      details: discrepancies === 0
        ? 'Local PAPER positions and orders reconciled against simulated market data; broker reconciliation is unavailable.'
        : `${discrepancies} unresolved reconciliation or order-intent issue(s); broker records are unavailable.`,
    };
  }

  private startOrderBookAndStopWatcher() {
    // Monitor positions every 2 seconds for stop losses and take profits
    setInterval(() => {
      for (const pos of this.positions.values()) {
        const quote = marketDataService.getQuote(pos.symbol);
        if (!quote) continue;

        pos.currentPrice = quote.lastPrice;
        const pnl = (pos.currentPrice - pos.entryPrice) * pos.quantity * (pos.side === 'BUY' ? 1 : -1);
        pos.unrealizedPnL = Number(pnl.toFixed(2));
        pos.unrealizedPnLPct = Number((((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'BUY' ? 1 : -1)).toFixed(2));

        // Check stop loss trigger
        let triggerExit = false;
        let exitReason: 'STOP_LOSS' | 'TAKE_PROFIT' = 'STOP_LOSS';

        if (pos.side === 'BUY') {
          if (pos.currentPrice <= pos.stopLossPrice) {
            triggerExit = true;
            exitReason = 'STOP_LOSS';
          } else if (pos.takeProfitPrice && pos.currentPrice >= pos.takeProfitPrice) {
            triggerExit = true;
            exitReason = 'TAKE_PROFIT';
          }
        } else {
          if (pos.currentPrice >= pos.stopLossPrice) {
            triggerExit = true;
            exitReason = 'STOP_LOSS';
          } else if (pos.takeProfitPrice && pos.currentPrice <= pos.takeProfitPrice) {
            triggerExit = true;
            exitReason = 'TAKE_PROFIT';
          }
        }

        if (triggerExit) {
          void this.closePosition(pos.symbol, `Protective ${exitReason} Triggered at $${pos.currentPrice}`)
            .then((result) => {
              if (!result.success) {
                auditLogger.record({
                  category: 'RISK_DECISION',
                  level: 'CRITICAL',
                  action: 'PAPER_PROTECTIVE_CLOSE_FAILED',
                  details: { symbol: pos.symbol, reason: result.message },
                  actor: 'RISK_ENGINE',
                });
              }
            })
            .catch((error: unknown) => {
              auditLogger.record({
                category: 'RISK_DECISION',
                level: 'CRITICAL',
                action: 'PAPER_PROTECTIVE_CLOSE_FAILED',
                details: { symbol: pos.symbol, error: error instanceof Error ? error.message : 'Unknown error' },
                actor: 'RISK_ENGINE',
              });
            });
        }
      }

      this.recalculatePortfolio();
    }, 2000).unref();
  }

  private recalculatePortfolio() {
    const dailyLossWasTripped = riskEngine.isDailyLossCircuitBreakerTripped();
    let totalUnrealized = 0;
    let totalMargin = 0;
    let totalGrossNotional = 0;
    let totalOpenRisk = 0;

    for (const pos of this.positions.values()) {
      totalUnrealized += pos.unrealizedPnL;
      totalMargin += pos.marginUsed;
      totalGrossNotional += pos.quantity * pos.currentPrice;

      // Open risk is distance to stop loss
      const stopDist = Math.abs(pos.currentPrice - pos.stopLossPrice);
      totalOpenRisk += pos.quantity * stopDist;
    }

    this.portfolio.unrealizedPnL = Number(totalUnrealized.toFixed(2));
    this.portfolio.totalEquity = Number((this.portfolio.cashBalance + totalUnrealized).toFixed(2));
    this.portfolio.usedMargin = Number(totalMargin.toFixed(2));
    this.portfolio.availableMargin = Number(Math.max(0, this.portfolio.totalEquity - totalMargin).toFixed(2));

    if (this.portfolio.totalEquity > this.peakEquity) {
      this.peakEquity = this.portfolio.totalEquity;
    }

    const drawdownPct = this.peakEquity > 0 ? ((this.peakEquity - this.portfolio.totalEquity) / this.peakEquity) * 100 : 0;
    this.portfolio.currentDrawdownPct = Number(drawdownPct.toFixed(2));
    this.portfolio.maxDrawdownPct = Math.max(this.portfolio.maxDrawdownPct, this.portfolio.currentDrawdownPct);

    const totalPnlToday = this.portfolio.realizedPnLToday + this.portfolio.unrealizedPnL;
    this.portfolio.dailyLossPct = this.portfolio.startOfDayEquity > 0
      ? Number(((-totalPnlToday / this.portfolio.startOfDayEquity) * 100).toFixed(2))
      : 0;

    this.portfolio.grossLeverage = this.portfolio.totalEquity > 0
      ? Number((totalGrossNotional / this.portfolio.totalEquity).toFixed(2))
      : 0;

    this.portfolio.openRiskBudgetPct = this.portfolio.totalEquity > 0
      ? Number(((totalOpenRisk / this.portfolio.totalEquity) * 100).toFixed(2))
      : 0;

    this.portfolio.activePositionsCount = this.positions.size;
    this.portfolio.activeOrdersCount = Array.from(this.orders.values()).filter(o =>
      ['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED'].includes(o.status)
    ).length;

    this.portfolio.consecutiveLosses = this.accountConsecutiveLosses;
    this.portfolio.accountCooldown = riskEngine.getCooldown('ACCOUNT');
    this.portfolio.activeCooldowns = riskEngine.getAllCooldowns().filter(c => c.active && c.remainingSeconds > 0);

    this.portfolio.isDailyLossHalted = riskEngine.checkDailyLossBreach(this.portfolio);
    this.portfolio.isGlobalKillSwitched = riskEngine.isGlobalKillSwitched();
    if (!dailyLossWasTripped && this.portfolio.isDailyLossHalted) {
      void this.persistCurrentState().then((persisted) => {
        if (!persisted) {
          riskEngine.setGlobalKillSwitch(true, 'Daily-loss breaker could not be durably persisted');
        }
      }).catch((error: unknown) => {
        riskEngine.setGlobalKillSwitch(true, 'Daily-loss breaker persistence failed');
        auditLogger.record({
          category: 'RISK_DECISION',
          level: 'CRITICAL',
          action: 'DAILY_LOSS_BREAKER_PERSISTENCE_FAILED',
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
          actor: 'RISK_ENGINE',
        });
      });
    }
  }
}

export const executionEngine = new ExecutionEngine();
