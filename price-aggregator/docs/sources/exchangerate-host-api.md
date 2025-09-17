# exchangerate.host API Documentation

Official documentation: [https://exchangerate.host/](https://exchangerate.host/)

## 1. How to request a price for a pair (single endpoint)

To request the exchange rate for a single currency pair, you can use either the `/latest` or `/convert` endpoint.

**Endpoint `/latest`:**

**Parameters:**

- `base` (STRING, MANDATORY): The base currency (e.g., `USD`).
- `symbols` (STRING, MANDATORY): The target currency (e.g., `EUR`).

**Request Example:**
`https://api.exchangerate.host/latest?base=USD&symbols=EUR`

**Endpoint `/convert`:**

**Parameters:**

- `from` (STRING, MANDATORY): The source currency.
- `to` (STRING, MANDATORY): The target currency.

**Request Example:**
`https://api.exchangerate.host/convert?from=USD&to=EUR`

## 2. Does the API support batch price requests

Yes, the exchangerate.host API allows retrieving rates for multiple currencies in a single request. You can pass a comma-separated list of currency codes in the `symbols` parameter.

**Parameters:**

- `base` (STRING): The base currency (e.g., `USD`).
- `symbols` (STRING): A comma-separated list of target currencies (e.g., `EUR,JPY,GBP`).

**Request Example:**
`https://api.exchangerate.host/latest?base=USD&symbols=EUR,JPY,GBP`

## 3. Can you subscribe to pairs and receive events (streaming)

No, exchangerate.host is a REST-only API and does **not provide** a WebSocket or any other mechanism for subscribing to real-time rate updates.

## 4. Limitations and API Key Requirements

- **API Key**:
  - An API key is **not required** for the free plan.
  - Paid plans provide an API key (`access_key`) that gives access to additional features (like higher-frequency updates) and higher rate limits.

- **Rate Limits**:
  - **Free Plan**: Rate limits are not explicitly specified but are intended for light usage.
  - **Paid Plans**: Offer significantly more requests, depending on the plan.
