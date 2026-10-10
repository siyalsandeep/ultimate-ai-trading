/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Instrument,
  MarketQuote,
  CandleOHLCV,
  PortfolioSummary,
  RiskLimits,
  StrategyConfig,
  TradeSignal,
  Position,
  Order,
  SystemHealthReport,
  AuditLogEntry,
  SystemMode,
  OrderSide,
  OrderType,
  MarketRegimeType,
  BacktestRequest,
  BacktestResult,
  AIResearchResponse,
  MarketPriceSnapshot,
  StrategyDefinition,
  StrategySelectionDecision,
} from './types/trading';
import { Header } from './components/Header';
import { TerminalView } from './components/TerminalView';
import { StrategiesView } from './components/StrategiesView';
import { RiskTowerView } from './components/RiskTowerView';
import { BlotterView } from './components/BlotterView';
import { BacktestView } from './components/BacktestView';
import { AiQuantLabView } from './components/AiQuantLabView';
import { HealthAuditView } from './components/HealthAuditView';
import { BrokerTruthView } from './components/BrokerTruthView';
import { LiveModeModal } from './components/LiveModeModal';
import { ShieldAlert, AlertTriangle, Power } from 'lucide-react';

async function getJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('terminal');
  const [mode, setMode] = useState<SystemMode>('PAPER');
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [marketPrices, setMarketPrices] = useState<MarketPriceSnapshot[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('SPY');
  const [candles, setCandles] = useState<CandleOHLCV[]>([]);
  const [currentRegime, setCurrentRegime] = useState<MarketRegimeType | 'UNKNOWN'>('UNKNOWN');
  const [portfolio, setPortfolio] = useState<PortfolioSummary>({
    mode: 'PAPER',
    totalEquity: 100000,
    cashBalance: 100000,
    availableMargin: 100000,
    usedMargin: 0,
    unrealizedPnL: 0,
    realizedPnLToday: 0,
    startOfDayEquity: 100000,
    dailyLossPct: 0,
    maxDrawdownPct: 0,
    currentDrawdownPct: 0,
    grossLeverage: 0,
    openRiskBudgetPct: 0,
    activePositionsCount: 0,
    activeOrdersCount: 0,
    consecutiveLosses: 0,
    isDailyLossHalted: false,
    isGlobalKillSwitched: false,
  });
  const [limits, setLimits] = useState<RiskLimits>({
    maxRiskPerTradePct: 0.25,
    dailyLossShutdownPct: 1.0,
    portfolioOpenRiskBudgetPct: 2.0,
    maxDrawdownPausePct: 5.0,
    maxDrawdownHaltPct: 10.0,
    maxSingleAssetExposurePct: 15.0,
    maxAssetClassExposurePct: 35.0,
    maxStrategyExposurePct: 30.0,
    maxLeverage: 1.5,
    maxSimultaneousPositions: 8,
    maxSpreadTolerancePct: 0.15,
    maxSlippageTolerancePct: 0.20,
    maxQuoteAgeMs: 30000,
    maxConsecutiveLosses: 5,
    consecutiveLossCooldownMinutes: 30,
  });
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [strategyDefinitions, setStrategyDefinitions] = useState<StrategyDefinition[]>([]);
  const [strategySelection, setStrategySelection] = useState<StrategySelectionDecision | null>(null);
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [health, setHealth] = useState<SystemHealthReport | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [hasPortfolioSnapshot, setHasPortfolioSnapshot] = useState(false);
  const [hasRiskLimitsSnapshot, setHasRiskLimitsSnapshot] = useState(false);
  const [lastFullRefreshAt, setLastFullRefreshAt] = useState<number | null>(null);
  const [refreshIssue, setRefreshIssue] = useState<string | null>(null);
  const [isLiveModalOpen, setIsLiveModalOpen] = useState(false);
  const [isKillSwitchModalOpen, setIsKillSwitchModalOpen] = useState(false);
  const [killSwitchError, setKillSwitchError] = useState<string | null>(null);
  const [operatorToken, setOperatorToken] = useState<string>('');
  const [operatorTokenInput, setOperatorTokenInput] = useState('');
  const [operatorAuthenticated, setOperatorAuthenticated] = useState(false);
  const [operatorAuthError, setOperatorAuthError] = useState<string | null>(null);
  const [operatorNotice, setOperatorNotice] = useState<string | null>(null);

  // Authorized fetch helper sending operator token
  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers || {});
      headers.set('Content-Type', 'application/json');
      if (operatorToken) {
        headers.set('Authorization', `Bearer ${operatorToken}`);
      }
      const response = await fetch(url, { ...options, headers });
      if (response.status === 401) {
        setOperatorToken('');
        setOperatorAuthenticated(false);
        setOperatorAuthError('Operator credential was rejected or expired. Sign in again; protected actions remain disabled.');
      }
      return response;
    },
    [operatorToken]
  );

  // Initial Fetch of Static / Universe Data
  useEffect(() => {
    getJson<Instrument[]>('/api/instruments')
      .then(data => setInstruments(data))
      .catch((error: unknown) => setRefreshIssue(error instanceof Error ? error.message : String(error)));

    getJson<{ limits?: RiskLimits }>('/api/risk/limits')
      .then(data => {
        if (data.limits) {
          setLimits(previous => JSON.stringify(previous) === JSON.stringify(data.limits) ? previous : data.limits!);
          setHasRiskLimitsSnapshot(true);
        }
      })
      .catch((error: unknown) => setRefreshIssue(error instanceof Error ? error.message : String(error)));

    getJson<StrategyConfig[]>('/api/strategies')
      .then(data => setStrategies(data))
      .catch((error: unknown) => setRefreshIssue(error instanceof Error ? error.message : String(error)));

    getJson<StrategyDefinition[]>('/api/strategy-definitions')
      .then(data => setStrategyDefinitions(data))
      .catch((error: unknown) => setRefreshIssue(error instanceof Error ? error.message : String(error)));
  }, []);

  // Periodic Polling Loop (Quotes, Portfolio, Positions, Orders, Health, Logs)
  const pollLiveData = useCallback(async () => {
    const requests: { label: string; run: () => Promise<void> }[] = [
      { label: 'Instruments', run: async () => setInstruments(await getJson<Instrument[]>('/api/instruments')) },
      { label: 'Quotes', run: async () => setQuotes(await getJson<MarketQuote[]>('/api/quotes')) },
      {
        label: 'Market snapshots',
        run: async () => {
          try {
            setMarketPrices(await getJson<MarketPriceSnapshot[]>('/api/market/prices'));
          } catch (error) {
            setMarketPrices(previous => previous.map(snapshot => ({
              ...snapshot,
              isStale: true,
              connectionState: 'DISCONNECTED',
              error: 'Market-data API unavailable; the last snapshot, if any, is not current.',
            })));
            throw error;
          }
        },
      },
      {
        label: 'Portfolio',
        run: async () => {
          const snapshot = await getJson<PortfolioSummary>('/api/portfolio');
          setPortfolio(snapshot);
          setMode(snapshot.mode);
          setHasPortfolioSnapshot(true);
        },
      },
      {
        label: 'Risk limits',
        run: async () => {
          const result = await getJson<{ limits: RiskLimits }>('/api/risk/limits');
          setLimits(previous => JSON.stringify(previous) === JSON.stringify(result.limits) ? previous : result.limits);
          setHasRiskLimitsSnapshot(true);
        },
      },
      { label: 'Positions', run: async () => setPositions(await getJson<Position[]>('/api/positions')) },
      { label: 'Orders', run: async () => setOrders(await getJson<Order[]>('/api/orders')) },
      { label: 'Signals', run: async () => setSignals(await getJson<TradeSignal[]>('/api/signals')) },
      { label: 'Strategies', run: async () => setStrategies(await getJson<StrategyConfig[]>('/api/strategies')) },
      { label: 'Strategy definitions', run: async () => setStrategyDefinitions(await getJson<StrategyDefinition[]>('/api/strategy-definitions')) },
      {
        label: 'Selected candles',
        run: async () => {
          try {
            setCandles(await getJson<CandleOHLCV[]>(`/api/candles/${selectedSymbol}`));
          } catch (error) {
            setCandles([]);
            throw error;
          }
        },
      },
      {
        label: 'Selected regime',
        run: async () => {
          try {
            const result = await getJson<{ regime: MarketRegimeType }>(`/api/regime/${selectedSymbol}`);
            setCurrentRegime(result.regime);
          } catch (error) {
            setCurrentRegime('UNKNOWN');
            throw error;
          }
        },
      },
      { label: 'Diagnostics', run: async () => setHealth(await getJson<SystemHealthReport>('/api/health/detailed')) },
      { label: 'Audit events', run: async () => setAuditLogs(await getJson<AuditLogEntry[]>('/api/audit-logs')) },
    ];
    const results = await Promise.allSettled(requests.map(request => request.run()));
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${requests[index].label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
        : []
    );
    setRefreshIssue(failures.length > 0 ? failures.join(' · ') : null);
    if (failures.length === 0) setLastFullRefreshAt(Date.now());
  }, [selectedSymbol]);

  useEffect(() => {
    pollLiveData();
    const interval = setInterval(pollLiveData, 3000);
    return () => clearInterval(interval);
  }, [pollLiveData]);

  const handleOperatorSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOperatorAuthError(null);
    try {
      const candidate = operatorTokenInput;
      const response = await fetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${candidate}` },
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok || result.authenticated !== true) {
        throw new Error(result.error || `Operator authentication failed (HTTP ${response.status}).`);
      }
      setOperatorToken(candidate);
      setOperatorAuthenticated(true);
      setOperatorTokenInput('');
      setOperatorNotice('Operator controls authenticated for this browser session. The credential remains in memory only.');
      await pollLiveData();
    } catch (error) {
      setOperatorToken('');
      setOperatorAuthenticated(false);
      setOperatorAuthError(error instanceof Error ? error.message : 'Operator authentication failed.');
    }
  };

  // Order Submission Handler
  const handleSubmitOrder = async (orderParams: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    strategyId: string;
  }) => {
    try {
      const res = await authFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify(orderParams),
      });
      const data = await res.json();
      pollLiveData();
      if (!res.ok) {
        return { success: false, error: data.error || data.message || 'Order failed' };
      }
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  };

  // Close Position Handler
  const handleClosePosition = async (symbol: string) => {
    try {
      const res = await authFetch(`/api/positions/${symbol}/close`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Operator Manual Close' }),
      });
      const data = await res.json();
      pollLiveData();
      const success = res.ok && data.success === true;
      const message = data.message || data.error || `Position close returned HTTP ${res.status}.`;
      setOperatorNotice(success ? message : `Position close failed: ${message}`);
      return { success, message };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOperatorNotice(`Position close failed: ${msg}`);
      return { success: false, message: msg };
    }
  };

  // Cancel Order Handler
  const handleCancelOrder = async (orderId: string) => {
    try {
      const res = await authFetch(`/api/orders/${orderId}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.success !== true) throw new Error(data.error || data.message || `HTTP ${res.status}`);
      setOperatorNotice(`Order ${orderId} cancelled in the local paper ledger.`);
      await pollLiveData();
    } catch (error) {
      setOperatorNotice(`Order cancellation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Mode Selection Handler
  const handleModeSelect = (newMode: SystemMode) => {
    if (newMode === 'LIVE') {
      setIsLiveModalOpen(true);
    } else {
      authFetch('/api/portfolio/mode', {
        method: 'POST',
        body: JSON.stringify({ mode: newMode }),
      })
        .then(async res => {
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.message || data.error || `HTTP ${res.status}`);
          setMode(data.mode || newMode);
          setOperatorNotice(`Operating mode set to ${data.mode || newMode}.`);
          await pollLiveData();
        })
        .catch(error => setOperatorNotice(`Mode change failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  };

  // Confirm Live Mode
  const handleConfirmLive = async () => {
    setIsLiveModalOpen(false);
    try {
      const res = await authFetch('/api/portfolio/mode', {
        method: 'POST',
        body: JSON.stringify({ mode: 'LIVE' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setOperatorNotice(data.message || data.error || 'LIVE execution locked: No verified live broker gateway configured.');
        setTimeout(() => setOperatorNotice(null), 6000);
      } else {
        setMode('LIVE');
      }
      await pollLiveData();
    } catch (error) {
      setOperatorNotice(`LIVE mode rejected fail-closed: ${error instanceof Error ? error.message : String(error)}`);
      setTimeout(() => setOperatorNotice(null), 6000);
    }
  };

  // Toggle Kill Switch
  const handleToggleKillSwitch = async (active: boolean) => {
    setKillSwitchError(null);
    try {
      const response = await authFetch('/api/risk/kill-switch', {
        method: 'POST',
        body: JSON.stringify({ active, reason: 'Operator-confirmed emergency halt control' }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) {
        throw new Error(result.message || result.error || `HTTP ${response.status}`);
      }
      const positionsRemain = Number(result.positionsLeftOpen ?? positions.length);
      setOperatorNotice(active
        ? `Emergency halt engaged. ${positionsRemain} existing position(s) remain open; no position was force-closed.`
        : 'Emergency halt disarmed. New entries remain subject to every other risk and authorization gate.');
      setIsKillSwitchModalOpen(false);
      await pollLiveData();
    } catch (error) {
      setKillSwitchError(`${error instanceof Error ? error.message : String(error)}. Verify the server state before retrying.`);
    }
  };

  // Reset Daily Loss Breaker
  const handleResetDailyLoss = async () => {
    if (!window.confirm('Reset the daily-loss breaker? This acknowledges the halt only; the configured threshold remains active and can halt entries again. Existing positions are not closed.')) return;
    try {
      const response = await authFetch('/api/risk/reset-daily-loss', { method: 'POST' });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      setOperatorNotice(result.message || 'Daily-loss breaker reset and audited.');
      await pollLiveData();
    } catch (error) {
      setOperatorNotice(`Daily-loss breaker reset failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Quarantine Strategy
  const handleQuarantineStrategy = async (strategyId: string, suspended: boolean) => {
    try {
      const response = await authFetch('/api/risk/strategy-quarantine', {
        method: 'POST',
        body: JSON.stringify({ strategyId, suspended }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      setOperatorNotice(`Strategy ${strategyId} ${suspended ? 'quarantined' : 'resumed'}; change persisted and audited.`);
      await pollLiveData();
    } catch (error) {
      setOperatorNotice(`Strategy quarantine action failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Update Risk Limits
  const handleUpdateLimits = async (newLimits: Partial<RiskLimits>) => {
    const res = await authFetch('/api/risk/limits', {
      method: 'POST',
      body: JSON.stringify(newLimits),
    });
    const data = await res.json();
    if (!res.ok || data.success !== true) {
      setOperatorNotice(`Risk-limit update rejected: ${data.message || data.error || `HTTP ${res.status}`}`);
      return { success: false, message: data.message || data.error || `HTTP ${res.status}` };
    }
    setOperatorNotice(data.message || 'Risk limits persisted and audited.');
    await pollLiveData();
    return data;
  };

  // Toggle Strategy Enabled
  const handleToggleStrategy = async (id: string, enabled: boolean) => {
    try {
      const response = await authFetch(`/api/strategies/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      setOperatorNotice(`Research strategy ${id} ${enabled ? 'enabled' : 'disabled'}; this does not enable order routing.`);
      await pollLiveData();
    } catch (error) {
      setOperatorNotice(`Strategy setting failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Update Strategy Parameters
  const handleUpdateParams = async (id: string, params: Record<string, number | string | boolean>) => {
    const res = await authFetch(`/api/strategies/${id}/params`, {
      method: 'POST',
      body: JSON.stringify({ parameters: params }),
    });
    if (!res.ok) throw new Error(`Strategy parameter update failed with HTTP ${res.status}`);
    const definitionsRes = await fetch('/api/strategy-definitions');
    if (!definitionsRes.ok) throw new Error(`Strategy definitions refresh failed with HTTP ${definitionsRes.status}`);
    setStrategyDefinitions(await definitionsRes.json());
    pollLiveData();
  };

  // Manual Scan Signals
  const handleScanSignals = async () => {
    const res = await authFetch('/api/signals/scan', { method: 'POST' });
    if (!res.ok) throw new Error(`Signal scan failed with HTTP ${res.status}`);
    const data = await res.json();
    setSignals(data);
  };

  const handleEvaluateStrategySelection = async () => {
    const res = await authFetch('/api/strategy-selection/evaluate', {
      method: 'POST',
      body: JSON.stringify({ symbol: selectedSymbol }),
    });
    if (!res.ok) throw new Error(`Strategy suitability evaluation failed with HTTP ${res.status}`);
    setStrategySelection(await res.json());
  };

  // Cancel All Open Orders
  const handleCancelAllOrders = async () => {
    const activeOrderCount = orders.filter((order) =>
      ['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED'].includes(order.status)
    ).length;
    if (!window.confirm(`Cancel all ${activeOrderCount} open order(s) in the local paper ledger? Existing positions are not closed and no broker cancel request will be sent.`)) return;
    try {
      const response = await authFetch('/api/orders/cancel-all', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Operator mass cancel; local paper ledger only' }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      setOperatorNotice(`${result.cancelledCount} open local order(s) cancelled. Existing positions remain open; no broker cancellation was sent.`);
      await pollLiveData();
    } catch (error) {
      setOperatorNotice(`Order cancellation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Run Backtest
  const handleRunBacktest = async (req: BacktestRequest): Promise<BacktestResult> => {
    const res = await authFetch('/api/backtest', {
      method: 'POST',
      body: JSON.stringify(req),
    });
    return res.json();
  };

  // Run AI Research
  const handleRunAiResearch = async (symbol: string, promptText: string): Promise<AIResearchResponse> => {
    const res = await authFetch('/api/ai/research', {
      method: 'POST',
      body: JSON.stringify({ symbol, promptText }),
    });
    return res.json();
  };

  // Run Reconciliation
  const handleRunReconciliation = async () => {
    const response = await authFetch('/api/orders/reconcile', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || `Reconciliation returned HTTP ${response.status}`);
    setOperatorNotice('Local paper-ledger reconciliation completed. No broker reconciliation was performed.');
    await pollLiveData();
  };

  const handleRunHealthCheck = async () => {
    try {
      const response = await fetch('/api/health/run-check', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || `Diagnostics returned HTTP ${response.status}`);
      setHealth(result as SystemHealthReport);
      await pollLiveData();
    } catch (error) {
      setOperatorNotice(`Diagnostics failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleModifyStopLoss = async (symbol: string, newStop: number) => {
    const response = await authFetch(`/api/positions/${encodeURIComponent(symbol)}/stop`, {
      method: 'POST',
      body: JSON.stringify({ stopLoss: newStop }),
    });
    const result = await response.json();
    return {
      success: response.ok && result.success === true,
      message: result.message || result.error || `Stop request returned HTTP ${response.status}.`,
    };
  };

  return (
    <div className="min-h-screen bg-[#06080d] text-slate-100 flex flex-col font-sans select-none antialiased">
      {/* Header */}
      <Header
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        mode={mode}
        onModeSelect={handleModeSelect}
        health={health}
        onTriggerHealthCheck={() => { void handleRunHealthCheck(); }}
        onOpenKillSwitchModal={() => setIsKillSwitchModalOpen(true)}
        isKillSwitched={portfolio.isGlobalKillSwitched}
        activePositionsCount={positions.length}
        activeSignalsCount={signals.length}
      />

      <section className="border-b border-white/[0.08] bg-[#0b1018] px-4 py-3" aria-label="Operator authentication">
        {operatorAuthenticated ? (
          <div className="mx-auto flex max-w-[1720px] flex-wrap items-center justify-between gap-3 text-xs">
            <p className="text-emerald-200" role="status">Operator controls authenticated · credential held in memory only</p>
            <button
              type="button"
              onClick={() => {
                setOperatorToken('');
                setOperatorAuthenticated(false);
                setOperatorAuthError(null);
                setOperatorNotice('Operator session cleared. Protected actions are disabled until you authenticate again.');
              }}
              className="rounded border border-white/10 bg-[#101722] px-3 py-1.5 text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
            >
              Clear operator session
            </button>
          </div>
        ) : (
          <form onSubmit={handleOperatorSignIn} className="mx-auto flex max-w-[1720px] flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label htmlFor="operator-token" className="mb-1 block text-[11px] font-semibold text-slate-200">
                Operator token
              </label>
              <input
                id="operator-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                value={operatorTokenInput}
                onChange={(event) => setOperatorTokenInput(event.target.value)}
                aria-describedby="operator-auth-help"
                className="w-full max-w-xl rounded border border-white/15 bg-[#06080d] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
              />
              <p id="operator-auth-help" className="mt-1 text-[10px] text-slate-400">
                Configure OPERATOR_TOKEN with at least 32 characters on the server. It is never returned by the API or saved in this browser.
              </p>
            </div>
            <button
              type="submit"
              className="rounded border border-amber-500/40 bg-amber-700/80 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
            >
              Authenticate operator
            </button>
            {operatorAuthError && <p className="basis-full text-xs text-rose-200" role="alert">{operatorAuthError}</p>}
          </form>
        )}
      </section>

      {/* Critical System Alert Banners if Kill Switched or Daily Loss Tripped */}
      {operatorNotice && (
        <div className="bg-amber-950/80 border-b border-amber-600/80 px-4 py-2 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2 font-bold font-mono">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>OPERATOR SAFETY NOTICE: {operatorNotice}</span>
          </div>
          <button
            onClick={() => setOperatorNotice(null)}
            className="px-2.5 py-0.5 bg-amber-800/60 hover:bg-amber-700 text-white rounded text-[11px] font-mono transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {!hasPortfolioSnapshot && (
        <div className="bg-slate-900 border-b border-white/10 px-4 py-2 text-xs text-slate-300" role="status" aria-live="polite">
          Syncing server state. Account, position, and risk controls are unavailable until the first server snapshot is received.
        </div>
      )}

      {(refreshIssue || lastFullRefreshAt !== null) && (
        <div className={`border-b px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${
          refreshIssue
            ? 'bg-rose-950/70 border-rose-600/70 text-rose-200'
            : 'bg-[#0a0d15] border-white/[0.06] text-slate-400'
        }`} role={refreshIssue ? 'alert' : 'status'} aria-live="polite">
          <span>
            {refreshIssue
              ? `Server refresh incomplete. Values may be stale: ${refreshIssue}`
              : `All dashboard endpoints refreshed ${new Date(lastFullRefreshAt!).toLocaleTimeString()}.`}
          </span>
          {refreshIssue && (
            <button onClick={() => void pollLiveData()} className="rounded border border-rose-400/30 px-2 py-1 hover:bg-rose-900/60">
              Retry refresh
            </button>
          )}
        </div>
      )}

      {portfolio.isGlobalKillSwitched && (
        <div className="bg-rose-950/70 border-b border-rose-600/70 px-4 py-2 flex items-center justify-between text-xs text-rose-200">
          <div className="flex items-center gap-2 font-bold font-mono">
            <Power className="w-4 h-4 text-rose-400" />
            <span>EMERGENCY HALT ENGAGED. New risk-increasing orders are blocked; {positions.length} existing local position(s) remain open and are not force-closed.</span>
          </div>
          <button
            onClick={() => setIsKillSwitchModalOpen(true)}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded text-xs transition-colors"
          >
            Review / Disarm
          </button>
        </div>
      )}

      {portfolio.isDailyLossHalted && !portfolio.isGlobalKillSwitched && (
        <div className="bg-amber-950/70 border-b border-amber-600/70 px-4 py-2 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2 font-bold font-mono">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>DAILY LOSS LIMIT BREACHED ({portfolio.dailyLossPct.toFixed(2)}%). RISK PROTECTION ACTIVE.</span>
          </div>
          <button
            onClick={handleResetDailyLoss}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded text-xs transition-colors"
          >
            Reset Circuit Breaker
          </button>
        </div>
      )}

      {/* Revenge-Trading Prevention Cooldown Banner */}
      {portfolio.activeCooldowns && portfolio.activeCooldowns.length > 0 && !portfolio.isGlobalKillSwitched && (
        <div className="bg-[#1a1405] border-b border-amber-500/40 px-4 py-2.5 flex flex-wrap items-center justify-between text-xs text-amber-200 gap-2">
          <div className="flex items-center gap-2 font-mono">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>REVENGE-TRADING COOLDOWN ACTIVE:</strong> 5 consecutive closed losses triggered mandatory safety pause. Entries locked: {portfolio.activeCooldowns.map(c => `${c.target === 'ACCOUNT' ? 'Account-Wide' : c.target} (${c.remainingSeconds}s remaining)`).join(', ')}. Auto-execution disabled.
            </span>
          </div>
          <span className="text-[11px] text-amber-300 font-mono">
            Safety Floor: 30m lock cannot be shortened by ordinary settings. Resumes after full duration and health checks pass.
          </span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto pb-8">
        {currentTab === 'terminal' && (
          hasPortfolioSnapshot ? <TerminalView
            instruments={instruments}
            quotes={quotes}
            marketPrices={marketPrices}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={(symbol) => {
              setCandles([]);
              setCurrentRegime('UNKNOWN');
              setSelectedSymbol(symbol);
            }}
            candles={candles}
            portfolio={portfolio}
            regime={currentRegime}
            onSubmitOrder={handleSubmitOrder}
          /> : <div className="m-5 rounded border border-white/10 bg-[#0a0d15] p-5 text-sm text-slate-300" role="status">Waiting for the authoritative local portfolio snapshot before displaying trading controls.</div>
        )}

        {currentTab === 'broker-truth' && (
          <BrokerTruthView
            positions={positions}
            instruments={instruments}
            quotes={quotes}
            onTriggerReconciliation={handleRunReconciliation}
            onModifyStopLoss={handleModifyStopLoss}
            authFetch={authFetch}
          />
        )}

        {currentTab === 'strategies' && (
          <StrategiesView
            strategies={strategies}
            definitions={strategyDefinitions}
            selection={strategySelection}
            selectedSymbol={selectedSymbol}
            signals={signals}
            onToggleStrategy={handleToggleStrategy}
            onUpdateParams={handleUpdateParams}
            onScanSignals={handleScanSignals}
            onEvaluateSelection={handleEvaluateStrategySelection}
            currentRegime={currentRegime}
          />
        )}

        {currentTab === 'risk' && (
          hasPortfolioSnapshot && hasRiskLimitsSnapshot ? <RiskTowerView
            limits={limits}
            portfolio={portfolio}
            strategies={strategies}
            onUpdateLimits={handleUpdateLimits}
            onToggleKillSwitch={() => {
              setKillSwitchError(null);
              setIsKillSwitchModalOpen(true);
            }}
            onResetDailyLoss={handleResetDailyLoss}
            onQuarantineStrategy={handleQuarantineStrategy}
            onCancelAllOrders={handleCancelAllOrders}
          /> : <div className="m-5 rounded border border-white/10 bg-[#0a0d15] p-5 text-sm text-slate-300" role="status">Risk controls are withheld until server risk and portfolio state are loaded.</div>
        )}

        {currentTab === 'blotter' && (
          <BlotterView
            positions={positions}
            orders={orders}
            onClosePosition={handleClosePosition}
            onCancelOrder={handleCancelOrder}
          />
        )}

        {currentTab === 'backtest' && (
          <BacktestView
            instruments={instruments}
            onRunBacktest={handleRunBacktest}
          />
        )}

        {currentTab === 'ai-lab' && (
          <AiQuantLabView
            instruments={instruments}
            currentRegime={currentRegime}
            onRunResearch={handleRunAiResearch}
          />
        )}

        {currentTab === 'health-audit' && (
          <HealthAuditView
            health={health}
            auditLogs={auditLogs}
            onTriggerHealthCheck={handleRunHealthCheck}
            onRunReconciliation={handleRunReconciliation}
          />
        )}
      </main>

      {/* Live Mode Operator Modal */}
      <LiveModeModal
        isOpen={isLiveModalOpen}
        onClose={() => setIsLiveModalOpen(false)}
        onConfirmLive={handleConfirmLive}
      />

      {/* Emergency Kill Switch Modal */}
      {isKillSwitchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4">
          <div className="bg-[#0b0f19] border border-rose-600/80 rounded-xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden">
            <div className="flex items-center gap-2.5 text-rose-400 pb-3 border-b border-white/[0.08]">
              <div className="p-1.5 rounded bg-rose-500/15 border border-rose-500/30">
                <Power className="w-4 h-4 text-rose-400" />
              </div>
              <h3 className="font-bold text-sm text-slate-100">
                {portfolio.isGlobalKillSwitched ? 'Review Emergency Halt' : 'Confirm Global Emergency Halt'}
              </h3>
            </div>
            <p className="my-4 text-xs text-slate-300 leading-relaxed">
              {portfolio.isGlobalKillSwitched
                ? `Disarming removes only the global halt. All other risk gates remain in force. ${positions.length} local position(s) remain open.`
                : `This halt blocks new risk-increasing entries and cancels every non-terminal order in the local paper ledger (not just entry orders). It does not close or flatten existing positions. ${positions.length} local position(s) will remain open; their recorded stops remain managed by the local paper simulator. No verified broker account is connected, so this sends no broker cancellation or position-close request.`}
            </p>
            <p className="mb-4 rounded border border-amber-500/30 bg-amber-950/30 p-3 text-[11px] text-amber-200">
              Confirm the resulting state in System Health &amp; Audit after the action. If the request fails or times out, do not assume the halt state changed.
            </p>
            {killSwitchError && (
              <p className="mb-4 rounded border border-rose-500/40 bg-rose-950/40 p-3 text-[11px] text-rose-100" role="alert">
                Emergency halt action failed: {killSwitchError}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-3 border-t border-white/[0.08]">
              <button
                onClick={() => setIsKillSwitchModalOpen(false)}
                className="px-4 py-2 bg-[#0e1320] hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded border border-white/[0.08] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleToggleKillSwitch(!portfolio.isGlobalKillSwitched)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded shadow-md transition-colors"
              >
                {portfolio.isGlobalKillSwitched ? 'Disarm global halt' : 'Engage halt and cancel open orders'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
