# IMPLEMENTATION CHECKLIST — STAGED BUILD MASTER PLAN

> Broker/provider status in this historical checklist was not evidence of a real connection. The current verified provider and execution boundary is documented in `INTEGRATIONS_STATUS.md` and `EXECUTION_STATE.md`; no broker account adapter is configured.

- [x] **Stage 1 — Repository audit and truth check**
  - [x] Codebase audited: no unverified live broker connections present
  - [x] Project state verified in code rather than documentation assumptions
  - [x] All data, broker, and execution pathways mapped truthfully

- [x] **Stage 2 — Immediate safety and truthful operating modes**
  - [x] Default operating mode set to `PAPER` on startup, reconnect, and process restart
  - [x] `setMode('LIVE')` strictly locked behind technical fail-closed barrier
  - [x] Unverified broker order attempts rejected immediately with `ERR_BROKER_ISOLATED`
  - [x] Demo/test feeds accurately labeled `SIMULATED`

- [x] **Stage 3 — Secure foundation and canonical architecture**
  - [x] Operator authentication (`/api/auth/session`, Bearer/x-operator-token header)
  - [x] Sliding-window rate limiting on mutating endpoints (60 req/min)
  - [x] Input validation for order payloads, risk limits, and strategy toggles
  - [x] Server-side secrets isolation (no API keys bundled to browser)

- [x] **Stage 4 — Durable persistence and restart recovery**
  - [x] Atomic write-and-rename state persistence in `data/app_state.json`
  - [x] Orders, positions, portfolio balances, risk limits, and audit events saved
  - [x] Safe restart recovery with schema validation and idempotency cache restoration
  - [x] Persist order intents before paper submission; restore unresolved intents as uncertain and block new entries
  - [ ] Reconcile uncertain intents against authoritative broker records after restart (broker integration unavailable; live execution remains disabled)

- [x] **Stage 5 — Market-data integrity and global source coverage**
  - [x] Multi-asset quotes (Equities, Crypto, FX, Commodities, Indices) with quality tags (`SIMULATED`)
  - [x] Freshness tracking with 30,000ms staleness threshold
  - [x] Fail-closed gating on missing or stale market quotes

- [x] **Stage 6 — Instrument calendars and trading schedule**
  - [x] Exchange calendars and timezones mapped per asset class
  - [x] 15-minute market-close lockout buffer enforced on equities
  - [x] Weekend entry rejection for equities, forex, and commodities

- [x] **Stage 7 — Deterministic risk and order safeguards**
  - [x] Server-side Deterministic Risk Engine independent of AI and strategy code
  - [x] 13 protective checks: mandatory stop-loss, 0.25% equity budget, daily loss circuit breaker, leverage cap, asset concentration, and session boundaries
  - [x] Emergency kill switches (global, per-strategy, per-broker) with instantaneous halt

- [x] **Stage 8 — Explainable AI research assistant**
  - [x] Advisory-only AI quant assistant via `@google/genai` (Gemini 3.8 Flash)
  - [x] AI strictly prohibited from placing orders or altering risk limits
  - [x] Advisory recommendations include `WAIT` / `NO_TRADE` during market regime shocks

- [x] **Stage 9 — Strategy research and honest profitability evaluation**
  - [x] Trend Following, Mean Reversion, Momentum, and Regime Classifier modules
  - [x] Backtesting engine with 70/30 in-sample/out-of-sample split
  - [x] Realistic friction: half-spread, quadratic slippage, commission drag, borrow fees

- [x] **Stage 10 — Paper trading and order lifecycle**
  - [x] Complete order state machine (`CREATED → VALIDATED → SUBMITTED → ACKNOWLEDGED → FILLED / REJECTED / CANCELLED`)
  - [x] Cryptographic idempotency key (`client_order_id`) prevents duplicate executions
  - [x] Isolated execution engine physically incapable of dispatching live orders

- [x] **Stage 11 — User experience and visual design**
  - [x] Refined dark-mode financial terminal with zero AI slop and tabular numerals
  - [x] High-contrast status badges (READ-ONLY, PAPER, SIMULATED, LIVE LOCKED)
  - [x] Accessible keyboard navigation, reduced-motion compliance, and visible focus rings

- [x] **Stage 12 — Operational monitoring, security review, and compliance**
  - [x] Health check endpoints (`/api/health`, `/api/health/detailed`, `/api/health/run-check`)
  - [x] Honest broker matrix reporting unconfigured status for live gateways
  - [x] Disclaimers for jurisdictional algo regulations and risk disclosure

