# CHANGELOG

## [1.1.0] - 2026-10-09
### Design & UI Polish (Ultimate AI Trading)
- Unified product branding to **Ultimate AI Trading** consistently across all screens, headers, dialogs, and HTML metadata.
- Elevated dark foundation (`#06080d`, `#0a0d15`, `#0c101a`) with soft radial ambient lighting (`cinematic-glow`) and hairline border hierarchy (`border-white/[0.08]`).
- Enforced tabular numerals (`tabular-nums font-mono`) across prices, lot sizes, P&L, fees, and percentages for financial clarity.
- Introduced a dedicated Pre-Trade Order Risk Preview Card in the Order Ticket detailing notional value, stop distance, dollar risk, and fee estimates.
- Redesigned Candlestick Chart with timeframe selectors (`1D`, `4H`, `1H`, `15M`), technical overlay controls, and volume depth histogram.
- Added live search filter and asset class chips to Multi-Asset Watchlist with staleness badges.
- Upgraded Backtest Studio with smoothed area gradient equity curve, benchmark comparative baseline, and walk-forward degradation breakdown.
- Polished Risk Tower with dual-tone progress bars, daily loss warning thresholds, and emergency action bar.
- Added accessible focus indicators, `prefers-reduced-motion` compliance, and verified contrast across all components.

## [1.0.0] - 2026-10-09
### Added
- Core architecture of Global AI Trader OS.
- Deterministic Risk Engine with 12 distinct pre-trade and portfolio-level checks.
- Strategy Engine implementing Trend Following, Mean Reversion, Momentum/Relative Strength, and Market Regime Classifier.
- AI Research Assistant service powered by Gemini 3.8 Flash (`@google/genai`).
- Backtesting engine with walk-forward validation and transaction cost friction.
- Paper Trading Execution Engine with complete order state machine (`CREATED` -> `VALIDATED` -> `SUBMITTED` -> `ACKNOWLEDGED` -> `FILLED/CANCELLED/REJECTED`).
- Multi-asset market data generator and normalized quote streaming.
- Health monitor with periodic checks and fail-closed safety state.
- Full-stack Express server (`server.ts`) and modern quantitative trading dashboard.
