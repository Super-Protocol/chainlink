# CoinGecko API Documentation

Official documentation: [https://www.coingecko.com/en/api/documentation](https://www.coingecko.com/en/api/documentation)

## 1. How to request a price for a pair (single endpoint)

To request the price of a single cryptocurrency in one fiat currency, use the `GET /api/v3/simple/price` endpoint.

**Parameters:**

- `ids` (STRING, MANDATORY): Cryptocurrency ID (e.g., `bitcoin`).
- `vs_currencies` (STRING, MANDATORY): Fiat currency (e.g., `usd`).

**Request Example:**
`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd`

## 2. Does the API support batch price requests

Yes, the CoinGecko REST API allows getting prices for multiple cryptocurrencies and multiple fiat currencies in a single request, using the same `GET /api/v3/simple/price` endpoint.

**Parameters:**

- `ids` (STRING, MANDATORY): A comma-separated list of cryptocurrency IDs (e.g., `bitcoin,ethereum`).
- `vs_currencies` (STRING, MANDATORY): A comma-separated list of fiat currencies (e.g., `usd,eur`).

**Request Example:**
`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,eur`

## 3. Can you subscribe to pairs and receive events (streaming)

No, CoinGecko does **not** currently provide a public WebSocket API for subscribing to real-time price updates. To get the latest data, you need to periodically poll their REST API.

## 4. Limitations and API Key Requirements

- **API Key**:
  - **Public API (free, no key)**: You can use the API without a key but with lower rate limits.
  - **Demo API (free, with key)**: You can get a free API key from your developer dashboard for higher and more stable limits. This is recommended for any application.

- **Rate Limits**:
  - **Public API**: Limits vary but are typically around 10-30 requests per minute per IP address.
  - **Demo API**: With a free key, the rate limit is **100 requests per minute**.
  - **Paid Plans**: For commercial use and very high limits, CoinGecko offers paid API plans.