- [x] **Revenge-trading prevention and consecutive-loss cooldown**
  - [x] Anti-revenge policy strictly enforced: no position size escalation, no limit loosening, no recovery re-entries
  - [x] Pre-trade risk Check 14 (`ERR_REVENGE_SIZING_VIOLATION`) rejects oversized risk expansion
  - [x] Closed trade loss tracking: only closed trades count; open trades excluded
  - [x] Fee drag accounting: gross profit turning into net loss after fees counted as loss
  - [x] Breakeven neutrality: $0.00 net P&L leaves counter unchanged (neither increment nor reset)
  - [x] 5 consecutive losses triggers automatic 30-minute pause for strategy and/or account
  - [x] Auto-execution disabled for affected strategy during cooldown
  - [x] Durable audit log captures sequence, 5 triggering trade IDs, start time, end time, and reason
  - [x] Winning trades cannot bypass or shorten an active cooldown
  - [x] Strategy isolation enforced: Strategy A cooldown does not block unaffected strategies
  - [x] Server-side enforcement persists to `data/app_state.json` and survives restarts
  - [x] Manual strategy toggle cannot bypass active cooldown
  - [x] Ordinary settings cannot shorten cooldown below 30-minute institutional floor
  - [x] Frontend UI displays unboxed paused badge, remaining countdown timer, and triggering trades
  - [x] Automated test suite verifies all cooldown triggers, accounting rules, isolation, and persistence

- [x] **Stage 13 — Release review and continuous improvement**
  - [x] Full automated test suite passing cleanly (`tests/system.test.ts`)
  - [x] Production compilation verified (`compile_applet`)
  - [x] Project memory and execution state updated to authoritative state

- [x] **Stage 14 — Provider price provenance and execution health gate**
  - [x] Add a display-only, explicitly mapped Finnhub snapshot adapter; do not present it as connected without credentials and entitlement verification
  - [x] Keep provider snapshots separate from simulated quotes and generated candles in the terminal
  - [x] Reject paper entries when the current server-side health state is degraded or unavailable
  - [x] Verify provider failure/staleness and degraded-health rejection using mocked tests
  - [ ] Configure an authorized market-data account and observe provider quotes/timestamps before describing any provider feed as connected
  - [ ] Complete actual broker identity verification, read-only account integration, reconciliation, and independently authorized live-pilot review; live execution remains disabled

- [x] **Stage 15 — Durable uncertain paper-order intents**
  - [x] Persist client order intent before paper submission and preserve uncertain outcomes across restart
  - [x] Clear intents only after durable definite outcomes; fail closed if outcome persistence fails
  - [x] Verify restart blocking and idempotency without resubmitting ambiguous intents
  - [ ] Reconcile unresolved outcomes against genuine broker records; unavailable until a verified read-only broker integration exists

- [x] **Stage 16 — Strategy catalog and evidence-gated suitability**
  - [x] Version strategies and document eligible classes/timeframes, conditions, rules, risk, assumptions, and limitations
  - [x] Abstain on non-broker-executable/delayed/simulated/stale/unverified data, unknown/low-confidence regime, closed/unknown session, excessive spread, account/strategy risk blocks, or insufficient version-matched evidence
  - [x] Require regime/instrument/timeframe/version-matched out-of-sample and walk-forward evidence, realistic costs/adverse execution, bias review, positive lower confidence bound, and risk limits; do not rank on recent profit
  - [x] Expose and audit an operator-triggered selection decision; label existing generated signals as simulated
  - [x] Keep selection advisory-only with no automatic strategy switching or order authorization
  - [ ] If automatic switching is proposed, define and validate explicit switch hysteresis/cooldown and require separate operator approval first
  - [ ] Produce reproducible historical and out-of-sample evidence from authorized historical data before any strategy can qualify in production

- [ ] **Stage 17 — Estimated local portfolio stress and aggregate exposure gate**
  - [x] Add local-paper-ledger exposure totals for open positions, active pending orders, and the proposed entry; enforce existing leverage, symbol, asset-class, strategy, and stop-risk budgets in the central permission gate
  - [x] Report joint adverse price, spread-widening, and gap scenarios without diversification credit; identify shared asset-class/quote-currency clusters as proxies, not measured correlations
  - [x] Expose the assessment through an authenticated operator endpoint and mark its source `LOCAL_PAPER_LEDGER` / `ESTIMATED_PAPER_ONLY`
  - [ ] Reconcile manual/external broker holdings, currency conversion, sector/common-factor exposure, historical correlation, event scenarios, and broker margin before claiming account-wide portfolio risk
  - [ ] Add a dedicated portfolio-risk UI, strategy-health monitoring, execution-quality limits, verified event safeguards, and pause/instrument-disable/resume-authorization controls
  - [ ] Complete deterministic tests for pending-order exposure, stress boundaries, unknown inputs, persistence/restart, and all relevant failure paths

- [ ] **Stage 18 — Order replay honesty and broker integration boundary**
  - [x] Make idempotent retries preserve the original rejected/cancelled result instead of returning success
  - [x] Block retries for an unresolved order intent before creating another order record
  - [x] Add regression coverage for rejected-order replay and uncertain-intent duplicate prevention
  - [ ] Implement only after a verified broker/account is available: current broker-provided contract rules, execution modes/fill policies, margin calculations, broker order/deal identifiers, and authoritative order/position reconciliation
  - [ ] Verify broker acknowledgements, partial fills/closes, cancellations, stop changes, execution quality, and restart outcomes in an isolated demo environment before claiming support
  - [ ] Keep LIVE disabled until actual account, instrument specifications, authorization, reconciliation, and independently reviewed release gates are proven

