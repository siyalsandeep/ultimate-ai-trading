import React, { useState, useEffect } from 'react';
import {
  BrokerTruthState,
  PermissionGateResult,
  Position,
  Instrument,
  MarketQuote,
  DataProvenance,
} from '../types/trading';
import {
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Lock,
  Server,
  Database,
  DollarSign,
  Activity,
  FileCheck,
  Sliders,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { Mt5ConnectionWizard } from './Mt5ConnectionWizard';
import type { Mt5ReadOnlyConnectionState } from '../../server/broker/mt5-read-only-connector';

interface BrokerTruthViewProps {
  positions: Position[];
  instruments: Instrument[];
  quotes: MarketQuote[];
  onTriggerReconciliation: () => Promise<void>;
  onModifyStopLoss: (symbol: string, newStop: number) => Promise<{ success: boolean; message: string }>;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

export const BrokerTruthView: React.FC<BrokerTruthViewProps> = ({
  positions,
  instruments,
  quotes,
  onTriggerReconciliation,
  onModifyStopLoss,
  authFetch,
}) => {
  const [brokerState, setBrokerState] = useState<BrokerTruthState | null>(null);
  const [mt5Connection, setMt5Connection] = useState<Mt5ReadOnlyConnectionState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'PNL_AUDIT' | 'QUOTES_PROVENANCE' | 'GATE_VALIDATOR' | 'STOPS_DISCIPLINE'>('OVERVIEW');
  const [stopInputs, setStopInputs] = useState<Record<string, string>>({});
  const [stopFeedback, setStopFeedback] = useState<Record<string, { type: 'success' | 'error'; message: string }>>({});

  // Gate simulation state
  const [simSymbol, setSimSymbol] = useState<string>('BTC/USDT');
  const [simSide, setSimSide] = useState<'BUY' | 'SELL'>('BUY');
  const [simQuantity, setSimQuantity] = useState<number>(0.1);
  const [simStopLoss, setSimStopLoss] = useState<string>('66000');
  const [gateSimResult, setGateSimResult] = useState<PermissionGateResult | null>(null);
  const [isSimulatingGate, setIsSimulatingGate] = useState(false);
  const [brokerError, setBrokerError] = useState<string | null>(null);

  const fetchBrokerTruth = async () => {
    try {
      const res = await fetch('/api/broker/truth');
      if (!res.ok) throw new Error(`Broker truth endpoint returned HTTP ${res.status}`);
      const data = await res.json();
      setBrokerState(data);
      setBrokerError(null);
    } catch (err) {
      setBrokerError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    fetchBrokerTruth();
    const interval = setInterval(fetchBrokerTruth, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleReconcileNow = async () => {
    setIsLoading(true);
    try {
      await onTriggerReconciliation();
      await fetchBrokerTruth();
    } finally {
      setIsLoading(false);
    }
  };

  const handleModifyStop = async (symbol: string, currentStop: number) => {
    const inputVal = stopInputs[symbol];
    const newStop = parseFloat(inputVal);
    if (isNaN(newStop) || newStop <= 0) {
      setStopFeedback((prev) => ({
        ...prev,
        [symbol]: { type: 'error', message: 'Enter a valid positive stop price.' },
      }));
      return;
    }

    try {
      const res = await onModifyStopLoss(symbol, newStop);
      setStopFeedback((prev) => ({
        ...prev,
        [symbol]: {
          type: res.success ? 'success' : 'error',
          message: res.message,
        },
      }));
      if (res.success) await fetchBrokerTruth();
    } catch (error) {
      setStopFeedback((prev) => ({
        ...prev,
        [symbol]: { type: 'error', message: error instanceof Error ? error.message : String(error) },
      }));
    }
  };

  const handleRunGateTest = async () => {
    setIsSimulatingGate(true);
    try {
      const res = await fetch('/api/risk/permission-gate/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: simSymbol,
          side: simSide,
          quantity: simQuantity,
          stopLoss: parseFloat(simStopLoss) || 0,
          strategyId: 'strat_trend',
          broker: 'SimulatedInstitutionalBroker',
          clientOrderId: `test_gate_${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `Gate validation returned HTTP ${res.status}`);
      setGateSimResult(data);
    } catch (err) {
      setBrokerError(`Permission-gate validation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSimulatingGate(false);
    }
  };

  const getProvenanceBadge = (prov: DataProvenance) => {
    switch (prov) {
      case 'BROKER_CONFIRMED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> BROKER_CONFIRMED
          </span>
        );
      case 'APP_ESTIMATED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30">
            APP_ESTIMATED
          </span>
        );
      case 'SIMULATED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-500/15 text-purple-300 border border-purple-500/30">
            SIMULATED
          </span>
        );
      case 'THIRD_PARTY':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30">
            THIRD_PARTY
          </span>
        );
      case 'HISTORICAL':
      case 'CACHED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-500/15 text-slate-300 border border-slate-500/30">
            {prov}
          </span>
        );
      case 'STALE':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" /> STALE
          </span>
        );
      case 'UNAVAILABLE':
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
            <XCircle className="w-3 h-3 text-rose-400" /> UNAVAILABLE
          </span>
        );
    }
  };

  const conn = brokerState?.connection;
  const snap = brokerState?.accountSnapshot;
  const pnl = brokerState?.pnlVerification;
  const mt5Snapshot = mt5Connection?.snapshot;
  const mt5Connected = mt5Connection?.status === 'CONNECTED' && !!mt5Snapshot;
  const formatMoney = (value: number | null | undefined) =>
    value == null ? 'Unavailable' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      {brokerError && (
        <div className="rounded border border-rose-600/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-200" role="alert">
          Broker diagnostics or control request failed: {brokerError}
        </div>
      )}
      <Mt5ConnectionWizard authFetch={authFetch} onStateChange={setMt5Connection} />

      {/* 1. Header & Institutional Status */}
      <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-100 tracking-tight">
                  Broker-Truth & Central Permission Gate Engine
                </h2>
                <span className="px-2 py-0.5 bg-sky-500/10 text-sky-300 border border-sky-500/20 rounded font-mono text-[10px]">
                  {mt5Connected ? 'MT5 READ-ONLY CONNECTED' : 'BROKER ACCESS NOT CONFIGURED'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {mt5Connected
                  ? 'MT5 account snapshot is broker-confirmed and read-only; separate broker reconciliation and execution integrations remain unavailable.'
                  : 'Broker account records are unavailable. Market prices shown elsewhere are simulated and are not broker-confirmed.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            onClick={handleReconcileNow}
            disabled={isLoading}
            className="px-3 py-1.5 bg-[#0e1320] hover:bg-slate-800 text-slate-200 border border-white/[0.08] rounded transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Run Local Reconciliation</span>
          </button>
        </div>
      </div>

      {/* 2. Broker and account-data status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
        {/* Card 1: Broker integration status */}
        <div className="p-3.5 bg-[#0a0d15] border border-white/[0.08] rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="flex items-center gap-1.5 text-[11px]">
              <Server className="w-3.5 h-3.5 text-sky-400" /> Broker Integration
            </span>
            <span className={`px-1.5 py-0.5 text-[10px] rounded border ${
              mt5Connected
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}>
              {mt5Connected ? 'AUTHENTICATED_READ_ONLY' : conn?.connectionHealth || 'UNAUTHENTICATED'}
            </span>
          </div>
          <div className="text-slate-100 font-bold text-sm truncate" title={mt5Snapshot?.broker || conn?.brokerName || undefined}>
            {mt5Connected ? mt5Snapshot.broker : conn?.brokerName || 'Not configured'}
          </div>
          <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
            <span>Server: {mt5Connected ? mt5Snapshot.server : conn?.server || 'Unavailable'}</span>
            <span>{conn?.pingLatencyMs == null ? 'Latency unavailable' : `${conn.pingLatencyMs}ms ping`}</span>
          </div>
        </div>

        {/* Card 2: Account Identity & Integration Status */}
        <div className="p-3.5 bg-[#0a0d15] border border-white/[0.08] rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="flex items-center gap-1.5 text-[11px]">
              <Lock className="w-3.5 h-3.5 text-purple-400" /> Account Identity
            </span>
            <span className="text-[10px] text-sky-400 font-bold">
              {mt5Connected ? mt5Snapshot.accountType : conn?.accountMode || 'UNKNOWN'}
            </span>
          </div>
          <div className="text-slate-100 font-bold text-sm">
            {mt5Connected
              ? `${mt5Snapshot.maskedAccountId} (${mt5Snapshot.currency})`
              : `${conn?.accountId || 'Identity unavailable'} (${conn?.currency || 'Currency unavailable'})`}
          </div>
          <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
            <span>Leverage: {conn?.leverage == null ? 'Unavailable' : `${conn.leverage}:1`}</span>
            <span className={mt5Connected ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
              {mt5Connected ? 'READ-ONLY VERIFIED · EXECUTION DISABLED' : 'READ-ONLY AUTH NOT ESTABLISHED'}
            </span>
          </div>
        </div>

        {/* Card 3: Broker account balance and equity */}
        <div className="p-3.5 bg-[#0a0d15] border border-white/[0.08] rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="flex items-center gap-1.5 text-[11px]">
              <DollarSign className="w-3.5 h-3.5 text-amber-400" /> Broker Equity
            </span>
            {mt5Connected
              ? getProvenanceBadge(mt5Snapshot.provenance)
              : snap ? getProvenanceBadge(snap.provenance) : null}
          </div>
          <div className="text-slate-100 font-bold text-lg">
            {formatMoney(mt5Connected ? mt5Snapshot.equity : snap?.equity)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
            <span>Balance: {formatMoney(mt5Connected ? mt5Snapshot.balance : snap?.balance)}</span>
            <span>Free margin: {formatMoney(mt5Connected ? mt5Snapshot.freeMargin : snap?.freeMargin)}</span>
          </div>
        </div>

        {/* Card 4: Reconciliation Integrity */}
        <div className="p-3.5 bg-[#0a0d15] border border-white/[0.08] rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="flex items-center gap-1.5 text-[11px]">
              <Database className="w-3.5 h-3.5 text-amber-400" /> Ledger Integrity
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
              brokerState?.reconciliationStatus.status === 'RECONCILED'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            }`}>
              {brokerState?.reconciliationStatus.status || 'UNAVAILABLE'}
            </span>
          </div>
          <div className="text-slate-100 font-bold text-sm">
            {brokerState?.reconciliationStatus.unresolvedDiscrepancies ?? 'Unknown'} Unresolved Discrepancies
          </div>
          <div className="text-[10px] text-slate-400 mt-1 truncate" title={brokerState?.reconciliationStatus.details}>
            {brokerState?.reconciliationStatus.details || 'Broker reconciliation unavailable.'}
          </div>
        </div>
      </div>

      {/* 3. Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] pb-2 font-mono text-xs">
        {[
          { id: 'OVERVIEW', label: 'Broker Positions & Deals' },
          { id: 'PNL_AUDIT', label: 'P&L Audit & Discrepancies' },
          { id: 'QUOTES_PROVENANCE', label: 'Quote Provenance Matrix' },
          { id: 'GATE_VALIDATOR', label: 'Central Permission Gate' },
          { id: 'STOPS_DISCIPLINE', label: 'Protective Stop Management' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3 py-1.5 rounded transition-colors font-bold ${
              activeTab === tab.id
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Verified Positions & Deals */}
      {activeTab === 'OVERVIEW' && (
        <div className="space-y-4">
          <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide mb-3 font-mono flex items-center justify-between">
              <span>Broker Active Positions ({mt5Connected ? mt5Snapshot.positions.length : brokerState?.positions.length || 0})</span>
              <span className="text-[10px] text-slate-400 font-normal">
                {mt5Connected ? `${mt5Snapshot.positions.length} MT5 positions shown in the connection snapshot above` : 'Read-only broker integration not configured'}
              </span>
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#070910] border-b border-white/[0.06] text-[10px] text-slate-400 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Ticket</th>
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3">Lots</th>
                    <th className="py-2.5 px-3">Open</th>
                    <th className="py-2.5 px-3">Market</th>
                    <th className="py-2.5 px-3">Stop Loss</th>
                    <th className="py-2.5 px-3">Take Profit</th>
                    <th className="py-2.5 px-3">Broker P&L</th>
                    <th className="py-2.5 px-3">App Estimate</th>
                    <th className="py-2.5 px-3">Discrepancy</th>
                    <th className="py-2.5 px-3">Provenance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] tabular-nums">
                  {(!brokerState?.positions || brokerState.positions.length === 0) ? (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-slate-500">
                        {mt5Connected
                          ? 'Verified MT5 positions are listed in the read-only connection snapshot above.'
                          : 'Broker positions are unavailable until an authenticated account-data integration is configured.'}
                      </td>
                    </tr>
                  ) : (
                    brokerState.positions.map((p) => {
                      const isProfit = p.brokerReportedProfit >= 0;
                      return (
                        <tr key={p.ticket} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 px-3 text-slate-400 font-semibold">{p.ticket}</td>
                          <td className="py-2.5 px-3 text-slate-100 font-bold">{p.symbol}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              p.side === 'BUY' ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
                            }`}>
                              {p.side}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-200">{p.lots}</td>
                          <td className="py-2.5 px-3 text-slate-300">${p.openPrice}</td>
                          <td className="py-2.5 px-3 text-slate-100 font-semibold">${p.currentPrice}</td>
                          <td className="py-2.5 px-3 text-rose-400 font-bold">${p.stopLoss}</td>
                          <td className="py-2.5 px-3 text-emerald-400">{p.takeProfit ? `$${p.takeProfit}` : '—'}</td>
                          <td className="py-2.5 px-3 font-bold">
                            <span className={isProfit ? 'text-emerald-400' : 'text-rose-400'}>
                              {isProfit ? '+' : ''}${p.brokerReportedProfit.toFixed(2)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">${p.appEstimatedProfit.toFixed(2)}</td>
                          <td className="py-2.5 px-3">
                            <span className={p.discrepancyUSD > 1.0 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                              ${p.discrepancyUSD.toFixed(2)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">{getProvenanceBadge(p.provenance)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Broker Closed Deals History */}
          <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide mb-3 font-mono flex items-center justify-between">
              <span>Broker Deals History ({brokerState?.deals.length || 0})</span>
              <span className="text-[10px] text-slate-400 font-normal">Broker deal history unavailable</span>
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#070910] border-b border-white/[0.06] text-[10px] text-slate-400 uppercase">
                  <tr>
                    <th className="py-2 px-3">Deal Ticket</th>
                    <th className="py-2 px-3">Order Ticket</th>
                    <th className="py-2 px-3">Time</th>
                    <th className="py-2 px-3">Symbol</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Volume</th>
                    <th className="py-2 px-3">Fill Price</th>
                    <th className="py-2 px-3">Commission</th>
                    <th className="py-2 px-3">Swap</th>
                    <th className="py-2 px-3">Fee</th>
                    <th className="py-2 px-3">Deal Profit</th>
                    <th className="py-2 px-3">Provenance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] tabular-nums text-[11px]">
                  {brokerState?.deals.length === 0 ? (
                    <tr><td colSpan={12} className="py-8 text-center text-slate-500">Broker deals are unavailable until an authenticated account-data integration is configured.</td></tr>
                  ) : brokerState?.deals.map((d) => (
                    <tr key={d.ticket} className="hover:bg-white/[0.02]">
                      <td className="py-2 px-3 text-slate-300">{d.ticket}</td>
                      <td className="py-2 px-3 text-slate-500">{d.orderTicket}</td>
                      <td className="py-2 px-3 text-slate-400">{new Date(d.time).toLocaleTimeString()}</td>
                      <td className="py-2 px-3 font-bold text-slate-200">{d.symbol}</td>
                      <td className="py-2 px-3 text-sky-400">{d.dealType}</td>
                      <td className="py-2 px-3 text-slate-300">{d.lots}</td>
                      <td className="py-2 px-3 text-slate-100">${d.price}</td>
                      <td className="py-2 px-3 text-slate-400">-${d.commission.toFixed(2)}</td>
                      <td className="py-2 px-3 text-slate-400">${d.swap.toFixed(2)}</td>
                      <td className="py-2 px-3 text-slate-400">-${d.fee.toFixed(2)}</td>
                      <td className="py-2 px-3 font-bold text-slate-100">
                        {d.profit !== 0 ? (d.profit > 0 ? `+$${d.profit.toFixed(2)}` : `-$${Math.abs(d.profit).toFixed(2)}`) : '—'}
                      </td>
                      <td className="py-2 px-3">{getProvenanceBadge(d.provenance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: P&L Verification Audit & Discrepancies */}
      {activeTab === 'PNL_AUDIT' && pnl && (
        <div className="space-y-4 font-mono">
          <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] mb-4">
              <div>
                <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                  Profit & Loss Reconciliation Audit
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Broker-reported P&L and transaction costs remain unavailable until account data is connected.
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                pnl.hasDiscrepancy == null
                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                  : pnl.hasDiscrepancy
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              }`}>
                {pnl.hasDiscrepancy == null ? 'UNAVAILABLE' : pnl.hasDiscrepancy ? 'DISCREPANCY EXPLAINED' : 'BALANCED & AUDITED'}
              </span>
            </div>

            {/* Side-by-Side Verification Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="p-3.5 bg-[#06080e] border border-white/[0.06] rounded">
                <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                  <span>Broker-Reported Total P&L</span>
                  <span className="text-rose-400 text-[10px]">UNAVAILABLE</span>
                </div>
                <div className="text-xl font-bold text-slate-400">
                  {pnl.brokerReportedTotalPnL == null ? 'Unavailable' : formatMoney(pnl.brokerReportedTotalPnL)}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Realized: {formatMoney(pnl.realizedPnL)} | Unrealized: {formatMoney(pnl.unrealizedPnL)}
                </div>
              </div>

              <div className="p-3.5 bg-[#06080e] border border-white/[0.06] rounded">
                <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                  <span>App Independent Estimate</span>
                  <span className="text-sky-400 text-[10px]">{pnl.appCalculatedTotalPnL == null ? 'UNAVAILABLE' : 'COMPUTED'}</span>
                </div>
                <div className={`text-xl font-bold ${pnl.appCalculatedTotalPnL == null ? 'text-slate-400' : pnl.appCalculatedTotalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatMoney(pnl.appCalculatedTotalPnL)}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Gross Price P&L: {formatMoney(pnl.grossPnL)}
                </div>
              </div>

              <div className="p-3.5 bg-[#06080e] border border-white/[0.06] rounded">
                <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                  <span>Net Ledger Delta</span>
                  <span className={pnl.netDiscrepancy == null ? 'text-rose-400 text-[10px]' : pnl.netDiscrepancy > 1.0 ? 'text-amber-400 text-[10px]' : 'text-slate-500 text-[10px]'}>
                    {pnl.netDiscrepancy == null ? 'UNAVAILABLE' : pnl.netDiscrepancy > 1.0 ? 'EXPLAINED' : 'ZERO DELTA'}
                  </span>
                </div>
                <div className="text-xl font-bold text-slate-100">
                  {formatMoney(pnl.netDiscrepancy)}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Never silently overwritten
                </div>
              </div>
            </div>

            {/* Itemized Cost Breakdown Table */}
            <div className="p-3.5 bg-[#06080e] border border-white/[0.06] rounded mb-3">
              <h4 className="text-[11px] font-bold text-slate-300 uppercase mb-2">Itemized Friction & Fee Breakdown</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block text-[10px]">Commissions Paid</span>
                  <span className="text-slate-200 font-bold">{formatMoney(pnl.totalCommissions)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Regulatory Fees</span>
                  <span className="text-slate-200 font-bold">{formatMoney(pnl.totalFees)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Overnight Swaps</span>
                  <span className="text-slate-200 font-bold">{formatMoney(pnl.totalSwaps)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">FX Conversion Delta</span>
                  <span className="text-slate-200 font-bold">{formatMoney(pnl.currencyConversionAdjustment)}</span>
                </div>
              </div>
            </div>

            {pnl.discrepancyExplanation && (
              <div className="p-3 bg-amber-950/20 border border-amber-500/30 rounded text-xs text-amber-200">
                <strong>Audit Explanation:</strong> {pnl.discrepancyExplanation}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Quotes Provenance & Freshness Matrix */}
      {activeTab === 'QUOTES_PROVENANCE' && (
        <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm font-mono">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] mb-3">
            <div>
              <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                Quote Provenance & Traceability Matrix
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Local simulated quotes are identified separately; no broker symbol mapping or broker ticket is available.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#070910] border-b border-white/[0.06] text-[10px] text-slate-400 uppercase">
                <tr>
                  <th className="py-2.5 px-3">Broker Symbol</th>
                  <th className="py-2.5 px-3">App Symbol</th>
                  <th className="py-2.5 px-3">Broker Ticket</th>
                  <th className="py-2.5 px-3">Bid</th>
                  <th className="py-2.5 px-3">Ask</th>
                  <th className="py-2.5 px-3">Spread</th>
                  <th className="py-2.5 px-3">Quote Age</th>
                  <th className="py-2.5 px-3">Health</th>
                  <th className="py-2.5 px-3">Data Provenance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] tabular-nums">
                {brokerState?.quotes.map((q) => {
                  const validPrices = Number.isFinite(q.bid) && Number.isFinite(q.ask) && q.bid > 0 && q.ask >= q.bid;
                  const spreadPct = validPrices ? `${(((q.ask - q.bid) / q.bid) * 100).toFixed(3)}%` : 'Unavailable';
                  return (
                    <tr key={q.appSymbol} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-bold text-slate-400">{q.brokerSymbol || 'Unavailable'}</td>
                      <td className="py-2.5 px-3 text-slate-400">{q.appSymbol}</td>
                      <td className="py-2.5 px-3 text-slate-500">{q.ticketOrSeq == null ? '—' : `#${q.ticketOrSeq}`}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-100">{validPrices ? `$${q.bid}` : 'Unavailable'}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-100">{validPrices ? `$${q.ask}` : 'Unavailable'}</td>
                      <td className="py-2.5 px-3 text-slate-400">{spreadPct}</td>
                      <td className="py-2.5 px-3">
                        <span className={q.quoteAgeMs == null || q.quoteAgeMs > 30000 ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                          {q.quoteAgeMs == null ? 'Unavailable' : `${q.quoteAgeMs}ms`}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          q.connectionHealth === 'HEALTHY' ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'
                        }`}>
                          {q.connectionHealth}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">{getProvenanceBadge(q.provenance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Central Permission Gate Live Inspector */}
      {activeTab === 'GATE_VALIDATOR' && (
        <div className="space-y-4 font-mono">
          <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-5 shadow-sm">
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide mb-1">
              Central Permission Gate — Unified Invariant Tester
            </h3>
            <p className="text-[11px] text-slate-400 mb-4">
              All automated entry paths must pass this single server-side gate. If any critical check fails, risk-increasing orders are deterministically rejected.
            </p>

            {/* Test Form */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3 bg-[#06080e] border border-white/[0.06] rounded mb-4 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Symbol</label>
                <select
                  value={simSymbol}
                  onChange={(e) => setSimSymbol(e.target.value)}
                  className="w-full bg-[#0c101a] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-200"
                >
                  {instruments.map((i) => (
                    <option key={i.symbol} value={i.symbol}>{i.symbol} ({i.assetClass})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Side</label>
                <select
                  value={simSide}
                  onChange={(e) => setSimSide(e.target.value as any)}
                  className="w-full bg-[#0c101a] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-200"
                >
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Quantity</label>
                <input
                  type="number"
                  step="any"
                  value={simQuantity}
                  onChange={(e) => setSimQuantity(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#0c101a] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-200"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Protective Stop Loss</label>
                <input
                  type="number"
                  step="any"
                  value={simStopLoss}
                  onChange={(e) => setSimStopLoss(e.target.value)}
                  className="w-full bg-[#0c101a] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-200"
                />
              </div>
            </div>

            <div className="flex justify-end mb-4">
              <button
                onClick={handleRunGateTest}
                disabled={isSimulatingGate}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{isSimulatingGate ? 'Evaluating Gate...' : 'Run Central Permission Gate Check'}</span>
              </button>
            </div>

            {/* Results breakdown */}
            {gateSimResult && (
              <div className="space-y-3">
                <div className={`p-3 rounded border flex items-center justify-between ${
                  gateSimResult.approved
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                }`}>
                  <div className="flex items-center gap-2">
                    {gateSimResult.approved ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400" />
                    )}
                    <div>
                      <span className="font-bold text-sm block">
                        GATE RESULT: {gateSimResult.approved ? 'ORDER PERMITTED TO ROUTE' : 'REJECTED FAIL-CLOSED'}
                      </span>
                      <span className="text-xs text-slate-300">{gateSimResult.message}</span>
                    </div>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-black/40 border border-white/[0.08]">
                    {gateSimResult.gateCode}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {gateSimResult.checks.map((chk, idx) => (
                    <div
                      key={chk.code}
                      className={`p-3 rounded border text-xs flex items-start gap-2.5 ${
                        chk.passed
                          ? 'bg-[#06080e] border-white/[0.06] text-slate-300'
                          : 'bg-rose-950/20 border-rose-800/80 text-rose-200'
                      }`}
                    >
                      <div className="mt-0.5">
                        {chk.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-bold text-slate-200">
                            Stage {idx + 1}: {chk.name}
                          </span>
                          <span className={chk.passed ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                            {chk.passed ? 'PASSED' : 'FAILED'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">{chk.details}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Protective Stop Management & Stop Widening Prohibition */}
      {activeTab === 'STOPS_DISCIPLINE' && (
        <div className="space-y-4 font-mono">
          <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] mb-4">
              <div>
                <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                  Protective Stop-Loss Discipline & Risk Reduction
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  These rules apply to local PAPER state only. Instrument ticks, broker costs, volatility calibration, and server-side stop behavior are not verified.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> STOP WIDENING PROHIBITED
              </span>
            </div>

            {/* Documented Rules Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              {brokerState?.stopRules.map((rule) => (
                <div key={rule.symbol} className="p-3 bg-[#06080e] border border-white/[0.06] rounded text-xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-slate-200">{rule.symbol}</span>
                    <span className="text-[10px] text-sky-400">{rule.strategyId}</span>
                  </div>
                  <div className="space-y-1 text-[11px] text-slate-400">
                    <div className="flex justify-between">
                      <span>Initial Stop:</span>
                      <span className="text-emerald-400 font-bold">MANDATORY</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Break-Even Trigger:</span>
                      <span className="text-slate-200">{rule.breakEvenThresholdR}R (+{rule.breakEvenBufferPips} cost cushion)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Trailing Method:</span>
                      <span className="text-slate-200">{rule.trailingType} ({rule.trailingParam}x)</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Interactive Stop Modification for Active Positions */}
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide mb-3">
              Ratchet Local Paper Stop (Risk Reducing Only)
            </h4>

            {positions.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No active positions open. Open a position in the Terminal to test protective stop ratcheting.
              </p>
            ) : (
              <div className="space-y-3">
                {positions.map((pos) => {
                  const feedback = stopFeedback[pos.symbol];
                  const stopRule = brokerState?.stopRules.find((rule) => rule.symbol === pos.symbol) ?? brokerState?.stopRules[0];
                  const initialStop = pos.initialStopPrice ?? pos.stopLossPrice;
                  const currentBrokerStop = pos.brokerConfirmedStopPrice ?? null;
                  const pendingStop = typeof pos.pendingStopPrice === 'number' ? pos.pendingStopPrice : null;
                  const remainingRiskUsd = Math.abs(pos.currentPrice - pos.stopLossPrice) * pos.quantity;
                  const instrument = instruments.find((item) => item.symbol === pos.symbol);
                  const estimatedSpreadCost = instrument ? pos.quantity * pos.currentPrice * (instrument.typicalSpreadPct || 0) : 0;
                  const estimatedCommission = instrument
                    ? instrument.commissionType === 'FIXED_PER_UNIT'
                      ? pos.quantity * instrument.commissionPerUnit
                      : pos.quantity * pos.currentPrice * instrument.commissionPerUnit
                    : 1.5;
                  const estimatedCostUsd = Math.max(estimatedSpreadCost + estimatedCommission, 1.5);
                  return (
                    <div key={pos.id} className="p-3.5 bg-[#06080e] border border-white/[0.06] rounded text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-100 text-sm">{pos.symbol}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              pos.side === 'BUY' ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
                            }`}>
                              {pos.side}
                            </span>
                            <span className="text-slate-400">Entry: ${pos.entryPrice}</span>
                            <span className="text-slate-100 font-semibold">Current: ${pos.currentPrice}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1">
                            Current local protective stop: <strong className="text-rose-400">${pos.stopLossPrice}</strong>
                            {pos.side === 'BUY' ? ' (must ratchet UP)' : ' (must ratchet DOWN)'}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="any"
                            placeholder="New Stop Price"
                            value={stopInputs[pos.symbol] || ''}
                            onChange={(e) => setStopInputs({ ...stopInputs, [pos.symbol]: e.target.value })}
                            className="bg-[#0c101a] border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-slate-200 w-32"
                          />
                          <button
                            onClick={() => handleModifyStop(pos.symbol, pos.stopLossPrice)}
                            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded text-xs transition-colors"
                          >
                            Confirm Ratchet
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
                        <div className="p-2 rounded bg-[#0c101a] border border-white/[0.06]">
                          <div className="text-[10px] uppercase text-slate-500">Initial stop</div>
                          <div className="mt-1 text-sm text-slate-100 font-bold">${initialStop.toFixed(2)}</div>
                        </div>
                        <div className="p-2 rounded bg-[#0c101a] border border-white/[0.06]">
                          <div className="text-[10px] uppercase text-slate-500">Broker-confirmed stop</div>
                          <div className="mt-1 text-sm text-slate-100 font-bold">{currentBrokerStop == null ? 'UNAVAILABLE' : `$${currentBrokerStop.toFixed(2)}`}</div>
                        </div>
                        <div className="p-2 rounded bg-[#0c101a] border border-white/[0.06]">
                          <div className="text-[10px] uppercase text-slate-500">Modeled risk left</div>
                          <div className="mt-1 text-sm text-slate-100 font-bold">${remainingRiskUsd.toFixed(2)}</div>
                        </div>
                        <div className="p-2 rounded bg-[#0c101a] border border-white/[0.06]">
                          <div className="text-[10px] uppercase text-slate-500">Estimated costs</div>
                          <div className="mt-1 text-sm text-slate-100 font-bold">${estimatedCostUsd.toFixed(2)}</div>
                        </div>
                        <div className="p-2 rounded bg-[#0c101a] border border-white/[0.06]">
                          <div className="text-[10px] uppercase text-slate-500">Rule</div>
                          <div className="mt-1 text-[10px] text-slate-200">{stopRule ? `${stopRule.trailingType} @ ${stopRule.breakEvenThresholdR}R` : 'LOCAL_PAPER_ONLY'}</div>
                        </div>
                      </div>

                      <div className="mt-3 p-2.5 rounded border border-amber-500/20 bg-amber-500/5 text-[11px] text-amber-200">
                        Stop management rule: {stopRule ? `${stopRule.strategyId} — risk-reducing only; break-even after ${stopRule.breakEvenThresholdR}R and ${stopRule.breakEvenBufferPips} cost cushion; no widening or removal allowed.` : 'No verified broker rule available. Local paper state only.'}
                      </div>

                      {pendingStop != null && pendingStop !== (pos.lastConfirmedStopPrice ?? pos.stopLossPrice) && (
                        <div className="mt-3 p-2 rounded border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-200">
                          Unconfirmed local change pending: ${pendingStop.toFixed(2)}. Broker-side confirmation is required before this value is displayed as active in a live account.
                        </div>
                      )}

                      {feedback && (
                        <div className={`w-full p-2 rounded text-[11px] mt-3 ${
                          feedback.type === 'success' ? 'bg-emerald-950/30 text-emerald-300 border border-emerald-500/30' : 'bg-rose-950/30 text-rose-300 border border-rose-500/30'
                        }`}>
                          {feedback.message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
