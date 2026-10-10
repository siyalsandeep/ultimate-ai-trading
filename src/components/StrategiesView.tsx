import React, { useState } from 'react';
import {
  StrategyConfig,
  StrategyDefinition,
  StrategySelectionDecision,
  TradeSignal,
  MarketRegimeType,
} from '../types/trading';
import {
  Layers,
  Power,
  Sliders,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Info,
  ShieldAlert,
} from 'lucide-react';

interface StrategiesViewProps {
  strategies: StrategyConfig[];
  definitions: StrategyDefinition[];
  selection: StrategySelectionDecision | null;
  selectedSymbol: string;
  signals: TradeSignal[];
  onToggleStrategy: (id: string, enabled: boolean) => void;
  onUpdateParams: (id: string, params: Record<string, number | string | boolean>) => Promise<void>;
  onScanSignals: () => Promise<void>;
  onEvaluateSelection: () => Promise<void>;
  currentRegime: MarketRegimeType | 'UNKNOWN';
}

export const StrategiesView: React.FC<StrategiesViewProps> = ({
  strategies,
  definitions,
  selection,
  selectedSymbol,
  signals,
  onToggleStrategy,
  onUpdateParams,
  onScanSignals,
  onEvaluateSelection,
  currentRegime,
}) => {
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>(strategies[0]?.id || 'strat_trend');
  const [editingParams, setEditingParams] = useState<Record<string, number | string | boolean> | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSavingParams, setIsSavingParams] = useState(false);

  const selectedStrategy = strategies.find(s => s.id === selectedStrategyId) || strategies[0];
  const selectedDefinition = definitions.find(definition => definition.id === selectedStrategy?.id);
  const recommendedDefinition = definitions.find(definition => definition.id === selection?.selectedStrategyId);
  const visibleSelection = selection?.symbol === selectedSymbol ? selection : null;

  const handleSaveParams = async () => {
    if (editingParams && selectedStrategy) {
      setIsSavingParams(true);
      setActionError(null);
      try {
        await onUpdateParams(selectedStrategy.id, editingParams);
        setEditingParams(null);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Strategy parameter update failed.');
      } finally {
        setIsSavingParams(false);
      }
    }
  };

  const handleScan = async () => {
    setIsScanning(true);
    setActionError(null);
    try {
      await onScanSignals();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Research signal scan failed.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleEvaluateSelection = async () => {
    setSelectionError(null);
    setIsEvaluating(true);
    try {
      await onEvaluateSelection();
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : 'Strategy evaluation failed.');
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 p-4 sm:p-5">
      {actionError && (
        <div className="lg:col-span-12 rounded border border-rose-600/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-200" role="alert">
          Strategy action failed: {actionError}
        </div>
      )}
      <section className="lg:col-span-12 rounded-lg border border-amber-500/20 bg-[#0a0d15] p-4" aria-labelledby="strategy-selection-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="strategy-selection-title" className="text-xs font-bold uppercase tracking-wider text-slate-100">
              Strategy suitability · {selectedSymbol} · Daily
            </h2>
            <p className="mt-1 text-[11px] text-slate-400">
              Manual evaluation only: no automatic strategy switching or order authorization. Requires verified data and version-matched evidence. Strategy toggles and parameters are process-memory settings and reset on server restart.
            </p>
          </div>
          <button
            type="button"
            onClick={handleEvaluateSelection}
            disabled={isEvaluating}
            className="rounded border border-white/[0.12] bg-[#0c101a] px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {isEvaluating ? 'Evaluating…' : 'Evaluate suitability'}
          </button>
        </div>
        {selectionError && <p role="alert" className="mt-3 text-xs text-rose-300">{selectionError}</p>}
        {visibleSelection ? (
          <div className="mt-4 grid gap-4 border-t border-white/[0.06] pt-3 lg:grid-cols-3">
            <div>
              <p className={`text-sm font-bold ${visibleSelection.decision === 'SELECT' ? 'text-emerald-300' : 'text-amber-300'}`}>
                {visibleSelection.decision === 'SELECT'
                  ? `SELECT · ${visibleSelection.candidates.find(candidate => candidate.strategyId === visibleSelection.selectedStrategyId)?.strategyName}`
                  : 'NO TRADE'}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Condition: {visibleSelection.marketCondition} · Confidence: {visibleSelection.regimeConfidence === null ? 'UNKNOWN' : `${(visibleSelection.regimeConfidence * 100).toFixed(0)}%`} {visibleSelection.regimeConfidenceMethod ? `(${visibleSelection.regimeConfidenceMethod})` : ''}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Data: {visibleSelection.dataStatus} · {visibleSelection.dataProvider || 'No verified provider'} · {visibleSelection.quoteIsBrokerExecutable ? 'Broker executable' : 'Not broker executable'} · Source time: {visibleSelection.sourceTimestamp ? new Date(visibleSelection.sourceTimestamp).toLocaleString() : 'Unavailable'}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Candles: {visibleSelection.candleProvider || 'Unavailable'} · {visibleSelection.candleTimestamp ? new Date(visibleSelection.candleTimestamp).toLocaleString() : 'No source time'} · Spread: {visibleSelection.spreadBasisPoints === null ? 'Unavailable' : `${visibleSelection.spreadBasisPoints.toFixed(2)} bps`} · Session: {visibleSelection.sessionStatus}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Decision reasons</p>
              <ul className="space-y-1 text-[11px] text-slate-300">
                {visibleSelection.reasons.length > 0
                  ? visibleSelection.reasons.map((reason, index) => <li key={index}>• {reason}</li>)
                  : <li>No global blocker; candidate-specific assessments follow.</li>}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Candidate assessment</p>
              <ul className="space-y-2 text-[11px] text-slate-300">
                {visibleSelection.candidates.map(candidate => (
                  <li key={candidate.strategyId}>
                    <strong>{candidate.strategyName} v{candidate.strategyVersion}</strong>
                    <span className={candidate.suitable ? 'ml-2 text-emerald-300' : 'ml-2 text-amber-300'}>
                      {candidate.suitable ? 'SUITABLE' : candidate.validationStatus}
                    </span>
                    {candidate.validationEvidence && (
                      <p className="mt-0.5 text-slate-400">
                        Evidence {candidate.validationEvidence.evidenceId} · Data {candidate.validationEvidence.dataSetId} · Code {candidate.validationEvidence.codeRevision} · OOS trades {candidate.validationEvidence.outOfSampleTrades} / WF windows {candidate.validationEvidence.walkForwardWindows} · Net expectancy {candidate.validationEvidence.outOfSampleNetExpectancyPct}% (95% lower bound {candidate.validationEvidence.netExpectancyLower95Pct}%) · Sharpe {candidate.validationEvidence.outOfSampleSharpe} · Turnover {candidate.validationEvidence.annualizedTurnover} · Costs {candidate.validationEvidence.totalCostsPctOfGrossNotional}% / {candidate.validationEvidence.maximumCostsPctOfGrossNotional}% cap · Drawdown {candidate.validationEvidence.maxDrawdownPct}%
                      </p>
                    )}
                    {!candidate.suitable && <p className="mt-0.5 text-slate-400">{candidate.reasons.join(' ')}</p>}
                  </li>
                ))}
              </ul>
            </div>
            {visibleSelection.decision === 'SELECT' && recommendedDefinition && (
              <div className="lg:col-span-3 rounded border border-emerald-500/20 bg-emerald-950/10 p-3 text-[11px]">
                <p className="font-bold text-emerald-200">Selected rule set · {recommendedDefinition.name} v{recommendedDefinition.version}</p>
                <p className="mt-1 text-slate-300">Entry / confirmation: {recommendedDefinition.entryRules} {recommendedDefinition.confirmationRules}</p>
                <p className="mt-1 text-slate-300">Invalidation / exit: {recommendedDefinition.invalidationRules} {recommendedDefinition.exitRules}</p>
                <p className="mt-1 text-slate-300">Defined maximum risk: {recommendedDefinition.maximumRiskPct}% per trade. This is a limit, not a guarantee.</p>
                <p className="mt-1 text-slate-300">Abstain if: {recommendedDefinition.noTradeConditions.join('; ')}.</p>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-slate-500">No evaluation for the selected instrument yet. The selector records an auditable decision when evaluated.</p>
        )}
      </section>

      {/* 1. Strategy Cards Grid (Left column: 5 cols) */}
      <div className="lg:col-span-5 flex flex-col gap-3">
        <div className="flex items-center justify-between px-1 mb-1">
          <div>
            <span className="text-xs font-bold text-slate-100 uppercase tracking-wider block">
              Strategy Orchestration
            </span>
            <span className="text-[11px] text-slate-400">
              Deterministic, independent strategy modules
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            Paper-simulated regime: <strong className="text-amber-300">{currentRegime}</strong>
          </span>
        </div>

        <div className="space-y-3">
          {strategies.map((strat) => {
            const isSelected = strat.id === selectedStrategyId;

            return (
              <div
                key={strat.id}
                onClick={() => {
                  setSelectedStrategyId(strat.id);
                  setEditingParams(null);
                }}
                className={`p-4 rounded-lg border transition-all cursor-pointer relative overflow-hidden ${
                  isSelected
                    ? 'bg-[#0f1422] border-emerald-500/50 shadow-md ring-1 ring-emerald-500/20'
                    : 'bg-[#0a0d15] border-white/[0.08] hover:border-white/[0.14]'
                }`}
              >
                {/* Subtle active left border highlight */}
                {isSelected && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-400" />
                )}

                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                      <span>{strat.name}</span>
                      {strat.cooldown?.active && strat.cooldown.remainingSeconds > 0 ? (
                        <span className="text-[10px] text-amber-300 font-mono px-1.5 py-0.2 bg-amber-500/15 border border-amber-500/30 rounded">
                          COOLDOWN: {strat.cooldown.remainingSeconds}s
                        </span>
                      ) : strat.isSuspended ? (
                        <span className="text-[10px] text-rose-400 font-mono px-1.5 py-0.2 bg-rose-500/10 border border-rose-500/20 rounded">
                          QUARANTINED
                        </span>
                      ) : null}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-1 font-mono">
                      <span>Allocation: {strat.allocationPct}%</span>
                      <span>·</span>
                      <span>Losses: <strong className={strat.consecutiveLosses >= 4 ? 'text-amber-400' : 'text-slate-300'}>{strat.consecutiveLosses}</strong>/5</span>
                      <span>·</span>
                      <span className={strat.enabled ? 'text-amber-400 font-medium' : 'text-slate-500'}>
                        {strat.enabled ? 'Research signals only · order routing disabled' : 'Research module disabled'}
                      </span>
                    </div>
                  </div>

                  {/* Toggle button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStrategy(strat.id, !strat.enabled);
                    }}
                    className={`p-1.5 rounded transition-colors ${
                      strat.enabled
                        ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-500 hover:text-slate-300 border border-transparent'
                    }`}
                    title={strat.enabled ? 'Disable Strategy' : 'Enable Strategy'}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Regime Tags */}
                <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-white/[0.05] text-[10px] font-mono text-slate-400">
                  <span className="text-slate-500">Allowed:</span>
                  {strat.allowedRegimes.map((r) => (
                    <span
                      key={r}
                      className={`px-1.5 py-0.5 rounded ${
                        r === currentRegime
                          ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                          : 'bg-[#080b12] text-slate-400 border border-white/[0.05]'
                      }`}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Strategy Inspector & Parameter Tuning (Right column: 7 cols) */}
      <div className="lg:col-span-7 flex flex-col gap-4">
        {selectedStrategy && (
          <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] mb-3">
              <div>
                <span className="text-[10px] text-slate-500 font-mono tracking-wider">STRATEGY PARAMETER INSPECTOR</span>
                <h2 className="text-sm font-bold text-slate-100">{selectedStrategy.name}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingParams(editingParams ? null : { ...selectedStrategy.parameters })}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0e1320] hover:bg-slate-800 text-slate-200 text-xs font-mono rounded border border-white/[0.08] transition-colors"
                >
                  <Sliders className="w-3 h-3 text-emerald-400" />
                  <span>{editingParams ? 'Cancel Edit' : 'Edit Parameters'}</span>
                </button>
              </div>
            </div>

            {/* Parameters Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              {Object.entries(editingParams || selectedStrategy.parameters).map(([key, value]) => (
                <div key={key} className="bg-[#070910] p-2.5 rounded border border-white/[0.06]">
                  <span className="text-[10px] text-slate-400 font-mono block uppercase">{key}</span>
                  {editingParams ? (
                    <input
                      type="number"
                      step="any"
                      value={String(editingParams[key])}
                      onChange={(e) =>
                        setEditingParams({
                          ...editingParams,
                          [key]: parseFloat(e.target.value) || e.target.value,
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono text-xs tabular-nums mt-1"
                    />
                  ) : (
                    <span className="text-sm font-bold text-slate-100 font-mono tabular-nums">{String(value)}</span>
                  )}
                </div>
              ))}
            </div>

            {editingParams && (
              <div className="flex justify-end gap-2 mb-4">
                <button
                  onClick={() => { void handleSaveParams(); }}
                  disabled={isSavingParams}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded transition-colors shadow-sm disabled:opacity-50"
                >
                  {isSavingParams ? 'Saving…' : 'Save Strategy Parameters'}
                </button>
              </div>
            )}

            {/* Target Asset Universe */}
            <div className="text-xs text-slate-400 font-mono border-t border-white/[0.06] pt-3">
              <span>Target Asset Classes: </span>
              <strong className="text-slate-200">{selectedStrategy.targetAssetClasses.join(', ')}</strong>
            </div>
            {selectedDefinition && (
              <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-3 text-[11px]">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-400">
                  <span>Version: <strong className="text-slate-200">{selectedDefinition.version}</strong></span>
                  <span>Symbols: <strong className="text-slate-200">{selectedDefinition.eligibleSymbols.join(', ')}</strong></span>
                  <span>Timeframes: <strong className="text-slate-200">{selectedDefinition.eligibleTimeframes.join(', ')}</strong></span>
                  <span>Expected hold: <strong className="text-slate-200">{selectedDefinition.expectedHoldingPeriod}</strong></span>
                  <span>Research baselines: <strong className="text-slate-200">{selectedDefinition.comparisonBaselines.join('; ')}</strong></span>
                  <span>Max defined risk: <strong className="text-slate-200">{selectedDefinition.maximumRiskPct}%</strong></span>
                  <span>Spread limit: <strong className="text-slate-200">{selectedDefinition.maximumSpreadBasisPoints} bps</strong></span>
                  <span>Cost limit: <strong className="text-slate-200">{selectedDefinition.maximumCostsPctOfGrossNotional}% of gross notional</strong></span>
                </div>
                <p className="text-slate-300">{selectedDefinition.purpose}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><strong className="text-slate-400">Entry / confirmation</strong><p className="mt-1 text-slate-300">{selectedDefinition.entryRules} {selectedDefinition.confirmationRules}</p></div>
                  <div><strong className="text-slate-400">Candle rules</strong><p className="mt-1 text-slate-300">{selectedDefinition.candleRules}</p></div>
                  <div><strong className="text-slate-400">Invalidation / exit</strong><p className="mt-1 text-slate-300">{selectedDefinition.invalidationRules} {selectedDefinition.exitRules}</p></div>
                  <div><strong className="text-slate-400">No-trade conditions</strong><p className="mt-1 text-slate-300">{selectedDefinition.noTradeConditions.join('; ')}</p></div>
                  <div><strong className="text-slate-400">Limitations</strong><p className="mt-1 text-slate-300">{selectedDefinition.knownLimitations.join(' ')}</p></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Live Explainable Signals Stream */}
        <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-100 uppercase tracking-wide">
              Paper-Simulator Signals
              </span>
              <span className="text-[10px] text-amber-300 font-mono">SIMULATED · not a recommendation</span>
              <span className="text-[10px] text-slate-400 font-mono">({signals.length} generated)</span>
            </div>
            <button
              onClick={handleScan}
              disabled={isScanning}
              className="flex items-center gap-1.5 px-3 py-1 bg-[#0c101a] hover:bg-slate-800 text-slate-200 text-xs rounded font-medium border border-white/[0.08] transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{isScanning ? 'Scanning...' : 'Rescan Signals'}</span>
            </button>
          </div>

          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {signals.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500 font-mono">
                No active strategy signals at this tick. Strategies are waiting for confirmed breakout/reversion setups.
              </div>
            ) : (
              signals.map((sig) => (
                <div
                  key={sig.id}
                  className="p-3.5 bg-[#070910] border border-white/[0.06] rounded-lg text-xs"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                        sig.side === 'BUY'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}>
                        {sig.side} {sig.symbol}
                      </span>
                      <span className="text-slate-300 font-semibold">{sig.strategyName}</span>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                      <span className="text-slate-400">Confidence: {sig.confidence === null ? 'not calibrated' : `${(sig.confidence * 100).toFixed(0)}%`}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{new Date(sig.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  <p className="text-slate-300 text-[11px] leading-relaxed mb-2.5">
                    {sig.rationale}
                  </p>

                  {/* Quantitative Factors List */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/[0.04] font-mono text-[10px] tabular-nums">
                    {sig.factors.map((f, i) => (
                      <div key={i} className="bg-[#0a0d15] p-1.5 rounded border border-white/[0.04]">
                        <span className="text-slate-500 block truncate">{f.name}</span>
                        <span className="text-emerald-400 font-semibold">{String(f.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
