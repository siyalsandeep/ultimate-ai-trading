# DECISIONS LOG

## Architectural Decisions
1. **Separation of Concerns Between AI and Risk Engine:**
   - *Decision:* The AI assistant (Gemini 3.8 Flash) operates strictly in advisory and exploratory capacities. It produces hypothesis memos, regime commentary, and trade signal explanations.
   - *Rationale:* Algorithmic trading requires strict deterministic invariants. No probabilistic LLM token stream may ever directly invoke order routing or bypass risk bounds.

2. **Deterministic Risk Invariants:**
   - *Decision:* Hard-coded conservative risk limits cannot be relaxed by UI inputs beyond safe institutional boundaries (maximum 1% per-trade risk ceiling, 2.5% max daily loss ceiling, maximum 3x leverage ceiling).
   - *Rationale:* Protect against operator error and rogue strategy parameter runaway.

3. **Order State Machine and Idempotency:**
   - *Decision:* All orders must possess a client-generated UUID `client_order_id`. Any submission retry with the same ID returns the existing order state rather than generating duplicate orders.
   - *Rationale:* Eliminates double fills during network timeouts or reconnections.

4. **Realistic Market Execution Modeling:**
   - *Decision:* Paper trading and backtesting explicitly apply half-spread cost, square-root volume market impact slippage, and explicit broker fee schedules ($0.005/share equities, 0.075% taker crypto, $2.00/lot forex).
   - *Rationale:* Paper trading without friction produces dangerously inflated expectations.

6. **Visual System & Cinematic Surface Tokens:**
   - *Decision:* Formulate high-density financial terminal layout with dark charcoal/slate foundation (`#06080d`), hairline border hierarchy (`border-white/[0.08]`), soft radial highlights (`cinematic-glow`), and consistent tabular numerals (`tabular-nums font-mono`).
   - *Rationale:* Financial trading terminals demand zero visual noise, no generic AI slop (no candy pills, no cartoonish gradients), and immediate scanability of numbers and risk states.

7. **Product Branding Harmonization:**
   - *Decision:* Standardize product name to **Ultimate AI Trading** consistently across header, badges, titles, and operational dialogs.
   - *Rationale:* Ensures cohesive product identity and institutional presence.

8. **Market Calendar Session Enforcement and Weekend Lockouts:**
   - *Decision:* Instruments now define explicit exchange timezones, pre-close entry buffer minutes (e.g. 15 minutes before close), and weekend entry locks (`weekendEntryAllowed: false` for traditional equities, ETFs, FX, indices, commodities; true for 24/7 crypto).
   - *Rationale:* Avoids holding illiquid positions across market closes with unpredictable gap risks or entering when orders cannot be reliably liquidated before the bell.

9. **Revenge-Trading Prevention & Consecutive-Loss Cooldown:**
   - *Decision:* Implemented automatic 30-minute entry lockout and auto-execution disablement triggered when 5 consecutive closed losing trades occur on any strategy or account-wide. Losses are strictly calculated net of all commissions and slippage. Breakeven trades ($0.00 net P&L) are neutral (neither increment nor reset the loss counter). Active cooldowns are immune to wins (a winning trade cannot bypass or shorten an active cooldown). Cooldown state is durably persisted to `data/app_state.json` with an institutional floor of 30 minutes that cannot be reduced via ordinary settings or manual strategy toggles. Pre-trade risk Check 14 evaluates revenge sizing to prohibit oversized position scaling following losses.
   - *Rationale:* Revenge trading is the primary cause of sudden catastrophic drawdown among both discretionary and automated traders. Hard deterministic cooldowns interrupt emotional bias, algorithmic feedback loops, and regime mismatches without permitting manual circumvention.

10. **Broker Truth and Live-Execution Boundary:**
   - *Decision:* Until a real provider adapter is implemented and authenticated, broker identity, account metrics, positions, deals, costs, P&L, symbol mappings, and reconciliation are unavailable. Local simulated quotes and paper positions are never labeled broker-confirmed. LIVE execution remains disabled.
   - *Rationale:* Generated test fixtures and local paper state cannot establish broker truth or justify live risk.

