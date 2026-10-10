# RISK POLICY & CAPITAL PRESERVATION RULES

## 1. Prime Invariant
Under no circumstances may a trade signal, optimization routine, or AI recommendation bypass or disable the Deterministic Risk Engine.

## 2. Hard Portfolio-Level Limits
- **Max Risk per Trade:** 0.25% of current equity (Absolute hard ceiling configurable to max 1.00%).
- **Daily Loss Shutdown Threshold:** 1.00% of Start-of-Day (SOD) equity.
  - Action on breach: System status switches to `SUSPENDED_DAILY_LOSS_BREACH`. All open limit/entry orders are instantly cancelled. Safe protective policy active. No risk-increasing orders allowed until next session start.
- **Max Total Portfolio Open Risk:** 2.00% of current equity (Sum of all trade stop-loss risk budgets).
- **Max Portfolio Drawdown:** 5.00% triggers operational review; 10.00% hard system halt.
- **Max Portfolio Gross Leverage:** 1.50x in Paper/Live mode.
- **Max Single Asset Concentration:** 15.00% of portfolio equity.
- **Max Asset Class Concentration:** 35.00% of portfolio equity.
- **Max Simultaneous Open Positions:** 8 positions.

## 3. Trade-Level Execution Safeguards
- **Mandatory Pre-Trade Stop Loss:** Every market or limit order must provide a valid stop-loss price. Order size is derived from stop distance: `Size = (Equity * RiskPercent) / (EntryPrice - StopPrice)`.
- **Max Spread Tolerance:** 0.15% of price. Orders rejected if current spread > 0.15%.
- **Max Allowed Slippage:** 0.20% of expected fill price.
- **Data Freshness Requirement:** Reject entry if last tick age exceeds 30,000 milliseconds.

## 4. Revenge-Trading Prevention & Consecutive-Loss Cooldown
- **Anti-Revenge Invariants:**
  - The system strictly forbids revenge trading: never increase position size (no Martingale or recovery scaling), loosen risk limits, immediately re-enter to recover a loss, or submit extra orders because of a losing trade or missed opportunity.
  - Sizing is hard-capped by `maxRiskPerTradePct` (default 0.25%, absolute institutional ceiling 1.00%). Pre-trade risk evaluates Check 14 (`ERR_REVENGE_SIZING_VIOLATION`) and rejects oversized positions attempting loss-recovery sizing.
- **Loss Accounting Definitions:**
  - **Only Closed Trades Count:** Open positions are never counted as losses.
  - **Net Realized P&L:** Net P&L = Gross P&L minus all commissions, borrow fees, and execution slippage. If Net P&L < -$0.001, the trade is classified as `LOSS`.
  - **Fee Drag Losses:** A trade with positive gross P&L that turns negative after broker commissions is strictly counted as a `LOSS`.
  - **Breakeven Neutrality:** Trades with Net P&L = $0.00 (within ±$0.001) are classified as `BREAKEVEN`. They neither increment the loss counter nor reset it.
  - **Partial Closes:** A partial close with Net P&L < 0 increments the consecutive loss counter for that strategy and the account.
  - **Winning Trade Reset Policy:** A trade with Net P&L > +$0.001 resets the consecutive loss counter to 0 for that strategy and for the account—**provided no cooldown is active**.
  - **Cooldown Immunity to Wins:** If a 30-minute cooldown is already active, a winning trade on an existing position or another strategy **CANNOT** bypass, shorten, or cancel the active cooldown period. The cooldown must run its full duration.
- **5 Consecutive Losses Trigger & Cooldown Invariants:**
  - Tracked independently per strategy and at the account level.
  - When **5 consecutive closed losing trades** occur on a strategy:
    - Automatically pauses all new entries for that strategy for at least **30 minutes** (1,800,000 ms).
    - Automatically disables auto-execution for the affected strategy during the cooldown.
    - Risk limits remain unchanged; no sizing recovery is allowed.
    - Durable audit log records: category `RISK_DECISION`, action `CONSECUTIVE_LOSS_COOLDOWN_TRIGGERED`, sequence count 5, triggering trade IDs, start time, cooldown end time, and reason.
  - When **5 consecutive closed losses** occur across the account:
    - Automatically pauses new entries across the entire account for at least 30 minutes.
- **Server-Side Enforcement & Restart Survival:**
  - The cooldown is enforced server-side and persists durably to `data/app_state.json`.
  - A server restart, client reconnect, AI recommendation, or manual strategy toggle (`/api/strategies/:id/toggle`) cannot bypass the active cooldown.
  - Ordinary settings cannot shorten the cooldown below the 30-minute institutional floor (`consecutiveLossCooldownMinutes >= 30`).
- **Resumption Protocol:**
  - Trading resumes only after the full cooldown duration has elapsed (`cooldownEndTime <= Date.now()`), system health is `HEALTHY`, market quotes are fresh, and all session/calendar invariants pass.

## 5. Operational & Fail-Closed Protocols
- **Degraded Integration:** If broker ping exceeds 2,500ms or market data feed drops > 2 frames, risk state enters `FAIL_CLOSED`.
- **Emergency Kill Switch:**
  - `GLOBAL_KILL_SWITCH`: Cancels all pending entry orders, freezes execution loop, maintains existing protective stops.
  - `PER_STRATEGY_KILL_SWITCH`: Suspends individual strategy.
  - `PER_BROKER_KILL_SWITCH`: Isolates individual broker connection.

## 6. Verified Execution Boundaries
- Every entry proposal must pass the central permission gate, deterministic risk engine, independent account-wide exposure assessment, and broker-specific order authorization before the paper simulator can accept it. The authorization is single-use, short-lived, bound to the complete account/order/quote/risk snapshot, and revalidated after intent persistence immediately before simulated submission.
- Broker sizing uses broker-reported volume bounds and step, contract size, tick size/value, commissions, stop distance, adverse slippage allowance, account currency, and the exact per-trade risk budget. Missing or inconsistent constraints, unsupported currencies/conversions, invalid spread/session/stop rules, or worst-case loss above budget block authorization.
- Open positions and pending orders without verifiable stops make the account-wide stop-risk assessment unavailable for new entries. Broker-confirmed positions without a validated mapping into the risk ledger also block entries rather than being omitted.
- Daily-loss and cooldown state, global halt, and operator strategy/instrument/broker suspensions are persisted together. Missing, corrupt, or incomplete safety state restores with entries halted pending operator review.
- Supported session rules use configured instrument timezone and hours; unsupported or invalid schedules fail closed. Exchange holidays and early closes require an authoritative calendar and are not claimed as verified by the current local schedule rules.
- The current broker truth service has no configured executable account/quote/contract-constraints provider, and the MT5 connector is read-only. Therefore normal order authorization rejects all new submissions. The only order destination in this deployment is the isolated paper simulator; live execution remains disabled. Passing unit fixtures are not evidence of a broker integration.
