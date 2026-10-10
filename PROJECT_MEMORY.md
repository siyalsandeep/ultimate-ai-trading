# PROJECT MEMORY: Ultimate AI Trading

## System Overview
- **Name:** Ultimate AI Trading
- **Domain:** Multi-asset simulated research and local paper-trading application; it is not a connected brokerage platform.
- **Core Philosophy:** Capital preservation first, deterministic risk enforcement independent of AI, transparent strategy explainability, realistic execution simulation (spread, slippage, commissions, borrow costs), and strict operational reliability.
- **Architectural Tenet:** AI assists in quantitative analysis, hypothesis generation, and signal commentary. AI NEVER directly submits orders or overrides the risk engine.

## Operating Modes
1. **BACKTEST:** Historical simulation only. Current candles are synthetic and the engine's 70/30 split is not a demonstrated walk-forward study; its results are not deployment evidence.
2. **PAPER:** Local simulated quotes and execution only. No live/replay provider or broker reconciliation is configured.
3. **LIVE:** Not implemented and disabled. There is no broker account-data or execution adapter and no live authorization.

## System Invariants
1. All local paper order submissions pass through the server-side Deterministic Risk Engine; no external order router exists.
2. LIVE entries require authenticated broker account data, broker-confirmed fresh quotes, and completed reconciliation. The current deployment cannot satisfy these requirements and fails closed.
3. Daily loss ceiling, open-risk budget, and maximum portfolio drawdown are non-negotiable hard circuit breakers.
4. Local paper duplicate-order prevention uses `client_order_id`; concurrent same-intent requests share one in-flight outcome, and key reuse with a different payload is rejected.
5. Revenge-Trading Prevention & 5-Loss Cooldown: 5 consecutive closed losses trigger automatic 30-minute pause and auto-execution disablement; net P&L incorporates fees; breakeven is neutral; wins cannot bypass active cooldowns; state is durably persisted and cannot be shortened by ordinary settings.
6. Market session boundaries & calendar lockouts: 15-minute pre-close lockout buffer and weekend entry rejection enforced fail-closed.
7. Controlled rollout remains intentionally conservative: the app stays in `PAPER_ONLY` unless a user-approved live-pilot review has been explicitly completed and a live broker adapter has been independently verified.
8. Strategy suitability is versioned and advisory-only. The selector abstains unless broker-executable fresh quotes, verified fresh candles, calibrated regime confidence, an open verified session, strategy-specific spread/cost caps, passing account/strategy gates, and instrument/timeframe/regime/version-matched out-of-sample evidence are all present. Evidence policy currently requires at least 100 out-of-sample trades, 3 walk-forward windows, positive net expectancy and 95% lower bound, realistic costs/adverse execution, bias review, stable windows, and drawdown no greater than 5%; these cutoffs are initial reviewable policy values, not proven optimal thresholds.
9. Current strategy quotes and candles are simulated, there is no calibrated regime-confidence method or verified calendar, and no validation evidence registry is configured. Production selection therefore returns `NO TRADE` / `UNKNOWN`. Generated signals are simulated research output, not recommendations. The selector does not switch strategies or authorize orders.
10. A local-paper portfolio assessment aggregates local positions, active pending-order remainder, and a proposed entry in the central PAPER permission gate. It enforces the existing exposure/leverage/stop-risk limits and reports joint price/spread/gap stress and rough shared asset-class/quote-currency clusters. It is explicitly an estimate, not a measured correlation or account-wide broker exposure model; no external/manual positions, verified FX conversion, sector mapping, broker margin, or reconciliation are available. The assessment is exposed by authenticated `GET /api/risk/portfolio`.
11. Idempotent local-paper retries preserve terminal rejection/cancellation outcomes and return explicit failure for unresolved intents without creating a second order. Paper fills now use a reproducible deterministic adverse 0.02% model and persist submission quote provenance and local simulator timestamps, labeled `PAPER MODEL`. They are not signal-to-fill or broker execution measurements. The order flow, contract metadata, acknowledgements, fills, slippage, cancellations, and closures are simulated; none demonstrate broker-specific behavior or execution quality.
12. Concurrent local-paper requests sharing one idempotency key await the same in-flight result; reuse of the key with a different order intent is rejected. A replay is reported successful only when its saved state is `FILLED`. This protection is process-local and is not a broker or distributed idempotency guarantee.
13. The central local permission gate validates supplied limit/stop/take-profit prices against the local catalog tick size and rejects invalid explicit prices rather than silently substituting the market quote. These local metadata checks do not prove broker constraints or minimum stop distances.
14. Local USD-denominated position sizing rounds down to local lot steps, refuses an unaffordable minimum lot, and reports risk for the rounded size. Without currency conversion, non-USD instruments are unsized; backtests skip those entries and sizes below the local minimum. The calculation still lacks broker contract multipliers and is only a local estimate.
15. Every order submission passes the server-side `OrderAuthorizationService`: fresh authenticated/reconciled DEMO-account and broker-quote evidence, current broker instrument constraints plus central order validation, and deterministic risk-engine approval must all pass independently. A one-use 1.5-second approval binds the exact order and relevant account/data/portfolio/risk snapshot and is revalidated after durable intent persistence immediately before routing. Decisions and provenance are durably audited without credentials; restart invalidates approvals and unresolved intents remain blocked. Because no broker/account/spec provider is configured, all current new automated entries, including local PAPER fills, fail closed. LIVE remains disabled.

## Recovery and Controlled Rollout
- Recovery target: RTO <= 300s for service restoration, RPO <= 60s for critical state and order ledger persistence.
- Backup restoration: atomic `app_state.json` persistence is used, but backup validation and reconnect/reconcile workflows are not yet live-broker authorized.
- Restart-safe default: on restart, the system loads the durable state and keeps the app non-trading until reconciliation and data-integrity checks pass.
- Rollout gate: `portfolio.rolloutStage` defaults to `PAPER_ONLY`; `liveExecutionAuthorized` remains false until an explicit operator review completes. Any LIVE transition without verified broker data is rejected by the central permission gate.

## Verified Broker Boundary

No broker provider, server, account identity, account mode, currency, leverage, symbol mapping, or broker instrument specification is verified. Broker account values, positions, orders, deals, costs, P&L, and reconciliation are unavailable. Local paper values and simulated quotes must never be described as broker-confirmed.