11. **Current health is a required order authorization input:**
   - *Decision:* The paper order-submission path receives the current server-side `HealthState`; only `HEALTHY` permits progression past the execution-health gate. It must not replace current health with a constant.
   - *Rationale:* A hard-coded healthy value silently defeats fail-closed behavior when data, reconciliation, or supporting services degrade. Live execution remains separately disabled.
   - *Alternatives considered:* Keep a constant for the isolated paper simulator (rejected: it masks operational failure); read health state from the client (rejected: client state is not authoritative).

12. **Write-ahead paper order intents and conservative restart recovery:**
   - *Decision:* Persist the client order intent before paper submission. Remove it only after a definite simulated outcome is durably saved or a definitive rejection is saved. Restore any still-pending intent as `UNCERTAIN` and block new entries; do not retry it without authoritative reconciliation evidence.
   - *Rationale:* A process restart or persistence failure must not erase whether a submission may have occurred. Current execution is simulated only, and no broker adapter exists to resolve ambiguity.
   - *Alternatives considered:* Retry pending intents on restart (rejected: could duplicate an order); discard intents when outcome persistence fails (rejected: could lose a fill); mark them uncertain and block (chosen: fail-closed despite possible manual recovery).

13. **Strategy suitability requires explicit evidence and may abstain:**
   - *Decision:* Keep versioned, human-readable definitions and only select a single strategy when instrument/timeframe/market-condition match, calibrated regime confidence is at least 0.75, a fresh broker-executable `LIVE` quote and verified fresh candles are present, the verified session is open, spread and total transaction costs are below strategy-specific limits, account and strategy gates permit entry, and strategy-version/instrument/timeframe/regime-matched evidence passes fixed criteria (at least 100 out-of-sample trades, 3 walk-forward windows, positive net expectancy and positive 95% lower confidence bound, realistic costs, adverse execution, bias review, stable windows, and drawdown no greater than 5%). Preserve dataset/run/code identifiers, out-of-sample metrics, costs, and turnover with the decision. Otherwise return `NO_TRADE`; if multiple qualify, abstain rather than rank by recent profit. This selector is manual analysis only; it does not switch strategies or authorize orders.
   - *Rationale:* The active feed and candles are synthetic, and the existing backtest is not sufficient validation evidence. Explicit gates avoid representing regime labels or historical returns as proof of strategy suitability. Numerical cutoffs are conservative initial policy thresholds, not empirically proven optimal values; review them with independently reproducible evidence before any deployment.
   - *Alternatives considered:* Select the highest recent backtest return (rejected: encourages overfit); reuse the existing simulated regime/signal stream (rejected: unverified inputs); abstain until independent evidence exists (chosen).
   - *Versioning:* Operator parameter edits increment the strategy patch version and are audited, so evidence tied to an earlier ruleset cannot qualify the changed version.

14. **Portfolio exposure assessment is an explicitly estimated paper-ledger control:**
   - *Decision:* Before permitting a PAPER entry, aggregate known local positions, active pending-order remainder, and the proposed entry. Enforce existing symbol, asset-class, strategy, gross-leverage, and stop-risk budgets. Report a joint adverse price/spread/gap scenario without diversification credit and shared asset-class/quote-currency clusters as proxies only.
   - *Rationale:* Single-trade checks understate combined exposure. At the same time, no broker reconciliation, FX conversion, verified sector/common-factor mapping, or empirical correlation dataset exists, so these estimates must not be presented as account-wide broker risk or measured correlation.
   - *Unavailable:* Manual/external positions and orders, broker margin, verified currency conversion, sector/common-factor exposures, and broker reconciliation. Unpriceable local positions/orders fail closed. The stress output is informative; no new stress-loss limit is inferred from the daily-loss limit.
   - *Seed data integrity:* Default simulated positions use stops relative to the simulated bid at initialization; static demo stops could already be breached before the first risk check and incorrectly obscure the actual local-ledger risk state.

15. **Idempotent order replays preserve failure and uncertainty:**
   - *Decision:* A retry with an existing client order ID returns the original outcome, never a success-shaped response for a rejected/cancelled order. If its durable intent is unresolved, return an explicit uncertain failure before creating another order.
   - *Rationale:* The prior implementation returned `success: true` for any known order, including rejected orders, and could mask an uncertain intent that shared its idempotency key. This correction applies only to the local paper simulator; no broker retry or reconciliation behavior is asserted.
   - *Broker boundary:* Local catalog fields, acknowledgement/fill events, randomized slippage, and local cancel/close behavior do not establish broker-specific contract rules, fills, execution quality, or confirmed closure. A connected account and isolated broker demo are prerequisites for those claims.
