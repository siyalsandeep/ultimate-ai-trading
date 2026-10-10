import { MarketPriceSnapshot } from '../../src/types/trading';

const FINNHUB_SYMBOLS: Record<string, string> = {
  SPY: 'SPY',
  QQQ: 'QQQ',
  AAPL: 'AAPL',
  NVDA: 'NVDA',
  MSFT: 'MSFT',
};

interface FinnhubQuoteResponse {
  c?: number;
  dp?: number;
  t?: number;
}

interface StoredSnapshot {
  lastPrice: number;
  changePct: number | null;
  sourceTimestamp: number;
  receiptTimestamp: number;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface FinnhubSnapshotProviderOptions {
  apiKey?: string;
  pollIntervalMs?: number;
  maxQuoteAgeMs?: number;
  now?: () => number;
  fetcher?: Fetcher;
}

const MIN_POLL_INTERVAL_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_MAX_QUOTE_AGE_MS = 120_000;

function positiveInteger(value: string | undefined, fallback: number, minimum: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

export class FinnhubSnapshotProvider {
  private readonly apiKey: string | undefined;
  private readonly pollIntervalMs: number;
  private readonly maxQuoteAgeMs: number;
  private readonly now: () => number;
  private readonly fetcher: Fetcher;
  private readonly snapshots = new Map<string, StoredSnapshot>();
  private readonly errors = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: FinnhubSnapshotProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.FINNHUB_API_KEY;
    this.pollIntervalMs = options.pollIntervalMs ?? positiveInteger(
      process.env.FINNHUB_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      MIN_POLL_INTERVAL_MS,
    );
    this.maxQuoteAgeMs = options.maxQuoteAgeMs ?? positiveInteger(
      process.env.FINNHUB_MAX_QUOTE_AGE_MS,
      DEFAULT_MAX_QUOTE_AGE_MS,
      1,
    );
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetcher ?? fetch;
  }

  public start(): void {
    if (!this.apiKey || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.pollIntervalMs);
  }

  public async refresh(): Promise<void> {
    if (!this.apiKey) return;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.refreshMappedSymbols().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  public getSnapshots(symbols: string[]): MarketPriceSnapshot[] {
    const now = this.now();
    return symbols.map((symbol) => {
      const providerSymbol = FINNHUB_SYMBOLS[symbol];
      const stored = this.snapshots.get(symbol);
      const error = this.errors.get(symbol);

      if (!providerSymbol) {
        return this.unavailable(symbol, 'No authorized provider mapping is configured for this instrument.');
      }
      if (!this.apiKey) {
        return this.unavailable(symbol, 'Finnhub API credentials are not configured.');
      }
      if (!stored) {
        return this.unavailable(symbol, error || 'Waiting for the first provider snapshot.');
      }

      const quoteAgeMs = Math.max(0, now - stored.sourceTimestamp);
      const isStale = quoteAgeMs > this.maxQuoteAgeMs || Boolean(error);
      return {
        symbol,
        provider: 'Finnhub',
        providerSymbol,
        status: 'SNAPSHOT',
        connectionState: error ? 'DEGRADED' : 'CONNECTED',
        lastPrice: stored.lastPrice,
        bid: null,
        ask: null,
        spread: null,
        changePct: stored.changePct,
        sourceTimestamp: stored.sourceTimestamp,
        receiptTimestamp: stored.receiptTimestamp,
        quoteAgeMs,
        isStale,
        error: error || (quoteAgeMs > this.maxQuoteAgeMs ? 'Provider snapshot exceeded the configured freshness limit.' : null),
      };
    });
  }

  private unavailable(symbol: string, reason: string): MarketPriceSnapshot {
    return {
      symbol,
      provider: FINNHUB_SYMBOLS[symbol] ? 'Finnhub' : null,
      providerSymbol: FINNHUB_SYMBOLS[symbol] || null,
      status: 'UNAVAILABLE',
      connectionState: this.apiKey ? 'UNAVAILABLE' : 'UNCONFIGURED',
      lastPrice: null,
      bid: null,
      ask: null,
      spread: null,
      changePct: null,
      sourceTimestamp: null,
      receiptTimestamp: null,
      quoteAgeMs: null,
      isStale: true,
      error: reason,
    };
  }

  private async refreshMappedSymbols(): Promise<void> {
    for (const [symbol, providerSymbol] of Object.entries(FINNHUB_SYMBOLS)) {
      try {
        const url = new URL('https://finnhub.io/api/v1/quote');
        url.searchParams.set('symbol', providerSymbol);
        const response = await this.fetcher(url.toString(), {
          headers: { 'X-Finnhub-Token': this.apiKey || '' },
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) {
          this.errors.set(symbol, `Finnhub request failed with HTTP ${response.status}.`);
          continue;
        }

        const payload = await response.json() as FinnhubQuoteResponse;
        const sourceTimestamp = typeof payload.t === 'number' ? payload.t * 1000 : NaN;
        const receiptTimestamp = this.now();
        if (
          typeof payload.c !== 'number' ||
          !Number.isFinite(payload.c) ||
          payload.c <= 0 ||
          !Number.isSafeInteger(payload.t) ||
          !Number.isFinite(sourceTimestamp) ||
          sourceTimestamp <= 0 ||
          sourceTimestamp > receiptTimestamp
        ) {
          this.errors.set(symbol, 'Finnhub returned an empty, invalid, or future-dated quote.');
          continue;
        }

        const previous = this.snapshots.get(symbol);
        if (previous && sourceTimestamp <= previous.sourceTimestamp) {
          this.errors.set(symbol, 'Duplicate or out-of-order provider timestamp; retained the last valid snapshot.');
          continue;
        }

        this.snapshots.set(symbol, {
          lastPrice: payload.c,
          changePct: typeof payload.dp === 'number' && Number.isFinite(payload.dp) ? payload.dp : null,
          sourceTimestamp,
          receiptTimestamp,
        });
        this.errors.delete(symbol);
      } catch {
        this.errors.set(symbol, 'Provider request failed; the last valid snapshot, if any, was retained.');
      }
    }
  }
}
