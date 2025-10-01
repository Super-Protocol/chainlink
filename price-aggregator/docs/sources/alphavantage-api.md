# Alpha Vantage API Documentation

Official documentation: [https://www.alphavantage.co/documentation/](https://www.alphavantage.co/documentation/)

## 1. How to request a price for a pair (single endpoint)

To request the exchange rate between two currencies, use the `CURRENCY_EXCHANGE_RATE` function.

**Parameters:**

- `function` (STRING, MANDATORY): Must be `CURRENCY_EXCHANGE_RATE`.
- `from_currency` (STRING, MANDATORY): Source currency symbol (e.g., `USD`).
- `to_currency` (STRING, MANDATORY): Target currency symbol (e.g., `JPY`).
- `apikey` (STRING, MANDATORY): Your API key.

**Request Example:**
`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=JPY&apikey=YOUR_API_KEY`

The response will contain a "Realtime Currency Exchange Rate" object with the rate.

## 2. Does the API support batch price requests

No, the Alpha Vantage API does **not support** batch requests for currency exchange rates. Each API call is designed to retrieve data for a single specific pair.

## 3. Can you subscribe to pairs and receive events (streaming)

No, Alpha Vantage is a REST-only API and does **not provide** WebSocket or any other mechanism for subscribing to real-time updates.

## 4. Limitations and API Key Requirements

- **API Key**: Yes, using the Alpha Vantage API **requires** an API key. A free key can be obtained from their website.

- **Rate Limits**:
  - **Free Plan**:
    - **Up to 25 requests per day**.
  - **Paid Plans**: Offer significantly higher limits (from 150 requests per minute and up), as well as access to premium data.
