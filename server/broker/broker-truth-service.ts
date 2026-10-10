import {
  BrokerConnectionInfo,
  BrokerAccountSnapshot,
  BrokerPositionRecord,
  BrokerDealRecord,
  QuoteProvenanceRecord,
  PnLVerificationSummary,
  StopDisciplineRule,
  BrokerTruthState,
  DataProvenance,
  StopModificationEvaluationResult,
} from '../../src/types/trading';
import { marketDataService } from '../data/market-data-service';
import { auditLogger } from '../audit/audit-logger';
import type { BrokerInstrumentConstraints } from '../execution/order-authorization-service';

export class BrokerTruthService {
  private readonly connection: BrokerConnectionInfo = {
    brokerName: null,
    server: null,
    accountId: null,
    accountMode: 'UNKNOWN',
    currency: null,
    leverage: null,
    connectionHealth: 'UNAUTHENTICATED',
    readOnlyAuthenticated: false,
    executionPermitted: false,
    lastSyncTimestamp: null,
    pingLatencyMs: null,
  };

  private lastSeenQuoteTimestamps: Map<string, number> = new Map();

  private stopDisciplineRules: Map<string, StopDisciplineRule> = new Map([
    [
      'SPY',
      {
        symbol: 'SPY',
        strategyId: 'trend_following_v1',
        initialStopRequired: true,
        breakEvenThresholdR: 1.5,
        breakEvenBufferPips: 0.05,
        trailingType: 'ATR_CHANDELIER',
        trailingParam: 2.0,
        stopWideningProhibited: true,
      },
    ],
    [
      'BTC/USDT',
      {
        symbol: 'BTC/USDT',
        strategyId: 'momentum_crypto_v1',
        initialStopRequired: true,
        breakEvenThresholdR: 1.5,
        breakEvenBufferPips: 25.0,
        trailingType: 'ATR_CHANDELIER',
        trailingParam: 2.5,
        stopWideningProhibited: true,
      },
    ],
    [
      'EUR/USD',
      {
        symbol: 'EUR/USD',
        strategyId: 'forex_mean_rev_v1',
        initialStopRequired: true,
        breakEvenThresholdR: 1.5,
        breakEvenBufferPips: 0.0002,
        trailingType: 'SWING_STRUCTURE',
        trailingParam: 1.5,
        stopWideningProhibited: true,
      },
    ],
    [
      'XAU/USD',
      {
        symbol: 'XAU/USD',
        strategyId: 'gold_breakout_v1',
        initialStopRequired: true,
        breakEvenThresholdR: 1.5,
        breakEvenBufferPips: 0.5,
        trailingType: 'ATR_CHANDELIER',
        trailingParam: 2.0,
        stopWideningProhibited: true,
      },
    ],
  ]);

  public getConnectionInfo(): BrokerConnectionInfo {
    return { ...this.connection };
  }

  public getAccountSnapshot(): BrokerAccountSnapshot {
    return {
      balance: null,
      equity: null,
      margin: null,
      freeMargin: null,
      marginLevelPct: null,
      currency: null,
      asOf: null,
      provenance: 'UNAVAILABLE',
    };
  }