16. **Paper execution telemetry is deterministic and explicitly simulated:**
   - *Decision:* Use a fixed 0.02% adverse paper slippage assumption, round simulated fills to the configured local tick size, and persist the source quote provider/quality/time, reference price, local submission/acknowledgement/fill timestamps, model, and simulator processing duration.
   - *Rationale:* Random fill perturbations made tests and comparisons irreproducible. Captured provenance makes simulation assumptions reviewable without presenting them as observed broker execution.
   - *Limits:* This is not a calibrated instrument-specific execution model. There is no signal-time quote supplied to the order path; the displayed elapsed time is local simulator processing, not broker latency. No live execution-quality monitoring is claimed.
17. **Concurrent submissions share idempotent outcomes:**
   - *Decision:* Coalesce concurrent requests with the same `clientOrderId` and identical order intent onto one in-flight submission. Reject reuse of that identifier for a different payload, and report a replay successful only when the persisted order is `FILLED`.
   - *Rationale:* Returning an in-progress `VALIDATED` order as successful misrepresented execution state, while different payloads under one idempotency key made the caller's intent ambiguous.
   - *Limits:* This lock is in-process and specific to the local paper simulator. It does not provide cross-process or broker-side idempotency; uncertain intents remain blocked and cannot be cleared without authoritative broker reconciliation.
18. **Validate prices against configured local tick increments:**
   - *Decision:* Reject explicit order, protective stop, and take-profit prices that are non-positive, non-finite, or off the local catalog tick grid; require an explicit price for limit orders. Preserve explicitly supplied values rather than replacing falsey values with a quote.
   - *Rationale:* Silently using a quote for an invalid explicit price changes the operator's order intent. Off-tick prices are invalid against even the local simulator catalog and cannot safely reach an execution adapter.
   - *Limits:* These checks use unverified local simulator metadata only. They do not establish broker precision, minimum stop distance, freeze levels, maximum volume, or accepted order modes; LIVE remains disabled.
19. **Position sizing never increases a risk budget to meet minimum lot size:**
   - *Decision:* Round risk-derived volume down to the configured local lot step and abstain when it falls below the configured minimum. Reject non-finite inputs and do not label a non-USD quote-currency estimate as USD without conversion.
   - *Rationale:* Raising a sub-minimum size to the minimum silently exceeds approved risk; a backtest with the same behavior also overstates deployable results.
   - *Limits:* The local catalog lacks verified broker contract multipliers and conversion rates. Backtest and paper values remain estimates; this policy does not establish actual broker sizing or margin.
20. **A mandatory, expiring three-approval service is the only order-submission authorization boundary:**
   - *Decision:* Every server-side submission must pass (A) fresh authenticated demo-account, broker-quote, and reconciled-state checks; (B) fresh broker instrument constraints and the existing central parameter gate; and (C) the deterministic risk engine. Approval is single-use, valid for at most 1.5 seconds, and bound to the exact order plus account, quote, instrument, portfolio/positions/orders, health, and risk-limit snapshot. The service revalidates after durable intent persistence immediately before simulated routing. Reject when any input is unavailable or changes.
   - *Rationale:* Separate preflight checks can become stale across persistence or be satisfied by simulated/local metadata. A single server-only service prevents AI, UI, strategy and retry code from substituting confidence for independent risk approval.
   - *Audit:* Persist the intent, data timestamps/provenance, instrument rules, gate/risk check results, snapshot fingerprint, decision, rejection reason, and explicit `NOT_SUBMITTED` broker response state. Account identity is hashed in audit records; credentials are never included. Restart invalidates approvals and unresolved intents remain blocked.
   - *Limits:* No broker read-only/account adapter, broker-executable quote, instrument constraints, or reconciliation is configured. Therefore all current automated order submissions are rejected, including local PAPER fills. Only synthetic service fixtures exercised the approval path. LIVE remains technically disabled.
