# Finnhub API Documentation

## 1. Does the API support batch price requests

No, Finnhub REST API does **not support** getting quotes for multiple symbols in a single request. Each call to the `/quote` endpoint is designed to get data for one symbol.

## 2. Can you subscribe to pairs and receive events

Yes, Finnhub provides a WebSocket API for subscribing to real-time market data. You can subscribe to:

- **Stocks**: Receive stock prices.
- **Forex**: Receive currency exchange rates.
- **Cryptocurrencies**: Receive cryptocurrency prices.

This allows receiving real-time updates without constant HTTP requests.

## 3. How to request price for a pair

To request the current quote (including price) for a single symbol, use the `GET /quote` endpoint.

**Parameters:**

- `symbol` (STRING, MANDATORY): Symbol to query (e.g., `AAPL` for stocks, `OANDA:EUR_USD` for Forex, `BINANCE:BTCUSDT` for cryptocurrencies).
- `token` (STRING, MANDATORY): Your API key.

**Request Example (for stocks):**
`https://finnhub.io/api/v1/quote?symbol=AAPL&token=YOUR_API_TOKEN`

The response will contain several fields, including:

- `c` - current price
- `h` - day high
- `l` - day low
- `o` - open price

## 4. Limitations and API Key Requirements

- **API Key**: Yes, Finnhub API **requires** an API key (token). A free key can be obtained after registration.

- **Rate Limits**:
  - **Free Plan**:
    - **60 API calls per minute**.
    - Access to real-time data for stocks, Forex, and cryptocurrencies.
  - **Paid Plans**: Offer higher limits, access to more historical data, institutional data, and other premium features.
