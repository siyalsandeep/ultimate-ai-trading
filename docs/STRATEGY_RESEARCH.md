# Strategy Research Catalog

This catalog describes research rules, not recommendations or evidence of profitability. All four catalog entries start disabled. The selector is advisory-only and cannot activate a strategy or submit an order.

## Candidate A — Trend following

- **Version:** 1.1.0; any parameter edit increments the patch version and invalidates evidence for the prior version.
- **Configuration:** Fast EMA 20, slow EMA 50, ADX minimum 25, RSI strictly between 52 and 75, ATR stop multiple 2, take-profit distance 4 ATR.
- **Eligibility:** SPY, QQQ, AAPL, NVDA, MSFT, BTC/USDT, and ETH/USDT; daily candles; bullish-trend regime only. The implemented candidate is long-only.
- **Candle rule:** At least 50 completed daily bars. Evaluate the latest completed bar and never fill earlier than the following bar's open in a historical simulation.
- **Entry/invalidation:** Close above the fast EMA, fast EMA above the slow EMA, ADX at/above its threshold, and RSI inside its bounds. Missing indicators, stale inputs, or a regime outside the candidate's universe abstain. The initial stop is mandatory; stops are not widened.
- **Baseline:** Same-instrument buy-and-hold and cash/no-trade over identical dates.
- **Limitations:** Simulated candle source; no validated short side, holding-time limit, or venue-specific execution model.

## Candidate B — Mean reversion

- **Version:** 1.1.0; parameter edits increment the patch version.
- **Configuration:** Bollinger period 20 and standard deviation 2, RSI period 14 and oversold threshold 30, lower-band tolerance 0.004, ATR stop multiple 1.5.
- **Eligibility:** SPY, QQQ, AAPL, MSFT, EUR/USD, and USD/JPY; daily candles; low- or high-volatility range regime. The implemented candidate is long-only.
- **Candle rule:** At least 20 completed daily bars. The latest completed close must be within the configured lower-band tolerance and RSI no greater than the oversold threshold. Hypothetical entry is no earlier than the next bar; reject a gap where the mean target is no longer above entry.
- **Invalidation/exit:** Range regime failure or initial ATR stop; mean-band midpoint is the predefined target; stops are not widened.
- **Baseline:** Same-instrument buy-and-hold and cash/no-trade over identical dates.
- **Limitations:** Range transitions, event risk, maximum holding period, and venue-specific execution are not validated.

## Candidate C — Risk-adjusted momentum

- **Version:** 1.1.0; parameter edits increment the patch version.
- **Configuration:** 20 completed-bar lookback, maximum volatility 2.5, minimum return/volatility score 1.2, ATR stop multiple 1.8, target 3.6 ATR.
- **Eligibility:** SPY, QQQ, AAPL, NVDA, MSFT, BTC/USDT, and ETH/USDT; daily candles; bullish-trend or low-volatility range regime. This implementation is long-only and single-instrument, not a validated cross-asset ranker.
- **Candle rule:** At least 21 completed daily bars. Lookback return and volatility use only observations through the latest completed candle; hypothetical entry is no earlier than the following bar.
- **Invalidation/exit:** Momentum or volatility filter failure, shock/unknown regime, or initial ATR stop; stops are not widened.
- **Baseline:** Same-instrument buy-and-hold and cash/no-trade over identical dates.
- **Limitations:** Cross-asset comparability, survivorship, rebalancing, turnover, and maximum holding period are not validated.

## Candidate D — Regime classifier

- **Version:** 1.1.0; parameter edits increment the patch version.
- **Configuration:** ADX threshold 25, volatility ceiling 3.5, low-volatility ceiling 1.2, minimum history 20 bars.
- **Eligibility:** Catalog instruments and daily candles; output is informational and cannot be selected for entry.
- **Candle rule:** At least 20 completed daily bars; insufficient or unreliable values must produce UNKNOWN rather than an entry signal.
- **Baseline:** Cash/no-trade. This classifier has no entry, sizing, order, or performance claim.
- **Limitations:** Current regime confidence is not calibrated; synthetic-data classifications are not suitable for strategy selection.

## Activation, selection, and evidence

No challenger strategy has been added: the available repository contains no authorized historical dataset or validated results with which to establish eligibility. Candidates A-C are research signal generators only; candidate D is informational. Signals carry no suggested position size and no calibrated confidence until those values are supported by evidence.

The selector returns `NO TRADE` unless a candidate is explicitly operator-enabled and passes version-, symbol-, timeframe-, and regime-matched out-of-sample checks plus verified-data, open-session, spread/cost, and account-risk gates. Multiple qualifying candidates also result in abstention. The current runtime uses simulated candles and has no validation evidence registry, so production selection remains `NO TRADE` / `UNKNOWN`.

The backtest uses the previous completed bar for entry decisions and the following bar for hypothetical entry. Existing positions are closed at the 70/30 split boundary, stop-first ordering is used when OHLC data cannot establish intrabar event order, and any final open position is closed at the final bar. It reports observed segment return-based Sharpe values without synthetic floors or multipliers, and compares buy-and-hold with a zero-return cash/no-trade baseline. It is a single split, not rolling walk-forward validation; window stability and statistical uncertainty are not estimated. The local candle source is simulated, so results are exploratory only and are not authorized evidence for selector qualification, promotion, or activation. No strategy has been shown profitable.

The current historical-data discovery and blocked evaluation status are recorded in [HISTORICAL_VALIDATION.md](HISTORICAL_VALIDATION.md).
