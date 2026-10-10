import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  CloudOff,
  LockKeyhole,
  Monitor,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type {
  Mt5ReadOnlyConnectionState,
  Mt5ConnectionStatus,
} from '../../server/broker/mt5-read-only-connector';

interface Mt5ConnectionWizardProps {
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onStateChange: (state: Mt5ReadOnlyConnectionState) => void;
}

const INITIAL_STATE: Mt5ReadOnlyConnectionState = {
  method: 'LOCAL_LOGGED_IN_MT5_TERMINAL',
  status: 'NOT_TESTED',
  message: 'No MT5 connection test has been run.',
  testedAt: null,
  snapshot: null,
  automatedTradingEnabled: false,
};

const STATUS_STYLES: Record<Mt5ConnectionStatus, string> = {
  NOT_TESTED: 'text-slate-300 bg-slate-500/10 border-slate-500/30',
  CONNECTED: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  STALE: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  DISCONNECTED: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
  AUTHENTICATION_REQUIRED: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  IDENTITY_MISMATCH: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
  UNAVAILABLE: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
};

const CONNECTION_STATUSES: Mt5ConnectionStatus[] = [
  'NOT_TESTED',
  'CONNECTED',
  'STALE',
  'DISCONNECTED',
  'AUTHENTICATION_REQUIRED',
  'IDENTITY_MISMATCH',
  'UNAVAILABLE',
];

function isConnectionState(value: unknown): value is Mt5ReadOnlyConnectionState {
  return typeof value === 'object' &&
    value !== null &&
    'method' in value &&
    value.method === 'LOCAL_LOGGED_IN_MT5_TERMINAL' &&
    'status' in value &&
    typeof value.status === 'string' &&
    CONNECTION_STATUSES.includes(value.status as Mt5ConnectionStatus) &&
    'message' in value &&
    typeof value.message === 'string';
}

function formatAmount(value: number | null | undefined, currency?: string): string {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
}

function formatTime(timestamp: number | null | undefined): string {
  return timestamp ? new Date(timestamp).toLocaleString() : 'Not available';
}

