# Coinbase API Documentation

## 1. Does the API support batch price requests

Yes, Coinbase REST API (v2) allows getting exchange rates for multiple currencies simultaneously. The `GET /v2/exchange-rates` endpoint will return rates for the specified base currency to all other supported currencies.

**Parameters:**

- `currency` (STRING): Base currency symbol (e.g., `BTC`).

**Request Example:**
`https://api.coinbase.com/v2/exchange-rates?currency=BTC`

This request will return BTC rates to all other currencies (USD, ETH, etc.).

## 2. Can you subscribe to pairs and receive events

Yes, Coinbase provides a WebSocket feed for subscribing to real-time market data. This is the preferred way to get current prices and events. You can subscribe to channels such as:

- `ticker`: Receive ticker updates.
- `level2`: Receive order book updates.
- `matches`: Receive information about completed trades.

## 3. How to request price for a pair

To request the current spot price for a single trading pair, use the `GET /v2/prices/{currency_pair}/spot` endpoint.

**Parameters:**

- `currency_pair` (STRING, MANDATORY): Trading pair separated by a hyphen (e.g., `BTC-USD`).

**Request Example:**
`https://api.coinbase.com/v2/prices/BTC-USD/spot`

## 4. Limitations and API Key Requirements

- **API Key**:
  - Public endpoints, such as getting prices, do **not require** an API key.
  - Authentication with an API key (`CB-ACCESS-KEY`) is required for accessing private data (accounts, orders) and trading operations.

- **Rate Limits**:
  - Public endpoints are limited to **10,000 requests per hour**.
  - Limits for private endpoints depend on the endpoint type and are specified in the documentation.
  - Coinbase recommends using WebSocket for real-time data to avoid exceeding REST API limits.
