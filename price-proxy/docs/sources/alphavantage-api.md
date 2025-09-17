# Alpha Vantage API Documentation

## 1. Does the API support batch price requests

No, Alpha Vantage API does **not support** batch requests in the traditional sense (getting multiple pairs in one call). Each API call is designed to get data for one specific pair (currency or stock).

## 2. Can you subscribe to pairs and receive events

No, Alpha Vantage is a REST API, and it does **not provide** WebSocket or any other mechanism for subscribing to real-time updates.

## 3. How to request price for a pair

To request the exchange rate between two currencies, use the `CURRENCY_EXCHANGE_RATE` function.

**Parameters:**

- `function` (STRING, MANDATORY): Must be `CURRENCY_EXCHANGE_RATE`.
- `from_currency` (STRING, MANDATORY): Source currency symbol (e.g., `USD`).
- `to_currency` (STRING, MANDATORY): Target currency symbol (e.g., `JPY`).
- `apikey` (STRING, MANDATORY): Your API key.

**Request Example:**
`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=JPY&apikey=YOUR_API_KEY`

The response will contain a "Realtime Currency Exchange Rate" object with the rate.

## 4. Limitations and API Key Requirements

- **API Key**: Yes, using Alpha Vantage API **requires** an API key. A free key can be obtained from their website.

- **Rate Limits**:
  - **Free Plan**:
    - **25 requests per day**.
  - **Paid Plans**: Offer significantly higher limits (from 150 requests per minute and up), as well as access to premium data.
