import React, { useState, useMemo } from 'react';
import { CandleOHLCV } from '../types/trading';

interface CandleChartProps {
  symbol: string;
  candles: CandleOHLCV[];
  currentPrice?: number;
  height?: number;
}

export const CandleChart: React.FC<CandleChartProps> = ({
  symbol,
  candles,
  currentPrice,
  height = 380,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showEMA, setShowEMA] = useState(true);
  const [showBB, setShowBB] = useState(true);
  const [timeframe, setTimeframe] = useState<'1D' | '4H' | '1H' | '15M'>('1D');

  // Compute scale boundaries
  const { minPrice, maxPrice, priceRange, maxVolume } = useMemo(() => {
    if (!candles || candles.length === 0) {
      return { minPrice: 0, maxPrice: 100, priceRange: 100, maxVolume: 1000 };
    }
    let min = Infinity;
    let max = -Infinity;
    let maxVol = 0;

    for (const c of candles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (c.indicators?.bbLower && c.indicators.bbLower < min) min = c.indicators.bbLower;
      if (c.indicators?.bbUpper && c.indicators.bbUpper > max) max = c.indicators.bbUpper;
      if (c.volume > maxVol) maxVol = c.volume;
    }

    const padding = (max - min) * 0.05 || 1;
    return {
      minPrice: min - padding,
      maxPrice: max + padding,
      priceRange: (max + padding) - (min - padding),
      maxVolume: maxVol || 1,
    };
  }, [candles]);

  const chartWidth = 760;
  const paddingRight = 70;
  const paddingBottom = 26;
  const chartHeight = height - paddingBottom;
  const plotWidth = chartWidth - paddingRight;

  const candleWidth = useMemo(() => {
    if (!candles || candles.length === 0) return 6;
    return Math.max(3.5, (plotWidth / candles.length) * 0.72);
  }, [candles, plotWidth]);

  const getY = (val: number) => {
    return chartHeight - ((val - minPrice) / priceRange) * (chartHeight - 44) - 22;
  };

  const hoveredCandle = hoverIndex !== null && candles[hoverIndex] ? candles[hoverIndex] : candles[candles.length - 1];

  return (
    <div className="relative flex flex-col bg-[#0a0d15] border border-white/[0.08] rounded-lg overflow-hidden shadow-lg select-none">
      {/* Chart Top Bar with Timeframe Controls, Technical Toggles and Live OHLCV */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-[#0c101a] text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-100 text-sm tracking-wide">{symbol}</span>
            <span className="text-[10px] text-amber-300 font-mono">SIMULATED OHLCV</span>
          </div>

          <div className="h-3 w-[1px] bg-white/[0.08]" />

          {/* Timeframe Selectors */}
          <div className="flex items-center bg-[#07090e] border border-white/[0.08] rounded p-0.5 text-[11px] font-mono">
            {(['1D', '4H', '1H', '15M'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-emerald-500/15 text-emerald-300 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="h-3 w-[1px] bg-white/[0.08] hidden sm:block" />

          {/* Indicator toggles */}
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={() => setShowEMA(!showEMA)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                showEMA ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30' : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              EMA 20/50
            </button>
            <button
              onClick={() => setShowBB(!showBB)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                showBB ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              Bollinger (20,2)
            </button>
          </div>
        </div>

        {/* Live OHLCV Readout */}
        {hoveredCandle && (
          <div className="flex items-center gap-2.5 text-slate-400 font-mono text-[11px] tabular-nums">
            <span>O: <strong className="text-slate-200">{hoveredCandle.open}</strong></span>
            <span>H: <strong className="text-emerald-400">{hoveredCandle.high}</strong></span>
            <span>L: <strong className="text-rose-400">{hoveredCandle.low}</strong></span>
            <span>C: <strong className={hoveredCandle.close >= hoveredCandle.open ? 'text-emerald-400' : 'text-rose-400'}>{hoveredCandle.close}</strong></span>
            <span className="hidden md:inline">Vol: <strong className="text-slate-300">{(hoveredCandle.volume / 1000).toFixed(0)}k</strong></span>
          </div>
        )}
      </div>

      {/* SVG Chart Area */}
      <div className="relative w-full overflow-hidden bg-[#080b13]" style={{ height: `${height}px` }}>
        <svg
          viewBox={`0 0 ${chartWidth} ${height}`}
          className="w-full h-full cursor-crosshair"
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = ((e.clientX - rect.left) / rect.width) * chartWidth;
            if (mouseX <= plotWidth && candles.length > 0) {
              const idx = Math.min(
                candles.length - 1,
                Math.max(0, Math.floor((mouseX / plotWidth) * candles.length))
              );
              setHoverIndex(idx);
            }
          }}
        >
          <defs>
            <linearGradient id="bbGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#818cf8" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="volBullGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="volBearGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Subtle Horizontal Grid lines & Price Labels */}
          {[0.15, 0.35, 0.55, 0.75, 0.9].map((ratio, i) => {
            const y = chartHeight * ratio;
            const price = maxPrice - ratio * priceRange;
            return (
              <g key={i}>
                <line x1="0" y1={y} x2={plotWidth} y2={y} stroke="#172033" strokeDasharray="3 3" strokeWidth="1" />
                <text x={plotWidth + 6} y={y + 3.5} fill="#64748b" fontSize="10" fontFamily="monospace" className="tabular-nums">
                  {price < 10 ? price.toFixed(4) : price.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Bollinger Bands Shaded Envelope */}
          {showBB && (
            <path
              d={candles
                .map((c, i) => {
                  const x = (i / candles.length) * plotWidth + candleWidth / 2;
                  const yUpper = getY(c.indicators?.bbUpper || c.high);
                  return `${i === 0 ? 'M' : 'L'} ${x} ${yUpper}`;
                })
                .concat(
                  candles
                    .slice()
                    .reverse()
                    .map((c, i) => {
                      const origIdx = candles.length - 1 - i;
                      const x = (origIdx / candles.length) * plotWidth + candleWidth / 2;
                      const yLower = getY(c.indicators?.bbLower || c.low);
                      return `L ${x} ${yLower}`;
                    })
                )
                .join(' ') + ' Z'}
              fill="url(#bbGradient)"
            />
          )}

          {/* Volume histogram at bottom */}
          {candles.map((c, i) => {
            const x = (i / candles.length) * plotWidth;
            const volHeight = Math.max(2, (c.volume / maxVolume) * 55);
            const y = chartHeight - volHeight;
            const isBull = c.close >= c.open;
            return (
              <rect
                key={`vol_${i}`}
                x={x}
                y={y}
                width={candleWidth}
                height={volHeight}
                fill={isBull ? 'url(#volBullGrad)' : 'url(#volBearGrad)'}
                rx="0.5"
              />
            );
          })}

          {/* Candlesticks (Wick & Body) */}
          {candles.map((c, i) => {
            const x = (i / candles.length) * plotWidth;
            const isBull = c.close >= c.open;
            const color = isBull ? '#10b981' : '#f43f5e';
            const yHigh = getY(c.high);
            const yLow = getY(c.low);
            const yOpen = getY(c.open);
            const yClose = getY(c.close);
            const bodyY = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));

            return (
              <g key={`candle_${i}`}>
                {/* Candle Wick */}
                <line
                  x1={x + candleWidth / 2}
                  y1={yHigh}
                  x2={x + candleWidth / 2}
                  y2={yLow}
                  stroke={color}
                  strokeWidth="1.2"
                  opacity="0.85"
                />
                {/* Candle Body */}
                <rect
                  x={x}
                  y={bodyY}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={color}
                  rx="0.8"
                />
              </g>
            );
          })}

          {/* EMA 20 Line (Sky Blue) */}
          {showEMA && (
            <polyline
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.6"
              opacity="0.9"
              points={candles
                .filter(c => c.indicators?.ema20)
                .map((c, i) => {
                  const x = (i / candles.length) * plotWidth + candleWidth / 2;
                  const y = getY(c.indicators!.ema20!);
                  return `${x},${y}`;
                })
                .join(' ')}
            />
          )}

          {/* EMA 50 Line (Purple/Indigo) */}
          {showEMA && (
            <polyline
              fill="none"
              stroke="#a855f7"
              strokeWidth="1.4"
              strokeDasharray="4 2"
              opacity="0.85"
              points={candles
                .filter(c => c.indicators?.ema50)
                .map((c, i) => {
                  const x = (i / candles.length) * plotWidth + candleWidth / 2;
                  const y = getY(c.indicators!.ema50!);
                  return `${x},${y}`;
                })
                .join(' ')}
            />
          )}

          {/* Local paper-simulator reference line */}
          {currentPrice && (
            <g>
              <line
                x1="0"
                y1={getY(currentPrice)}
                x2={plotWidth}
                y2={getY(currentPrice)}
                stroke="#10b981"
                strokeDasharray="2 2"
                strokeWidth="1"
                opacity="0.75"
              />
              <rect
                x={plotWidth + 1}
                y={getY(currentPrice) - 9}
                width={paddingRight - 2}
                height="18"
                fill="#10b981"
                rx="2"
              />
              <text
                x={plotWidth + 6}
                y={getY(currentPrice) + 4}
                fill="#05120c"
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
                className="tabular-nums"
              >
                {currentPrice < 10 ? currentPrice.toFixed(4) : currentPrice.toFixed(2)}
              </text>
            </g>
          )}

          {/* Interactive Crosshair Tracking */}
          {hoverIndex !== null && candles[hoverIndex] && (
            <g>
              <line
                x1={(hoverIndex / candles.length) * plotWidth + candleWidth / 2}
                y1="0"
                x2={(hoverIndex / candles.length) * plotWidth + candleWidth / 2}
                y2={chartHeight}
                stroke="#94a3b8"
                strokeDasharray="2 2"
                strokeWidth="1"
                opacity="0.6"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Chart Footer Indicator Legends */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/[0.06] bg-[#070a12] text-[11px] text-slate-400 font-mono">
        <div className="flex items-center gap-4">
          {showEMA && (
            <>
              <span className="flex items-center gap-1.5 text-sky-400">
                <span className="w-2.5 h-0.5 bg-sky-400 inline-block" /> EMA 20
              </span>
              <span className="flex items-center gap-1.5 text-purple-400">
                <span className="w-2.5 h-0.5 bg-purple-400 inline-block border-b border-dashed" /> EMA 50
              </span>
            </>
          )}
          {showBB && (
            <span className="flex items-center gap-1.5 text-indigo-400">
              <span className="w-2.5 h-1.5 bg-indigo-500/20 border border-indigo-500/40 inline-block" /> Bollinger Band Envelope
            </span>
          )}
        </div>
        <span className="text-amber-300">Generated simulated candles; not provider history</span>
      </div>
    </div>
  );
};
