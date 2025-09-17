# Binance API Documentation

## 1. Does the API support batch price requests

Yes, Binance REST API supports getting prices for multiple symbols (trading pairs) in a single request. This can be done by calling the `/api/v3/ticker/price` endpoint without specifying a symbol, which will return prices for all available pairs. You can also use the `/api/v3/ticker/24hr` endpoint to get 24-hour statistics for all or specific pairs.

## 2. Can you subscribe to pairs and receive events

Yes, Binance provides a WebSocket API for subscribing to real-time market data. You can subscribe to various data streams, including:

- **Trade Streams**: Receive information about each new trade.
- **Kline/Candlestick Streams**: Receive candlestick data (intervals).
- **Individual Symbol Ticker Streams**: Receive tickers for a specific symbol.
- **All Market Tickers Stream**: Receive tickers for all symbols.

This allows receiving price updates and other events without the need to constantly poll the REST API.

## 3. How to request price for a pair

To request the current price for a single trading pair via REST API, use the `GET /api/v3/ticker/price` endpoint.

**Parameters:**

- `symbol` (STRING, MANDATORY): Trading pair name, e.g., `BTCUSDT`.

**Request Example:**
`https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT`

## 4. Limitations and API Key Requirements

- **API Key**: For accessing public endpoints, such as getting prices (`/api/v3/ticker/price`), an API key is **not required**. A key is needed for accessing private data (e.g., account information, orders) and for executing trading operations.

- **Rate Limits**:
  - REST API has request weight limits per minute per IP address. Each endpoint has its own weight.
  - For example, the `/api/v3/ticker/price` endpoint has a weight of 2 for a single symbol and 40 for all symbols.
  - The total request weight limit is 6,000 per minute.
  - There's also an order limit: 50 orders per 10 seconds and 160,000 orders per 24 hours.
  - WebSocket API has a limit of 5 connections per second.
