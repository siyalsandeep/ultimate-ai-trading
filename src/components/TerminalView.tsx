import React, { useState, useMemo } from 'react';
import {
  Instrument,
  MarketQuote,
  MarketPriceSnapshot,
  CandleOHLCV,
  PortfolioSummary,
  AssetClass,
  OrderSide,
  OrderType,
  MarketRegimeType,
} from '../types/trading';
import { CandleChart } from './CandleChart';
import {
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  AlertCircle,
  Calculator,
  Send,
  Radio,
  Search,
  Eye,
  DollarSign,
  Percent,
} from 'lucide-react';

function formatPrice(price: number, tickSize?: number): string {
  const precision = tickSize && tickSize < 1
    ? Math.min(8, (tickSize.toString().split('.')[1] || '').length)
    : 2;
  return price.toFixed(precision);
}

function formatLocalTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(timestamp));
}

interface TerminalViewProps {
  instruments: Instrument[];
  quotes: MarketQuote[];
  marketPrices: MarketPriceSnapshot[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  candles: CandleOHLCV[];
  portfolio: PortfolioSummary;
  regime: MarketRegimeType | 'UNKNOWN';
  onSubmitOrder: (order: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    strategyId: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  instruments,
  quotes,
  marketPrices,
  selectedSymbol,
  onSelectSymbol,
  candles,
  portfolio,
  regime,
  onSubmitOrder,
}) => {
  const [selectedAssetClass, setSelectedAssetClass] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [side, setSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [quantity, setQuantity] = useState<number>(1);
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const selectedInst = instruments.find(i => i.symbol === selectedSymbol);
  const selectedQuote = quotes.find(q => q.symbol === selectedSymbol);
  const selectedMarketPrice = marketPrices.find(q => q.symbol === selectedSymbol);
  const currentPrice = selectedQuote?.lastPrice ?? 0;

  // Filter watchlist by asset class and search query
  const filteredQuotes = useMemo(() => {
    return quotes.filter(q => {
      const inst = instruments.find(i => i.symbol === q.symbol);
      const matchesClass = selectedAssetClass === 'ALL' || inst?.assetClass === selectedAssetClass;
      const matchesSearch = searchQuery === '' ||
        q.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (inst?.name.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
      return matchesClass && matchesSearch;
    });
  }, [quotes, instruments, selectedAssetClass, searchQuery]);

  // Derived calculations for Pre-Trade Order Preview
  const notionalValue = useMemo(() => {
    const price = orderType === 'LIMIT' && parseFloat(limitPrice) > 0 ? parseFloat(limitPrice) : currentPrice;
    return quantity * price;
  }, [quantity, orderType, limitPrice, currentPrice]);

  const estimatedFee = useMemo(() => {
    if (!selectedInst) return 1.5;
    if (selectedInst.commissionType === 'PERCENTAGE') {
      return Math.max(1.0, notionalValue * selectedInst.commissionPerUnit);
    }
    return Math.max(1.0, quantity * selectedInst.commissionPerUnit);
  }, [selectedInst, notionalValue, quantity]);

  const stopLossDistance = useMemo(() => {
    const sl = parseFloat(stopLoss);
    if (!sl || sl <= 0) return 0;
    return Math.abs(currentPrice - sl);
  }, [stopLoss, currentPrice]);

  const dollarRiskAtStop = useMemo(() => {
    return quantity * stopLossDistance;
  }, [quantity, stopLossDistance]);

  const riskPctOfEquity = useMemo(() => {
    if (portfolio.totalEquity <= 0) return 0;
    return (dollarRiskAtStop / portfolio.totalEquity) * 100;
  }, [dollarRiskAtStop, portfolio.totalEquity]);

  // Auto calculate risk-based position size (0.25% equity risk budget)
  const handleAutoCalculateSize = () => {
    const sl = parseFloat(stopLoss);
    if (!sl || sl <= 0) {
      // Default to 2x ATR distance if not provided
      const lastCandle = candles[candles.length - 1];
      const atr = lastCandle?.indicators?.atr14 || currentPrice * 0.02;
      const defaultSL = side === 'BUY' ? currentPrice - atr * 2 : currentPrice + atr * 2;
      const formattedSL = selectedInst && selectedInst.tickSize < 0.001 ? defaultSL.toFixed(5) : defaultSL.toFixed(2);
      setStopLoss(formattedSL);

      const distance = Math.abs(currentPrice - defaultSL);
      const riskBudgetUSD = portfolio.totalEquity * 0.0025; // 0.25%
      const calculatedQty = distance > 0 ? riskBudgetUSD / distance : 1;
      const step = selectedInst?.lotStep || 1;
      const rounded = Math.max(selectedInst?.minLotSize || 1, Math.floor(calculatedQty / step) * step);
      setQuantity(Number(rounded.toFixed(4)));

      const tpDist = distance * 2.5;
      const calculatedTP = side === 'BUY' ? currentPrice + tpDist : currentPrice - tpDist;
      setTakeProfit(selectedInst && selectedInst.tickSize < 0.001 ? calculatedTP.toFixed(5) : calculatedTP.toFixed(2));
      return;
    }

    const distance = Math.abs(currentPrice - sl);
    const riskBudgetUSD = portfolio.totalEquity * 0.0025;
    const calculatedQty = distance > 0 ? riskBudgetUSD / distance : 1;
    const step = selectedInst?.lotStep || 1;
    const rounded = Math.max(selectedInst?.minLotSize || 1, Math.floor(calculatedQty / step) * step);
    setQuantity(Number(rounded.toFixed(4)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    if (!selectedQuote || selectedQuote.isStale) {
      setFeedback({
        type: 'error',
        message: 'Paper order blocked: the local simulated reference quote is unavailable or stale.',
      });
      setIsSubmitting(false);
      return;
    }

    const sl = parseFloat(stopLoss);
    if (!sl || sl <= 0) {
      setFeedback({
        type: 'error',
        message: 'Pre-Trade Risk Violation: Mandatory protective stop-loss is required by Risk Engine.',
      });
      setIsSubmitting(false);
      return;
    }

    const price = orderType === 'LIMIT' ? parseFloat(limitPrice) : undefined;
    const tp = takeProfit ? parseFloat(takeProfit) : undefined;

    const res = await onSubmitOrder({
      symbol: selectedSymbol,
      side,
      type: orderType,
      quantity,
      price,
      stopLoss: sl,
      takeProfit: tp,
      strategyId: 'strat_manual_ticket',
    });

    setIsSubmitting(false);
    if (res.success) {
      setFeedback({ type: 'success', message: `Local paper order accepted by the simulator: ${side} ${quantity} ${selectedSymbol}. No broker order was sent.` });
    } else {
      setFeedback({ type: 'error', message: res.error || 'Order rejected by risk engine' });
    }
  };

  const lastBar = candles[candles.length - 1];
  const ind = lastBar?.indicators;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 sm:p-5">
      {/* 1. Market Watchlist (Left column: 3 cols) */}
      <div className="lg:col-span-3 flex flex-col bg-[#0a0d15] border border-white/[0.08] rounded-lg overflow-hidden shadow-md">
        <div className="p-3 border-b border-white/[0.06] bg-[#0c101a]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-100 uppercase tracking-wider">Market Watchlist</span>
            <span className="text-[10px] text-amber-300 font-mono">SNAPSHOTS ONLY</span>
          </div>

          {/* Search Bar */}
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ticker or name..."
              className="w-full bg-[#07090e] border border-white/[0.08] rounded pl-8 pr-2.5 py-1 text-slate-200 text-xs font-mono focus:border-emerald-500/60"
            />
          </div>

          {/* Asset Class Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none text-[11px]">
            {['ALL', 'EQUITY', 'CRYPTO', 'FOREX', 'COMMODITY', 'INDEX'].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedAssetClass(cat)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  selectedAssetClass === cat
                    ? 'bg-emerald-500/15 text-emerald-300 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Watchlist Items */}
        <div className="divide-y divide-white/[0.04] max-h-[640px] overflow-y-auto">
          {filteredQuotes.map((q) => {
            const isSelected = q.symbol === selectedSymbol;
            const snapshot = marketPrices.find((price) => price.symbol === q.symbol);
            const instrument = instruments.find((item) => item.symbol === q.symbol);
            const price = snapshot?.lastPrice;
            const isPositive = (snapshot?.changePct ?? 0) >= 0;
            return (
              <button
                key={q.symbol}
                onClick={() => onSelectSymbol(q.symbol)}
                className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between transition-colors ${
                  isSelected
                    ? 'bg-emerald-500/[0.07] border-l-2 border-emerald-400'
                    : 'hover:bg-white/[0.02]'
                }`}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs text-slate-100">{q.symbol}</span>
                    <span className={`text-[9px] font-mono px-1 rounded ${
                      !snapshot || snapshot.status === 'UNAVAILABLE'
                        ? 'text-slate-300 bg-slate-700/50'
                        : snapshot.isStale
                        ? 'text-amber-300 bg-amber-500/10'
                        : 'text-sky-300 bg-sky-500/10'
                    }`}>
                      {!snapshot || snapshot.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : snapshot.isStale ? 'STALE SNAPSHOT' : snapshot.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                    {snapshot?.provider || 'No provider'} · {snapshot?.quoteAgeMs == null ? 'age N/A' : `${Math.floor(snapshot.quoteAgeMs / 1000)}s old`}
                  </div>
                </div>

                <div className="text-right font-mono tabular-nums">
                  <div className="text-xs font-semibold text-slate-200">
                    {price == null ? 'UNAVAILABLE' : `${formatPrice(price, instrument?.tickSize)} ${instrument?.currency || ''}`}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {snapshot?.changePct == null ? 'Last price only' : `${isPositive ? '+' : ''}${snapshot.changePct.toFixed(2)}% daily`}
                  </div>
                  {snapshot?.sourceTimestamp != null && (
                    <div className="text-[9px] text-slate-500">
                      {formatLocalTime(snapshot.sourceTimestamp)}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Primary Chart & Regime Center (Center column: 6 cols) */}
      <div className="lg:col-span-6 flex flex-col gap-4">
        <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-slate-400">Provider market snapshot · {selectedMarketPrice?.provider || 'No configured provider'}</div>
              <div className="font-mono text-slate-100 text-lg tabular-nums">
                {selectedMarketPrice?.lastPrice == null
                  ? 'UNAVAILABLE'
                  : `${formatPrice(selectedMarketPrice.lastPrice, selectedInst?.tickSize)} ${selectedInst?.currency || ''}`}
              </div>
            </div>
            <span className={`font-mono font-bold ${selectedMarketPrice?.isStale || !selectedMarketPrice || selectedMarketPrice.status === 'UNAVAILABLE' ? 'text-amber-300' : 'text-sky-300'}`}>
              {!selectedMarketPrice || selectedMarketPrice.status === 'UNAVAILABLE'
                ? 'UNAVAILABLE'
                : selectedMarketPrice.isStale
                ? 'STALE SNAPSHOT'
                : selectedMarketPrice.status}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-400 font-mono">
            <span>Bid: {selectedMarketPrice?.bid == null ? 'N/A' : selectedMarketPrice.bid}</span>
            <span>Ask: {selectedMarketPrice?.ask == null ? 'N/A' : selectedMarketPrice.ask}</span>
            <span>Last: {selectedMarketPrice?.lastPrice == null ? 'N/A' : selectedMarketPrice.lastPrice}</span>
            <span>Spread: {selectedMarketPrice?.spread == null ? 'N/A' : selectedMarketPrice.spread}</span>
            <span>Source time: {selectedMarketPrice?.sourceTimestamp == null ? 'N/A' : formatLocalTime(selectedMarketPrice.sourceTimestamp)}</span>
            <span>Received locally: {selectedMarketPrice?.receiptTimestamp == null ? 'N/A' : formatLocalTime(selectedMarketPrice.receiptTimestamp)}</span>
            <span>Quote age: {selectedMarketPrice?.quoteAgeMs == null ? 'N/A' : `${Math.floor(selectedMarketPrice.quoteAgeMs / 1000)}s`}</span>
            <span>Provider symbol: {selectedMarketPrice?.providerSymbol || 'N/A'}</span>
          </div>
          {selectedMarketPrice?.error && <div className="mt-2 text-amber-300">{selectedMarketPrice.error}</div>}
          <div className="mt-2 text-[10px] text-slate-500">
            Snapshot data is display-only and is not a broker executable quote. No live order routing is enabled.
          </div>
        </div>

        {/* Regime Status Banner */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#0a0d15] border border-white/[0.08] rounded-lg text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium text-[11px]">Simulated Regime (generated candles):</span>
            <span className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
              regime === 'TRENDING_BULL'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : regime === 'TRENDING_BEAR'
                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                : regime === 'RANGING_LOW_VOL'
                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                : regime === 'RANGING_HIGH_VOL'
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                : 'bg-red-950/40 text-red-300 border border-red-800'
            }`}>
              {regime}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono tabular-nums">
            <span>ATR(14): <strong className="text-slate-200">${ind?.atr14 || 'N/A'}</strong></span>
            <span>·</span>
            <span>ADX: <strong className="text-slate-200">{ind?.adx14 || 'N/A'}</strong></span>
            <span>·</span>
            <span>RSI: <strong className="text-slate-200">{ind?.rsi14 || 'N/A'}</strong></span>
          </div>
        </div>

        {/* Candlestick Chart */}
        <CandleChart
          symbol={selectedSymbol}
          candles={candles}
          currentPrice={currentPrice}
          height={380}
        />

        {/* Level 2 Micro Order Book Depth Simulation */}
        <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-3.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-200">Institutional Book Depth (Simulated L2)</span>
            <span className="text-[10px] text-slate-400 font-mono">Friction Model: Half-Spread + Volatility Impact</span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs font-mono tabular-nums">
            {/* Bids */}
            <div>
              <div className="flex justify-between text-[10px] text-slate-500 border-b border-white/[0.06] pb-1 mb-1">
                <span>BID SIZE</span>
                <span>BID PRICE</span>
              </div>
              {[0.0001, 0.0003, 0.0006, 0.001].map((offset, i) => {
                const price = currentPrice * (1 - offset);
                const size = Math.round(60 + i * 95);
                const depthWidth = Math.min(100, (size / 380) * 100);
                return (
                  <div key={i} className="relative flex justify-between py-0.5 text-emerald-400">
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 pointer-events-none rounded-xs"
                      style={{ width: `${depthWidth}%` }}
                    />
                    <span className="text-slate-400 relative z-10">{size}</span>
                    <span className="relative z-10">{price < 10 ? price.toFixed(4) : price.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>

            {/* Asks */}
            <div>
              <div className="flex justify-between text-[10px] text-slate-500 border-b border-white/[0.06] pb-1 mb-1">
                <span>ASK PRICE</span>
                <span>ASK SIZE</span>
              </div>
              {[0.0001, 0.0003, 0.0006, 0.001].map((offset, i) => {
                const price = currentPrice * (1 + offset);
                const size = Math.round(55 + i * 90);
                const depthWidth = Math.min(100, (size / 380) * 100);
                return (
                  <div key={i} className="relative flex justify-between py-0.5 text-rose-400">
                    <div
                      className="absolute left-0 top-0 bottom-0 bg-rose-500/10 pointer-events-none rounded-xs"
                      style={{ width: `${depthWidth}%` }}
                    />
                    <span className="relative z-10">{price < 10 ? price.toFixed(4) : price.toFixed(2)}</span>
                    <span className="text-slate-400 relative z-10">{size}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Manual Order Ticket & Pre-Trade Risk Guard (Right column: 3 cols) */}
      <div className="lg:col-span-3 flex flex-col gap-4">
        {/* Portfolio Live Summary Card */}
        <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Paper Account Equity</span>
            <span className="font-mono text-emerald-400 font-bold tabular-nums">${portfolio.totalEquity.toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono tabular-nums pt-2 border-t border-white/[0.06]">
            <div>
              <span className="text-slate-500 block">Daily P&L</span>
              <span className={portfolio.dailyLossPct > 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                {portfolio.dailyLossPct > 0 ? '-' : '+'}{portfolio.dailyLossPct.toFixed(2)}%
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Open Risk</span>
              <span className="text-slate-300">{portfolio.openRiskBudgetPct.toFixed(2)}% / 2.0%</span>
            </div>
          </div>
        </div>

        {/* Order Ticket */}
        <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 flex flex-col shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] mb-3">
            <span className="text-xs font-bold text-slate-100 uppercase tracking-wide">Paper Execution Ticket</span>
            <span className="text-[10px] text-emerald-400 font-mono">DETERMINISTIC GUARD</span>
          </div>
          <div className="mb-3 text-[10px] text-slate-400 font-mono">
            Paper reference: {selectedQuote ? `${selectedQuote.provider} · SIMULATED · ${formatPrice(selectedQuote.lastPrice, selectedInst?.tickSize)} ${selectedInst?.currency || ''} · ${selectedQuote.isStale ? 'STALE' : `${Math.floor((Date.now() - selectedQuote.timestamp) / 1000)}s old`} · ${formatLocalTime(selectedQuote.timestamp)}` : 'UNAVAILABLE'}.
            Provider snapshots above are not used as execution prices.
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-xs">
            {/* Buy / Sell Tabs */}
            <div className="grid grid-cols-2 gap-1 bg-[#06080e] p-1 rounded border border-white/[0.06]">
              <button
                type="button"
                onClick={() => setSide('BUY')}
                className={`py-1.5 font-bold rounded text-xs transition-colors ${
                  side === 'BUY'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                BUY / LONG
              </button>
              <button
                type="button"
                onClick={() => setSide('SELL')}
                className={`py-1.5 font-bold rounded text-xs transition-colors ${
                  side === 'SELL'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                SELL / SHORT
              </button>
            </div>

            {/* Order Type */}
            <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setOrderType('MARKET')}
                className={`py-1 rounded border transition-colors ${
                  orderType === 'MARKET'
                    ? 'bg-slate-800 text-slate-100 border-white/[0.15]'
                    : 'bg-[#080b13] text-slate-400 border-white/[0.05] hover:text-slate-200'
                }`}
              >
                Market Order
              </button>
              <button
                type="button"
                onClick={() => setOrderType('LIMIT')}
                className={`py-1 rounded border transition-colors ${
                  orderType === 'LIMIT'
                    ? 'bg-slate-800 text-slate-100 border-white/[0.15]'
                    : 'bg-[#080b13] text-slate-400 border-white/[0.05] hover:text-slate-200'
                }`}
              >
                Limit Order
              </button>
            </div>

            {/* Limit Price Field */}
            {orderType === 'LIMIT' && (
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Limit Price ($)</label>
                <input
                  type="number"
                  step="any"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={currentPrice.toString()}
                  className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs tabular-nums focus:border-emerald-500/60"
                />
              </div>
            )}

            {/* Stop Loss (MANDATORY BY DETERMINISTIC RISK ENGINE) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-rose-400 flex items-center gap-1">
                  <span>Mandatory Stop Loss ($)</span>
                  <span className="text-[9px] text-rose-500 font-normal">*REQUIRED</span>
                </label>
                <button
                  type="button"
                  onClick={handleAutoCalculateSize}
                  className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1 font-mono"
                >
                  <Calculator className="w-2.5 h-2.5" /> Auto 2x ATR
                </button>
              </div>
              <input
                type="number"
                step="any"
                required
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="Required by Risk Policy"
                className="w-full bg-[#06080e] border border-rose-900/60 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs tabular-nums focus:border-rose-500"
              />
            </div>

            {/* Take Profit */}
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Take Profit ($) - Optional</label>
              <input
                type="number"
                step="any"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder="Optional Target Price"
                className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs tabular-nums focus:border-emerald-500/60"
              />
            </div>

            {/* Quantity */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-slate-400">Order Quantity</label>
                <span className="text-[10px] text-slate-500 font-mono tabular-nums">
                  Lot: {selectedInst?.minLotSize || 1}
                </span>
              </div>
              <input
                type="number"
                step="any"
                min={selectedInst?.minLotSize || 0.0001}
                value={quantity}
                onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs tabular-nums focus:border-emerald-500/60"
              />
            </div>

            {/* Dedicated Pre-Trade Order Risk Preview Card */}
            <div className="bg-[#070910] p-2.5 rounded border border-white/[0.06] text-[11px] font-mono tabular-nums text-slate-400 space-y-1.5">
              <div className="flex items-center justify-between text-slate-300 font-semibold border-b border-white/[0.04] pb-1">
                <span className="flex items-center gap-1 text-[10px]">
                  <Eye className="w-3 h-3 text-sky-400" /> Pre-Trade Risk Summary
                </span>
                <span className="text-[10px] text-slate-500">0.25% Limit</span>
              </div>

              <div className="flex justify-between">
                <span>Notional Value:</span>
                <span className="text-slate-100 font-medium">${notionalValue.toFixed(2)}</span>
              </div>

              <div className="flex justify-between">
                <span>Max Stop Loss Risk:</span>
                <span className={riskPctOfEquity > 0.25 ? 'text-amber-400 font-bold' : 'text-slate-200'}>
                  ${dollarRiskAtStop.toFixed(2)} ({riskPctOfEquity.toFixed(2)}%)
                </span>
              </div>

              <div className="flex justify-between">
                <span>Estimated Fee:</span>
                <span className="text-slate-300">${estimatedFee.toFixed(2)}</span>
              </div>
            </div>

            {/* Feedback Alerts */}
            {feedback && (
              <div className={`p-2.5 rounded text-xs flex items-start gap-2 ${
                feedback.type === 'success'
                  ? 'bg-emerald-950/40 border border-emerald-800/80 text-emerald-300'
                  : 'bg-rose-950/40 border border-rose-800/80 text-rose-300'
              }`}>
                {feedback.type === 'success' ? (
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                )}
                <span className="leading-tight">{feedback.message}</span>
              </div>
            )}

            {/* Account Cooldown Alert */}
            {portfolio.accountCooldown?.active && portfolio.accountCooldown.remainingSeconds > 0 && (
              <div className="p-2.5 rounded text-xs bg-amber-950/40 border border-amber-800/80 text-amber-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <div className="leading-tight">
                  <span className="font-bold block">Revenge-Trading Cooldown Active</span>
                  <span className="text-[11px] text-amber-300/90 font-mono mt-0.5 block">
                    Account entries paused ({portfolio.accountCooldown.remainingSeconds}s remaining). Risk limits unchanged.
                  </span>
                </div>
              </div>
            )}

            {/* Submit Order Button */}
            <button
              type="submit"
              disabled={isSubmitting || portfolio.isGlobalKillSwitched || Boolean(portfolio.accountCooldown?.active && portfolio.accountCooldown.remainingSeconds > 0)}
              className={`w-full py-2.5 rounded font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md ${
                portfolio.isGlobalKillSwitched || Boolean(portfolio.accountCooldown?.active && portfolio.accountCooldown.remainingSeconds > 0)
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : side === 'BUY'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-rose-600 hover:bg-rose-500 text-white'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {isSubmitting
                  ? 'Validating Deterministic Risk...'
                  : portfolio.isGlobalKillSwitched
                  ? 'HALTED BY KILL SWITCH'
                  : portfolio.accountCooldown?.active && portfolio.accountCooldown.remainingSeconds > 0
                  ? `COOLDOWN ACTIVE (${portfolio.accountCooldown.remainingSeconds}s)`
                  : `Route ${side} Order`}
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
