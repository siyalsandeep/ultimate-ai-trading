import { Instrument, MarketQuote, CandleOHLCV, MarketRegimeType } from '../../src/types/trading';

export const SUPPORTED_INSTRUMENTS: Instrument[] = [
  // Equities & ETFs
  {
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    assetClass: 'INDEX',
    currency: 'USD',
    minLotSize: 1,
    lotStep: 1,
    tickSize: 0.01,
    commissionPerUnit: 0.005,
    commissionType: 'FIXED_PER_UNIT',
    typicalSpreadPct: 0.0002,
    marginRequirement: 0.25,
    tradingHours: '09:30-16:00 EST',
    exchange: 'NYSE Arca',
    marketCloseBufferMinutes: 15,
    weekendEntryAllowed: false,
    timezone: 'America/New_York',
  },
  {
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust (Nasdaq-100)',
    assetClass: 'INDEX',
    currency: 'USD',
    minLotSize: 1,
    lotStep: 1,
    tickSize: 0.01,
    commissionPerUnit: 0.005,
    commissionType: 'FIXED_PER_UNIT',
    typicalSpreadPct: 0.0002,
    marginRequirement: 0.25,
    tradingHours: '09:30-16:00 EST',
    exchange: 'NASDAQ',
    marketCloseBufferMinutes: 15,
    weekendEntryAllowed: false,
    timezone: 'America/New_York',
  },
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'EQUITY',
    currency: 'USD',
    minLotSize: 1,
    lotStep: 1,
    tickSize: 0.01,
    commissionPerUnit: 0.005,
    commissionType: 'FIXED_PER_UNIT',
    typicalSpreadPct: 0.0003,
    marginRequirement: 0.30,
    tradingHours: '09:30-16:00 EST',
    exchange: 'NASDAQ',
    marketCloseBufferMinutes: 15,
    weekendEntryAllowed: false,
    timezone: 'America/New_York',
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    assetClass: 'EQUITY',
    currency: 'USD',
    minLotSize: 1,
    lotStep: 1,
    tickSize: 0.01,
    commissionPerUnit: 0.005,
    commissionType: 'FIXED_PER_UNIT',
    typicalSpreadPct: 0.0004,
    marginRequirement: 0.35,
    tradingHours: '09:30-16:00 EST',
    exchange: 'NASDAQ',
    marketCloseBufferMinutes: 15,
    weekendEntryAllowed: false,
    timezone: 'America/New_York',
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    assetClass: 'EQUITY',
    currency: 'USD',
    minLotSize: 1,
    lotStep: 1,
    tickSize: 0.01,
    commissionPerUnit: 0.005,
    commissionType: 'FIXED_PER_UNIT',
    typicalSpreadPct: 0.0003,
    marginRequirement: 0.30,
    tradingHours: '09:30-16:00 EST',
    exchange: 'NASDAQ',
    marketCloseBufferMinutes: 15,
    weekendEntryAllowed: false,
    timezone: 'America/New_York',
  },
  // Crypto Spot (24/7/365 trading - weekend entries permissible)
  {
    symbol: 'BTC/USDT',
    name: 'Bitcoin / Tether USD',
    assetClass: 'CRYPTO',
    currency: 'USDT',
    minLotSize: 0.0001,
    lotStep: 0.0001,
    tickSize: 0.1,
    commissionPerUnit: 0.00075, // 0.075% taker fee
    commissionType: 'PERCENTAGE',
    typicalSpreadPct: 0.00015,
    marginRequirement: 1.0, // spot default
    tradingHours: '24/7/365',
    exchange: 'Binance / Global Crypto',
    marketCloseBufferMinutes: 0,
    weekendEntryAllowed: true,
    timezone: 'UTC',
  },
  {
    symbol: 'ETH/USDT',
    name: 'Ethereum / Tether USD',
    assetClass: 'CRYPTO',
    currency: 'USDT',
    minLotSize: 0.001,
    lotStep: 0.001,
    tickSize: 0.01,
    commissionPerUnit: 0.00075,
    commissionType: 'PERCENTAGE',
    typicalSpreadPct: 0.0002,
    marginRequirement: 1.0,
    tradingHours: '24/7/365',
    exchange: 'Binance / Global Crypto',
    marketCloseBufferMinutes: 0,
    weekendEntryAllowed: true,
    timezone: 'UTC',
  },
  {
    symbol: 'SOL/USDT',
    name: 'Solana / Tether USD',
    assetClass: 'CRYPTO',
    currency: 'USDT',
    minLotSize: 0.01,
    lotStep: 0.01,
    tickSize: 0.01,
    commissionPerUnit: 0.00075,
    commissionType: 'PERCENTAGE',
    typicalSpreadPct: 0.0003,
    marginRequirement: 1.0,
    tradingHours: '24/7/365',
    exchange: 'Binance / Global Crypto',
    marketCloseBufferMinutes: 0,
    weekendEntryAllowed: true,
    timezone: 'UTC',
  },
  // Forex
  {
    symbol: 'EUR/USD',
    name: 'Euro / US Dollar',
    assetClass: 'FOREX',
    currency: 'USD',
    minLotSize: 1000,
    lotStep: 1000,
    tickSize: 0.00001,
    commissionPerUnit: 0.00002, // $2.00 per standard lot
    commissionType: 'FIXED_PER_UNIT',
    typicalSpreadPct: 0.00008,
    marginRequirement: 0.033, // 30:1 leverage
    tradingHours: '24/5 Global FX',
    exchange: 'Interbank / ECN',
    marketCloseBufferMinutes: 15,
    weekendEntryAllowed: false,
    timezone: 'America/New_York',
  },
  {
    symbol: 'USD/JPY',
    name: 'US Dollar / Japanese Yen',
    assetClass: 'FOREX',
    currency: 'JPY',
    minLotSize: 1000,
    lotStep: 1000,
    tickSize: 0.001,
    commissionPerUnit: 0.00002,
    commissionType: 'FIXED_PER_UNIT',
    typicalSpreadPct: 0.00009,
    marginRequirement: 0.033,
    tradingHours: '24/5 Global FX',
    exchange: 'Interbank / ECN',
    marketCloseBufferMinutes: 15,
    weekendEntryAllowed: false,
    timezone: 'America/New_York',
  },
  // Commodities
  {
    symbol: 'XAU/USD',
    name: 'Gold (Troy Ounce) / USD',
    assetClass: 'COMMODITY',
    currency: 'USD',
    minLotSize: 1,
    lotStep: 1,
    tickSize: 0.01,
    commissionPerUnit: 0.0003,
    commissionType: 'PERCENTAGE',
    typicalSpreadPct: 0.00025,
    marginRequirement: 0.05, // 20:1
    tradingHours: '23/5 Global Metals',
    exchange: 'COMEX / London OTC',
    marketCloseBufferMinutes: 15,
    weekendEntryAllowed: false,
    timezone: 'America/New_York',
  },
  {
    symbol: 'WTI/USD',
    name: 'Crude Oil WTI Light Sweet',
    assetClass: 'COMMODITY',
    currency: 'USD',
    minLotSize: 10,
    lotStep: 10,
    tickSize: 0.01,
    commissionPerUnit: 0.0004,
    commissionType: 'PERCENTAGE',
    typicalSpreadPct: 0.0004,
    marginRequirement: 0.10, // 10:1
    tradingHours: '23/5 NYMEX',
    exchange: 'NYMEX',
    marketCloseBufferMinutes: 15,
    weekendEntryAllowed: false,
    timezone: 'America/New_York',
  },
];

