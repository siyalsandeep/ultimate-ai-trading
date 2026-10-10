import React, { useState } from 'react';
import { SystemHealthReport, AuditLogEntry } from '../types/trading';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ShieldCheck,
  Server,
  Database,
  Radio,
  FileText,
  RotateCcw,
  Activity,
  Layers,
} from 'lucide-react';

interface HealthAuditViewProps {
  health: SystemHealthReport | null;
  auditLogs: AuditLogEntry[];
  onTriggerHealthCheck: () => Promise<void>;
  onRunReconciliation: () => Promise<void>;
}

export const HealthAuditView: React.FC<HealthAuditViewProps> = ({
  health,
  auditLogs,
  onTriggerHealthCheck,
  onRunReconciliation,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isReconciling, setIsReconciling] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [actionIssue, setActionIssue] = useState<string | null>(null);

  const filteredLogs = auditLogs.filter(
    (l) => selectedCategory === 'ALL' || l.category === selectedCategory
  );
  const stateTone = (state?: string) => state === 'HEALTHY'
    ? 'text-emerald-400'
    : state === 'DEGRADED'
      ? 'text-amber-400'
      : 'text-rose-400';
  const downloadJson = (filename: string, report: unknown) => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleReconcile = async () => {
    setIsReconciling(true);
    setActionIssue(null);
    try {
      await onRunReconciliation();
    } catch (error) {
      setActionIssue(error instanceof Error ? error.message : String(error));
    } finally {
      setIsReconciling(false);
    }
  };

  const handleHealthCheck = async () => {
    setIsChecking(true);
    setActionIssue(null);
    try {
      await onTriggerHealthCheck();
    } catch (error) {
      setActionIssue(error instanceof Error ? error.message : String(error));
    } finally {
      setIsChecking(false);
    }
  };

  const comps = health?.components;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      {/* 1. System Health Dashboard & Component Matrix */}
      <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm">
        {actionIssue && (
          <div className="mb-3 rounded border border-rose-600/50 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-200" role="alert">
            Operational action failed: {actionIssue}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-white/[0.06] mb-4 gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                Periodic Application Health Diagnostics
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                health?.overallState === 'HEALTHY'
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : health?.overallState === 'DEGRADED'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
              }`}>
                {health?.overallState || 'CHECKING'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Application diagnostics and data provenance. A healthy simulator is not a connected broker or live-trading approval.
            </p>
            {health && (
              <p className="mt-1 text-[10px] text-slate-500">
                Checked {new Date(health.timestamp).toLocaleString()} · Live execution {health.liveExecutionAuthorized ? 'authorized' : 'disabled'} · Rollout {health.rolloutStage}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReconcile}
              disabled={isReconciling}
              className="px-3.5 py-1.5 bg-[#0e1320] hover:bg-slate-800 text-slate-200 text-xs font-semibold font-mono rounded border border-white/[0.08] transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{isReconciling ? 'Reconciling...' : 'Reconcile State Now'}</span>
            </button>
            <button
              onClick={handleHealthCheck}
              disabled={isChecking}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold font-mono rounded transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              <span>{isChecking ? 'Verifying...' : 'Run Diagnostics'}</span>
            </button>
            <button
              onClick={() => health && downloadJson(`system-diagnostics-${health.timestamp}.json`, health)}
              disabled={!health}
              className="px-3 py-1.5 bg-[#0e1320] hover:bg-slate-800 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded border border-white/[0.08]"
            >
              Export diagnostics
            </button>
          </div>
        </div>

        {/* Component Health Cards */}
        {comps && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
            {/* Component 1: API & Runtime */}
            <div className="p-3 bg-[#06080e] border border-white/[0.06] rounded">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="flex items-center gap-1 text-[11px]">
                  <Server className="w-3 h-3 text-sky-400" /> API Process
                </span>
                <span className={`${stateTone(comps.apiProcess.state)} font-bold`}>{comps.apiProcess.state}</span>
              </div>
              <div className="text-slate-100 font-semibold">
                {comps.apiProcess.latencyMs == null ? 'Latency not measured' : `${comps.apiProcess.latencyMs}ms latency`}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 truncate">{comps.apiProcess.details}</div>
            </div>

            {/* Component 2: State Persistence */}
            <div className="p-3 bg-[#06080e] border border-white/[0.06] rounded">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="flex items-center gap-1 text-[11px]">
                  <Database className="w-3 h-3 text-purple-400" /> Local State / Audit Memory
                </span>
                <span className={`${stateTone(comps.databaseAndState.state)} font-bold`}>{comps.databaseAndState.state}</span>
              </div>
              <div className="text-slate-100 font-semibold">
                {comps.databaseAndState.ordersCount} saved local orders
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                {comps.databaseAndState.auditEventsCount} recent in-memory audit events
              </div>
              <div className="text-[10px] text-slate-500 mt-1 break-words">
                {comps.databaseAndState.details}
              </div>
            </div>

            {/* Component 3: Market Feeds */}
            <div className="p-3 bg-[#06080e] border border-white/[0.06] rounded">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="flex items-center gap-1 text-[11px]">
                  <Radio className="w-3 h-3 text-emerald-400" /> Data Feeds
                </span>
                <span className={`${stateTone(comps.marketDataFeeds.state)} font-bold`}>{comps.marketDataFeeds.state}</span>
              </div>
              <div className="text-slate-100 font-semibold">
                {comps.marketDataFeeds.activeSymbols} symbols · source not broker-verified
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                {comps.marketDataFeeds.staleFeedsCount} Stale Simulated Quotes · Latency {comps.marketDataFeeds.avgLatencyMs == null ? 'not measured' : `${comps.marketDataFeeds.avgLatencyMs}ms`}
              </div>
              <div className="text-[10px] text-amber-300 mt-1">
                {comps.marketDataFeeds.sourceLabel}
              </div>
            </div>

            {/* Component 4: Reconciliation */}
            <div className="p-3 bg-[#06080e] border border-white/[0.06] rounded">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="flex items-center gap-1 text-[11px]">
                  <CheckCircle2 className="w-3 h-3 text-amber-400" /> Reconciliation
                </span>
                <span className={comps.reconciliation.unresolvedDiscrepancies === 0 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {comps.reconciliation.state}
                </span>
              </div>
              <div className="text-slate-100 font-semibold">
                {comps.reconciliation.unresolvedDiscrepancies} local ledger discrepancies
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Local paper ledger · {new Date(comps.reconciliation.lastReconciledAt).toLocaleTimeString()}
              </div>
            </div>
          </div>
        )}
        {!comps && (
          <p className="py-6 text-center text-xs text-slate-400" role="status">
            Waiting for a diagnostics response. No healthy state is assumed.
          </p>
        )}

        {health && health.activeWarnings.length > 0 && (
          <div className="mt-4 border-t border-white/[0.06] pt-3" role="status" aria-live="polite">
            <h4 className="text-[11px] font-semibold text-amber-300 mb-2">Operational notices</h4>
            <ul className="space-y-1 text-[11px] text-amber-200/90">
              {health.activeWarnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
            </ul>
          </div>
        )}

        {/* Broker Adapters Matrix */}
        {comps?.brokerAdapters && (
          <div className="mt-4 pt-3 border-t border-white/[0.06]">
            <h4 className="text-xs font-semibold text-slate-300 mb-2 font-mono flex items-center justify-between">
              <span>Broker Connectivity & Adapter Status Matrix</span>
              <span className="text-[10px] text-slate-500 font-normal">Live order submission blocked for unconfigured gateways</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px] font-mono">
              {comps.brokerAdapters.map((b) => (
                <div key={b.provider} className="p-2.5 bg-[#06080e] border border-white/[0.06] rounded flex flex-col justify-between gap-2">
                  <div className="flex items-start justify-between gap-1">
                    <div>
                      <span className="text-slate-200 block truncate font-semibold">{b.provider}</span>
                      <span className="text-[10px] text-slate-500 block">{b.connectionType}</span>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                      b.state === 'HEALTHY'
                        ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                        : b.state === 'DEGRADED'
                        ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                        : 'text-slate-400 bg-slate-800/60 border border-white/[0.06]'
                    }`}>
                      {b.state === 'UNAVAILABLE' ? 'UNCONFIGURED' : b.state}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate" title={b.details}>
                    {b.details}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Recent Operational Audit Events */}
      <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-white/[0.06] mb-3 gap-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
              Recent Operational Audit Events ({auditLogs.length} in-memory events)
            </h3>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-mono">
            {['ALL', 'RISK_DECISION', 'ORDER_STATE', 'STRATEGY_SIGNAL', 'KILL_SWITCH', 'HEALTH_CHECK', 'RECONCILIATION'].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  selectedCategory === cat
                    ? 'bg-emerald-500/15 text-emerald-300 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
            <button
              onClick={() => downloadJson(`recent-audit-events-${Date.now()}.json`, {
                exportedAt: new Date().toISOString(),
                scope: 'Current in-memory events returned by the server; limited to the recent 100-event window.',
                category: selectedCategory,
                events: filteredLogs,
              })}
              disabled={filteredLogs.length === 0}
              className="ml-2 rounded border border-white/[0.08] bg-[#0c1017] px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              Export visible events
            </button>
          </div>
        </div>

        <div className="space-y-2 max-h-[420px] overflow-y-auto font-mono text-xs pr-1">
          {filteredLogs.length === 0 && (
            <p className="p-4 text-center text-[11px] text-slate-400">
              No matching events in the recent in-memory audit window.
            </p>
          )}
          {filteredLogs.map((log) => (
            <div
              key={log.id}
              className={`p-2.5 rounded border text-[11px] ${
                log.level === 'CRITICAL'
                  ? 'bg-rose-950/25 border-rose-800/80 text-rose-200'
                  : log.level === 'WARNING'
                  ? 'bg-amber-950/20 border-amber-800/80 text-amber-200'
                  : 'bg-[#06080e] border-white/[0.05] text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1 text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-400">[{log.category}]</span>
                  <span className="font-semibold text-slate-100">{log.action}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-500 tabular-nums">
                  <span>Actor: {log.actor}</span>
                  <span>·</span>
                  <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>

              <div className="text-slate-400 text-[10px] bg-black/40 p-1.5 rounded overflow-x-auto">
                {JSON.stringify(log.details)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