- [ ] **Stage 19 — Reproducible paper execution telemetry**
  - [x] Replace random simulated slippage with a documented deterministic adverse 0.02% assumption rounded to local catalog tick size
  - [x] Persist paper-only quote provider/quality/timestamp, reference price, submission/acknowledgement/fill timestamps, and simulated processing duration on each simulated order
  - [x] Label blotter telemetry as a paper model; test both order sides, tick-size validation, and stored telemetry
  - [ ] Capture a genuine signal-time executable quote and compare broker-confirmed submission/fill costs only after a verified data/execution adapter exists
  - [ ] Validate execution assumptions, adverse fills, rejection/partial-fill behavior, and strategy health on separated shadow/demo evidence before rollout

- [ ] **Stage 20 — Concurrent order idempotency**
  - [x] Coalesce concurrent duplicate submissions by client order ID so all callers receive the same final result
  - [x] Reject reuse of an idempotency key for a different payload
  - [x] Do not report replayed in-progress orders as successful fills
  - [x] `npm run lint` passes; `npm test` passes with isolated clean paper state and original user state restored

- [ ] **Stage 21 — Local order-price constraint validation**
  - [x] Validate finite positive instrument lot-step, tick-size, margin, and currency metadata before risk approval
  - [x] Enforce local tick alignment for explicit order, stop-loss, and take-profit prices; require price on LIMIT orders
  - [x] Reject explicit zero/invalid values instead of substituting a quote
  - [ ] Validate broker minimum stop distance, maximum volume, price precision, and permissions after verified broker specifications are available
  - [x] `npm run lint`, `npm run build`, and full `npm test` pass with isolated PAPER state; original state restored byte-for-byte

- [ ] **Stage 22 — Risk-bounded position sizing**
  - [x] Abstain when the risk budget cannot fund the minimum local lot; never round risk upward
  - [x] Validate finite inputs and only return USD risk where the local quote currency is USD and no conversion is needed
  - [x] Update the research backtest to respect local minimum/step volume and skip sizes that exceed the modeled risk budget
  - [x] Add regression tests for unaffordable minimum, rounded-size risk, missing currency conversion, and non-finite equity; `npm run lint`, `npm run build`, and isolated `npm test` passed
  - [ ] Verify contract multipliers, currency conversion, margin, and broker-side minimum/maximum volumes with a read-only broker source before any broker use

- [ ] **Stage 23 — Mandatory broker-truth order authorization**
  - [x] Route every server order submission through a service requiring fresh broker/account, broker instrument/parameter, and deterministic risk approvals
  - [x] Bind a single-use 1.5-second approval to exact order and account, quote, instrument, positions/orders, health, and risk-limit state; revalidate after write-ahead persistence immediately before routing
  - [x] Durably audit authorization inputs, timestamps/provenance, component checks, decision, rejection reason, and explicit no-broker-submission response; do not log account credentials
  - [x] Fail closed on missing/stale data, changed state, service failure, expired/replayed authorization, risk rejection, or invalid parameters
  - [x] `npm run lint`, `npm run build`, and isolated full `npm test` passed; original app-state files were restored byte-for-byte
  - [ ] Supply and independently verify a read-only DEMO account feed, fresh broker quotes, current instrument constraints, and reconciliation before PAPER entries can pass the gate
  - [ ] Implement and separately verify broker execution acknowledgements/reconciliation; keep LIVE disabled

- [ ] **Phase 4 — Central risk engine and broker-specific authorization**
  - [x] Enforce exact per-trade risk budgets with broker tick/contract/volume/commission rules and conservative stop/slippage loss
  - [x] Apply an independent account-wide position/order/proposed-exposure and open-stop-risk assessment; block unknown stop risk and unmapped broker positions
  - [x] Enforce freshness, spread, configured session, initial-stop direction/distance, currency, volume, and tick constraints before authorization
  - [x] Persist and restore global halt, daily-loss breaker, cooldown, and strategy/instrument/broker suspensions; incomplete state fails closed
  - [x] Reject stale-quote local close/stop operations and halt when safety-state persistence fails
  - [x] Add negative tests for broker/account/quote/constraint failures, risk excess, session closure, cooldown persistence, and stale close/stop operations; `npm run lint`, `npm test`, `npm run build`, and `git diff --check` passed
  - [ ] Connect an authoritative DEMO broker account, executable quote, reconciliation, and instrument-constraints provider; verify actual broker details rather than fixtures
  - [ ] Validate broker-side order/close/stop acknowledgements and failure recovery in isolated DEMO; keep LIVE disabled
