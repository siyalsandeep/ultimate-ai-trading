import React, { useState } from 'react';
import { ShieldAlert, CheckCircle2, Lock, X, AlertTriangle } from 'lucide-react';

interface LiveModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmLive: () => void;
}

export const LiveModeModal: React.FC<LiveModeModalProps> = ({
  isOpen,
  onClose,
  onConfirmLive,
}) => {
  const [checklist, setChecklist] = useState({
    paperEvaluated: false,
    drawdownVerified: false,
    brokerKeysEncrypted: false,
    riskLimitsLocked: false,
    regulatoryUnderstood: false,
  });

  if (!isOpen) return null;

  const allChecked = Object.values(checklist).every(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4">
      <div className="bg-[#0b0f19] border border-rose-600/70 rounded-xl max-w-lg w-full p-6 shadow-2xl relative overflow-hidden">
        {/* Soft radial glow at top */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-rose-500/10 to-transparent pointer-events-none" />

        <div className="flex items-center justify-between pb-3.5 border-b border-white/[0.08] relative z-10">
          <div className="flex items-center gap-2.5 text-rose-400">
            <div className="p-1.5 rounded bg-rose-500/15 border border-rose-500/30">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100">Live Execution Preflight Gate</h3>
              <p className="text-[10px] text-slate-400 font-mono">Formal Operator Verification Required</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-white/[0.04] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="my-4 text-xs text-slate-300 leading-relaxed space-y-3 relative z-10">
          <div className="p-3 bg-amber-950/30 rounded border border-amber-600/40 text-amber-200/90 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <p className="leading-snug">
              Live trading requires a verified, production-approved broker gateway. No live broker API keys (Interactive Brokers / Binance / Alpaca) are configured in this deployment. Live execution is technically disabled.
            </p>
          </div>

          <div className="space-y-2.5 pt-1">
            <div className="p-2.5 rounded bg-[#06080e] border border-white/[0.06] text-[11px] text-slate-300 space-y-1">
              <div className="font-semibold text-slate-100 flex items-center gap-1.5 text-xs text-rose-300">
                <Lock className="w-3.5 h-3.5 text-rose-400" />
                <span>Fail-Closed Technical Invariant Active</span>
              </div>
              <p className="text-slate-400 leading-normal">
                All order routing is permanently isolated to the deterministic Paper Execution Engine. Any direct attempt to submit real capital orders to unverified live brokers is blocked fail-closed by the server risk engine with code <code className="text-rose-400 font-mono">ERR_LIVE_TRADING_DISABLED</code>.
              </p>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded hover:bg-white/[0.02] transition-colors">
              <input
                type="checkbox"
                checked={checklist.paperEvaluated}
                onChange={(e) => setChecklist({ ...checklist, paperEvaluated: e.target.checked })}
                className="mt-0.5 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-[11px] text-slate-300">Minimum 30-day paper-trading evaluation required before any production live deployment.</span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded hover:bg-white/[0.02] transition-colors">
              <input
                type="checkbox"
                checked={checklist.drawdownVerified}
                onChange={(e) => setChecklist({ ...checklist, drawdownVerified: e.target.checked })}
                className="mt-0.5 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-[11px] text-slate-300">Maximum drawdown during evaluation strictly maintained below the 5.0% threshold.</span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded hover:bg-white/[0.02] transition-colors">
              <input
                type="checkbox"
                checked={checklist.riskLimitsLocked}
                onChange={(e) => setChecklist({ ...checklist, riskLimitsLocked: e.target.checked })}
                className="mt-0.5 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-[11px] text-slate-300">Deterministic Risk Engine limits locked with hard 0.25% trade risk ceiling and 1% daily loss shutdown.</span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded hover:bg-white/[0.02] transition-colors">
              <input
                type="checkbox"
                checked={checklist.regulatoryUnderstood}
                onChange={(e) => setChecklist({ ...checklist, regulatoryUnderstood: e.target.checked })}
                className="mt-0.5 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-[11px] text-slate-300">
                Acknowledged that algorithmic trading involves material risk and no strategy can guarantee fixed daily profits (5-10%).
              </span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3.5 border-t border-white/[0.08] relative z-10">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#0e1320] hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded border border-white/[0.08] transition-colors"
          >
            Acknowledge & Stay in Paper Mode
          </button>
          <button
            disabled={!allChecked}
            onClick={onConfirmLive}
            className={`px-4 py-2 text-xs font-bold font-mono rounded transition-colors shadow-sm flex items-center gap-1.5 ${
              allChecked
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/[0.04]'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Attempt Live Verification</span>
          </button>
        </div>
      </div>
    </div>
  );
};