  public getQuotesWithProvenance(): QuoteProvenanceRecord[] {
    const quotes = marketDataService.getAllQuotes();
    const now = Date.now();

    return quotes.map((q) => {
      const lastSeen = this.lastSeenQuoteTimestamps.get(q.symbol) || 0;
      const validTimestamp = Number.isFinite(q.timestamp) && q.timestamp <= now;
      const isOutOfOrder = validTimestamp && q.timestamp < lastSeen;
      if (validTimestamp && !isOutOfOrder) {
        this.lastSeenQuoteTimestamps.set(q.symbol, q.timestamp);
      }

      const quoteAgeMs = validTimestamp ? Math.max(0, now - q.timestamp) : null;
      const isStale = (quoteAgeMs != null && quoteAgeMs > 30000) || q.isStale;
      const validPrices = Number.isFinite(q.bid) && Number.isFinite(q.ask) && q.bid > 0 && q.ask >= q.bid;

      let provenance: DataProvenance = q.quality === 'SIMULATED'
        ? 'SIMULATED'
        : q.quality === 'HISTORICAL'
        ? 'HISTORICAL'
        : q.quality === 'SNAPSHOT'
        ? 'CACHED'
        : q.quality === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : 'THIRD_PARTY';
      let unavailableReason: string | undefined = undefined;

      if (!validTimestamp) {
        provenance = 'UNAVAILABLE';
        unavailableReason = `Invalid quote source timestamp (${q.timestamp}); future or non-finite timestamps are rejected`;
      } else if (isOutOfOrder) {
        provenance = 'UNAVAILABLE';
        unavailableReason = `Out-of-order quote detected: timestamp ${q.timestamp} < last seen ${lastSeen}`;
      } else if (!validPrices) {
        provenance = 'UNAVAILABLE';
        unavailableReason = 'Quote bid/ask is non-finite, non-positive, or crossed';
      } else if (isStale) {
        provenance = 'STALE';
        unavailableReason = `Quote age (${quoteAgeMs}ms) exceeds max freshness ceiling (30000ms)`;
      }

      return {
        brokerSymbol: null,
        appSymbol: q.symbol,
        ticketOrSeq: null,
        bid: q.bid,
        ask: q.ask,
        sourceTimestamp: q.timestamp,
        receiptTimestamp: now,
        quoteAgeMs,
        provenance,
        connectionHealth: isStale ? 'STALE' : 'UNAUTHENTICATED',
        isStale,
        unavailableReason,
      };
    });
  }

  public getQuoteWithProvenance(symbol: string): QuoteProvenanceRecord | null {
    const quotes = this.getQuotesWithProvenance();
    return quotes.find((q) => q.appSymbol === symbol || q.brokerSymbol === symbol) || null;
  }

  public recordQuoteTimestamp(symbol: string, timestamp: number): { valid: boolean; reason?: string } {
    if (!Number.isFinite(timestamp) || timestamp > Date.now()) {
      return {
        valid: false,
        reason: `Invalid quote timestamp: ${timestamp}; future or non-finite timestamps are rejected`,
      };
    }
    const lastSeen = this.lastSeenQuoteTimestamps.get(symbol) || 0;
    if (timestamp < lastSeen) {
      return {
        valid: false,
        reason: `Out-of-order quote timestamp: received ${timestamp} which is older than recorded ${lastSeen}`,
      };
    }
    this.lastSeenQuoteTimestamps.set(symbol, timestamp);
    return { valid: true };
  }

  public getBrokerPositions(): BrokerPositionRecord[] {
    return [];
  }

  public getBrokerDeals(): BrokerDealRecord[] {
    return [];
  }

  public getInstrumentConstraints(_symbol: string): BrokerInstrumentConstraints | null {
    return null;
  }

  public getBrokerPnLVerification(): PnLVerificationSummary {
    return {
      realizedPnL: null,
      unrealizedPnL: null,
      grossPnL: null,
      totalCommissions: null,
      totalFees: null,
      totalSwaps: null,
      currencyConversionAdjustment: null,
      brokerReportedTotalPnL: null,
      appCalculatedTotalPnL: null,
      netDiscrepancy: null,
      hasDiscrepancy: null,
      verifiedAsOf: null,
      provenance: 'UNAVAILABLE',
    };
  }

