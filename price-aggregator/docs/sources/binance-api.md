# Binance API Documentation

Official documentation: [https://binance-docs.github.io/apidocs/spot/en/](https://binance-docs.github.io/apidocs/spot/en/)

## 1. How to request a price for a pair (single endpoint)

To request the current price for a single trading pair, use the `GET /api/v3/ticker/price` endpoint.

**Parameters:**

- `symbol` (STRING, MANDATORY): Trading pair name, e.g., `BTCUSDT`.

**Request Example:**
`https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT`

## 2. Does the API support batch price requests

Yes, Binance REST API supports fetching prices for multiple symbols in a single request. This can be done by calling the `GET /api/v3/ticker/price` endpoint without specifying a `symbol`. This will return prices for all available pairs.

Alternatively, you can use the `GET /api/v3/ticker/24hr` endpoint for 24-hour statistics for all or specific pairs.

**Batch Request Example:**
`https://api.binance.com/api/v3/ticker/price`

## 3. Can you subscribe to pairs and receive events (streaming)

Yes, Binance provides a WebSocket API for subscribing to real-time market data. The WebSocket base endpoint is `wss://stream.binance.com:9443`.

You can subscribe to various data streams, including:

- **Individual Symbol Ticker Streams**: Receive tickers for a specific symbol.
  - **Stream Name**: `<symbol>@ticker`
  - **Example**: `wss://stream.binance.com:9443/ws/btcusdt@ticker`

- **All Market Tickers Stream**: Receive tickers for all symbols.
  - **Stream Name**: `!ticker@arr`

This allows receiving price updates and other events without the need to constantly poll the REST API.

## 4. Limitations and API Key Requirements

- **API Key**: For accessing public endpoints, such as getting prices (`/api/v3/ticker/price`), an API key is **not required**. An API key is needed for accessing private data (e.g., account information, orders) and for executing trading operations.

- **Rate Limits**:
  - The REST API has request weight limits per minute per IP address. Each endpoint has its own weight.
  - For example, the `/api/v3/ticker/price` endpoint has a weight of 2 for a single symbol and 40 for all symbols.
  - The total request weight limit is 6,000 per minute.
  - There's also an order limit: 50 orders per 10 seconds and 160,000 orders per 24 hours.
  - The WebSocket API has a limit of 5 connections per second.
