# Integrations Status

## Broker and Market-Data Providers

| Provider / Adapter | Account access | Execution | Status |
| :--- | :--- | :--- | :--- |
| Local paper simulator | Simulated state only | Local paper fills only | Available; not a broker |
| MetaTrader 5 desktop terminal | Local account, positions, pending orders, MT5 symbol inventory, requested contract specs and timestamped quotes through the Python MetaTrader5 package; connector accepts XM Global DEMO only | Disabled; the connector contains no order-routing calls | XM identity checks and read-only query implemented; no terminal/account has been verified in this workspace |
| Interactive Brokers (TWS/Gateway) | None | Disabled | Not implemented or connected |
| Binance | None | Disabled | Not implemented or connected |
| Alpaca | None | Disabled | Not implemented or connected |
| Coinbase Advanced Trade | None | Disabled | Not implemented or connected |

No broker, MT5 server, account identity, account mode, account currency, leverage, or broker instrument specification has been verified against a real user terminal in this workspace. The MT5 connector's XM Global/demo checks and symbol details are implemented but have only mocked test evidence here. Until a successful local connection test, those records remain unavailable; they are not inferred from local paper state. Broker deals, independent P&L reconciliation, and execution remain unavailable.

The MT5 connector invokes a fixed local Python bridge, checks that an MT5 terminal process is already running, and reads `terminal_info`, `account_info`, `positions_get`, `orders_get`, `symbols_get`, `symbol_info`, and `symbol_info_tick`. It checks XM Global company/server evidence and the broker-reported DEMO account mode; account/server identity is pinned in process memory. It reports terminal/account trading permission flags and broker symbol order/execution/fill/expiration modes as diagnostics only. It never calls MT5 login or order APIs, never accepts a broker password or account number from the browser, and does not persist the snapshot across server restarts. The status and connection-test routes are operator-authenticated, loopback-only, and return a masked account identifier. The app's read-only code does not prove that the terminal login lacks trading privileges; use broker-issued investor/read-only credentials where available. Quotes are per-symbol MT5 terminal snapshots, not guaranteed executable prices or independent validation. There is no broker order-submission adapter or broker-side result verification, so the central order path remains fail-closed and demo execution is not available. See [MT5 read-only connection setup](docs/MT5_READ_ONLY_SETUP.md). A cloud-hosted app cannot reach the user's local terminal; run the app on the same computer as MT5. No broker-specific cloud API is assumed or configured.

## Market Data

| Provider / coverage | Connection | Data type | Status |
| :--- | :--- | :--- | :--- |
| Finnhub quote API (`SPY`, `QQQ`, `AAPL`, `NVDA`, `MSFT`) | `FINNHUB_API_KEY` absent; entitlements not verified | Display-only last-price snapshots; bid/ask unavailable | Adapter implemented, not connected |
| Other listed instruments (`BTC/USDT`, `ETH/USDT`, `SOL/USDT`, `EUR/USD`, `USD/JPY`, `XAU/USD`, `WTI/USD`) | No authorized provider mapping configured | Unavailable from the display-price endpoint | Not connected |
| Local paper simulator | Isolated internal feed | Simulated quotes and generated candles | Available for paper simulation only |

The display adapter calls Finnhub's documented quote endpoint (`https://finnhub.io/docs/api/quote`) for the five explicit US-equity mappings. It makes no provider requests without `FINNHUB_API_KEY`; a key alone does not establish the user's data entitlements or authorize display/storage. Responses are always labeled `SNAPSHOT`, never broker-executable, and stale or failed requests retain only the last valid timestamped snapshot with a stale indicator. Bid, ask, and spread are unavailable from this endpoint and are not synthesized.

The terminal watchlist, selected-instrument market snapshot, and order preview show provider provenance, status, source/receipt times, age, and stale/error state. The chart is generated simulated OHLCV, not provider history; the paper ticket continues to use only its separate local simulated reference. Third-party snapshots are not passed to the execution or risk path. In the current deployment no provider credentials or direct provider observations were available, so all provider-backed prices are `UNAVAILABLE`.

## Operating Boundary

- Operating mode: `PAPER`; the local simulator does not route external orders.
- Live execution: disabled and fail-closed.
- Broker reconciliation: unavailable; local paper-ledger checks do not imply broker reconciliation.
- MT5 viewing: local terminal snapshot only; a successful read-only connection does not enable orders or prove instrument constraints or reconciliation.
- Automated tests: use local deterministic/simulated data only and must never place real orders.
- Live deployment requires a separately implemented and documented authenticated read-only account adapter, provider-specific symbol/specification mapping, reconciliation, and a distinct authorized execution integration. No such authorization is present.