// Isolated in-memory simulator for generated candles and paper-only quotes.
class MarketDataService {
  private candlesBySymbol: Map<string, CandleOHLCV[]> = new Map();
  private latestQuotes: Map<string, MarketQuote> = new Map();
  private basePrices: Map<string, number> = new Map([
    ['SPY', 585.40],
    ['QQQ', 492.80],
    ['AAPL', 234.50],
    ['NVDA', 138.20],
    ['MSFT', 428.10],
    ['BTC/USDT', 67450.0],
    ['ETH/USDT', 2640.0],
    ['SOL/USDT', 156.40],
    ['EUR/USD', 1.0875],
    ['USD/JPY', 149.20],
    ['XAU/USD', 2655.0],
    ['WTI/USD', 71.80],
  ]);

  constructor() {
    this.initializeHistoricalData();
    this.startPaperTickSimulation();
  }

  private initializeHistoricalData() {
    const barCount = 180; // 180 daily bars for deep historical lookback & backtesting
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    for (const inst of SUPPORTED_INSTRUMENTS) {
      const base = this.basePrices.get(inst.symbol) || 100;
      const bars: CandleOHLCV[] = [];
      let currentPrice = base * 0.82; // Start from earlier level to simulate realistic trending & ranging cycles

      for (let i = barCount - 1; i >= 0; i--) {
        const time = now - i * dayMs;
        // Deterministic stochastic walk with regime cycles
        const cycle = Math.sin((barCount - i) / 14);
        const noise = (Math.sin(i * 1337) * 0.5 + Math.cos(i * 733) * 0.5) * 0.015;
        const drift = 0.001 + cycle * 0.004 + noise;

        const open = currentPrice;
        const close = open * (1 + drift);
        const high = Math.max(open, close) * (1 + Math.abs(noise * 0.8) + 0.002);
        const low = Math.min(open, close) * (1 - Math.abs(noise * 0.8) - 0.002);
        const volume = Math.round(500000 + Math.abs(Math.sin(i * 41)) * 1500000);

        bars.push({
          time,
          open: Number(open.toFixed(inst.tickSize < 0.001 ? 5 : 2)),
          high: Number(high.toFixed(inst.tickSize < 0.001 ? 5 : 2)),
          low: Number(low.toFixed(inst.tickSize < 0.001 ? 5 : 2)),
          close: Number(close.toFixed(inst.tickSize < 0.001 ? 5 : 2)),
          volume,
        });

        currentPrice = close;
      }

      // Compute technical indicators for bars
      this.calculateIndicators(bars);
      this.candlesBySymbol.set(inst.symbol, bars);

      // Create initial quote
      const lastBar = bars[bars.length - 1];
      const spread = lastBar.close * inst.typicalSpreadPct;
      this.latestQuotes.set(inst.symbol, {
        symbol: inst.symbol,
        bid: Number((lastBar.close - spread / 2).toFixed(inst.tickSize < 0.001 ? 5 : 2)),
        ask: Number((lastBar.close + spread / 2).toFixed(inst.tickSize < 0.001 ? 5 : 2)),
        lastPrice: lastBar.close,
        volume24h: lastBar.volume,
        high24h: lastBar.high,
        low24h: lastBar.low,
        change24hPct: Number((((lastBar.close - bars[bars.length - 2].close) / bars[bars.length - 2].close) * 100).toFixed(2)),
        spreadPct: inst.typicalSpreadPct,
        timestamp: Date.now(),
        provider: 'Local Paper Simulator',
        isStale: false,
        quality: 'SIMULATED',
        feedDescription: 'Local paper simulator; not current market data',
        isLiveBrokerExecutable: false,
        feedLatencyMs: 4,
      });
    }
  }

