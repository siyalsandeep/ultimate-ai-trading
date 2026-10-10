import json
import math
import os
import subprocess
import sys
import time


MAX_SYMBOLS = 2500
MAX_REQUESTED_SYMBOLS = 10
MAX_QUOTE_AGE_MS = 30000

def number_or_none(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def optional_price(value):
    number = number_or_none(value)
    return number if number is not None and number > 0 else None


def terminal_process_running(terminal_path):
    if sys.platform != "win32":
        return False
    names = [os.path.basename(terminal_path)] if terminal_path else ["terminal64.exe", "terminal.exe"]
    for name in names:
        try:
            output = subprocess.run(
                ["tasklist", "/FI", f"IMAGENAME eq {name}", "/FO", "CSV", "/NH"],
                check=False,
                capture_output=True,
                text=True,
                timeout=3,
            ).stdout
        except (OSError, subprocess.TimeoutExpired):
            return False
        if name.lower() in output.lower():
            return True
    return False


def symbol_record(mt5, name, now_ms):
    info = mt5.symbol_info(name)
    if info is None:
        return None

    tick = mt5.symbol_info_tick(name)
    source_time = None
    bid = ask = last = None
    age_ms = None
    if tick is not None:
        tick_time = getattr(tick, "time_msc", 0)
        if tick_time:
            source_time = int(tick_time)
            age_ms = max(0, now_ms - source_time)
        bid = optional_price(getattr(tick, "bid", None))
        ask = optional_price(getattr(tick, "ask", None))
        last = optional_price(getattr(tick, "last", None))

    quote_status = "UNAVAILABLE"
    if bid is not None and ask is not None and ask >= bid and age_ms is not None:
        quote_status = "FRESH" if age_ms <= MAX_QUOTE_AGE_MS else "STALE"

    def field_number(field):
        return number_or_none(getattr(info, field, None))

    return {
        "symbol": str(info.name),
        "description": str(getattr(info, "description", "") or ""),
        "digits": int(info.digits),
        "point": field_number("point"),
        "tradeTickSize": field_number("trade_tick_size"),
        "tradeTickValue": field_number("trade_tick_value"),
        "contractSize": field_number("trade_contract_size"),
        "volumeMinimum": field_number("volume_min"),
        "volumeMaximum": field_number("volume_max"),
        "volumeStep": field_number("volume_step"),
        "stopsLevelPoints": field_number("trade_stops_level"),
        "freezeLevelPoints": field_number("trade_freeze_level"),
        "profitCurrency": str(getattr(info, "currency_profit", "") or ""),
        "marginCurrency": str(getattr(info, "currency_margin", "") or ""),
        "tradeMode": str(getattr(info, "trade_mode", "UNKNOWN")),
        "orderMode": number_or_none(getattr(info, "order_mode", None)),
        "executionMode": number_or_none(getattr(info, "trade_exemode", None)),
        "fillingMode": number_or_none(getattr(info, "filling_mode", None)),
        "expirationMode": number_or_none(getattr(info, "expiration_mode", None)),
        "bid": bid,
        "ask": ask,
        "last": last,
        "sourceTimestamp": source_time,
        "receiptTimestamp": now_ms,
        "quoteAgeMs": age_ms,
        "quoteStatus": quote_status,
    }


def main():
    terminal_path = sys.argv[1] if len(sys.argv) > 1 else None
    requested_symbols = []
    if len(sys.argv) > 2:
        try:
            raw_symbols = json.loads(sys.argv[2])
            if not isinstance(raw_symbols, list) or len(raw_symbols) > MAX_REQUESTED_SYMBOLS:
                print(json.dumps({"ok": False, "code": "ACCOUNT_DATA_INCOMPLETE"}))
                return
            if any(not isinstance(name, str) or not name or len(name) > 32 for name in raw_symbols):
                print(json.dumps({"ok": False, "code": "ACCOUNT_DATA_INCOMPLETE"}))
                return
            requested_symbols = list(dict.fromkeys(raw_symbols))
        except (TypeError, ValueError):
            print(json.dumps({"ok": False, "code": "ACCOUNT_DATA_INCOMPLETE"}))
            return
    if not terminal_process_running(terminal_path):
        print(json.dumps({"ok": False, "code": "TERMINAL_UNAVAILABLE"}))
        return

    try:
        import MetaTrader5 as mt5
    except ImportError:
        print(json.dumps({"ok": False, "code": "TERMINAL_UNAVAILABLE"}))
        return

    initialized = mt5.initialize(path=terminal_path) if terminal_path else mt5.initialize()
    if not initialized:
        print(json.dumps({"ok": False, "code": "TERMINAL_UNAVAILABLE"}))
        return

    try:
        terminal = mt5.terminal_info()
        if terminal is None:
            print(json.dumps({"ok": False, "code": "TERMINAL_UNAVAILABLE"}))
            return
        if not terminal.connected:
            print(json.dumps({"ok": False, "code": "TERMINAL_DISCONNECTED"}))
            return

        account = mt5.account_info()
        if account is None:
            print(json.dumps({"ok": False, "code": "AUTHENTICATION_REQUIRED"}))
            return
        if not account.company or not account.server or not account.currency or int(account.login) <= 0:
            print(json.dumps({"ok": False, "code": "ACCOUNT_DATA_INCOMPLETE"}))
            return

        mode = {
            mt5.ACCOUNT_TRADE_MODE_DEMO: "DEMO",
            mt5.ACCOUNT_TRADE_MODE_CONTEST: "CONTEST",
            mt5.ACCOUNT_TRADE_MODE_REAL: "REAL",
        }.get(account.trade_mode, "UNKNOWN")
        broker_text = str(account.company).casefold()
        server_text = str(account.server).casefold()
        if not (
            ("xm" in broker_text and "global" in broker_text)
            or ("xmglobal" in server_text.replace(" ", "").replace("-", ""))
        ):
            print(json.dumps({"ok": False, "code": "NOT_XM_GLOBAL"}))
            return
        if mode != "DEMO":
            print(json.dumps({"ok": False, "code": "NOT_DEMO_ACCOUNT"}))
            return

        positions = mt5.positions_get()
        orders = mt5.orders_get()
        if positions is None or orders is None:
            print(json.dumps({"ok": False, "code": "TERMINAL_DISCONNECTED"}))
            return

        position_records = []
        for position in positions:
            position_records.append({
                "ticket": str(position.ticket),
                "symbol": str(position.symbol),
                "side": "BUY" if position.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": number_or_none(position.volume),
                "openPrice": number_or_none(position.price_open),
                "currentPrice": number_or_none(position.price_current),
                "stopLoss": optional_price(position.sl),
                "takeProfit": optional_price(position.tp),
                "profit": number_or_none(position.profit),
                "swap": number_or_none(position.swap),
                "commission": number_or_none(getattr(position, "commission", None)),
            })

        pending_records = []
        order_types = {
            mt5.ORDER_TYPE_BUY_LIMIT: "BUY_LIMIT",
            mt5.ORDER_TYPE_SELL_LIMIT: "SELL_LIMIT",
            mt5.ORDER_TYPE_BUY_STOP: "BUY_STOP",
            mt5.ORDER_TYPE_SELL_STOP: "SELL_STOP",
            mt5.ORDER_TYPE_BUY_STOP_LIMIT: "BUY_STOP_LIMIT",
            mt5.ORDER_TYPE_SELL_STOP_LIMIT: "SELL_STOP_LIMIT",
        }
        for order in orders:
            pending_records.append({
                "ticket": str(order.ticket),
                "symbol": str(order.symbol),
                "type": order_types.get(order.type, "OTHER"),
                "volume": number_or_none(order.volume_current),
                "price": number_or_none(order.price_open),
                "stopLoss": optional_price(order.sl),
                "takeProfit": optional_price(order.tp),
                "setupTime": int(order.time_setup_msc) if getattr(order, "time_setup_msc", 0) else None,
            })

        all_symbols = mt5.symbols_get()
        if all_symbols is None:
            print(json.dumps({"ok": False, "code": "TERMINAL_DISCONNECTED"}))
            return
        available_symbols = [str(item.name) for item in all_symbols[:MAX_SYMBOLS]]
        requested_details = []
        unavailable_symbols = []
        received_at = int(time.time() * 1000)
        available_set = set(available_symbols)
        for requested in requested_symbols:
            if requested not in available_set:
                unavailable_symbols.append(requested)
                continue
            record = symbol_record(mt5, requested, received_at)
            if record is None:
                unavailable_symbols.append(requested)
            else:
                requested_details.append(record)

        print(json.dumps({
            "ok": True,
            "broker": str(account.company),
            "server": str(account.server),
            "login": int(account.login),
            "currency": str(account.currency),
            "accountType": mode,
            "balance": number_or_none(account.balance),
            "equity": number_or_none(account.equity),
            "margin": number_or_none(account.margin),
            "freeMargin": number_or_none(account.margin_free),
            "marginLevelPct": number_or_none(account.margin_level) if account.margin > 0 else None,
            "tradingPermissions": {
                "terminalTradeAllowed": getattr(terminal, "trade_allowed", None),
                "terminalTradeApiDisabled": getattr(terminal, "tradeapi_disabled", None),
                "accountTradeAllowed": getattr(account, "trade_allowed", None),
                "accountExpertTradingAllowed": getattr(account, "trade_expert", None),
            },
            "positions": position_records,
            "pendingOrders": pending_records,
            "availableSymbols": available_symbols,
            "symbolsTruncated": len(all_symbols) > MAX_SYMBOLS,
            "unavailableSymbols": unavailable_symbols,
            "symbols": requested_details,
        }, allow_nan=False))
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
