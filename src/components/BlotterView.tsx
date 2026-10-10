import React, { useState } from 'react';
import { Position, Order, OrderStatus } from '../types/trading';
import {
  History,
  XCircle,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Layers,
} from 'lucide-react';

interface BlotterViewProps {
  positions: Position[];
  orders: Order[];
  onClosePosition: (symbol: string) => Promise<{ success: boolean; message: string }>;
  onCancelOrder: (orderId: string) => void;
}

export const BlotterView: React.FC<BlotterViewProps> = ({
  positions,
  orders,
  onClosePosition,
  onCancelOrder,
}) => {
  const [activeTab, setActiveTab] = useState<'POSITIONS' | 'ORDERS'>('POSITIONS');
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const handleClose = async (symbol: string) => {
    if (!window.confirm(`Close ${symbol} in the local paper ledger? This records a simulated close and sends no broker order.`)) return;
    try {
      const res = await onClosePosition(symbol);
      setFeedback(res);
      setTimeout(() => setFeedback(null), 6000);
    } catch (error) {
      setFeedback({
        success: false,
        message: error instanceof Error ? error.message : 'Position close failed.',
      });
    }
  };

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'FILLED':
        return (
          <span className="text-emerald-400 font-semibold font-mono text-[10px] px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded">
            FILLED
          </span>
        );
      case 'REJECTED':
        return (
          <span className="text-rose-400 font-semibold font-mono text-[10px] px-1.5 py-0.5 bg-rose-500/10 border border-rose-500/20 rounded">
            REJECTED
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="text-slate-400 font-mono text-[10px] px-1.5 py-0.5 bg-slate-800 rounded">
            CANCELLED
          </span>
        );
      default:
        return (
          <span className="text-sky-300 font-mono text-[10px] px-1.5 py-0.5 bg-sky-500/10 border border-sky-500/20 rounded">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      {/* Top Blotter Header & Mode Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0a0d15] border border-white/[0.08] p-3 rounded-lg shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('POSITIONS')}
            className={`px-3.5 py-1.5 rounded text-xs font-mono font-bold transition-colors ${
              activeTab === 'POSITIONS'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Active Positions ({positions.length})
          </button>
          <button
            onClick={() => setActiveTab('ORDERS')}
            className={`px-3.5 py-1.5 rounded text-xs font-mono font-bold transition-colors ${
              activeTab === 'ORDERS'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Local Paper Orders ({orders.length})
          </button>
        </div>

        {feedback && (
          <span role={feedback.success ? 'status' : 'alert'} className={`text-xs font-mono px-2.5 py-1 rounded border ${
            feedback.success
              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
              : 'text-rose-200 bg-rose-950/30 border-rose-500/30'
          }`}>
            {feedback.message}
          </span>
        )}
      </div>

      <p className="rounded border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
        Positions and order states shown here are from the local paper ledger. No broker orders, positions, fills, or cancellations are confirmed by this view.
      </p>

      {/* Table 1: Open Positions */}
      {activeTab === 'POSITIONS' && (
        <div>
          <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg overflow-x-auto shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#070910] border-b border-white/[0.06] text-[10px] text-slate-400 font-mono uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3.5">Symbol</th>
                <th className="py-2.5 px-3">Side</th>
                <th className="py-2.5 px-3">Quantity</th>
                <th className="py-2.5 px-3">Entry Price</th>
                <th className="py-2.5 px-3">Current Price</th>
                <th className="py-2.5 px-3">Stop Loss</th>
                <th className="py-2.5 px-3">Take Profit</th>
                <th className="py-2.5 px-3">Unrealized P&L</th>
                <th className="py-2.5 px-3">Margin</th>
                <th className="py-2.5 px-3">Strategy</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] font-mono tabular-nums">
              {positions.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-slate-500 text-xs">
                    No active positions currently open in this session.
                  </td>
                </tr>
              ) : (
                positions.map((pos) => {
                  const isProfit = pos.unrealizedPnL >= 0;
                  return (
                    <tr key={pos.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3.5 font-bold text-slate-100">{pos.symbol}</td>
                      <td className="py-3 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          pos.side === 'BUY'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                        }`}>
                          {pos.side}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-200">{pos.quantity}</td>
                      <td className="py-3 px-3 text-slate-300">${pos.entryPrice}</td>
                      <td className="py-3 px-3 font-semibold text-slate-100">${pos.currentPrice}</td>
                      <td className="py-3 px-3 text-rose-400">${pos.stopLossPrice}</td>
                      <td className="py-3 px-3 text-emerald-400">
                        {pos.takeProfitPrice ? `$${pos.takeProfitPrice}` : '—'}
                      </td>
                      <td className="py-3 px-3 font-bold">
                        <span className={isProfit ? 'text-emerald-400' : 'text-rose-400'}>
                          {isProfit ? '+' : ''}${pos.unrealizedPnL.toFixed(2)} ({isProfit ? '+' : ''}{pos.unrealizedPnLPct.toFixed(2)}%)
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-400">${pos.marginUsed.toFixed(2)}</td>
                      <td className="py-3 px-3 text-slate-400 text-[11px]">{pos.strategyId}</td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => handleClose(pos.symbol)}
                          className="px-2.5 py-1 bg-[#0c101a] hover:bg-rose-950/60 hover:text-white text-rose-200 text-[11px] font-medium rounded border border-white/[0.08] transition-colors"
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Table 2: Order State Machine Blotter */}
      {activeTab === 'ORDERS' && (
        <div className="bg-[#0a0d15] border border-white/[0.08] rounded-lg overflow-x-auto shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#070910] border-b border-white/[0.06] text-[10px] text-slate-400 font-mono uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3.5">Time</th>
                <th className="py-2.5 px-3">Client Order ID</th>
                <th className="py-2.5 px-3">Symbol</th>
                <th className="py-2.5 px-3">Side</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Quantity</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3">Avg Fill</th>
                <th className="py-2.5 px-3">Fee Paid</th>
                <th className="py-2.5 px-3">Slippage</th>
                <th className="py-2.5 px-3 text-right">Action / Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] font-mono tabular-nums">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-slate-500 text-xs">
                    No orders submitted in current session.
                  </td>
                </tr>
              ) : (
                orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-3.5 text-slate-400 text-[11px]">
                      {new Date(ord.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-[10px] truncate max-w-[100px]" title={ord.clientOrderId}>
                      {ord.clientOrderId}
                    </td>
                    <td className="py-3 px-3 font-bold text-slate-100">{ord.symbol}</td>
                    <td className="py-3 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        ord.side === 'BUY'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                      }`}>
                        {ord.side}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-300">{ord.type}</td>
                    <td className="py-3 px-3 text-slate-200">{ord.quantity}</td>
                    <td className="py-3 px-3">{getStatusBadge(ord.status)}</td>
                    <td className="py-3 px-3 font-semibold text-slate-100">
                      {ord.avgFillPrice ? `$${ord.avgFillPrice}` : '—'}
                    </td>
                    <td className="py-3 px-3 text-slate-400">${ord.feePaid.toFixed(2)}</td>
                    <td className="py-3 px-3 text-slate-400">
                      {ord.estimatedSlippage ? `$${ord.estimatedSlippage}` : '—'}
                      {ord.executionTelemetry && (
                        <span
                          className="block text-[9px] text-amber-400/80"
                          title={`${ord.executionTelemetry.quoteProvider} ${ord.executionTelemetry.quoteQuality}; quote timestamp ${new Date(ord.executionTelemetry.quoteTimestamp).toLocaleString()}; ${ord.executionTelemetry.slippageModel}`}
                        >
                          PAPER MODEL
                          {ord.executionTelemetry.simulatedProcessingDurationMs !== undefined
                            ? ` · ${ord.executionTelemetry.simulatedProcessingDurationMs}ms sim`
                            : ''}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED'].includes(ord.status) ? (
                        <button
                          onClick={() => onCancelOrder(ord.id)}
                          className="px-2.5 py-1 bg-rose-950 text-rose-300 hover:bg-rose-900 text-[10px] font-bold rounded"
                        >
                          Cancel
                        </button>
                      ) : ord.rejectReason ? (
                        <span className="text-[10px] text-rose-400 truncate max-w-[130px] inline-block" title={ord.rejectReason}>
                          {ord.rejectReason}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
