import React from 'react';
import { SystemMode, HealthState, SystemHealthReport } from '../types/trading';
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  Power,
  Layers,
  SlidersHorizontal,
  BarChart2,
  Brain,
  History,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
} from 'lucide-react';

interface HeaderProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  mode: SystemMode;
  onModeSelect: (mode: SystemMode) => void;
  health: SystemHealthReport | null;
  onTriggerHealthCheck: () => void;
  onOpenKillSwitchModal: () => void;
  isKillSwitched: boolean;
  activePositionsCount?: number;
  activeSignalsCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onTabChange,
  mode,
  onModeSelect,
  health,
  onTriggerHealthCheck,
  onOpenKillSwitchModal,
  isKillSwitched,
  activePositionsCount = 0,
  activeSignalsCount = 0,
}) => {
  const overallState = health?.overallState ?? null;

  const navItems = [
    { id: 'terminal', label: 'Terminal', icon: BarChart2, badge: undefined },
    { id: 'broker-truth', label: 'Broker Truth & Gate', icon: ShieldCheck, badge: undefined },
    { id: 'strategies', label: 'Strategies & Regimes', icon: Layers, badge: activeSignalsCount > 0 ? activeSignalsCount : undefined },
    { id: 'risk', label: 'Risk Tower', icon: SlidersHorizontal, badge: undefined },
    { id: 'blotter', label: 'Blotter & Positions', icon: History, badge: activePositionsCount > 0 ? activePositionsCount : undefined },
    { id: 'backtest', label: 'Backtest Studio', icon: Activity, badge: undefined },
    { id: 'ai-lab', label: 'AI Quant Lab', icon: Brain, badge: undefined },
    { id: 'health-audit', label: 'System Health & Audit', icon: CheckCircle2, badge: undefined },
  ];

  return (
    <header className="border-b border-white/[0.07] bg-[#07090e] sticky top-0 z-40 backdrop-blur-md">
      {/* Top Bar: Branding, Operational Mode, Fail-Closed Safety, Health & Kill Switch */}
      <div className="flex flex-wrap items-center justify-between px-4 sm:px-6 py-2.5 gap-3 border-b border-white/[0.05] relative">
        {/* Soft subtle ambient glow at top */}
        <div className="absolute inset-0 pointer-events-none cinematic-glow opacity-60" />

        {/* Brand & Mode */}
        <div className="flex items-center gap-4 relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center w-7 h-7 rounded bg-emerald-500/10 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-slate-100 text-sm">
                  Ultimate AI Trading
                </span>
                <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                  OS v2.4
                </span>
              </div>
            </div>
          </div>

          <div className="h-4 w-[1px] bg-white/[0.08] hidden sm:block" />

          {/* Mode Switcher Segmented Control */}
          <div className="flex items-center bg-[#0c1017] border border-white/[0.08] p-0.5 rounded-md text-xs font-mono">
            <button
              onClick={() => onModeSelect('BACKTEST')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
                mode === 'BACKTEST'
                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Historical backtest replay execution"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${mode === 'BACKTEST' ? 'bg-sky-400' : 'bg-slate-600'}`} />
              <span>BACKTEST</span>
            </button>

            <button
              onClick={() => onModeSelect('PAPER')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
                mode === 'PAPER'
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Local paper execution with simulated quotes only; no broker feed is connected"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${mode === 'PAPER' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              <span>PAPER</span>
            </button>

            <button
              onClick={() => onModeSelect('LIVE')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
                mode === 'LIVE'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Unavailable: no authenticated broker account or live execution adapter is configured"
            >
              <Lock className="w-2.5 h-2.5 text-slate-400" />
              <span>LIVE</span>
            </button>
          </div>
        </div>

        {/* Right side: Safety invariants, System Health, Emergency Kill Switch */}
        <div className="flex items-center gap-3 relative z-10">
          {/* Fail-Closed Indicator */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-[#0c1017] border border-white/[0.08] text-[11px] font-mono text-slate-300 rounded">
            <Lock className={`w-3.5 h-3.5 ${health ? health.liveExecutionAuthorized ? 'text-rose-400' : 'text-amber-400' : 'text-slate-400'}`} />
            <span>{health ? health.liveExecutionAuthorized ? 'LIVE AUTHORIZED' : 'LIVE ROUTING: DISABLED' : 'LIVE AUTH: CHECKING'}</span>
          </div>

          {/* Periodic Health Heartbeat */}
          <button
            onClick={onTriggerHealthCheck}
            title="Periodic health check report (Click to run manual diagnostic)"
            className={`flex items-center gap-2 px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
              overallState === 'HEALTHY'
                ? 'bg-emerald-950/30 text-emerald-300 border-emerald-500/30 hover:bg-emerald-900/30'
                : overallState === 'DEGRADED'
                ? 'bg-amber-950/30 text-amber-300 border-amber-500/30 hover:bg-amber-900/30'
                : overallState === 'UNAVAILABLE'
                  ? 'bg-rose-950/30 text-rose-300 border-rose-500/30 hover:bg-rose-900/30'
                  : 'bg-slate-900 text-slate-300 border-white/10'
            }`}
          >
            {!overallState ? (
              <Activity className="w-3.5 h-3.5 text-slate-400" />
            ) : overallState === 'HEALTHY' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : overallState === 'DEGRADED' ? (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
            )}
            <span className="font-semibold">{overallState || 'CHECKING'}</span>
            <span className="text-[10px] text-slate-400 tabular-nums">
              {health?.components?.apiProcess?.latencyMs == null
                ? 'latency n/m'
                : `${health.components.apiProcess.latencyMs}ms`}
            </span>
          </button>

          {/* High-visibility Emergency Kill Switch */}
          <button
            onClick={onOpenKillSwitchModal}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold font-mono rounded transition-all shadow-sm ${
              isKillSwitched
                ? 'bg-rose-600 text-white ring-2 ring-rose-400/80 shadow-[0_0_16px_rgba(244,63,94,0.4)]'
                : 'bg-rose-950/40 text-rose-300 border border-rose-600/40 hover:bg-rose-900/40 hover:border-rose-500'
            }`}
            title="Emergency halt: blocks new entries and cancels all open local orders; existing positions remain open"
          >
            <Power className="w-3.5 h-3.5" />
            <span>{isKillSwitched ? 'KILL SWITCH ENGAGED' : 'EMERGENCY HALT'}</span>
          </button>
        </div>
      </div>

      {/* Primary Sub-Navigation Bar */}
      <div className="flex items-center px-4 sm:px-6 overflow-x-auto scrollbar-none gap-1 bg-[#080b12]">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`relative flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-emerald-400 text-slate-100 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-white/10'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 rounded font-semibold">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </header>
  );
};
