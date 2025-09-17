# Frankfurter.app API Documentation

## 1. Does the API support batch price requests

Yes, Frankfurter API allows retrieving rates for multiple currencies in a single request. You can list multiple currency symbols in the `to` parameter of the `/latest` endpoint, separated by commas.

**Parameters:**

- `from` (STRING): Base currency (e.g., `USD`).
- `to` (STRING): List of target currencies, separated by commas (e.g., `EUR,JPY,GBP`).

**Request Example:**
`https://api.frankfurter.app/latest?from=USD&to=EUR,JPY,GBP`

## 2. Can you subscribe to pairs and receive events

No, Frankfurter is a simple REST API for getting currency exchange rates. It does **not provide** WebSocket or any other mechanism for subscribing to real-time updates.

## 3. How to request price for a pair

To request the rate for a single currency pair, use the `/latest` endpoint.

**Parameters:**

- `from` (STRING, MANDATORY): Base currency (e.g., `USD`).
- `to` (STRING, MANDATORY): Target currency (e.g., `EUR`).

**Request Example:**
`https://api.frankfurter.app/latest?from=USD&to=EUR`

## 4. Limitations and API Key Requirements

- **API Key**: API key is **not required**. The service is free and open-source.

- **Rate Limits**:
  - The official documentation does not specify strict request limits.
  - Developers are asked to use the API "sensibly".
  - As this is a free service, restrictions may apply under very high load. For commercial applications with high load, consider self-hosting the API.
