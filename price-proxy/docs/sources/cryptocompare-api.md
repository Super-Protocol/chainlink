# CryptoCompare API Documentation

## 1. Does the API support batch price requests

Yes, CryptoCompare REST API allows requesting prices for multiple trading pairs in a single request. This is done using the `GET /data/pricemulti` endpoint.

**Parameters:**

- `fsyms` (STRING, MANDATORY): List of symbols to get prices for, separated by commas (e.g., `BTC,ETH`).
- `tsyms` (STRING, MANDATORY): List of currencies to get prices in, separated by commas (e.g., `USD,EUR`).

**Request Example:**
`https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH&tsyms=USD,EUR`

## 2. Can you subscribe to pairs and receive events

Yes, CryptoCompare provides a WebSocket (Streaming) API for subscribing to real-time data. You can subscribe to:

- Trades
- Quotes
- Aggregated Data

This allows receiving price updates without constant HTTP requests.

## 3. How to request price for a pair

To request the price for a single trading pair, use the `GET /data/price` endpoint.

**Parameters:**

- `fsym` (STRING, MANDATORY): Symbol to get the price for (e.g., `BTC`).
- `tsyms` (STRING, MANDATORY): Currency to get the price in (e.g., `USD`).

**Request Example:**
`https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD`

## 4. Limitations and API Key Requirements

- **API Key**: Yes, CryptoCompare API **requires** an API key. It can be obtained for free after registration.

- **Rate Limits**:
  - **Free Plan**:
    - 100,000 requests per month.
    - 25 requests per second (burst).
    - Limitations on historical data.
  - **Paid Plans**: Offer higher request limits, access to more historical data, and additional features.
