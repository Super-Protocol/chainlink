# CryptoCompare API Documentation

Official documentation: [https://min-api.cryptocompare.com/documentation](https://min-api.cryptocompare.com/documentation)

## 1. How to request a price for a pair (single endpoint)

To request the price for a single trading pair, use the `GET /data/price` endpoint.

**Parameters:**

- `fsym` (STRING, MANDATORY): The symbol to get the price for (e.g., `BTC`).
- `tsyms` (STRING, MANDATORY): The currency to get the price in (e.g., `USD`).

**Request Example:**
`https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD`

## 2. Does the API support batch price requests

Yes, the CryptoCompare REST API allows requesting prices for multiple trading pairs in a single request using the `GET /data/pricemulti` endpoint.

**Parameters:**

- `fsyms` (STRING, MANDATORY): A comma-separated list of symbols (e.g., `BTC,ETH`).
- `tsyms` (STRING, MANDATORY): A comma-separated list of currencies to get prices in (e.g., `USD,EUR`).

**Request Example:**
`https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH&tsyms=USD,EUR`

## 3. Can you subscribe to pairs and receive events (streaming)

Yes, CryptoCompare provides a WebSocket (Streaming) API for subscribing to real-time data. The base WebSocket URL is `wss://streamer.cryptocompare.com/v2`.

You can subscribe to various data streams, including trades, tickers, and order book updates.

**Subscription Message Example:**

```json
{
  "action": "SubAdd",
  "subs": ["5~CCCAGG~BTC~USD"]
}
```

## 4. Limitations and API Key Requirements

- **API Key**: Yes, the CryptoCompare API **requires** an API key. It can be obtained for free after registration. The key must be included as an `authorization` header: `Authorization: Apikey {YOUR_API_KEY}`.

- **Rate Limits**:
  - **Free Plan**:
    - 100,000 requests per month.
    - 25 requests per second (burst).
    - Rate limits are based on a credit system detailed in the documentation.
  - **Paid Plans**: Offer higher request limits, access to more historical data, and additional features.
