import {
  Instrument,
  Order,
  PortfolioRiskAssessment,
  Position,
  RiskLimits,
} from '../../src/types/trading';

interface ProposedExposure {
  clientOrderId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  stopLoss?: number;
  strategyId: string;
  instrument: Instrument;
}

interface ExposureLot {
  symbol: string;
  assetClass: Instrument['assetClass'];
  quoteCurrency: string;
  strategyId: string;
  notional: number;
  stopRisk: number | null;
  pending: boolean;
}

const ACTIVE_ORDER_STATES = new Set(['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED']);

export class PortfolioRiskService {
  public assess(input: {
    equity: number;
    positions: Position[];
    orders: Order[];
    proposed?: ProposedExposure;
    getInstrument: (symbol: string) => Instrument | undefined;
    limits: RiskLimits;
    accountCurrency?: string;
    now?: number;
  }): PortfolioRiskAssessment {
    const assessedAt = input.now ?? Date.now();
    const reasons: string[] = [];
    const warnings = [
      'Estimated from the local paper ledger only; no external/manual positions or broker records are connected.',
      'Equity is the local simulator value, not broker-confirmed account equity.',
      'Position notionals assume the account equity currency matches each instrument quote currency; FX conversion is unavailable.',
      'Correlation clusters are conservative shared asset-class/quote-currency proxies, not measured return correlations.',
    ];

    if (!Number.isFinite(input.equity) || input.equity <= 0) {
      return this.unavailable(assessedAt, 'Positive verified-equivalent equity is required for exposure ratios.');
    }
    if (input.accountCurrency !== undefined && !input.accountCurrency.trim()) {
      return this.unavailable(assessedAt, 'Account currency is unavailable; portfolio exposure cannot be converted.');
    }

    const lots: ExposureLot[] = [];
    if (input.proposed && (
      !Number.isFinite(input.proposed.quantity) || input.proposed.quantity <= 0 ||
      !Number.isFinite(input.proposed.price) || input.proposed.price <= 0
    )) {
      return this.unavailable(assessedAt, 'Proposed quantity or reference price is invalid; portfolio exposure cannot be calculated.');
    }
    for (const position of input.positions) {
      const instrument = input.getInstrument(position.symbol);
      if (!instrument || !Number.isFinite(position.quantity) || position.quantity <= 0 ||
        !Number.isFinite(position.currentPrice) || position.currentPrice <= 0) {
        return this.unavailable(assessedAt, `Cannot value local position ${position.symbol} from known instrument specifications and price.`);
      }
      if (input.accountCurrency && instrument.currency !== input.accountCurrency) {
        return this.unavailable(assessedAt, `Cannot convert ${position.symbol} exposure from ${instrument.currency} to account currency ${input.accountCurrency}.`);
      }
      const notional = Math.abs(position.quantity * position.currentPrice);
      const positionStopValid = Number.isFinite(position.stopLossPrice) &&
        position.stopLossPrice > 0 &&
        (position.side === 'BUY'
          ? position.stopLossPrice < position.currentPrice
          : position.stopLossPrice > position.currentPrice);
      lots.push({
        symbol: position.symbol,
        assetClass: instrument.assetClass,
        quoteCurrency: instrument.currency,
        strategyId: position.strategyId,
        notional,
        stopRisk: positionStopValid
          ? Math.abs(position.currentPrice - position.stopLossPrice) * Math.abs(position.quantity)
          : null,
        pending: false,
      });
      if (!positionStopValid) {
        reasons.push(`Position ${position.symbol} has no valid risk-reducing local stop price; its loss risk cannot be bounded by the ledger.`);
      }
    }

    for (const order of input.orders) {
      if (!ACTIVE_ORDER_STATES.has(order.status)) continue;
      if (input.proposed?.clientOrderId && order.clientOrderId === input.proposed.clientOrderId) continue;
      const instrument = input.getInstrument(order.symbol);
      const price = order.price ?? (input.proposed?.symbol === order.symbol ? input.proposed.price : null);
      if (!instrument || price === null || !Number.isFinite(price) || price <= 0 ||
        !Number.isFinite(order.quantity) || order.quantity <= 0 ||
        !Number.isFinite(order.filledQuantity) || order.filledQuantity < 0 || order.filledQuantity > order.quantity) {
        return this.unavailable(assessedAt, `Cannot value active pending order ${order.clientOrderId} (${order.symbol}); pending-order exposure is unknown.`);
      }
      if (input.accountCurrency && instrument.currency !== input.accountCurrency) {
        return this.unavailable(assessedAt, `Cannot convert pending ${order.symbol} exposure from ${instrument.currency} to account currency ${input.accountCurrency}.`);
      }
      const remainingQuantity = Math.max(0, order.quantity - order.filledQuantity);
      if (remainingQuantity === 0) continue;
      const notional = remainingQuantity * price;
      const orderStopRisk = order.stopLoss !== undefined && Number.isFinite(order.stopLoss) &&
        (order.side === 'BUY' ? order.stopLoss < price : order.stopLoss > price)
        ? Math.abs(price - order.stopLoss) * remainingQuantity
        : null;
      lots.push({
        symbol: order.symbol,
        assetClass: instrument.assetClass,
        quoteCurrency: instrument.currency,
        strategyId: order.strategyId,
        notional,
        stopRisk: orderStopRisk,
        pending: true,
      });
      if (orderStopRisk === null) {
        reasons.push(`Pending order ${order.clientOrderId} has no valid risk-reducing stop; its risk contribution is unknown.`);
      }
    }

    if (input.proposed) {
      const { proposed } = input;
      if (input.accountCurrency && proposed.instrument.currency !== input.accountCurrency) {
        return this.unavailable(assessedAt, `Cannot convert proposed ${proposed.symbol} exposure from ${proposed.instrument.currency} to account currency ${input.accountCurrency}.`);
      }
      const notional = proposed.quantity * proposed.price;
      const proposedStopRisk = proposed.stopLoss !== undefined && Number.isFinite(proposed.stopLoss) &&
        proposed.stopLoss > 0 &&
        (proposed.side === 'BUY' ? proposed.stopLoss < proposed.price : proposed.stopLoss > proposed.price)
        ? Math.abs(proposed.price - proposed.stopLoss) * proposed.quantity
        : null;
      lots.push({
        symbol: proposed.symbol,
        assetClass: proposed.instrument.assetClass,
        quoteCurrency: proposed.instrument.currency,
        strategyId: proposed.strategyId,
        notional,
        stopRisk: proposedStopRisk,
        pending: true,
      });
      if (proposedStopRisk === null) {
        reasons.push('Proposed entry has no valid risk-reducing stop; portfolio stop risk is unknown.');
      }
    }

    const grossNotional = lots.reduce((sum, lot) => sum + lot.notional, 0);
    const grossLeverage = grossNotional / input.equity;
    const knownStopRisk = lots.reduce((sum, lot) => sum + (lot.stopRisk ?? 0), 0);
    const allStopRisksKnown = lots.every((lot) => lot.stopRisk !== null);
    const stressedLoss = lots.reduce((sum, lot) => {
      const shockPct = this.stressShockPct(lot.assetClass);
      const spreadWideningPct = 0.01;
      const gapBufferPct = 0.02;
      return sum + lot.notional * (shockPct + spreadWideningPct + gapBufferPct);
    }, 0);

    const bySymbol = this.group(lots, (lot) => lot.symbol);
    const byAssetClass = this.group(lots, (lot) => lot.assetClass);
    const byQuoteCurrency = this.group(lots, (lot) => lot.quoteCurrency);
    const strategyNotional = this.group(lots, (lot) => lot.strategyId);
    const proposed = input.proposed;

    if (grossLeverage > input.limits.maxLeverage) {
      reasons.push(`Combined positions and pending entries imply ${grossLeverage.toFixed(2)}x gross leverage, above the ${input.limits.maxLeverage.toFixed(2)}x limit.`);
    }
    if (proposed) {
      const assetPct = (bySymbol.get(proposed.symbol) || 0) / input.equity * 100;
      const classPct = (byAssetClass.get(proposed.instrument.assetClass) || 0) / input.equity * 100;
      const strategyPct = (strategyNotional.get(proposed.strategyId) || 0) / input.equity * 100;
      if (assetPct > input.limits.maxSingleAssetExposurePct) {
        reasons.push(`${proposed.symbol} combined position and pending-order exposure would reach ${assetPct.toFixed(2)}% of equity, over the ${input.limits.maxSingleAssetExposurePct}% limit.`);
      }
      if (classPct > input.limits.maxAssetClassExposurePct) {
        reasons.push(`${proposed.instrument.assetClass} exposure would reach ${classPct.toFixed(2)}% of equity, over the ${input.limits.maxAssetClassExposurePct}% limit.`);
      }
      if (strategyPct > input.limits.maxStrategyExposurePct) {
        reasons.push(`${proposed.strategyId} exposure would reach ${strategyPct.toFixed(2)}% of equity, over the ${input.limits.maxStrategyExposurePct}% limit.`);
      }
      if (allStopRisksKnown && knownStopRisk / input.equity * 100 > input.limits.portfolioOpenRiskBudgetPct) {
        reasons.push(`Combined modeled stop risk would reach ${(knownStopRisk / input.equity * 100).toFixed(2)}% of equity, over the ${input.limits.portfolioOpenRiskBudgetPct}% portfolio risk budget.`);
      }
    }

    if (!allStopRisksKnown) {
      warnings.push('At least one position/order lacks a valid stop, so the stop-based portfolio loss estimate is incomplete.');
      if (input.proposed) {
        reasons.push('Existing account exposure has unknown stop risk; a new entry is blocked until every position and active order has a verifiable protective stop.');
      }
    }
    const symbolsByCorrelationProxy = new Map<string, Set<string>>();
    for (const lot of lots) {
      const key = `${lot.assetClass}/${lot.quoteCurrency}`;
      const symbols = symbolsByCorrelationProxy.get(key) || new Set<string>();
      symbols.add(lot.symbol);
      symbolsByCorrelationProxy.set(key, symbols);
    }
    const correlatedClusters = Array.from(symbolsByCorrelationProxy.entries())
      .filter(([, symbols]) => symbols.size > 1)
      .map(([key, symbols]) => ({
        key,
        symbols: Array.from(symbols),
        notional: lots.filter((lot) => `${lot.assetClass}/${lot.quoteCurrency}` === key).reduce((sum, lot) => sum + lot.notional, 0),
        limitation: 'Shared classification stress proxy; no historical correlation sample or FX conversion is available.',
      }));

    return {
      status: 'ESTIMATED_PAPER_ONLY',
      source: 'LOCAL_PAPER_LEDGER',
      equity: input.equity,
      grossNotional,
      grossLeverage,
      stopRisk: allStopRisksKnown ? knownStopRisk : null,
      stressedLoss,
      stressAssumption: 'All holdings are stressed jointly: equity/index 15%, crypto 30%, forex 10%, commodity 20%, plus 1% spread widening and 2% gap buffer; no diversification credit.',
      exposureBySymbol: this.exposureArray(bySymbol, input.equity),
      exposureByAssetClass: this.exposureArray(byAssetClass, input.equity),
      exposureByQuoteCurrency: this.exposureArray(byQuoteCurrency, input.equity),
      correlatedClusters,
      warnings,
      entryAllowed: reasons.length === 0,
      reasons,
      assessedAt,
    };
  }

