# Phase 9 — Shadow Mode and Demo Forward Validation

**Status: BLOCKED before strategy shadow validation and demo execution.** The app now has an explicit, authenticated manual endpoint that can persist read-only MT5 observations. It does not capture strategy predictions because the strategy engine consumes simulated candles, and it does not reconcile broker history. No terminal was accessed and no capture or order was made for this checkpoint.

## Verified capabilities

- The MT5 connector uses read-only terminal queries, accepts only the configured XM Global demo identity, masks the account ID, bounds symbol requests, labels broker provenance and freshness, and always reports `tradingEnabled: false` and `automatedTradingEnabled: false`.
- The connector is invoked only through operator-authenticated, loopback-restricted endpoints. The local setup is described in [MT5_READ_ONLY_SETUP.md](MT5_READ_ONLY_SETUP.md).
- `POST /api/mt5/shadow/captures` can manually capture one to ten requested symbols and persist the complete read-only snapshot, capture timestamp, broker quote source/receipt timestamps, measured freshness, missing/stale symbol gaps, and explicit status. `GET /api/mt5/shadow/captures` reads recent records. Both routes require operator authentication and a loopback client. Per-capture JSON files are written under `data/mt5-shadow-captures/` using temp-file plus rename; they are separate from the paper ledger.
- Every record is labeled `OBSERVATION_ONLY`, `INCOMPLETE`, or `UNAVAILABLE`, with `tradingEnabled: false` and `automatedTradingEnabled: false`. Manual capture cadence means temporal gaps between expected observations cannot be inferred; the record says `NOT_ASSESSABLE_WITHOUT_SCHEDULE` rather than pretending to detect scheduled misses.
- Captures explicitly report `strategyPredictions: NOT_CAPTURED`: the existing strategies consume the simulated market-data candles, not these MT5 snapshots. The capture is not a complete strategy shadow record and cannot be used to calculate shadow performance.
- Existing MT5 point-in-time snapshots include account metrics, current open positions, pending orders, and requested symbol quotes/specifications. They do not include historical deals or completed-order history. The broker-truth service still returns no broker positions/deals, no verified P&L, and no cross-snapshot reconciliation. New observation files preserve evidence but do not reconcile it.
- Unit tests use a mock bridge to verify a demo-labelled snapshot, account and symbol fields, stale-data behavior, identity rejection, and read-only flags. These are simulated tests, not observations from a user's terminal.
- No broker execution adapter, broker-confirmed deals/P&L history, or broker reconciliation is configured. MT5 snapshots are not wired into order authorization.
- Historical evaluation remains blocked because no authorized OHLCV dataset or realistic execution-cost assumptions are available; see [HISTORICAL_VALIDATION.md](HISTORICAL_VALIDATION.md).
- Phase 8 remains blocked on provider-backed order/stop/reconciliation recovery scenarios. A read-only account snapshot cannot demonstrate execution outcomes.

## Phase 9 evidence not collected

| Requirement | Status | Evidence / limitation |
|---|---|---|
| Observe an authorized live-data source without order access | Not run | No local MT5 terminal or broker session was accessed in this checkpoint. The supported connector is read-only and XM-demo-specific; it does not support a live identity. |
| Capture read-only broker observations durably | Implemented; not exercised against a user's terminal | The manual capture API persists source, capture and quote timestamps, freshness, missing-symbol gaps, connection/capture status, and a point-in-time snapshot. This checkpoint made no real capture because no local terminal was accessed. |
| Record timestamped strategy predictions alongside broker data | Blocked | Strategy observations are still based on simulated candles and are intentionally not attached to MT5 records. There is no validated broker-candle-to-strategy path or prediction-time pairing. |
| Compare predicted and actual execution prices, spreads, fees, slippage, and latency | Blocked | There are no broker-confirmed deals or execution reports, and there is no execution adapter. The paper simulator's fills are not broker evidence. |
| Reconcile broker-confirmed positions, stops, pending orders, deals, and account metrics over a forward period | Blocked | A snapshot contains current account values, open positions, and pending orders only. It lacks historical deals/closed orders, broker stop confirmation semantics, and cross-snapshot comparison. The capture store is not a reconciliation ledger. |
| Demo execution after prior gates pass and local setup is complete | Not authorized/available | Prior historical-validation and Phase 8 gates remain blocked, and no demo execution adapter exists. |
| Live-pilot enablement | Excluded | This phase provides no authorization for live execution. Live execution remains disabled. |

