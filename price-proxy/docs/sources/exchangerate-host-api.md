# exchangerate.host API Documentation

## 1. Does the API support batch price requests

Yes, exchangerate.host API allows retrieving rates for multiple currencies in a single request. You can pass a list of currency codes in the `symbols` parameter, separated by commas.

**Parameters:**

- `base` (STRING): Base currency (e.g., `USD`).
- `symbols` (STRING): List of target currencies, separated by commas (e.g., `EUR,JPY,GBP`).

**Request Example:**
`https://api.exchangerate.host/latest?base=USD&symbols=EUR,JPY,GBP`

## 2. Can you subscribe to pairs and receive events

No, exchangerate.host is a REST API, and it does **not provide** WebSocket or any other mechanism for subscribing to real-time rate updates.

## 3. How to request price for a pair

To request the rate for a single currency pair, use the `/latest` endpoint. You can also use the `/convert` endpoint.

**Endpoint `/latest`:**

**Parameters:**

- `base` (STRING, MANDATORY): Base currency (e.g., `USD`).
- `symbols` (STRING, MANDATORY): Target currency (e.g., `EUR`).

**Request Example:**
`https://api.exchangerate.host/latest?base=USD&symbols=EUR`

**Endpoint `/convert`:**

**Parameters:**

- `from` (STRING, MANDATORY): Source currency.
- `to` (STRING, MANDATORY): Target currency.

**Request Example:**
`https://api.exchangerate.host/convert?from=USD&to=EUR`

## 4. Limitations and API Key Requirements

- **API Key**:
  - **Free Plan**: API key is **not required**.
  - **Paid Plans**: For paid plans, an API key (`access_key`) is provided, which gives access to additional features and higher limits.

- **Rate Limits**:
  - **Free Plan**: **1,000 requests per day**.
  - **Paid Plans**: Offer significantly more requests per day/month, depending on the plan.
