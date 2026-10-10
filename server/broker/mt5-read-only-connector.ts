import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { auditLogger } from '../audit/audit-logger';

const execFileAsync = promisify(execFile);
const connectorDirectory = path.dirname(fileURLToPath(import.meta.url));

export type Mt5ConnectionStatus =
  | 'NOT_TESTED'
  | 'CONNECTED'
  | 'STALE'
  | 'DISCONNECTED'
  | 'AUTHENTICATION_REQUIRED'
  | 'IDENTITY_MISMATCH'
  | 'UNAVAILABLE';

export interface Mt5ReadOnlySymbolSnapshot {
  symbol: string;
  description: string;
  digits: number;
  point: number | null;
  tradeTickSize: number | null;
  tradeTickValue: number | null;
  contractSize: number | null;
  volumeMinimum: number | null;
  volumeMaximum: number | null;
  volumeStep: number | null;
  stopsLevelPoints: number | null;
  freezeLevelPoints: number | null;
  profitCurrency: string;
  marginCurrency: string;
  tradeMode: string;
  orderMode: number | null;
  executionMode: number | null;
  fillingMode: number | null;
  expirationMode: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  sourceTimestamp: number | null;
  receiptTimestamp: number;
  quoteAgeMs: number | null;
  quoteStatus: 'FRESH' | 'STALE' | 'UNAVAILABLE';
}

export interface Mt5TradingPermissions {
  terminalTradeAllowed: boolean | null;
  terminalTradeApiDisabled: boolean | null;
  accountTradeAllowed: boolean | null;
  accountExpertTradingAllowed: boolean | null;
}

export interface Mt5ReadOnlyPosition {
  ticket: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  currentPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number;
  swap: number;
  commission: number | null;
}

export interface Mt5ReadOnlyPendingOrder {
  ticket: string;
  symbol: string;
  type: string;
  volume: number;
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  setupTime: number | null;
}

export interface Mt5ReadOnlySnapshot {
  broker: string;
  server: string;
  maskedAccountId: string;
  currency: string;
  accountType: 'DEMO' | 'REAL' | 'CONTEST' | 'UNKNOWN';
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevelPct: number | null;
  tradingPermissions: Mt5TradingPermissions;
  positions: Mt5ReadOnlyPosition[];
  pendingOrders: Mt5ReadOnlyPendingOrder[];
  availableSymbols: string[];
  symbolsTruncated: boolean;
  unavailableSymbols: string[];
  symbols: Mt5ReadOnlySymbolSnapshot[];
  capturedAt: number;
  provenance: 'BROKER_CONFIRMED';
  tradingEnabled: false;
}

export interface Mt5ReadOnlyConnectionState {
  method: 'LOCAL_LOGGED_IN_MT5_TERMINAL';
  status: Mt5ConnectionStatus;
  message: string;
  testedAt: number | null;
  snapshot: Mt5ReadOnlySnapshot | null;
  automatedTradingEnabled: false;
}

interface BridgeFailure {
  ok: false;
  code:
    | 'TERMINAL_UNAVAILABLE'
    | 'TERMINAL_DISCONNECTED'
    | 'AUTHENTICATION_REQUIRED'
    | 'ACCOUNT_DATA_INCOMPLETE'
    | 'NOT_XM_GLOBAL'
    | 'NOT_DEMO_ACCOUNT'
    | 'ACCOUNT_IDENTITY_CHANGED';
}

interface BridgeSuccess {
  ok: true;
  broker: string;
  server: string;
  login: number;
  currency: string;
  accountType: Mt5ReadOnlySnapshot['accountType'];
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevelPct: number | null;
  tradingPermissions: Mt5TradingPermissions;
  positions: Mt5ReadOnlyPosition[];
  pendingOrders: Mt5ReadOnlyPendingOrder[];
  availableSymbols: string[];
  symbolsTruncated: boolean;
  unavailableSymbols: string[];
  symbols: Mt5ReadOnlySymbolSnapshot[];
}

type BridgePayload = BridgeFailure | BridgeSuccess;
type BridgeRunner = (pythonExecutable: string, args: string[]) => Promise<string>;

