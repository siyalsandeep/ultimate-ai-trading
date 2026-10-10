# BUGS AND FAILURES LOG

## Recorded Incidents & Mitigations
- **Bug/Issue #001: Client-Side Secrets Exposure Prevention**
  - *Risk:* Calling LLM or broker APIs with keys on frontend.
  - *Mitigation:* All Gemini API calls (`@google/genai`) and broker adapter authentication are strictly server-side in `server.ts` and backend services. Never bundled to client.

- **Bug/Issue #002: Stale Market Data Execution**
  - *Risk:* Executing market orders on quotes delayed by network latency.
  - *Mitigation:* Risk Engine verifies `quote.timestamp >= Date.now() - 30_000`. Stale quotes reject order immediately with code `ERR_STALE_MARKET_DATA`.

- **Bug/Issue #003: Double Fill on Network Timeout**
  - *Risk:* Retrying order placement without idempotency creates duplicate broker orders.
  - *Mitigation:* Local paper orders use `client_order_id` idempotency and persist the order intent before submission. Unresolved persisted intents restore as `UNCERTAIN`, are not automatically retried, and block new entries. Persistence failures after a simulated outcome are surfaced instead of reported as success.
  - *Remaining:* No broker reconciliation adapter exists to resolve uncertain intents from authoritative records. Live execution remains disabled.

- **Incident #004: Invariant Verification - Asset Concentration Ceiling**
  - *Test Event:* Test attempted to allocate additional SPY shares while existing portfolio was already holding 17.4% SPY.
  - *Result:* Deterministic Risk Engine immediately caught and rejected the order with `ERR_ASSET_CONCENTRATION` (target 20.12% vs 15% ceiling). Test updated to test non-concentrated symbols. Invariant verified functioning properly.

- **Bug/Issue #005: Order submission bypassed current service health**
  - *Risk:* `ExecutionEngine.submitOrder()` passed a hard-coded `HEALTHY` value to both permission and risk checks, so a degraded health report could not block a new paper entry.
  - *Mitigation:* Order submission now requires a `HealthState`; the authenticated server route obtains a fresh server-side health report and passes it to both gates. The central permission gate rejects any status other than `HEALTHY`.
  - *Verification:* `tests/system.test.ts` checks a direct order submission is rejected with the exact degraded-health reason. No live order path exists.

- **Bug/Issue #006: Idempotent replay masked rejected or uncertain outcomes**
  - *Risk:* A retry for an existing `clientOrderId` previously returned `success: true` without checking whether its order was rejected/cancelled or whether its write-ahead intent remained uncertain. Callers could misread a failed or unresolved paper outcome as successful processing.
  - *Mitigation:* Unresolved intents now return an explicit `UNCERTAIN` failure before a new order record is created. Replaying a rejected/cancelled order preserves its unsuccessful result and reason; confirmed local paper outcomes remain idempotent.
  - *Verification:* `tests/system.test.ts` covers rejected replay and uncertain-intent duplicate prevention. This is local paper behavior only; no broker adapter exists to query or reconcile actual orders.

- **Bug/Issue #007: Concurrent idempotent submissions could report a premature success**
  - *Risk:* Two overlapping requests with the same `clientOrderId` could let the later request return `success: true` while the first order was only `VALIDATED`, before a fill outcome existed. The old replay path also accepted the same key with a different payload.
  - *Mitigation:* Concurrent duplicate requests now share the original in-flight promise. Reuse with a different order intent is rejected, and persisted replays are successful only for a `FILLED` order.
  - *Verification:* Regression coverage exercises concurrent duplicate submissions, final-state consistency, and mismatched-payload rejection. This applies to the local paper simulator; broker-side idempotency remains unimplemented.

- **Bug/Issue #008: Explicit order prices and protective levels were not checked against tick size**
  - *Risk:* The central gate checked quantity steps but allowed off-tick limit, stop-loss, and take-profit prices. The execution path also used truthy fallbacks, so an explicit zero price could be silently replaced by the current quote.
  - *Mitigation:* The central gate now validates local instrument increments and rejects non-finite/non-positive supplied prices or levels and off-tick values. Limit orders require an explicit price. Execution now preserves explicit values for validation instead of replacing zero with a quote.
  - *Verification:* Gate and submit-path regression tests cover off-tick limit/stop/take-profit prices and explicit zero limit price. Broker-specific minimum stop distances, maximum order volume, and current contract rules remain unavailable and unverified.

- **Bug/Issue #009: Risk sizing forced an unaffordable minimum lot**
  - *Risk:* `calculatePositionSize()` clamped a below-minimum risk-sized quantity up to `minLotSize`; the backtest similarly forced at least one unit. Both could exceed the stated trade-risk budget.
  - *Mitigation:* Position sizing now abstains with zero quantity if the minimum lot is unaffordable, validates finite inputs, only reports USD risk for USD-quoted instruments when no conversion is configured, and reports the actual risk of the rounded size. Backtests now round down to the local lot step/minimum and skip entries that do not fit their modeled USD risk budget.
  - *Verification:* Regression tests check unaffordable minimum lots, actual rounded risk, missing currency conversion, and non-finite equity. Backtest fills and sizing remain synthetic local research assumptions, not broker-verified execution.

- **Bug/Issue #010: Order submission had no atomic, expiring broker-truth authorization**
  - *Risk:* Permission checks and deterministic-risk checks were separate, allowed local PAPER data to progress to simulated fills, and were not repeated after the asynchronous write-ahead persistence step. Broker account state and broker-provided instrument constraints were unavailable.
  - *Mitigation:* All `ExecutionEngine.submitOrder()` calls now use one server-side authorization service requiring independent verified account/quote, broker instrument/order constraint, and deterministic risk approvals. It binds a one-use 1.5-second approval to the exact order and account/quote/instrument/position/order/risk snapshot, then re-evaluates after intent persistence immediately before the simulated routing point. The server route supplies a fresh health-check callback. No broker/account/spec evidence means rejection; no LIVE or simulated fill is produced.
  - *Verification:* Tests cover approval pass with synthetic fixtures; missing/stale account, quote, and instrument inputs; bad volume/stop/parameters; central-gate and risk rejection; expiration, replay, and changed quote/volume/account/positions/risk limits; concurrent keys; authorization source failure; audit persistence; and restart uncertainty. No connected broker adapter exists, so the real order path is expected to fail closed and no broker response or live execution is claimed.