  private calculateIndicators(bars: CandleOHLCV[]) {
    // EMA calculations
    const ema = (period: number, prices: number[]): number[] => {
      const k = 2 / (period + 1);
      const res: number[] = [];
      let prevEma = prices[0];
      res.push(prevEma);
      for (let i = 1; i < prices.length; i++) {
        prevEma = prices[i] * k + prevEma * (1 - k);
        res.push(prevEma);
      }
      return res;
    };

    const closes = bars.map(b => b.close);
    const ema20 = ema(20, closes);
    const ema50 = ema(50, closes);
    const ema200 = ema(Math.min(bars.length, 100), closes);

    // ATR 14 calculation
    const trueRanges: number[] = [bars[0].high - bars[0].low];
    for (let i = 1; i < bars.length; i++) {
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close)
      );
      trueRanges.push(tr);
    }
    const atr14 = ema(14, trueRanges);

    // RSI 14 calculation
    const rsi14: number[] = [50];
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= 14 && i < bars.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }
    avgGain /= 14;
    avgLoss /= 14;
    for (let i = 1; i < bars.length; i++) {
      if (i > 14) {
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        avgGain = (avgGain * 13 + gain) / 14;
        avgLoss = (avgLoss * 13 + loss) / 14;
      }
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      rsi14.push(Number(rsi.toFixed(2)));
    }

    // Assign indicators to each bar
    for (let i = 0; i < bars.length; i++) {
      // 20-period Bollinger Bands
      const lookback = Math.min(i + 1, 20);
      const slice = closes.slice(i - lookback + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / lookback;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lookback;
      const stdDev = Math.sqrt(variance);

      // ADX proxy based on directional strength
      const adx = Number((20 + Math.abs((closes[i] - ema50[i]) / ema50[i]) * 350).toFixed(1));

      bars[i].indicators = {
        ema20: Number(ema20[i].toFixed(2)),
        ema50: Number(ema50[i].toFixed(2)),
        ema200: Number(ema200[i].toFixed(2)),
        atr14: Number(atr14[i].toFixed(2)),
        adx14: Math.min(65, Math.max(12, adx)),
        rsi14: rsi14[i] || 50,
        bbUpper: Number((mean + 2 * stdDev).toFixed(2)),
        bbMiddle: Number(mean.toFixed(2)),
        bbLower: Number((mean - 2 * stdDev).toFixed(2)),
        volatility: Number(((stdDev / mean) * 100).toFixed(2)),
      };
    }
  }

  private startPaperTickSimulation() {
    // Synthetic paper ticks are never provider or broker market data.
    setInterval(() => {
      for (const inst of SUPPORTED_INSTRUMENTS) {
        const currentQuote = this.latestQuotes.get(inst.symbol);
        if (!currentQuote) continue;

        // Mild micro-tick movement with realistic random walk
        const volatility = inst.assetClass === 'CRYPTO' ? 0.0006 : 0.0002;
        const tickDelta = (Math.random() - 0.495) * currentQuote.lastPrice * volatility;
        const newPrice = Number((currentQuote.lastPrice + tickDelta).toFixed(inst.tickSize < 0.001 ? 5 : 2));
        const spread = newPrice * inst.typicalSpreadPct;

        this.latestQuotes.set(inst.symbol, {
          ...currentQuote,
          lastPrice: newPrice,
          bid: Number((newPrice - spread / 2).toFixed(inst.tickSize < 0.001 ? 5 : 2)),
          ask: Number((newPrice + spread / 2).toFixed(inst.tickSize < 0.001 ? 5 : 2)),
          timestamp: Date.now(),
          isStale: false,
          quality: 'SIMULATED',
          feedDescription: 'Local paper simulator; not current market data',
          isLiveBrokerExecutable: false,
          feedLatencyMs: 4,
        });

        // Update the close of the most recent candle
        const candles = this.candlesBySymbol.get(inst.symbol);
        if (candles && candles.length > 0) {
          const lastCandle = candles[candles.length - 1];
          lastCandle.close = newPrice;
          if (newPrice > lastCandle.high) lastCandle.high = newPrice;
          if (newPrice < lastCandle.low) lastCandle.low = newPrice;
        }
      }
    }, 3000);
  }

  public getSupportedInstruments(): Instrument[] {
    return SUPPORTED_INSTRUMENTS;
  }

  public getInstrument(symbol: string): Instrument | undefined {
    return SUPPORTED_INSTRUMENTS.find(i => i.symbol === symbol);
  }

  public getQuote(symbol: string): MarketQuote | undefined {
    const quote = this.latestQuotes.get(symbol);
    if (!quote) return undefined;
    // Check staleness (if older than 30s)
    const isStale = Date.now() - quote.timestamp > 30000;
    return { ...quote, isStale };
  }

  public getAllQuotes(): MarketQuote[] {
    return Array.from(this.latestQuotes.values()).map(q => ({
      ...q,
      isStale: Date.now() - q.timestamp > 30000,
    }));
  }

  public getCandles(symbol: string, limit: number = 100): CandleOHLCV[] {
    const bars = this.candlesBySymbol.get(symbol) || [];
    return bars.slice(-limit);
  }

  public getCandleProvenance(symbol: string): {
    provider: string | null;
    quality: MarketQuote['quality'];
    latestTimestamp: number | null;
  } {
    const candles = this.candlesBySymbol.get(symbol);
    return {
      provider: candles?.length ? 'Local Paper Simulator' : null,
      quality: candles?.length ? 'SIMULATED' : 'UNAVAILABLE',
      latestTimestamp: candles?.[candles.length - 1]?.time ?? null,
    };
  }

  public classifyMarketRegime(symbol: string): MarketRegimeType {
    const candles = this.getCandles(symbol, 30);
    if (candles.length < 20) return 'UNCERTAIN_SHOCK';

    const latest = candles[candles.length - 1];
    const ind = latest.indicators;
    if (!ind) return 'RANGING_LOW_VOL';

    const adx = ind.adx14 || 20;
    const rsi = ind.rsi14 || 50;
    const vol = ind.volatility || 1.0;
    const ema20 = ind.ema20 || latest.close;
    const ema50 = ind.ema50 || latest.close;

    if (vol > 3.5) {
      return 'UNCERTAIN_SHOCK';
    }

    if (adx >= 25) {
      if (latest.close > ema20 && ema20 > ema50 && rsi > 52) {
        return 'TRENDING_BULL';
      }
      if (latest.close < ema20 && ema20 < ema50 && rsi < 48) {
        return 'TRENDING_BEAR';
      }
    }

    if (vol < 1.2) {
      return 'RANGING_LOW_VOL';
    }

    return 'RANGING_HIGH_VOL';
  }
}

export const marketDataService = new MarketDataService();
