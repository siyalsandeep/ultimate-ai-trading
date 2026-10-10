import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { isValidMt5SymbolRequest } from './mt5-read-only-connector';
import type {
  Mt5ReadOnlyConnectionState,
  Mt5ReadOnlyConnector,
} from './mt5-read-only-connector';

const connectorDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CAPTURE_DIRECTORY = path.resolve(connectorDirectory, '../../data/mt5-shadow-captures');
const MAX_CAPTURE_LIST_LIMIT = 100;

export interface Mt5ShadowSymbolObservation {
  symbol: string;
  sourceTimestamp: number | null;
  receiptTimestamp: number | null;
  quoteAgeMs: number | null;
  freshness: 'FRESH' | 'STALE' | 'UNAVAILABLE' | 'NOT_RETURNED';
  gap: 'NONE' | 'STALE_QUOTE' | 'QUOTE_UNAVAILABLE' | 'SYMBOL_NOT_RETURNED';
}

export interface Mt5ShadowCaptureRecord {
  id: string;
  capturedAt: number;
  source: 'LOCAL_MT5_TERMINAL';
  provenance: 'BROKER_CONFIRMED' | 'UNAVAILABLE';
  connectionStatus: Mt5ReadOnlyConnectionState['status'];
  status: 'OBSERVATION_ONLY' | 'INCOMPLETE' | 'UNAVAILABLE';
  broker: string | null;
  server: string | null;
  maskedAccountId: string | null;
  accountType: 'DEMO' | 'REAL' | 'CONTEST' | 'UNKNOWN' | null;
  requestedSymbols: string[];
  observations: Mt5ShadowSymbolObservation[];
  gaps: string[];
  cadence: {
    kind: 'MANUAL';
    expectedIntervalMs: null;
    assessment: 'NOT_ASSESSABLE_WITHOUT_SCHEDULE';
  };
  strategyPredictions: {
    status: 'NOT_CAPTURED';
    reason: string;
  };
  reconciliation: {
    status: 'POINT_IN_TIME_ONLY';
    accountSnapshot: boolean;
    openPositions: boolean;
    pendingOrders: boolean;
    historicalDeals: false;
    historicalOrders: false;
    crossSnapshotReconciliation: false;
  };
  snapshot: Mt5ReadOnlyConnectionState['snapshot'];
  tradingEnabled: false;
  automatedTradingEnabled: false;
}

interface CaptureStoreOptions {
  directory?: string;
  writeFile?: (filePath: string, contents: string) => Promise<void>;
  rename?: (fromPath: string, toPath: string) => Promise<void>;
  readFile?: (filePath: string) => Promise<string>;
  readDirectory?: (directory: string) => Promise<string[]>;
}

export class Mt5ShadowCaptureStore {
  private readonly directory: string;
  private readonly writeFile: NonNullable<CaptureStoreOptions['writeFile']>;
  private readonly rename: NonNullable<CaptureStoreOptions['rename']>;
  private readonly readFile: NonNullable<CaptureStoreOptions['readFile']>;
  private readonly readDirectory: NonNullable<CaptureStoreOptions['readDirectory']>;

  constructor(options: CaptureStoreOptions = {}) {
    this.directory = options.directory ?? DEFAULT_CAPTURE_DIRECTORY;
    this.writeFile = options.writeFile ?? ((filePath, contents) =>
      fs.promises.writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' }));
    this.rename = options.rename ?? ((fromPath, toPath) => fs.promises.rename(fromPath, toPath));
    this.readFile = options.readFile ?? ((filePath) =>
      fs.promises.readFile(filePath, 'utf8'));
    this.readDirectory = options.readDirectory ?? ((directory) =>
      fs.promises.readdir(directory));
  }

  public async save(record: Mt5ShadowCaptureRecord): Promise<void> {
    await fs.promises.mkdir(this.directory, { recursive: true });
    const fileName = `${String(record.capturedAt).padStart(13, '0')}-${record.id}.json`;
    const destination = path.join(this.directory, fileName);
    const temporary = `${destination}.tmp`;
    await this.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
    try {
      await this.rename(temporary, destination);
    } catch (error) {
      try {
        await fs.promises.unlink(temporary);
      } catch (cleanupError) {
        console.error('Failed to remove incomplete MT5 shadow capture file:', cleanupError);
      }
      throw error;
    }
  }

  public async getRecent(limit = 25): Promise<Mt5ShadowCaptureRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CAPTURE_LIST_LIMIT) {
      throw new Error(`Capture list limit must be between 1 and ${MAX_CAPTURE_LIST_LIMIT}.`);
    }

    let names: string[];
    try {
      names = await this.readDirectory(this.directory);
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return [];
      throw error;
    }

