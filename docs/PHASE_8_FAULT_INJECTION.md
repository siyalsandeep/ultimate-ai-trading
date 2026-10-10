# Phase 8 — Fault Injection, Recovery, and Security

## Scope and disposition

The available application is a local paper-trading simulator with a read-only, unauthenticated broker connector stub. No execution broker, broker credentials, or broker-confirmed account is configured. This report records tests against the code that exists; it does not claim that real broker failure and recovery behavior has been verified.

**Gate status: BLOCKED.** The verified operator-token disclosure was removed and the local fault-injection checks pass, but broker-side rejection, partial execution/close, failed broker stops, and broker reconciliation cannot be exercised without a real broker adapter and demo account.

## Security changes

- `/api/auth/session` now requires operator authorization and never returns the credential. Its responses are non-cacheable and rate-limited.
- Operator secrets shorter than 32 characters are treated as unconfigured; protected routes return `503` and fail closed. Credentials are compared with a constant-time comparison after checking equal lengths.
- The browser asks the operator to enter the token, keeps it in memory only, and clears it on logout or an authorization failure. It is not delivered automatically or persisted in browser storage.
- The server binds to `127.0.0.1` by default. A deployment that sets `HOST` to a network interface must place the service behind a trusted TLS-terminating proxy.
- Finnhub credentials are sent in `X-Finnhub-Token`, not in the request URL. Gemini provider failures log only the error type, not the provider error payload.
- Authorization audit events record the request path, method, and client IP, not submitted credentials.

## Fault-injection evidence

The system test suite covers:

- Stale, duplicate, future-dated, and out-of-order quotes; stale account/reconciliation evidence; broker account identity changes; and terminal disconnect/recovery.
- Provider HTTP failure (`429`) and invalid/unavailable provider snapshots without fabricated market data.
- Missing credentials, unauthenticated session access, unauthorized mutation access, rejected legacy credential headers, authenticated metadata without credential echo, and fail-closed behavior when operator auth is unconfigured.
- Concurrent duplicate order submissions, idempotency-key conflicts, and unresolved submission intent after restart. Uncertain intent remains blocked without broker evidence.
- Stale local quote failures for close/stop updates, stop widening rejection, and emergency cancellation of all open paper-order states while preserving terminal fills and open positions.
- Injected temporary-file write and atomic-rename failures. Both return failure and preserve the prior durable snapshot.
- The new MT5 observation store is fault-tested with an injected atomic-rename failure; the capture request surfaces failure and does not appear in the capture listing. Mocked observations also verify stale-quote and missing-symbol gaps. These tests do not connect to MT5.
- Simulated AI-provider failure. Research falls back to advisory local output, and the injected error payload is absent from captured logs.

These tests establish local behavior only. The partial-fill cancellation case is a state-machine fixture; it does not demonstrate broker partial-fill reporting, accounting, or recovery. Storage fault injection tests the storage service's atomic-write behavior, not a live database or every execution-engine persistence interleaving.

## Remaining release blockers

1. Provide the intended broker adapter and a disposable demo account with documented account identity and instrument constraints.
2. Add provider-backed fault tests for broker rejection, partial fill and partial close, failed stop placement/update, manual broker-side changes, and restart reconciliation. The tests must prove that unresolved outcomes block new entries until authoritative reconciliation succeeds.
3. The read-only MT5 snapshot currently returns account metrics, current positions, pending orders, and requested symbol details only. It does not retrieve historical deals or completed orders, validate history completeness, reconcile successive snapshots, or provide broker-confirmed realized P&L and stop/fill outcomes. The new durable observation capture is not a substitute for that reconciliation path.
4. Verify deployment network boundaries and TLS when `HOST` is configured beyond loopback. Operator authentication is a single shared bearer secret, not a multi-user identity or session system.

Do not enable live execution based on this report. Live execution remains disabled.
