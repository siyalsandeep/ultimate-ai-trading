# Historical Validation and Portfolio Evaluation

**Status: BLOCKED - no historical-performance or selector-qualification result is available.**

This report records the available evidence and the evaluation that could not be run. It does not treat simulated candles, a unit-test fixture, or generated paper prices as historical market data. No candidate is qualified, promoted, or enabled by this report.

## Run identity and data provenance

- Inspection date: 2026-10-10.
- Repository: `https://github.com/siyalsandeep/ultimate-ai-trading`.
- Checkout branch: `siyalsandeep-transfer-master-build-prompt`.
- Checkout `HEAD`: `4712558` (`docs: add master build prompt`); the application implementation files are working-tree files rather than files in that commit.
- Historical input dataset, vendor, retrieval timestamp, data license, corporate-action policy, and content hash: **none available**.
- The repository `data` directory contains `app_state.json`, not a historical OHLCV dataset. No CSV, Parquet, JSONL, Feather, or Arrow historical-data file was found in this checkout or the selected source checkout.
- `server/data/market-data-service.ts` generates 180 daily candles in memory from fixed base prices and formulaic drift/noise. Their timestamps are relative to process start; the current candle is then mutated by a three-second paper-tick loop with random price movement. The candle provenance is `SIMULATED`, not a vendor feed.
- `server/backtest/backtest-engine.ts` obtains candles from that service, so any output from it would be a simulation of generated data, not an authorized historical backtest. It currently provides one chronological 70/30 split; that is not walk-forward validation.

No historical strategy experiment was run. There are therefore no observed returns, trades, sample sizes, confidence intervals, or stress results to report. Existing system tests exercise mechanics using simulated/test inputs and are not market-performance experiments.

## Criteria fixed before any future selection

The existing selector policy is retained without tuning against results. It requires strategy-, version-, instrument-, timeframe-, and regime-matched evidence; at least 100 out-of-sample closed trades; at least three walk-forward windows; positive net expectancy with a positive 95% lower confidence bound; realistic costs; adverse execution; bias review; stable results across windows; and maximum drawdown no greater than 5%. Suitability also requires verified fresh historical candles, calibrated regime confidence of at least 0.75, a fresh broker-executable quote, an open verified session, strategy-specific spread/cost limits, and passing account/strategy risk gates. When evidence is absent or multiple candidates qualify, the selector must abstain.

These are the repository's pre-existing policy thresholds, not empirically optimized values. No additional threshold has been inferred from synthetic data. Until a reproducible evaluation satisfies them, the decision remains `NO TRADE` / `UNKNOWN`.

## Requested evaluation results

| Evaluation | Result | Reason |
|---|---|---|
| Historical backtest and out-of-sample holdout | Not run | No authorized, timestamped historical OHLCV input |
| Rolling walk-forward windows and per-window stability | Not run | No historical input; the available engine only has a single 70/30 split |
| Buy-and-hold and cash/no-trade comparison | Not run | No historical input on which to calculate comparable returns |
| Parameter sensitivity | Not run | No historical input; running the grid on generated candles would not validate sensitivity |
| Cost and execution stress | Not run | No source-calibrated spread, commission, slippage, fill, or gap assumptions |
| Drawdown, return, Sharpe/Sortino, profit factor, expectancy, win rate, and trade-count uncertainty | Not computed | No observed strategy trades or equity series |
| Turnover and total friction attribution | Not computed | No observed fills or authorized transaction-cost schedule |
| Correlated exposure and portfolio stress | Not computed | No synchronized historical return series, complete instrument metadata, or verified FX/conversion data |
| Selector qualification and candidate comparison | Abstain | No validated evidence registry entries; current market data and regime confidence are simulated/unverified |

There are no failed market experiments to report: the evaluation was blocked before backtesting rather than producing and rejecting a performance result. The available sample uncertainty is consequently **undefined**, not zero. A zero-trade or synthetic-data result must not be interpreted as evidence of safety or profitability.

## Reproduction and next input

The provenance check can be repeated by inspecting `data`, searching the checkout and selected source checkout for historical-data files, and tracing `BacktestEngine.runBacktest()` to `MarketDataService.getCandles()`. The current trace resolves to the in-memory generator described above. No backtest command was run because it would use that simulated source and could be mistaken for historical evidence.

To run the requested study, provide or configure an authorized dataset/provider with timestamped OHLCV for the intended instruments and timeframe, along with data provenance and adjustment policy (including corporate actions where applicable). Supply the applicable instrument/session metadata and realistic spread, commission, slippage, and execution assumptions. Then pin the dataset and code versions, run the predeclared out-of-sample and walk-forward protocol, and report the requested metrics, uncertainty, cost/execution stresses, and portfolio exposures. Until then, candidates A-C remain research-only and disabled by default; candidate D remains informational only.