export const Mt5ConnectionWizard: React.FC<Mt5ConnectionWizardProps> = ({ authFetch, onStateChange }) => {
  const [state, setState] = useState(INITIAL_STATE);
  const [isTesting, setIsTesting] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<'LOCAL' | 'CLOUD'>('LOCAL');
  const [symbolQuery, setSymbolQuery] = useState('');

  const updateState = useCallback((nextState: Mt5ReadOnlyConnectionState) => {
    setState(nextState);
    onStateChange(nextState);
  }, [onStateChange]);

  const loadStatus = useCallback(async () => {
    try {
      const response = await authFetch('/api/mt5/status');
      const result: unknown = await response.json();
      if (!isConnectionState(result)) throw new Error('Invalid MT5 status response');
      updateState(result);
    } catch {
      updateState({
        ...INITIAL_STATE,
        status: 'UNAVAILABLE',
        message: 'The local connection service is unavailable. Run this app on the same computer as MT5.',
      });
    }
  }, [authFetch, updateState]);

  useEffect(() => {
    void loadStatus();
    const interval = setInterval(() => void loadStatus(), 5000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  const testConnection = async () => {
    setIsTesting(true);
    try {
      const symbols = [...new Set(symbolQuery.split(',').map((symbol) => symbol.trim()).filter(Boolean))];
      const response = await authFetch('/api/mt5/connect/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      const result: unknown = await response.json();
      if (!isConnectionState(result)) throw new Error('Invalid MT5 connection response');
      updateState(result);
    } catch {
      updateState({
        ...INITIAL_STATE,
        status: 'UNAVAILABLE',
        testedAt: Date.now(),
        message: 'The read-only connection test could not reach the local app server.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const snapshot = state.snapshot;
  const snapshotIsCurrent = state.status === 'CONNECTED';
  const requestedSymbolNames = symbolQuery.split(',').map((symbol) => symbol.trim()).filter(Boolean);

  return (
    <section className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 sm:p-5 space-y-4" aria-labelledby="mt5-connection-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-sky-300" />
            <h2 id="mt5-connection-title" className="text-sm font-bold text-slate-100">
              Connect a MetaTrader 5 account
            </h2>
            <span className={`px-2 py-0.5 border rounded text-[10px] font-mono font-bold ${STATUS_STYLES[state.status]}`}>
              {state.status.replaceAll('_', ' ')}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Read-only account viewing only. This connector never sends, modifies, or closes orders; automated trading remains disabled.
          </p>
        </div>
        <button
          type="button"
          onClick={testConnection}
          disabled={isTesting || selectedMethod !== 'LOCAL' || requestedSymbolNames.length > 10}
          className="px-3 py-2 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-sky-200 border border-sky-500/30 rounded text-xs font-semibold flex items-center gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
          {isTesting ? 'Checking terminal…' : snapshot ? 'Refresh read-only data' : 'Test read-only connection'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <div className="md:col-span-1 p-3 rounded border border-sky-500/30 bg-sky-500/[0.06]">
          <div className="text-[10px] text-sky-300 font-mono font-bold mb-1">STEP 1</div>
          <div className="text-xs text-slate-100 font-semibold">MetaTrader 5</div>
          <div className="text-[10px] text-slate-400 mt-1">Selected connection provider</div>
        </div>
        <button
          type="button"
          onClick={() => setSelectedMethod('LOCAL')}
          className={`md:col-span-2 text-left p-3 rounded border ${
            selectedMethod === 'LOCAL'
              ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
              : 'border-white/[0.08] bg-white/[0.02]'
          }`}
        >
          <div className="text-[10px] text-emerald-300 font-mono font-bold mb-1">STEP 2 · SUPPORTED WHEN RUN LOCALLY</div>
          <div className="text-xs text-slate-100 font-semibold flex items-center gap-1.5">
            <Monitor className="w-3.5 h-3.5" /> Logged-in desktop terminal on this PC
          </div>
          <div className="text-[10px] text-slate-400 mt-1">Uses the terminal session; no broker password is entered into the app.</div>
        </button>
        <button
          type="button"
          onClick={() => setSelectedMethod('CLOUD')}
          className={`md:col-span-2 text-left p-3 rounded border ${
            selectedMethod === 'CLOUD'
              ? 'border-amber-500/30 bg-amber-500/[0.05]'
              : 'border-white/[0.08] bg-white/[0.02]'
          }`}
        >
          <div className="text-[10px] text-amber-300 font-mono font-bold mb-1">CLOUD SERVER · NOT CONFIGURED</div>
          <div className="text-xs text-slate-100 font-semibold flex items-center gap-1.5">
            <CloudOff className="w-3.5 h-3.5" /> Broker-hosted connection
          </div>
          <div className="text-[10px] text-slate-400 mt-1">No broker-specific read-only API or credentials are configured for this account.</div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="p-3.5 bg-[#080b12] border border-white/[0.07] rounded">
          <div className="text-[10px] text-slate-400 font-mono font-bold mb-2">STEP 3 · PREPARE THE TERMINAL</div>
          <ol className="space-y-1.5 text-xs text-slate-300 list-decimal list-inside">
            <li>Install MT5 desktop and sign in there (demo is recommended; use an investor/read-only password if your broker offers one).</li>
            <li>Keep MT5 open and connected on the same Windows computer running this app.</li>
            <li>After connecting, verify the broker, server, and masked account number are the account you intended.</li>
            <li>Do not enter your MT5 password, account number, or server in this app or chat.</li>
          </ol>
          <div className="mt-3 p-2.5 rounded border border-sky-500/20 bg-sky-500/[0.04] text-[11px] text-sky-100/90 flex gap-2">
            <LockKeyhole className="w-4 h-4 shrink-0 text-sky-300" />
            <span>The connector reads the terminal’s already signed-in account. The app itself issues only read calls, but the terminal login may still permit manual trading unless you use broker-provided investor/read-only credentials. Optional paths are local server settings, never browser fields.</span>
          </div>
        </div>

        <div className="p-3.5 bg-[#080b12] border border-white/[0.07] rounded">
          <div className="text-[10px] text-slate-400 font-mono font-bold mb-2">STEP 4 · TEST AND VERIFY</div>
          <p className="text-xs text-slate-300 leading-relaxed">{state.message}</p>
          <div className={`mt-3 p-2.5 rounded border text-[11px] flex items-start gap-2 ${
            selectedMethod === 'CLOUD'
              ? 'border-amber-500/20 bg-amber-500/[0.04] text-amber-100/90'
              : 'border-white/[0.07] bg-white/[0.02] text-slate-400'
          }`}>
            {selectedMethod === 'CLOUD' ? <CircleHelp className="w-4 h-4 shrink-0" /> : <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-300" />}
            {selectedMethod === 'CLOUD'
              ? 'This browser-hosted app cannot reach an MT5 terminal on your PC. Run the app locally beside MT5; no generic broker endpoint is assumed.'
              : 'Connection tests use account and terminal information only. They do not call MT5 order, modify, or close APIs.'}
          </div>
        </div>
      </div>

      {snapshot && (
        <div className="space-y-3" aria-live="polite">
          <div className={`p-3 rounded border flex items-start gap-2 ${
            snapshotIsCurrent
              ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
              : 'border-amber-500/25 bg-amber-500/[0.04]'
          }`}>
            {snapshotIsCurrent
              ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-300" />
              : <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" />}
            <div>
              <div className="text-xs font-semibold text-slate-100">
                {snapshotIsCurrent ? 'STEP 5 · BROKER-CONFIRMED READ-ONLY SNAPSHOT' : 'LAST SUCCESSFUL SNAPSHOT · NOT CURRENT'}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {snapshot.provenance} · last successful update {formatTime(snapshot.capturedAt)} · automated trading disabled
              </div>
            </div>
          </div>
          {snapshot.accountType === 'REAL' && (
            <div className="p-2.5 rounded border border-rose-500/30 bg-rose-500/[0.06] text-[11px] text-rose-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-300" />
              This is a REAL account. The connection is read-only; trading and automated execution remain disabled.
            </div>
          )}
          {snapshot.accountType === 'DEMO' && (
            <div className="p-2.5 rounded border border-emerald-500/20 bg-emerald-500/[0.04] text-[11px] text-emerald-100/90">
              MT5 reports a DEMO account. Broker/server identity is read from the active terminal session; this connection remains read-only.
            </div>
          )}
          <div className="p-2.5 rounded border border-white/[0.07] bg-white/[0.02] text-[11px] text-slate-300">
            <div className="font-semibold text-slate-100 mb-1">Terminal-reported trading permissions (diagnostic only)</div>
            <div>
              Terminal trading allowed: {snapshot.tradingPermissions.terminalTradeAllowed === null ? 'Unavailable' : snapshot.tradingPermissions.terminalTradeAllowed ? 'Yes' : 'No'}
              {' · '}Terminal trade API disabled: {snapshot.tradingPermissions.terminalTradeApiDisabled === null ? 'Unavailable' : snapshot.tradingPermissions.terminalTradeApiDisabled ? 'Yes' : 'No'}
            </div>
            <div>
              Account trading allowed: {snapshot.tradingPermissions.accountTradeAllowed === null ? 'Unavailable' : snapshot.tradingPermissions.accountTradeAllowed ? 'Yes' : 'No'}
              {' · '}Expert trading allowed: {snapshot.tradingPermissions.accountExpertTradingAllowed === null ? 'Unavailable' : snapshot.tradingPermissions.accountExpertTradingAllowed ? 'Yes' : 'No'}
            </div>
            <div className="text-slate-500 mt-1">These MT5 flags do not enable app orders. This connector is read-only, and broker-side execution remains unavailable.</div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              ['Broker / server', `${snapshot.broker} · ${snapshot.server}`],
              ['Account', `${snapshot.maskedAccountId} · ${snapshot.currency}`],
              ['Account type', snapshot.accountType],
              ['Balance', formatAmount(snapshot.balance, snapshot.currency)],
              ['Equity', formatAmount(snapshot.equity, snapshot.currency)],
              ['Free margin', formatAmount(snapshot.freeMargin, snapshot.currency)],
              ['Margin used', formatAmount(snapshot.margin, snapshot.currency)],
              ['Margin level', snapshot.marginLevelPct == null ? 'Unavailable' : `${snapshot.marginLevelPct.toFixed(2)}%`],
            ].map(([label, value]) => (
              <div key={label} className="p-2.5 rounded bg-[#080b12] border border-white/[0.06]">
                <div className="text-[10px] text-slate-500">{label}</div>
                <div className="text-xs text-slate-100 font-mono font-semibold mt-1 break-words">
                  {snapshotIsCurrent ? value : 'Stale · refresh to verify'}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded bg-[#080b12] border border-white/[0.06]">
              <div className="text-slate-200 font-semibold mb-2">Open positions · {snapshot.positions.length}</div>
              {snapshot.positions.length === 0 ? (
                <div className="text-slate-500">No positions reported in this snapshot.</div>
              ) : (
                <div className="space-y-1.5">
                  {snapshot.positions.map((position) => (
                    <div key={position.ticket} className="flex flex-wrap justify-between gap-x-3 text-[11px] text-slate-300 border-b border-white/[0.04] pb-1">
                      <span>{position.symbol} {position.side} · {position.volume} lots · open {position.openPrice}</span>
                      <span className="font-mono">P&L {formatAmount(position.profit, snapshot.currency)} · swap {formatAmount(position.swap, snapshot.currency)} · commission {formatAmount(position.commission, snapshot.currency)}</span>
                      <span className="text-slate-500">
                        SL {position.stopLoss ?? 'None'} · TP {position.takeProfit ?? 'None'} · now {position.currentPrice}
                      </span>
                      <span className="text-slate-500">Ticket {position.ticket}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-3 rounded bg-[#080b12] border border-white/[0.06]">
              <div className="text-slate-200 font-semibold mb-2">Pending orders · {snapshot.pendingOrders.length}</div>
              {snapshot.pendingOrders.length === 0 ? (
                <div className="text-slate-500">No pending orders reported in this snapshot.</div>
              ) : (
                <div className="space-y-1.5">
                  {snapshot.pendingOrders.map((order) => (
                    <div key={order.ticket} className="flex flex-wrap justify-between gap-x-3 text-[11px] text-slate-300 border-b border-white/[0.04] pb-1">
                      <span>{order.symbol} {order.type} · {order.volume}</span>
                      <span className="font-mono">Price {formatAmount(order.price, snapshot.currency)}</span>
                      <span className="text-slate-500">SL {order.stopLoss ?? 'None'} · TP {order.takeProfit ?? 'None'}</span>
                      <span className="text-slate-500">Placed {formatTime(order.setupTime)}</span>
                      <span className="text-slate-500">Ticket {order.ticket}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="p-3 rounded bg-[#080b12] border border-white/[0.06] space-y-2">
            <div className="text-slate-200 font-semibold">MT5 symbol inventory and quotes</div>
            <p className="text-[11px] text-slate-400">
              Inventory and requested contract fields come from MT5. Quotes are shown only with a valid MT5 tick timestamp; unavailable or stale quotes are not treated as current.
            </p>
            <div className="text-[11px] text-slate-400 break-words">
              {snapshot.availableSymbols.length} symbols returned{snapshot.symbolsTruncated ? ' (inventory truncated at 2,500)' : ''}.
              {snapshot.availableSymbols.length > 0 && ` Examples: ${snapshot.availableSymbols.slice(0, 30).join(', ')}${snapshot.availableSymbols.length > 30 ? ', …' : ''}`}
            </div>
            <label className="block text-[10px] text-slate-400" htmlFor="mt5-symbol-query">
              Request up to 10 exact MT5 symbols (comma-separated)
            </label>
            <div className="flex gap-2">
              <input
                id="mt5-symbol-query"
                value={symbolQuery}
                onChange={(event) => setSymbolQuery(event.target.value)}
                maxLength={329}
                placeholder="EURUSD, GOLD"
                className="min-w-0 flex-1 bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-100"
              />
              <span className="self-center text-[10px] text-slate-500">
                {requestedSymbolNames.length}/10
              </span>
            </div>
            {requestedSymbolNames.length > 10 && (
              <div className="text-[11px] text-rose-300">Request limited to 10 symbols. Reduce the list before refreshing.</div>
            )}
            {snapshot.unavailableSymbols.length > 0 && (
              <div className="text-[11px] text-amber-300">Unavailable symbols: {snapshot.unavailableSymbols.join(', ')}</div>
            )}
            {snapshot.symbols.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[10px]">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 pr-2">Symbol / quote</th>
                      <th className="py-1 pr-2">Contract / tick</th>
                      <th className="py-1 pr-2">Volume min / step / max</th>
                      <th className="py-1 pr-2">Stops / freeze</th>
                      <th className="py-1 pr-2">Currencies / permissions</th>
                      <th className="py-1">Quote time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.symbols.map((symbol) => (
                      <tr key={symbol.symbol} className="border-t border-white/[0.05] text-slate-300 align-top">
                        <td className="py-1.5 pr-2">
                          <div className="font-semibold">{symbol.symbol} · {symbol.quoteStatus}</div>
                          <div>{symbol.description}</div>
                          <div>Bid {symbol.bid ?? 'Unavailable'} / Ask {symbol.ask ?? 'Unavailable'}</div>
                        </td>
                        <td className="py-1.5 pr-2">
                          {symbol.contractSize ?? 'Unavailable'} · tick size {symbol.tradeTickSize ?? 'Unavailable'} · value {symbol.tradeTickValue ?? 'Unavailable'}
                        </td>
                        <td className="py-1.5 pr-2">
                          {symbol.volumeMinimum ?? 'Unavailable'} / {symbol.volumeStep ?? 'Unavailable'} / {symbol.volumeMaximum ?? 'Unavailable'}
                        </td>
                        <td className="py-1.5 pr-2">
                          {symbol.stopsLevelPoints ?? 'Unavailable'} / {symbol.freezeLevelPoints ?? 'Unavailable'} points
                        </td>
                        <td className="py-1.5 pr-2">
                          {symbol.profitCurrency || 'Unavailable'} / {symbol.marginCurrency || 'Unavailable'} · trade {symbol.tradeMode}, orders {symbol.orderMode ?? 'Unavailable'}, exec {symbol.executionMode ?? 'Unavailable'}, fill {symbol.fillingMode ?? 'Unavailable'}, expiry {symbol.expirationMode ?? 'Unavailable'}
                        </td>
                        <td className="py-1.5">
                          {symbol.quoteAgeMs === null ? 'Unavailable' : `${Math.round(symbol.quoteAgeMs / 1000)}s old`}<br />
                          {formatTime(symbol.sourceTimestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {(state.status === 'DISCONNECTED' || state.status === 'AUTHENTICATION_REQUIRED' || state.status === 'UNAVAILABLE' || state.status === 'IDENTITY_MISMATCH') && (
        <div className="text-[11px] text-slate-400 flex items-start gap-2">
          <XCircle className="w-4 h-4 text-rose-300 shrink-0" />
          <span>Nothing was inferred or simulated. Reopen MT5, restore its authenticated session, then run the read-only test again. A failed or stale connection does not authorize trading.</span>
        </div>
      )}
    </section>
  );
};