  /**
   * Responsible Stop Management & Validation
   * Rule: Valid initial stop REQUIRED.
   * Rule: Stop widening strictly PROHIBITED.
   * Only stops moving closer to market (reducing risk or locking profit) are permitted.
   */
  public evaluateStopModification(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    currentStopLoss: number;
    newStopLoss: number;
    entryPrice: number;
    currentPrice: number;
  }): StopModificationEvaluationResult {
    const { side, currentStopLoss, newStopLoss, entryPrice, currentPrice } = params;

    if (!newStopLoss || newStopLoss <= 0 || isNaN(newStopLoss)) {
      return {
        approved: false,
        code: 'INVALID_STOP_PRICE',
        message: 'Invalid stop price: must be positive numeric value.',
        appliedStop: currentStopLoss,
      };
    }

    // Invariant: NEVER widen a stop to rescue a losing trade or loosen risk budget!
    if (side === 'BUY') {
      if (newStopLoss < currentStopLoss) {
        auditLogger.record({
          category: 'RISK_DECISION',
          level: 'CRITICAL',
          action: 'STOP_WIDENING_REJECTED',
          details: {
            side,
            currentStopLoss,
            attemptedStopLoss: newStopLoss,
            violation: 'Attempted to move BUY stop lower (widening risk)',
          },
          actor: 'RISK_ENGINE',
        });
        return {
          approved: false,
          code: 'ILLEGAL_STOP_WIDENING',
          message: `STOP DISCIPLINE VIOLATION: Cannot widen stop-loss from $${currentStopLoss} to $${newStopLoss}. Moving stops further away to rescue losing trades is strictly prohibited.`,
          appliedStop: currentStopLoss,
        };
      }

      if (newStopLoss >= currentPrice) {
        return {
          approved: false,
          code: 'STOP_PRICE_CROSSES_MARKET',
          message: `Stop price $${newStopLoss} cannot be equal to or greater than current market price $${currentPrice}.`,
          appliedStop: currentStopLoss,
        };
      }
    } else {
      // SELL Position
      if (newStopLoss > currentStopLoss) {
        auditLogger.record({
          category: 'RISK_DECISION',
          level: 'CRITICAL',
          action: 'STOP_WIDENING_REJECTED',
          details: {
            side,
            currentStopLoss,
            attemptedStopLoss: newStopLoss,
            violation: 'Attempted to move SELL stop higher (widening risk)',
          },
          actor: 'RISK_ENGINE',
        });
        return {
          approved: false,
          code: 'ILLEGAL_STOP_WIDENING',
          message: `STOP DISCIPLINE VIOLATION: Cannot widen stop-loss from $${currentStopLoss} to $${newStopLoss}. Moving stops further away to rescue losing trades is strictly prohibited.`,
          appliedStop: currentStopLoss,
        };
      }

      if (newStopLoss <= currentPrice) {
        return {
          approved: false,
          code: 'STOP_PRICE_CROSSES_MARKET',
          message: `Stop price $${newStopLoss} cannot be equal to or less than current market price $${currentPrice}.`,
          appliedStop: currentStopLoss,
        };
      }
    }

    auditLogger.record({
      category: 'ORDER_STATE',
      level: 'INFO',
      action: 'PAPER_STOP_MODIFICATION_APPLIED',
      details: {
        symbol: params.symbol,
        side,
        previousStop: currentStopLoss,
        newPaperStop: newStopLoss,
        riskReducedUSD: Math.abs(currentStopLoss - newStopLoss),
      },
      actor: 'RISK_ENGINE',
    });

    return {
      approved: true,
      code: 'STOP_MODIFIED_LOCAL',
      status: 'UNCONFIRMED_LOCAL_ONLY',
      message: `Protective stop ratcheted in local PAPER state to $${newStopLoss}. Broker-side confirmation is unavailable and the last broker-confirmed stop remains unavailable.`,
      appliedStop: newStopLoss,
      confirmedStop: null,
      lastConfirmedStop: null,
      pendingStop: newStopLoss,
    };
  }

  public getStopDisciplineRules(): StopDisciplineRule[] {
    return Array.from(this.stopDisciplineRules.values());
  }

  public getBrokerTruthState(): BrokerTruthState {
    const connection = this.getConnectionInfo();
    const accountSnapshot = this.getAccountSnapshot();
    const quotes = this.getQuotesWithProvenance();
    const positions = this.getBrokerPositions();
    const deals = this.getBrokerDeals();
    const pnlVerification = this.getBrokerPnLVerification();
    const stopRules = this.getStopDisciplineRules();

    return {
      connection,
      accountSnapshot,
      quotes,
      positions,
      deals,
      pnlVerification,
      stopRules,
      reconciliationStatus: {
        inSync: false,
        status: 'UNAVAILABLE',
        unresolvedDiscrepancies: null,
        lastReconciledAt: null,
        details: 'No authenticated broker account-data integration is configured; broker records and reconciliation are unavailable.',
      },
    };
  }
}

export const brokerTruthService = new BrokerTruthService();