    const files = names
      .filter((name) => /^\d{13}-[0-9a-f-]{36}\.json$/i.test(name))
      .sort()
      .reverse()
      .slice(0, limit);
    const captures: Mt5ShadowCaptureRecord[] = [];
    for (const name of files) {
      const record = JSON.parse(await this.readFile(path.join(this.directory, name))) as Mt5ShadowCaptureRecord;
      if (
        !record ||
        typeof record.id !== 'string' ||
        !Number.isFinite(record.capturedAt) ||
        !Array.isArray(record.observations) ||
        !Array.isArray(record.gaps) ||
        record.tradingEnabled !== false ||
        record.automatedTradingEnabled !== false
      ) {
        throw new Error(`Invalid MT5 shadow capture record: ${name}`);
      }
      captures.push(record);
    }
    return captures;
  }
}

export class Mt5ShadowCaptureService {
  private readonly connector: Pick<Mt5ReadOnlyConnector, 'testReadOnlyConnection'>;
  private readonly store: Mt5ShadowCaptureStore;
  private readonly now: () => number;

  constructor(
    connector: Pick<Mt5ReadOnlyConnector, 'testReadOnlyConnection'>,
    store = new Mt5ShadowCaptureStore(),
    now: () => number = Date.now
  ) {
    this.connector = connector;
    this.store = store;
    this.now = now;
  }

  public async capture(symbols: unknown): Promise<Mt5ShadowCaptureRecord> {
    if (!isValidMt5SymbolRequest(symbols)) {
      throw new Error('Provide between 1 and 10 valid MT5 symbol names.');
    }

    const requestedSymbols = [...new Set(symbols)];
    const state = await this.connector.testReadOnlyConnection(requestedSymbols);
    const snapshot = state.snapshot;
    const capturedAt = snapshot?.capturedAt ?? state.testedAt ?? this.now();
    const snapshotSymbols = new Map((snapshot?.symbols ?? []).map((symbol) => [symbol.symbol, symbol]));
    const observations = requestedSymbols.map((symbol): Mt5ShadowSymbolObservation => {
      const detail = snapshotSymbols.get(symbol);
      if (!detail) {
        return {
          symbol,
          sourceTimestamp: null,
          receiptTimestamp: null,
          quoteAgeMs: null,
          freshness: 'NOT_RETURNED',
          gap: 'SYMBOL_NOT_RETURNED',
        };
      }
      return {
        symbol,
        sourceTimestamp: detail.sourceTimestamp,
        receiptTimestamp: detail.receiptTimestamp,
        quoteAgeMs: detail.quoteAgeMs,
        freshness: detail.quoteStatus,
        gap: detail.quoteStatus === 'FRESH'
          ? 'NONE'
          : detail.quoteStatus === 'STALE'
            ? 'STALE_QUOTE'
            : 'QUOTE_UNAVAILABLE',
      };
    });
    const gaps = observations
      .filter((observation) => observation.gap !== 'NONE')
      .map((observation) => `${observation.symbol}:${observation.gap}`);
    const allFresh = state.status === 'CONNECTED' &&
      observations.length === requestedSymbols.length &&
      observations.every((observation) => observation.freshness === 'FRESH');
    const record: Mt5ShadowCaptureRecord = {
      id: randomUUID(),
      capturedAt,
      source: 'LOCAL_MT5_TERMINAL',
      provenance: snapshot?.provenance ?? 'UNAVAILABLE',
      connectionStatus: state.status,
      status: !snapshot
        ? 'UNAVAILABLE'
        : allFresh
          ? 'OBSERVATION_ONLY'
          : 'INCOMPLETE',
      broker: snapshot?.broker ?? null,
      server: snapshot?.server ?? null,
      maskedAccountId: snapshot?.maskedAccountId ?? null,
      accountType: snapshot?.accountType ?? null,
      requestedSymbols,
      observations,
      gaps,
      cadence: {
        kind: 'MANUAL',
        expectedIntervalMs: null,
        assessment: 'NOT_ASSESSABLE_WITHOUT_SCHEDULE',
      },
      strategyPredictions: {
        status: 'NOT_CAPTURED',
        reason: 'The strategy engine consumes simulated candles; no broker-derived candle/prediction pairing is available.',
      },
      reconciliation: {
        status: 'POINT_IN_TIME_ONLY',
        accountSnapshot: snapshot !== null,
        openPositions: snapshot !== null,
        pendingOrders: snapshot !== null,
        historicalDeals: false,
        historicalOrders: false,
        crossSnapshotReconciliation: false,
      },
      snapshot,
      tradingEnabled: false,
      automatedTradingEnabled: false,
    };
    await this.store.save(record);
    return record;
  }

  public getRecent(limit = 25): Promise<Mt5ShadowCaptureRecord[]> {
    return this.store.getRecent(limit);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