interface Mt5ConnectorOptions {
  runner?: BridgeRunner;
  pythonExecutable?: string;
  terminalPath?: string;
  now?: () => number;
  maxSnapshotAgeMs?: number;
}

const MAX_SYMBOLS_PER_REQUEST = 10;
const SYMBOL_NAME_PATTERN = /^[A-Za-z0-9._#$@!+-]{1,32}$/;
const MAX_SYMBOL_INVENTORY = 2500;

export function isValidMt5SymbolRequest(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const symbols = [...new Set(value)];
  return symbols.length > 0 &&
    symbols.length <= MAX_SYMBOLS_PER_REQUEST &&
    symbols.every((symbol) => typeof symbol === 'string' && SYMBOL_NAME_PATTERN.test(symbol));
}

const FAILURE_MESSAGES: Record<BridgeFailure['code'], { status: Mt5ConnectionStatus; message: string }> = {
  TERMINAL_UNAVAILABLE: {
    status: 'UNAVAILABLE',
    message: 'MetaTrader 5 could not be reached on this computer. Install and open the desktop terminal, then retry.',
  },
  TERMINAL_DISCONNECTED: {
    status: 'DISCONNECTED',
    message: 'The MT5 terminal is open but disconnected. Reconnect it, then refresh this read-only check.',
  },
  AUTHENTICATION_REQUIRED: {
    status: 'AUTHENTICATION_REQUIRED',
    message: 'MT5 reports no authenticated account. Sign in or renew the session in the terminal; never enter its password here.',
  },
  ACCOUNT_DATA_INCOMPLETE: {
    status: 'UNAVAILABLE',
    message: 'MT5 did not provide a complete broker, server, account, and currency identity. No account snapshot is shown.',
  },
  NOT_XM_GLOBAL: {
    status: 'IDENTITY_MISMATCH',
    message: 'The logged-in terminal does not identify an XM Global broker/server. No account values were accepted; select the intended XM Global demo account in MT5.',
  },
  NOT_DEMO_ACCOUNT: {
    status: 'IDENTITY_MISMATCH',
    message: 'MT5 reports this is not a demo account. No account values were accepted; select the XM Global demo account in MT5.',
  },
  ACCOUNT_IDENTITY_CHANGED: {
    status: 'IDENTITY_MISMATCH',
    message: 'The terminal account or server changed after verification. Data is blocked to prevent silently switching accounts; restart the local app after confirming the intended XM Global demo login.',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function requiredString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validatePosition(value: unknown): value is Mt5ReadOnlyPosition {
  return isRecord(value) &&
    requiredString(value.ticket) &&
    requiredString(value.symbol) &&
    (value.side === 'BUY' || value.side === 'SELL') &&
    finite(value.volume) &&
    finite(value.openPrice) &&
    finite(value.currentPrice) &&
    (value.stopLoss === null || finite(value.stopLoss)) &&
    (value.takeProfit === null || finite(value.takeProfit)) &&
    finite(value.profit) &&
    finite(value.swap) &&
    (value.commission === null || finite(value.commission));
}

function validatePendingOrder(value: unknown): value is Mt5ReadOnlyPendingOrder {
  return isRecord(value) &&
    requiredString(value.ticket) &&
    requiredString(value.symbol) &&
    requiredString(value.type) &&
    finite(value.volume) &&
    finite(value.price) &&
    (value.stopLoss === null || finite(value.stopLoss)) &&
    (value.takeProfit === null || finite(value.takeProfit)) &&
    (value.setupTime === null || finite(value.setupTime));
}

function validateSymbol(value: unknown): value is Mt5ReadOnlySymbolSnapshot {
  const optionalFinite = (field: unknown) => field === null || finite(field);
  return isRecord(value) &&
    requiredString(value.symbol) &&
    requiredString(value.description) &&
    Number.isInteger(value.digits) &&
    optionalFinite(value.point) &&
    optionalFinite(value.tradeTickSize) &&
    optionalFinite(value.tradeTickValue) &&
    optionalFinite(value.contractSize) &&
    optionalFinite(value.volumeMinimum) &&
    optionalFinite(value.volumeMaximum) &&
    optionalFinite(value.volumeStep) &&
    optionalFinite(value.stopsLevelPoints) &&
    optionalFinite(value.freezeLevelPoints) &&
    requiredString(value.profitCurrency) &&
    requiredString(value.marginCurrency) &&
    requiredString(value.tradeMode) &&
    optionalFinite(value.orderMode) &&
    optionalFinite(value.executionMode) &&
    optionalFinite(value.fillingMode) &&
    optionalFinite(value.expirationMode) &&
    (value.bid === null || finite(value.bid)) &&
    (value.ask === null || finite(value.ask)) &&
    (value.last === null || finite(value.last)) &&
    (value.sourceTimestamp === null || finite(value.sourceTimestamp)) &&
    finite(value.receiptTimestamp) &&
    (value.quoteAgeMs === null || finite(value.quoteAgeMs)) &&
    (value.quoteStatus === 'FRESH' || value.quoteStatus === 'STALE' || value.quoteStatus === 'UNAVAILABLE');
}

function optionalBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

function validateBridgePayload(value: unknown): BridgePayload {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('INVALID_BRIDGE_RESPONSE');
  }
  if (!value.ok) {
    if (
      value.code === 'TERMINAL_UNAVAILABLE' ||
      value.code === 'TERMINAL_DISCONNECTED' ||
      value.code === 'AUTHENTICATION_REQUIRED' ||
      value.code === 'ACCOUNT_DATA_INCOMPLETE' ||
      value.code === 'NOT_XM_GLOBAL' ||
      value.code === 'NOT_DEMO_ACCOUNT' ||
      value.code === 'ACCOUNT_IDENTITY_CHANGED'
    ) {
      return { ok: false, code: value.code };
    }
    throw new Error('INVALID_BRIDGE_RESPONSE');
  }

  if (
    !requiredString(value.broker) ||
    !requiredString(value.server) ||
    !finite(value.login) ||
    value.login <= 0 ||
    !Number.isInteger(value.login) ||
    !requiredString(value.currency) ||
    !['DEMO', 'REAL', 'CONTEST', 'UNKNOWN'].includes(String(value.accountType)) ||
    !finite(value.balance) ||
    !finite(value.equity) ||
    !finite(value.margin) ||
    !finite(value.freeMargin) ||
    !(value.marginLevelPct === null || finite(value.marginLevelPct)) ||
    !isRecord(value.tradingPermissions) ||
    !optionalBoolean(value.tradingPermissions.terminalTradeAllowed) ||
    !optionalBoolean(value.tradingPermissions.terminalTradeApiDisabled) ||
    !optionalBoolean(value.tradingPermissions.accountTradeAllowed) ||
    !optionalBoolean(value.tradingPermissions.accountExpertTradingAllowed) ||
    !Array.isArray(value.positions) ||
    !value.positions.every(validatePosition) ||
    !Array.isArray(value.pendingOrders) ||
    !value.pendingOrders.every(validatePendingOrder) ||
    !Array.isArray(value.availableSymbols) ||
    value.availableSymbols.length > MAX_SYMBOL_INVENTORY ||
    !value.availableSymbols.every(requiredString) ||
    typeof value.symbolsTruncated !== 'boolean' ||
    !Array.isArray(value.unavailableSymbols) ||
    !value.unavailableSymbols.every(requiredString) ||
    !Array.isArray(value.symbols) ||
    value.symbols.length > MAX_SYMBOLS_PER_REQUEST ||
    !value.symbols.every(validateSymbol)
  ) {
    throw new Error('INVALID_BRIDGE_RESPONSE');
  }

  return value as unknown as BridgeSuccess;
}

function maskAccountId(login: number): string {
  const accountId = String(login);
  return `••••${accountId.slice(-4)}`;
}

export function isLoopbackMt5Client(
  remoteAddress: string | undefined,
  hasForwardedClientAddress = false
): boolean {
  return !hasForwardedClientAddress && (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

function defaultRunner(pythonExecutable: string, args: string[]): Promise<string> {
  return execFileAsync(pythonExecutable, args, {
    timeout: 12000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  }).then(({ stdout }) => stdout);
}

export class Mt5ReadOnlyConnector {
  private state: Mt5ReadOnlyConnectionState = {
    method: 'LOCAL_LOGGED_IN_MT5_TERMINAL',
    status: 'NOT_TESTED',
    message: 'No MT5 connection test has been run.',
    testedAt: null,
    snapshot: null,
    automatedTradingEnabled: false,
  };

  private readonly runner: BridgeRunner;
  private readonly pythonExecutable: string;
  private readonly terminalPath?: string;
  private readonly now: () => number;
  private readonly maxSnapshotAgeMs: number;
  private verifiedIdentity: string | null = null;

  constructor(options: Mt5ConnectorOptions = {}) {
    this.runner = options.runner ?? defaultRunner;
    this.pythonExecutable = options.pythonExecutable ?? process.env.MT5_PYTHON_EXECUTABLE ?? 'python';
    this.terminalPath = options.terminalPath ?? process.env.MT5_TERMINAL_PATH;
    this.now = options.now ?? Date.now;
    this.maxSnapshotAgeMs = options.maxSnapshotAgeMs ?? 30000;
  }

  public getStatus(): Mt5ReadOnlyConnectionState {
    const now = this.now();
    if (
      this.state.status === 'CONNECTED' &&
      this.state.snapshot &&
      now - this.state.snapshot.capturedAt > this.maxSnapshotAgeMs
    ) {
      return this.copyStateWithSnapshot(this.state, 'STALE', 'The last broker-confirmed snapshot is stale. Refresh before relying on these values.', now);
    }
    return this.copyStateWithSnapshot(this.state, this.state.status, this.state.message, now);
  }

  private copyStateWithSnapshot(
    state: Mt5ReadOnlyConnectionState,
    status: Mt5ConnectionStatus,
    message: string,
    now: number
  ): Mt5ReadOnlyConnectionState {
    return {
      ...state,
      status,
      message,
      snapshot: state.snapshot
        ? {
            ...state.snapshot,
            tradingPermissions: { ...state.snapshot.tradingPermissions },
            positions: state.snapshot.positions.map((position) => ({ ...position })),
            pendingOrders: state.snapshot.pendingOrders.map((order) => ({ ...order })),
            availableSymbols: [...state.snapshot.availableSymbols],
            unavailableSymbols: [...state.snapshot.unavailableSymbols],
            symbols: state.snapshot.symbols.map((symbol) => {
              const measuredAge = symbol.sourceTimestamp === null
                ? null
                : now - symbol.sourceTimestamp;
              const quoteAgeMs = measuredAge !== null && measuredAge >= 0 ? measuredAge : null;
              const validQuote = symbol.bid !== null &&
                symbol.ask !== null &&
                symbol.ask >= symbol.bid &&
                quoteAgeMs !== null;
              return {
                ...symbol,
                quoteAgeMs,
                quoteStatus: !validQuote
                  ? 'UNAVAILABLE' as const
                  : quoteAgeMs <= this.maxSnapshotAgeMs
                    ? 'FRESH' as const
                    : 'STALE' as const,
              };
            }),
          }
        : null,
    };
  }

  public async testReadOnlyConnection(requestedSymbols: unknown[] = []): Promise<Mt5ReadOnlyConnectionState> {
    const testedAt = this.now();
    let result: Mt5ReadOnlyConnectionState;
    try {
      const symbols = [...new Set(requestedSymbols)];
      if (
        symbols.length > MAX_SYMBOLS_PER_REQUEST ||
        symbols.some((symbol) => typeof symbol !== 'string' || !SYMBOL_NAME_PATTERN.test(symbol))
      ) {
        throw new Error('INVALID_SYMBOL_REQUEST');
      }
      const scriptPath = path.join(connectorDirectory, 'mt5_read_only_bridge.py');
      const args = [scriptPath, this.terminalPath ?? '', JSON.stringify(symbols)];
      const output = await this.runner(this.pythonExecutable, args);
      const payload = validateBridgePayload(JSON.parse(output) as unknown);
      if (!payload.ok) {
        const failure = FAILURE_MESSAGES[payload.code];
        result = {
          ...this.state,
          status: failure.status,
          message: failure.message,
          testedAt,
          ...(payload.code === 'NOT_XM_GLOBAL' ||
            payload.code === 'NOT_DEMO_ACCOUNT' ||
            payload.code === 'ACCOUNT_IDENTITY_CHANGED'
            ? { snapshot: null }
            : {}),
        };
      } else {
        const brokerName = payload.broker.toLowerCase();
        const identityFailure: BridgeFailure['code'] | null = !(
          (brokerName.includes('xm') && brokerName.includes('global')) ||
          payload.server.toLowerCase().replace(/[\s-]/g, '').includes('xmglobal')
        )
          ? 'NOT_XM_GLOBAL'
          : payload.accountType !== 'DEMO'
            ? 'NOT_DEMO_ACCOUNT'
            : null;
        const identity = `${payload.broker.toLowerCase()}|${payload.server.toLowerCase()}|${payload.login}`;
        const identityChanged = identityFailure === null &&
          this.verifiedIdentity !== null &&
          this.verifiedIdentity !== identity;
        if (identityFailure !== null || identityChanged) {
          const failure = FAILURE_MESSAGES[identityFailure ?? 'ACCOUNT_IDENTITY_CHANGED'];
          result = {
            ...this.state,
            status: 'IDENTITY_MISMATCH',
            message: failure.message,
            testedAt,
            snapshot: null,
          };
        } else {
          this.verifiedIdentity = identity;
          const symbols = payload.symbols.map((symbol) => {
            const measuredAge = symbol.sourceTimestamp === null
              ? null
              : testedAt - symbol.sourceTimestamp;
            const quoteAgeMs = measuredAge !== null && measuredAge >= 0 ? measuredAge : null;
            const validQuote = symbol.bid !== null &&
              symbol.ask !== null &&
              symbol.ask >= symbol.bid &&
              quoteAgeMs !== null;
            return {
              ...symbol,
              quoteAgeMs,
              quoteStatus: !validQuote
                ? 'UNAVAILABLE' as const
                : quoteAgeMs <= this.maxSnapshotAgeMs
                  ? 'FRESH' as const
                  : 'STALE' as const,
            };
          });
          result = {
            method: 'LOCAL_LOGGED_IN_MT5_TERMINAL',
            status: 'CONNECTED',
            message: 'XM Global demo identity verified from MT5 account data. The snapshot uses read-only terminal queries.',
            testedAt,
            automatedTradingEnabled: false,
            snapshot: {
              broker: payload.broker,
              server: payload.server,
              maskedAccountId: maskAccountId(payload.login),
              currency: payload.currency,
              accountType: payload.accountType,
              balance: payload.balance,
              equity: payload.equity,
              margin: payload.margin,
              freeMargin: payload.freeMargin,
              marginLevelPct: payload.marginLevelPct,
              tradingPermissions: { ...payload.tradingPermissions },
              positions: payload.positions.map((position) => ({ ...position })),
              pendingOrders: payload.pendingOrders.map((order) => ({ ...order })),
              availableSymbols: [...payload.availableSymbols],
              symbolsTruncated: payload.symbolsTruncated,
              unavailableSymbols: [...payload.unavailableSymbols],
              symbols,
              capturedAt: testedAt,
              provenance: 'BROKER_CONFIRMED',
              tradingEnabled: false,
            },
          };
        }
      }
    } catch (error) {
      const code = isRecord(error) && error.code === 'ENOENT'
        ? 'The configured Python interpreter was not found.'
        : 'The local MT5 read-only connector could not complete its check. Verify the local setup and retry.';
      result = {
        ...this.state,
        status: 'UNAVAILABLE',
        message: code,
        testedAt,
      };
    }

    this.state = result;
    auditLogger.record({
      category: 'HEALTH_CHECK',
      level: result.status === 'CONNECTED' ? 'INFO' : 'WARNING',
      action: 'MT5_READ_ONLY_CONNECTION_TESTED',
      details: {
        testedAt,
        status: result.status,
        method: result.method,
        broker: result.snapshot?.broker ?? null,
        server: result.snapshot?.server ?? null,
        maskedAccountId: result.snapshot?.maskedAccountId ?? null,
        message: result.message,
        automatedTradingEnabled: false,
      },
      actor: 'OPERATOR',
    });
    return this.getStatus();
  }
}

export const mt5ReadOnlyConnector = new Mt5ReadOnlyConnector();
