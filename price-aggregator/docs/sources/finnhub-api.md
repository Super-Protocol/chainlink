# Finnhub API Documentation

Official documentation: [https://finnhub.io/docs/api](https://finnhub.io/docs/api)

## 1. How to request a price for a pair (single endpoint)

To request the current quote for a single symbol, use the `GET /quote` endpoint.

**Parameters:**

- `symbol` (STRING, MANDATORY): The symbol to query (e.g., `AAPL` for stocks, `OANDA:EUR_USD` for Forex, `BINANCE:BTCUSDT` for cryptocurrencies).
- `token` (STRING, MANDATORY): Your API key.

**Request Example (for stocks):**
`https://finnhub.io/api/v1/quote?symbol=AAPL&token=YOUR_API_TOKEN`

The response will contain several fields, including:

- `c` - current price
- `h` - day high
- `l` - day low
- `o` - open price

## 2. Does the API support batch price requests

No, the Finnhub REST API does **not support** getting quotes for multiple symbols in a single request. Each call to the `/quote` endpoint is designed to retrieve data for one symbol at a time.

## 3. Can you subscribe to pairs and receive events (streaming)

Yes, Finnhub provides a WebSocket API for subscribing to real-time market data. The WebSocket endpoint is `wss://ws.finnhub.io`.

You can subscribe to trades for stocks, Forex, and cryptocurrencies.

**Subscription Message Example:**

```json
{ "type": "subscribe", "symbol": "AAPL" }
```

_This subscribes to trades for Apple Inc. (AAPL)._

## 4. Limitations and API Key Requirements

- **API Key**: Yes, the Finnhub API **requires** an API key (token). A free key can be obtained after registration.

- **Rate Limits**:
  - **Free Plan**:
    - **60 API calls per minute**.
    - **1 concurrent WebSocket connection**.
    - Access to real-time data for stocks, Forex, and cryptocurrencies.
  - **Paid Plans**: Offer higher limits, access to more historical data, institutional data, and other premium features.
