# CoinGecko API Documentation

## 1. Does the API support batch price requests

Yes, CoinGecko REST API allows getting prices for multiple cryptocurrencies (by their IDs) and multiple fiat currencies in a single request. This is done using the `GET /api/v3/simple/price` endpoint.

**Parameters:**

- `ids` (STRING, MANDATORY): List of cryptocurrency IDs, separated by commas (e.g., `bitcoin,ethereum`).
- `vs_currencies` (STRING, MANDATORY): List of fiat currencies to get prices in, separated by commas (e.g., `usd,eur`).

**Request Example:**
`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,eur`

## 2. Can you subscribe to pairs and receive events

No, currently CoinGecko does **not provide** a public WebSocket API for subscribing to real-time price updates. To get current data, you need to periodically poll their REST API.

## 3. How to request price for a pair

To request the price of a single cryptocurrency in one fiat currency, use the same `GET /api/v3/simple/price` endpoint.

**Parameters:**

- `ids` (STRING, MANDATORY): Cryptocurrency ID (e.g., `bitcoin`).
- `vs_currencies` (STRING, MANDATORY): Fiat currency (e.g., `usd`).

**Request Example:**
`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd`

## 4. Limitations and API Key Requirements

- **API Key**:
  - **Public API (free, no key)**: You can use the API without a key, but with lower limits.
  - **Demo API (free, with key)**: You can get a free API key on your profile page for higher and more stable limits.

- **Rate Limits**:
  - **Public API**: Limits vary but are typically around 10-30 requests per minute per IP address.
  - **Demo API**: With a free key, limits are higher, but exact numbers should be checked in the documentation.
  - **Paid Plans**: For commercial use and very high limits, CoinGecko offers paid API plans.