  private stressShockPct(assetClass: Instrument['assetClass']): number {
    switch (assetClass) {
      case 'EQUITY':
      case 'INDEX': return 0.15;
      case 'CRYPTO': return 0.30;
      case 'FOREX': return 0.10;
      case 'COMMODITY': return 0.20;
    }
  }

  private group(lots: ExposureLot[], keyOf: (lot: ExposureLot) => string): Map<string, number> {
    const groups = new Map<string, number>();
    for (const lot of lots) groups.set(keyOf(lot), (groups.get(keyOf(lot)) || 0) + lot.notional);
    return groups;
  }

  private exposureArray(groups: Map<string, number>, equity: number): Array<{ key: string; notional: number; pctEquity: number }> {
    return Array.from(groups.entries()).map(([key, notional]) => ({
      key,
      notional: Number(notional.toFixed(2)),
      pctEquity: Number((notional / equity * 100).toFixed(2)),
    }));
  }

  private unavailable(assessedAt: number, reason: string): PortfolioRiskAssessment {
    return {
      status: 'UNAVAILABLE',
      source: 'UNAVAILABLE',
      equity: null,
      grossNotional: null,
      grossLeverage: null,
      stopRisk: null,
      stressedLoss: null,
      stressAssumption: 'Unavailable because required valuation inputs are missing.',
      exposureBySymbol: [],
      exposureByAssetClass: [],
      exposureByQuoteCurrency: [],
      correlatedClusters: [],
      warnings: [],
      entryAllowed: false,
      reasons: [reason],
      assessedAt,
    };
  }
}

export const portfolioRiskService = new PortfolioRiskService();
