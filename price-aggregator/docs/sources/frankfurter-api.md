# Frankfurter.app API Documentation

Official documentation: [https://www.frankfurter.app/docs/](https://www.frankfurter.app/docs/)

## 1. How to request a price for a pair (single endpoint)

To request the exchange rate for a single currency pair, use the `/latest` endpoint.

**Parameters:**

- `from` (STRING, MANDATORY): The base currency (e.g., `USD`).
- `to` (STRING, MANDATORY): The target currency (e.g., `EUR`).

**Request Example:**
`https://api.frankfurter.app/latest?from=USD&to=EUR`

## 2. Does the API support batch price requests

Yes, the Frankfurter API allows retrieving rates for multiple currencies in a single request. You can list multiple currency symbols in the `to` parameter, separated by commas.

**Parameters:**

- `from` (STRING): The base currency (e.g., `USD`).
- `to` (STRING): A comma-separated list of target currencies (e.g., `EUR,JPY,GBP`).

**Request Example:**
`https://api.frankfurter.app/latest?from=USD&to=EUR,JPY,GBP`

## 3. Can you subscribe to pairs and receive events (streaming)

No, Frankfurter is a REST-only API and does **not provide** a WebSocket or any other mechanism for subscribing to real-time updates.

## 4. Limitations and API Key Requirements

- **API Key**: An API key is **not required**. The service is free and open-source.

- **Rate Limits**:
  - The official documentation does not specify strict rate limits but asks users to use the API "sensibly".
  - For high-volume or commercial use, self-hosting the open-source application is recommended.
