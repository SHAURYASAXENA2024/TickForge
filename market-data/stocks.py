import yfinance as yf
from datetime import datetime, timezone


def get_stock_data(symbol: str, range: str = "1d", interval: str = "5m"):
    ticker = yf.Ticker(symbol)

    history = ticker.history(
        period=range,
        interval=interval
    )

    if history.empty:
        return {"error": "No data found"}

    latest = history.iloc[-1]
    price = float(latest["Close"])

    previous_history = ticker.history(
        period="5d",
        interval="1d"
    )

    if len(previous_history) >= 2:
        previous_close = float(previous_history["Close"].iloc[-2])
    else:
        previous_close = price

    change = price - previous_close
    change_percent = (change / previous_close) * 100

    return {
        "symbol": symbol,
        "currency": "USD",
        "price": price,
        "previousClose": previous_close,
        "change": change,
        "changePercent": change_percent,
        "volume": int(latest["Volume"]),
        "marketState": "REGULAR",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "history": [
            {
                "timestamp": timestamp.isoformat(),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]),
            }
            for timestamp, row in history.iterrows()
        ],
    }