import React, { useEffect, useState } from 'react';
import { RiskLimits, PortfolioSummary, StrategyConfig } from '../types/trading';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Power,
  RotateCcw,
  SlidersHorizontal,
  Percent,
  TrendingDown,
  Gauge,
  CheckCircle2,
} from 'lucide-react';

interface RiskTowerViewProps {
  limits: RiskLimits;
  portfolio: PortfolioSummary;
  strategies: StrategyConfig[];
  onUpdateLimits: (newLimits: Partial<RiskLimits>) => Promise<{ success: boolean; message: string }>;
  onToggleKillSwitch: (active: boolean) => void;
  onResetDailyLoss: () => void;
  onQuarantineStrategy: (strategyId: string, suspended: boolean) => void;
  onCancelAllOrders: () => void;
}

export const RiskTowerView: React.FC<RiskTowerViewProps> = ({
  limits,
  portfolio,
  strategies,
  onUpdateLimits,
  onToggleKillSwitch,
  onResetDailyLoss,
  onQuarantineStrategy,
  onCancelAllOrders,
}) => {
  const [editableLimits, setEditableLimits] = useState<RiskLimits>({ ...limits });
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveSucceeded, setSaveSucceeded] = useState<boolean | null>(null);

  useEffect(() => {
    setEditableLimits({ ...limits });
  }, [limits]);

  const handleSave = async () => {
    try {
      const res = await onUpdateLimits(editableLimits);
      setSaveStatus(res.message);
      setSaveSucceeded(res.success);
      setTimeout(() => {
        setSaveStatus(null);
        setSaveSucceeded(null);
      }, 6000);
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Risk-limit update failed.');
      setSaveSucceeded(false);
    }
  };

  const dailyLossPct = portfolio.dailyLossPct;
  const isLossBreached = portfolio.isDailyLossHalted;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      {/* 1. Risk Utilization Gauges & Live Health Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Daily Loss vs Limit */}
        <div className={`p-4 rounded-lg border flex flex-col justify-between transition-all ${
          isLossBreached
            ? 'bg-rose-950/30 border-rose-600/80 shadow-[0_0_15px_rgba(244,63,94,0.15)]'
            : 'bg-[#0a0d15] border-white/[0.08]'
        }`}>
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Daily Loss Breaker</span>
              <span className="font-mono text-slate-300 tabular-nums">Ceiling: {limits.dailyLossShutdownPct}%</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-2xl font-bold font-mono tabular-nums ${
                isLossBreached ? 'text-rose-400' : 'text-slate-100'
              }`}>
                {dailyLossPct.toFixed(2)}%
              </span>
              <span className="text-xs text-slate-500 font-mono">of SOD equity</span>
            </div>
          </div>

          <div className="mt-3.5">
            <div className="w-full bg-[#06080e] h-2 rounded-full overflow-hidden border border-white/[0.05]">
              <div
                className={`h-full transition-all ${
                  isLossBreached ? 'bg-rose-500' : dailyLossPct > 0.7 ? 'bg-amber-400' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, (dailyLossPct / limits.dailyLossShutdownPct) * 100)}%` }}
              />
            </div>
            {isLossBreached ? (
              <span className="text-[11px] text-rose-400 font-bold block mt-1.5 font-mono">
                CIRCUIT BREAKER ENGAGED: RISK-INCREASING ORDERS BLOCKED
              </span>
            ) : (
              <span className="text-[10px] text-slate-500 font-mono block mt-1 tabular-nums">
                {(limits.dailyLossShutdownPct - dailyLossPct).toFixed(2)}% daily buffer remaining
              </span>
            )}
          </div>
        </div>

        {/* Metric 2: Portfolio Open Risk Budget */}
        <div className="p-4 bg-[#0a0d15] border border-white/[0.08] rounded-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Open Risk Budget</span>
              <span className="font-mono text-slate-300 tabular-nums">Ceiling: {limits.portfolioOpenRiskBudgetPct}%</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-100">
                {portfolio.openRiskBudgetPct.toFixed(2)}%
              </span>
              <span className="text-xs text-slate-500 font-mono">sum of stop distances</span>
            </div>
          </div>

          <div className="mt-3.5">
            <div className="w-full bg-[#06080e] h-2 rounded-full overflow-hidden border border-white/[0.05]">
              <div
                className="h-full bg-sky-500 transition-all"
                style={{ width: `${Math.min(100, (portfolio.openRiskBudgetPct / limits.portfolioOpenRiskBudgetPct) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500 font-mono block mt-1 tabular-nums">
              {(limits.portfolioOpenRiskBudgetPct - portfolio.openRiskBudgetPct).toFixed(2)}% open risk capacity remaining
            </span>
          </div>
        </div>

        {/* Metric 3: Portfolio Gross Leverage */}
        <div className="p-4 bg-[#0a0d15] border border-white/[0.08] rounded-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Gross Leverage</span>
              <span className="font-mono text-slate-300 tabular-nums">Ceiling: {limits.maxLeverage}x</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-100">
                {portfolio.grossLeverage.toFixed(2)}x
              </span>
              <span className="text-xs text-slate-500 font-mono">gross notional / equity</span>
            </div>
          </div>

          <div className="mt-3.5">
            <div className="w-full bg-[#06080e] h-2 rounded-full overflow-hidden border border-white/[0.05]">
              <div
                className="h-full bg-purple-500 transition-all"
                style={{ width: `${Math.min(100, (portfolio.grossLeverage / limits.maxLeverage) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500 font-mono block mt-1 tabular-nums">
              Cash: ${portfolio.cashBalance.toLocaleString()} · Used Margin: ${portfolio.usedMargin.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Metric 4: Max Drawdown Tracker */}
        <div className="p-4 bg-[#0a0d15] border border-white/[0.08] rounded-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Current Drawdown</span>
              <span className="font-mono text-slate-300 tabular-nums">Ceiling: {limits.maxDrawdownHaltPct}%</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-100">
                {portfolio.currentDrawdownPct.toFixed(2)}%
              </span>
              <span className="text-xs text-slate-500 font-mono">from peak equity</span>
            </div>
          </div>

          <div className="mt-3.5">
            <div className="w-full bg-[#06080e] h-2 rounded-full overflow-hidden border border-white/[0.05]">
              <div
                className="h-full bg-amber-500 transition-all"
                style={{ width: `${Math.min(100, (portfolio.currentDrawdownPct / limits.maxDrawdownHaltPct) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500 font-mono block mt-1 tabular-nums">
              Historical Max Drawdown: {portfolio.maxDrawdownPct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* 2. Emergency Operations Bar */}
      <div className="p-4 bg-[#0c101a] border border-white/[0.08] rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
              Emergency Safeguards & Kill Switches
            </h3>
            <p className="text-[11px] text-slate-400">
              The halt blocks new risk-increasing entries and cancels open local orders. Existing positions are not closed; their local paper stops remain under simulator management.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Daily loss breaker reset */}
          {isLossBreached && (
            <button
              onClick={() => {
                onResetDailyLoss();
              }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Daily Loss Breaker</span>
            </button>
          )}

          {/* Mass cancel open orders */}
          <button
            onClick={onCancelAllOrders}
            title="Cancels all non-terminal orders in the local paper ledger. It does not send a broker cancel request."
            className="px-3.5 py-1.5 bg-[#0e1320] hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded border border-white/[0.08] transition-colors"
          >
            Cancel All Open Local Orders
          </button>

          {/* Global Kill Switch */}
          <button
            onClick={() => onToggleKillSwitch(!portfolio.isGlobalKillSwitched)}
            title="Halts new entries and cancels all open local orders. Existing positions remain open."
            className={`px-4 py-1.5 font-bold font-mono text-xs rounded transition-all flex items-center gap-2 shadow-sm ${
              portfolio.isGlobalKillSwitched
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                : 'bg-rose-950/50 text-rose-300 border border-rose-600/50 hover:bg-rose-900/50'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{portfolio.isGlobalKillSwitched ? 'DISARM KILL SWITCH' : 'ENGAGE GLOBAL KILL SWITCH'}</span>
          </button>
        </div>
      </div>

      {/* 3. Strategy Quarantine Controls & Parameter Ceilings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Strategy Quarantine Matrix (5 cols) */}
        <div className="lg:col-span-5 bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4">
          <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide mb-3 pb-2 border-b border-white/[0.06]">
            Per-Strategy Quarantine Matrix
          </h3>

          <div className="space-y-3">
            {strategies.map((strat) => {
              const cd = strat.cooldown;
              const isCdActive = cd?.active && cd.remainingSeconds > 0;

              return (
                <div
                  key={strat.id}
                  className={`p-3 bg-[#070910] border rounded transition-all ${
                    isCdActive
                      ? 'border-amber-500/60 bg-amber-950/20'
                      : strat.isSuspended
                      ? 'border-rose-500/40'
                      : 'border-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-xs text-slate-200 flex items-center gap-2">
                        <span>{strat.name}</span>
                        {isCdActive && (
                          <span className="text-[10px] text-amber-300 font-mono px-1.5 py-0.2 bg-amber-500/10 border border-amber-500/30 rounded">
                            COOLDOWN: {cd.remainingSeconds}s REMAINING
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5 tabular-nums flex items-center gap-2">
                        <span>Consecutive Losses: <strong className={strat.consecutiveLosses >= 4 ? 'text-amber-400' : 'text-slate-200'}>{strat.consecutiveLosses}</strong> / {limits.maxConsecutiveLosses || 5} Max</span>
                        <span>·</span>
                        <span className="text-amber-400 font-medium">
                          {strat.autoExecutionDisabled ? 'Automated entries paused' : 'Research only · routing disabled'}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => onQuarantineStrategy(strat.id, !strat.isSuspended)}
                      className={`px-2.5 py-1 text-xs font-mono font-semibold rounded transition-colors ${
                        strat.isSuspended
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {strat.isSuspended ? 'Quarantined' : 'Quarantine'}
                    </button>
                  </div>

                  {isCdActive && cd.triggeringTradeIds?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-amber-500/20 text-[10px] font-mono text-amber-300/80">
                      <div>Triggering Losses: {cd.triggeringTradeIds.slice(-5).join(', ')}</div>
                      <div className="text-slate-400 mt-0.5">
                        Mandatory 30m revenge-prevention pause. Auto-execution will resume only after elapsed cooldown and health checks pass.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Deterministic Risk Limits Configuration (7 cols) */}
        <div className="lg:col-span-7 bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.06] mb-4">
            <div>
              <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                Configurable Risk Safeguards
              </h3>
              <p className="text-[11px] text-slate-400">
                Institutional ceilings are enforced deterministically and cannot be overridden.
              </p>
            </div>
            {saveStatus && (
              <span role="status" aria-live="polite" className={`text-xs font-mono ${
                saveSucceeded ? 'text-emerald-400' : 'text-rose-300'
              }`}>{saveStatus}</span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Max Risk per Trade (% Equity) - Hard Cap 1.00%
              </label>
              <input
                type="number"
                step="0.05"
                max={1.0}
                value={editableLimits.maxRiskPerTradePct}
                onChange={(e) =>
                  setEditableLimits({ ...editableLimits, maxRiskPerTradePct: parseFloat(e.target.value) || 0.25 })
                }
                className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Daily Loss Shutdown (% SOD Equity) - Hard Cap 2.50%
              </label>
              <input
                type="number"
                step="0.1"
                max={2.5}
                value={editableLimits.dailyLossShutdownPct}
                onChange={(e) =>
                  setEditableLimits({ ...editableLimits, dailyLossShutdownPct: parseFloat(e.target.value) || 1.0 })
                }
                className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Portfolio Open Risk Budget (%)
              </label>
              <input
                type="number"
                step="0.2"
                value={editableLimits.portfolioOpenRiskBudgetPct}
                onChange={(e) =>
                  setEditableLimits({ ...editableLimits, portfolioOpenRiskBudgetPct: parseFloat(e.target.value) || 2.0 })
                }
                className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Single Asset Concentration Cap (%)
              </label>
              <input
                type="number"
                step="1.0"
                value={editableLimits.maxSingleAssetExposurePct}
                onChange={(e) =>
                  setEditableLimits({ ...editableLimits, maxSingleAssetExposurePct: parseFloat(e.target.value) || 15.0 })
                }
                className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Max Allowed Spread Tolerance (%)
              </label>
              <input
                type="number"
                step="0.01"
                value={editableLimits.maxSpreadTolerancePct}
                onChange={(e) =>
                  setEditableLimits({ ...editableLimits, maxSpreadTolerancePct: parseFloat(e.target.value) || 0.15 })
                }
                className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Max Simultaneous Open Positions
              </label>
              <input
                type="number"
                step="1"
                value={editableLimits.maxSimultaneousPositions}
                onChange={(e) =>
                  setEditableLimits({ ...editableLimits, maxSimultaneousPositions: parseInt(e.target.value, 10) || 8 })
                }
                className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Max Consecutive Losses Before Cooldown (Default 5)
              </label>
              <input
                type="number"
                step="1"
                min={1}
                max={10}
                value={editableLimits.maxConsecutiveLosses || 5}
                onChange={(e) =>
                  setEditableLimits({ ...editableLimits, maxConsecutiveLosses: parseInt(e.target.value, 10) || 5 })
                }
                className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Revenge Cooldown Duration (Min) - Floor 30m
              </label>
              <input
                type="number"
                step="5"
                min={30}
                value={editableLimits.consecutiveLossCooldownMinutes || 30}
                onChange={(e) =>
                  setEditableLimits({ ...editableLimits, consecutiveLossCooldownMinutes: Math.max(30, parseInt(e.target.value, 10) || 30) })
                }
                className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono tabular-nums"
              />
            </div>
          </div>

          <div className="flex justify-end mt-4 pt-3 border-t border-white/[0.06]">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded transition-colors shadow-sm"
            >
              Save Invariant Limits
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
