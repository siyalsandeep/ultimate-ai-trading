import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Order,
  Position,
  PortfolioSummary,
  RiskLimits,
  AuditLogEntry,
  StrategyConfig,
  ClosedTradeRecord,
  CooldownState,
} from '../../src/types/trading';
import type { PersistedRiskSafetyState } from '../risk/risk-engine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');

interface StorageServiceOptions {
  dataDirectory?: string;
  writeFile?: (filePath: string, contents: string, encoding: BufferEncoding) => Promise<void>;
  rename?: (fromPath: string, toPath: string) => Promise<void>;
}

export interface PersistedAppState {
  version: string;
  lastSavedAt: number;
  portfolio: {
    totalEquity: number;
    cashBalance: number;
    startOfDayEquity: number;
    realizedPnLToday: number;
    peakEquity: number;
  };
  positions: Position[];
  orders: Order[];
  pendingOrderIntents?: PersistedOrderIntent[];
  closedTrades?: ClosedTradeRecord[];
  consecutiveLossesByStrategy?: Record<string, number>;
  accountConsecutiveLosses?: number;
  cooldowns?: Record<string, CooldownState>;
  riskSafetyState?: PersistedRiskSafetyState;
  riskLimits: RiskLimits;
  quarantinedStrategies: string[];
  suspendedInstruments: string[];
  isolatedBrokers: string[];
  auditLogs: AuditLogEntry[];
  lastReconciliationAt: number;
}

export interface PersistedOrderIntent {
  clientOrderId: string;
  intent: unknown;
  status: 'PENDING_ACK' | 'UNCERTAIN';
  timestamp: number;
}

export class StorageService {
  private activeSavePromise: Promise<boolean> | null = null;
  private readonly dataDirectory: string;
  private readonly stateFile: string;
  private readonly tempFile: string;
  private readonly writeFile: NonNullable<StorageServiceOptions['writeFile']>;
  private readonly rename: NonNullable<StorageServiceOptions['rename']>;

  constructor(options: StorageServiceOptions = {}) {
    this.dataDirectory = options.dataDirectory || DEFAULT_DATA_DIR;
    this.stateFile = path.join(this.dataDirectory, 'app_state.json');
    this.tempFile = path.join(this.dataDirectory, 'app_state.tmp.json');
    this.writeFile = options.writeFile || ((filePath, contents, encoding) =>
      fs.promises.writeFile(filePath, contents, encoding).then(() => undefined));
    this.rename = options.rename || ((fromPath, toPath) => fs.promises.rename(fromPath, toPath));
    this.ensureDataDirectory();
  }

  private ensureDataDirectory(): void {
    if (!fs.existsSync(this.dataDirectory)) {
      fs.mkdirSync(this.dataDirectory, { recursive: true });
    }
  }

  /**
   * Atomically save app state to disk to prevent corruption during unexpected shutdowns
   */
  public async saveState(state: Omit<PersistedAppState, 'version' | 'lastSavedAt'>): Promise<boolean> {
    while (this.activeSavePromise) {
      await this.activeSavePromise;
    }

    const doWrite = async (): Promise<boolean> => {
      try {
        this.ensureDataDirectory();
        const payload: PersistedAppState = {
          version: '1.2.0',
          lastSavedAt: Date.now(),
          ...state,
        };

        const jsonStr = JSON.stringify(payload, null, 2);
        // Write to temp file first, then atomic rename
        await this.writeFile(this.tempFile, jsonStr, 'utf-8');
        await this.rename(this.tempFile, this.stateFile);
        return true;
      } catch (err) {
        console.error('Failed to persist trading state to disk:', err);
        return false;
      }
    };

    this.activeSavePromise = doWrite().finally(() => {
      this.activeSavePromise = null;
    });

    return this.activeSavePromise;
  }

  /**
   * Load and validate persisted trading state from disk
   */
  public loadState(): PersistedAppState | null {
    try {
      this.ensureDataDirectory();
      if (!fs.existsSync(this.stateFile)) {
        return null;
      }

      const raw = fs.readFileSync(this.stateFile, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedAppState;

      // Validate critical properties
      if (!parsed.portfolio || typeof parsed.portfolio.totalEquity !== 'number') {
        console.warn('Persisted state corrupted: missing valid portfolio.');
        return null;
      }

      if (!Array.isArray(parsed.positions) || !Array.isArray(parsed.orders)) {
        console.warn('Persisted state corrupted: invalid positions or orders array.');
        return null;
      }

      if (
        parsed.pendingOrderIntents !== undefined &&
        (!Array.isArray(parsed.pendingOrderIntents) ||
          parsed.pendingOrderIntents.some((record) =>
            !record ||
            typeof record.clientOrderId !== 'string' ||
            !record.clientOrderId ||
            !['PENDING_ACK', 'UNCERTAIN'].includes(record.status) ||
            !Number.isFinite(record.timestamp)
          ))
      ) {
        console.warn('Persisted state corrupted: invalid pending order intents.');
        return null;
      }

      return parsed;
    } catch (err) {
      console.error('Error reading persisted state file:', err);
      return null;
    }
  }

  public getStorageHealth(): {
    exists: boolean;
    path: string;
    lastSavedAt: number | null;
    fileSizeBytes: number;
  } {
    try {
      if (fs.existsSync(this.stateFile)) {
        const stats = fs.statSync(this.stateFile);
        return {
          exists: true,
          path: this.stateFile,
          lastSavedAt: stats.mtimeMs,
          fileSizeBytes: stats.size,
        };
      }
    } catch {
      // Ignore
    }
    return {
      exists: false,
      path: this.stateFile,
      lastSavedAt: null,
      fileSizeBytes: 0,
    };
  }
}

export const storageService = new StorageService();
