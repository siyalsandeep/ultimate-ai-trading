import React, { useState } from 'react';
import { Instrument, AIResearchResponse, MarketRegimeType } from '../types/trading';
import {
  Brain,
  Sparkles,
  Send,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Search,
  Shield,
} from 'lucide-react';

interface AiQuantLabViewProps {
  instruments: Instrument[];
  currentRegime: MarketRegimeType | 'UNKNOWN';
  onRunResearch: (symbol: string, promptText: string) => Promise<AIResearchResponse>;
}

export const AiQuantLabView: React.FC<AiQuantLabViewProps> = ({
  instruments,
  currentRegime,
  onRunResearch,
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('SPY');
  const [prompt, setPrompt] = useState<string>(
    'Analyze current volatility clustering and formulate an explainable strategy proposal with strict stop-loss boundaries.'
  );
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<AIResearchResponse | null>(null);

  const handleResearch = async () => {
    setIsLoading(true);
    try {
      const res = await onRunResearch(selectedSymbol, prompt);
      setResponse(res);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 p-4 sm:p-5">
      {/* 1. Research Input & Hypothesis Formulator (Left column: 4 cols) */}
      <div className="lg:col-span-4 bg-[#0a0d15] border border-white/[0.08] rounded-lg p-4 flex flex-col justify-between shadow-sm">
        <div>
          <div className="flex items-center gap-2 pb-3 border-b border-white/[0.06] mb-4">
            <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                AI Quantitative Research Lab
              </h2>
              <p className="text-[10px] text-slate-400 font-mono">Engine: Gemini 3.8 Flash</p>
            </div>
          </div>

          <div className="space-y-3.5 text-xs">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Target Instrument</label>
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
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
              <label className="text-[11px] text-slate-400 block mb-1">Quantitative Directive / Hypothesis Inquiry</label>
              <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Specify quantitative objective or regime challenge..."
                className="w-full bg-[#06080e] border border-white/[0.08] rounded p-2.5 text-slate-100 font-mono text-xs focus:border-emerald-500/60 leading-relaxed"
              />
            </div>

            <div className="p-2.5 bg-[#06080e] rounded border border-white/[0.06] text-[11px] font-mono text-slate-400">
              <span>Observable Market Regime: </span>
              <strong className="text-emerald-400 font-semibold">{currentRegime}</strong>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-white/[0.06]">
          <button
            onClick={handleResearch}
            disabled={isLoading}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white font-bold text-xs rounded transition-all shadow-md flex items-center justify-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isLoading ? 'Synthesizing Hypothesis...' : 'Formulate Quantitative Memo'}</span>
          </button>
        </div>
      </div>

      {/* 2. Structured Quantitative Research Memo (Right column: 8 cols) */}
      <div className="lg:col-span-8 flex flex-col gap-4">
        {response ? (
          <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-5 flex flex-col gap-4 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <span className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                Quantitative Research Brief · {selectedSymbol}
              </span>
              <span className="text-[10px] text-emerald-400 font-mono px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded">
                EXPLAINABLE SIGNAL
              </span>
            </div>

            {/* Hypothesis Section */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Quantitative Hypothesis
              </h3>
              <p className="text-slate-200 leading-relaxed bg-[#06080e] p-3.5 rounded border border-white/[0.06] font-mono text-xs">
                {response.hypothesis}
              </p>
            </div>

            {/* Regime Assessment */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Observable Regime Assessment
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed bg-[#06080e] p-3.5 rounded border border-white/[0.06] font-mono">
                {response.marketRegimeAssessment}
              </p>
            </div>

            {/* Explainable Signals & Risk Boundaries */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Explainable Trade Evaluation & Risk Boundaries
              </h3>
              <div className="space-y-2">
                {response.explainableSignals.map((sig, idx) => (
                  <div key={idx} className="p-3.5 bg-[#06080e] rounded border border-white/[0.06] text-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-slate-100 font-mono">{sig.symbol}</span>
                      <span className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                        sig.recommendation === 'STRONG_SIGNAL'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : sig.recommendation === 'CAUTIOUS'
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}>
                        {sig.recommendation}
                      </span>
                    </div>
                    <p className="text-slate-300 text-[11px] mb-2 leading-relaxed">{sig.quantitativeReasoning}</p>
                    <div className="text-[10px] text-rose-400 font-mono bg-rose-950/20 p-2 rounded border border-rose-900/30">
                      Mandatory Protective Boundary: {sig.riskBoundary}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Regulatory Notice & Governance Invariant */}
            <div className="p-3 bg-[#080b13] rounded border border-white/[0.06] text-[11px] text-slate-400 leading-normal">
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold mb-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Deterministic Risk Governance Protocol</span>
              </div>
              <p>{response.regulatoryNotice}</p>
            </div>
          </div>
        ) : (
          <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg p-16 text-center flex flex-col items-center justify-center text-slate-500 font-mono text-xs shadow-sm">
            <Brain className="w-10 h-10 text-slate-700 mb-3" />
            <span className="text-slate-400 font-medium mb-1">AI Quantitative Assistant Idle</span>
            <span className="text-slate-500 text-[11px]">Select an instrument and execute a prompt directive to synthesize an explainable research brief.</span>
          </div>
        )}
      </div>
    </div>
  );
};
