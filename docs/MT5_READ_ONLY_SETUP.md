# MetaTrader 5 read-only connection

This app can inspect a session from an MT5 desktop terminal that is already installed, open, connected, and signed in on the **same Windows computer** as the app server. The current connector accepts only an MT5-reported **XM Global demo** identity. The app does not ask for the broker password or account number. Enter credentials only in the official MT5 terminal.

## Local setup

1. Install the MetaTrader 5 desktop terminal supplied by XM Global, then sign in to the intended XM Global demo account in that terminal. If XM provides investor/read-only credentials for the account, use them.
2. In the repository folder, install the Python bridge dependency into the Python interpreter that will run the connector:

   ```powershell
   python -m pip install -r requirements-mt5.txt
   ```

3. Start the app on that same computer:

   ```powershell
   npm run dev
   ```

4. Open **Broker Truth & Gate**, select **MetaTrader 5** and **Logged-in desktop terminal**, then choose **Test read-only connection**.
5. Review the broker/server, masked account number, account type, balance, equity, margin, positions, pending orders, symbol inventory, and snapshot timestamp. To request contract details and quotes, enter up to 10 exact MT5 symbol names (comma-separated) and refresh. A failed or stale test displays an unavailable state instead of substituting paper data.

The bridge checks for an already-running terminal before initializing the MT5 Python API. It reads terminal/account/position/order/symbol data, verifies broker company/server and `account.trade_mode` against XM Global and DEMO, and shuts down its API session after each test. A passing server name must contain `XMGlobal` (ignoring spaces/hyphens), or the broker company must explicitly contain both `XM` and `Global`. The raw account identifier is masked before leaving the local bridge process. Within one server process, the first verified broker/server/account identity is pinned; a later identity change clears the presented snapshot and requires an app restart after the operator confirms the intended terminal login. No password, account number, or server value is sent by the browser or written to app logs. Snapshots are held in memory only and must be tested again after a server restart.

The symbol inventory is capped at 2,500 names; the UI indicates if it was truncated. Requested symbol detail is bounded to 10 exact names. Contract size, tick value/size, volume limits, stop/freeze levels, currencies, trade mode, order mode, execution mode, fill mode, and expiration mode are returned directly from MT5 symbol information where available. A quote is current only when MT5 provides a valid bid/ask and source tick timestamp within the configured 30-second freshness window; freshness ages dynamically while the status view is open. Missing fields and unavailable/stale quotes remain explicitly unavailable/stale. Terminal and account trade-permission flags are displayed as diagnostics; they do not activate the app's trading path. Position commission is unavailable unless the terminal exposes it on the position record; this connector does not infer commission from zero or retrieve deal history. This is a terminal snapshot, not an execution authorization or independent market-data feed.

The connector code makes read-only API calls, but that does not remove trading privileges from a normal MT5 terminal login. Use broker-provided investor/read-only credentials where available. The connector cannot know which account you intended; verify the XM Global server and masked account identifier after connecting. A verified identity is pinned only for the life of the app process, not durably across restarts. MT5 may report missing, expired, and invalid terminal authentication alike as “authentication required”; the app does not guess which occurred.

## Optional local settings

If the default `python` command does not point to the interpreter where `MetaTrader5` is installed, set `MT5_PYTHON_EXECUTABLE` in the **local server environment** to that interpreter's executable path. If automatic terminal discovery does not find the open terminal, set `MT5_TERMINAL_PATH` in the local server environment to its executable path. Neither setting belongs in frontend code or source control. Restart the app after changing either setting.

## Hosted app limitation and safety

A cloud server cannot access an MT5 terminal installed on your PC. The connector endpoints are restricted to loopback requests as well as operator authentication, so a remote server cannot use the browser as a tunnel to your desktop terminal. Run the app locally beside MT5 for this method. A broker-hosted connection is not available until the specific broker offers a verified read-only API and it is implemented; do not send credentials to an undocumented endpoint.

The view is read-only. It does not submit, modify, or close orders, and LIVE/automated trading remains disabled. A displayed MT5 permission flag does not enable app order routing. The app currently has no broker execution adapter, broker-confirmed deal-history/P&L reconciliation, or verified order-result handling. Symbol specifications and quotes are display-only terminal snapshots; they are not wired as pre-trade authorization evidence. A connected demo account therefore does not make demo order execution available; the order gate must continue to reject new submissions while any broker-truth prerequisite is unavailable.

## Optional durable observation capture

To persist a manually initiated read-only observation, call the authenticated local endpoint with one to ten exact symbol names:

```powershell
$secureToken = Read-Host "Operator token" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  $headers = @{ Authorization = "Bearer $token" }
  $body = @{ symbols = @("EURUSD") } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/api/mt5/shadow/captures" -Headers $headers -ContentType "application/json" -Body $body
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  Remove-Variable token, headers, body -ErrorAction SilentlyContinue
}
```

Recent records can be read with `GET /api/mt5/shadow/captures?limit=25`. Both endpoints require operator authentication and a loopback client. Records are stored in `data/mt5-shadow-captures/`, separate from the paper ledger and excluded from Git. They contain the broker-confirmed point-in-time account/position/pending-order snapshot and requested-symbol observations, including capture/quote timestamps, freshness and gaps. Protect this directory as account data. Failed or incomplete manual attempts are stored with their status when the connector returns a state; a storage failure returns an error and does not report success.

The records are **observation-only**, not strategy shadow runs: the strategy engine currently consumes simulated candles, so no predictions are paired with MT5 quotes. Captures are manual and unscheduled; missed-time gaps cannot be inferred. MT5 current account/open positions/pending orders do not include historical deals or completed-order history, and capture files are not a cross-snapshot reconciliation ledger. Do not rely on these records as verified broker P&L/order reconciliation or execution authorization. See [Phase 9 shadow and demo validation](PHASE_9_SHADOW_DEMO_VALIDATION.md) for the current gate and evidence gaps.