## Safe operating boundary

The execution engine remains PAPER-only, forces PAPER on startup, and rejects LIVE requests. This checkpoint did not connect to a terminal or submit any order. Until all preceding evidence gates pass, use only the local paper simulator and, if the operator independently completes the setup in [MT5_READ_ONLY_SETUP.md](MT5_READ_ONLY_SETUP.md), the read-only demo-account observation view/capture endpoint. Do not submit an order through MT5, enable its terminal trading permissions for this application, or interpret a successful snapshot as execution authorization. Never connect a live account for this phase.

No predicted-versus-actual execution metric, fill, stop confirmation, reconciled forward result, or actual terminal capture is claimed. Existing automated tests do not substitute for a real, user-authorized demo observation period.

## Required inputs and next gate

1. The earliest incomplete prerequisite remains Phase 7: provide authorized, timestamped OHLCV data with provenance/adjustment policy, plus realistic spread, commission, slippage, and gap assumptions. No historical backtest, walk-forward, or candidate-qualification metric can be produced until those are supplied.
2. Phase 8 local tests cover the implemented auth, storage, provider, and simulated order-state failures. The remaining Phase 8 gate requires a broker-specific adapter and provider-backed fault/recovery/reconciliation evidence, which cannot be manufactured from the current read-only connector.
3. For a read-only observation, configure the supported XM Global **demo** terminal locally, set a strong operator token of at least 32 characters, and manually request a capture. Example from PowerShell on the local app computer:

   ```powershell
   $secureToken = Read-Host "Operator token" -AsSecureString
   $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
   try {
     $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
     $headers = @{ Authorization = "Bearer $token" }
     $body = @{ symbols = @("EURUSD") } | ConvertTo-Json
     Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/api/mt5/shadow/captures" -Headers $headers -ContentType "application/json" -Body $body
     Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:3000/api/mt5/shadow/captures?limit=25" -Headers $headers
   } finally {
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
     Remove-Variable token, headers, body -ErrorAction SilentlyContinue
   }
   ```

   Verify broker/server, masked account, source/capture timestamps, quote freshness, capture status, and gaps. Captures include account/position/order snapshot values and are stored locally; protect the data directory. No credentials should be shared with the application in chat or source files.
4. Before relying on broker-confirmed state, implement read-only `history_deals_get` and `history_orders_get` retrieval with explicit UTC range and completeness/error status; bind records to the verified account identity; deduplicate stable broker tickets; compare them with current account, open positions, pending orders, and prior durable snapshots; derive P&L only from complete broker evidence; and fail closed on missing/truncated/out-of-order history. This path does not currently exist.
5. Before demo execution, provide the actual broker-specific execution adapter, verified account/instrument constraints, confirmed stop/fill semantics, reconciliation, and recovery tests. Keep it disabled until every prior gate passes and obtain explicit authorization for that separate milestone.

**Gate result: NOT PASSED.** The code now supports durable manual observation snapshots, but no real terminal capture has been made; there is no paired strategy shadow dataset, complete broker reconciliation, or demo execution capability.

## Checkpoint verification

- `npm run lint` — passed.
- `npm run build` — passed; Vite emitted its existing `__dirname` config-loader warning.
- `npm test` — passed, including mocked capture persistence, source/timestamp/freshness fields, stale/missing-symbol gaps, read-only flags, and surfaced write failure. Existing paper-ledger files were backed up and restored around the test run.
- `git diff --check` and a trailing-whitespace scan of touched files — passed.
- No MT5 terminal was connected, no real broker observation was captured, no orders were sent, and no shadow performance metrics were calculated.
