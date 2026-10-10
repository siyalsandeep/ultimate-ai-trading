import React, { useState } from 'react';
import { BacktestRequest, BacktestResult, Instrument } from '../types/trading';
import {
  Play,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  BarChart,
  Percent,
  CheckCircle2,
  AlertCircle,
  Activity,
  Layers,
  Clock,
  ShieldAlert,
} from 'lucide-react';

interface BacktestViewProps {
  instruments: Instrument[];
  onRunBacktest: (req: BacktestRequest) => Promise<BacktestResult>;
}

export const BacktestView: React.FC<BacktestViewProps> = ({
  instruments,
  onRunBacktest,
}) => {
  const [strategyId, setStrategyId] = useState<string>('strat_trend');
  const [symbol, setSymbol] = useState<string>('SPY');
  const [initialCapital, setInitialCapital] = useState<number>(100000);
  const [slippagePct, setSlippagePct] = useState<number>(0.0002);
  const [commissionPerTrade, setCommissionPerTrade] = useState<number>(1.5);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const handleRun = async () => {
    setIsRunning(true);
    setRunError(null);
    try {
      const res = await onRunBacktest({
        strategyId,
        symbol,
        startDate: '2026-04-01',
        endDate: '2026-10-09',
        initialCapital,
        slippageModelPct: slippagePct,
        commissionPerTrade,
        parameters: {},
      });
      setResult(res);
    } catch (error) {
      setResult(null);
      setRunError(error instanceof Error ? error.message : 'Backtest failed.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      {/* 1. Backtest Configuration Controls */}
      <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm">
        {runError && (
          <p className="mb-3 rounded border border-rose-600/50 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-200" role="alert">
            Backtest report unavailable: {runError}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-white/[0.06] mb-4 gap-3">
          <div>
            <h2 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
              Reproducible Backtesting Studio
            </h2>
            <p className="text-[11px] text-slate-400">
              Single chronological 70/30 research split with modeled friction; not a walk-forward validation or evidence of profitability.
            </p>
            <p className="mt-1 text-[11px] text-amber-300">
              Current candle source is simulated. Results are exploratory only and cannot qualify a strategy for selection.
            </p>
          </div>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white font-bold text-xs rounded transition-all shadow-md flex items-center gap-2"
          >
            <Play className={`w-3.5 h-3.5 fill-current ${isRunning ? 'animate-pulse' : ''}`} />
            <span>{isRunning ? 'Simulating Engine...' : 'Run Simulation'}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Strategy</label>
            <select
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
              className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs"
            >
              <option value="strat_trend">Trend Following (EMA+ADX)</option>
              <option value="strat_mean_reversion">Mean Reversion (Bollinger+RSI)</option>
              <option value="strat_momentum">Cross-Asset Momentum</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Symbol Universe</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs"
            >
              {instruments.map((i) => (
                <option key={i.symbol} value={i.symbol}>
                  {i.symbol} ({i.assetClass})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Initial Capital ($)</label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 100000)}
              className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs tabular-nums"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Slippage Friction</label>
            <select
              value={slippagePct}
              onChange={(e) => setSlippagePct(parseFloat(e.target.value))}
              className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs"
            >
              <option value={0.0001}>0.01% (Low Impact)</option>
              <option value={0.0002}>0.02% (Standard)</option>
              <option value={0.0005}>0.05% (Conservative)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Commission per Side ($)</label>
            <input
              type="number"
              step="0.5"
              value={commissionPerTrade}
              onChange={(e) => setCommissionPerTrade(parseFloat(e.target.value) || 1.5)}
              className="w-full bg-[#06080e] border border-white/[0.08] rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* 2. Backtest KPIs & Out-of-Sample Performance */}
      {result && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3 bg-[#0a0d15] border border-white/[0.08] rounded-lg">
              <span className="text-[10px] text-slate-400 font-mono uppercase block">Net Return</span>
              <span className={`text-xl font-bold font-mono tabular-nums ${
                result.netReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {result.netReturnPct >= 0 ? '+' : ''}{result.netReturnPct.toFixed(2)}%
              </span>
              <span className="text-[10px] text-slate-500 font-mono block mt-0.5 tabular-nums">
                Buy & hold: {result.benchmarkReturnPct >= 0 ? '+' : ''}{result.benchmarkReturnPct.toFixed(2)}% · Cash/no-trade: {result.noTradeReturnPct.toFixed(2)}%
              </span>
            </div>

            <div className="p-3 bg-[#0a0d15] border border-white/[0.08] rounded-lg">
              <span className="text-[10px] text-slate-400 font-mono uppercase block">Max Drawdown</span>
              <span className="text-xl font-bold font-mono tabular-nums text-rose-400">
                {result.maxDrawdownPct.toFixed(2)}%
              </span>
              <span className="text-[10px] text-slate-500 font-mono block mt-0.5 tabular-nums">
                Duration: {result.maxDrawdownDurationDays} days
              </span>
            </div>

            <div className="p-3 bg-[#0a0d15] border border-white/[0.08] rounded-lg">
              <span className="text-[10px] text-slate-400 font-mono uppercase block">Sharpe Ratio</span>
              <span className="text-xl font-bold font-mono tabular-nums text-slate-100">
                {result.sharpeRatio.toFixed(2)}
              </span>
              <span className="text-[10px] text-slate-500 font-mono block mt-0.5 tabular-nums">
                Sortino: {result.sortinoRatio.toFixed(2)}
              </span>
            </div>

            <div className="p-3 bg-[#0a0d15] border border-white/[0.08] rounded-lg">
              <span className="text-[10px] text-slate-400 font-mono uppercase block">Profit Factor</span>
              <span className="text-xl font-bold font-mono tabular-nums text-slate-100">
                {result.profitFactor.toFixed(2)}
              </span>
              <span className="text-[10px] text-slate-500 font-mono block mt-0.5 tabular-nums">
                Expectancy: ${result.expectancyUSD}
              </span>
            </div>

            <div className="p-3 bg-[#0a0d15] border border-white/[0.08] rounded-lg">
              <span className="text-[10px] text-slate-400 font-mono uppercase block">Win Rate</span>
              <span className="text-xl font-bold font-mono tabular-nums text-emerald-400">
                {result.winRatePct.toFixed(1)}%
              </span>
              <span className="text-[10px] text-slate-500 font-mono block mt-0.5 tabular-nums">
                {result.winningTrades}W / {result.losingTrades}L
              </span>
            </div>

            <div className="p-3 bg-[#0a0d15] border border-white/[0.08] rounded-lg">
              <span className="text-[10px] text-slate-400 font-mono uppercase block">Total Friction Drag</span>
              <span className="text-xl font-bold font-mono tabular-nums text-slate-300">
                ${(result.totalFeesPaid + result.totalSlippageCost).toFixed(0)}
              </span>
              <span className="text-[10px] text-slate-500 font-mono block mt-0.5 tabular-nums">
                Fees: ${result.totalFeesPaid} · Slip: ${result.totalSlippageCost}
              </span>
            </div>
          </div>

          {/* Equity Curve SVG Chart */}
          <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06] mb-3">
              <span className="text-xs font-bold text-slate-200">
                Simulated equity vs buy-and-hold benchmark ({result.symbol})
              </span>
              <div className="flex items-center gap-4 text-[11px] font-mono">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-2.5 h-1 bg-emerald-400 rounded-full" /> Strategy Equity
                </span>
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-2.5 h-1 bg-slate-500 rounded-full" /> Benchmark (Buy & Hold)
                </span>
              </div>
            </div>

            <div className="w-full h-48 bg-[#07090e] rounded p-2 border border-white/[0.04]">
              <svg viewBox="0 0 600 180" className="w-full h-full">
                <defs>
                  <linearGradient id="eqAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.01" />
                  </linearGradient>
                </defs>

                {/* Horizontal grid lines */}
                {[0.25, 0.5, 0.75].map((r, i) => (
                  <line
                    key={i}
                    x1="0"
                    y1={180 * r}
                    x2="600"
                    y2={180 * r}
                    stroke="#172033"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                ))}

                {/* Benchmark Line */}
                <polyline
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  opacity="0.8"
                  points={result.equityCurve
                    .map((pt, idx) => {
                      const x = (idx / (result.equityCurve.length - 1)) * 600;
                      const y = 170 - ((pt.benchmark - result.initialCapital * 0.9) / (result.initialCapital * 0.35)) * 160;
                      return `${x},${Math.max(10, Math.min(170, y))}`;
                    })
                    .join(' ')}
                />

                {/* Strategy Equity Area Gradient Fill */}
                <path
                  d={
                    result.equityCurve
                      .map((pt, idx) => {
                        const x = (idx / (result.equityCurve.length - 1)) * 600;
                        const y = 170 - ((pt.equity - result.initialCapital * 0.9) / (result.initialCapital * 0.35)) * 160;
                        return `${idx === 0 ? 'M' : 'L'} ${x} ${Math.max(10, Math.min(170, y))}`;
                      })
                      .join(' ') + ' L 600 180 L 0 180 Z'
                  }
                  fill="url(#eqAreaGrad)"
                />

                {/* Strategy Equity Polyline */}
                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2"
                  points={result.equityCurve
                    .map((pt, idx) => {
                      const x = (idx / (result.equityCurve.length - 1)) * 600;
                      const y = 170 - ((pt.equity - result.initialCapital * 0.9) / (result.initialCapital * 0.35)) * 160;
                      return `${x},${Math.max(10, Math.min(170, y))}`;
                    })
                    .join(' ')}
                />
              </svg>
            </div>
          </div>

          {/* Chronological Holdout & Regime Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Single Holdout Split */}
            <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm">
              <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide mb-3 pb-2 border-b border-white/[0.06]">
                Single 70/30 Chronological Holdout
              </h3>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono tabular-nums">
                <div className="p-3 bg-[#06080e] rounded border border-white/[0.06]">
                  <span className="text-slate-500 block text-[10px]">In-Sample Sharpe · {result.validationMetrics.inSampleTrades} closed trades</span>
                  <span className="text-base font-bold text-slate-100">
                    {result.validationMetrics.inSampleSharpe}
                  </span>
                </div>
                <div className="p-3 bg-[#06080e] rounded border border-white/[0.06]">
                  <span className="text-slate-500 block text-[10px]">Holdout Sharpe · {result.validationMetrics.outOfSampleTrades} closed trades</span>
                  <span className="text-base font-bold text-emerald-400">
                    {result.validationMetrics.outOfSampleSharpe}
                  </span>
                </div>
              </div>

              <div className="mt-3 p-2.5 bg-[#0c101a] rounded text-[11px] font-mono text-slate-300 flex items-center justify-between border border-white/[0.06] tabular-nums">
                <span>In-sample to holdout Sharpe change:</span>
                <strong className="text-amber-400">{result.validationMetrics.degradationPct}%</strong>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                Stability across windows and statistical uncertainty are not estimated by this single split; open positions are closed at the split boundary.
              </p>
            </div>

            {/* Regime Breakdown Matrix */}
            <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm">
              <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide mb-3 pb-2 border-b border-white/[0.06]">
                Performance by Market Regime
              </h3>

              <div className="space-y-2 text-xs font-mono tabular-nums">
                {result.regimePerformance.map((rp) => (
                  <div
                    key={rp.regime}
                    className="flex items-center justify-between p-2 bg-[#06080e] rounded border border-white/[0.06]"
                  >
                    <span className="text-slate-300 font-semibold">{rp.regime}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400">{rp.trades} trades</span>
                      <span className="text-slate-400">Win: {rp.winRate}%</span>
                      <span className={`font-bold ${rp.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {rp.netPnL >= 0 ? '+' : ''}${rp.netPnL.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
