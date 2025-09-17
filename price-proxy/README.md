# Price Proxy Service

A NestJS-based microservice for proxying and managing price data from Chainlink oracles.

## Installation

```bash
$ npm install
```

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## API Documentation

Once the application is running, you can access the Swagger documentation at:

- http://localhost:3000/api

## Test

```bash
# unit tests
$ npm test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Configuration

The application supports two configuration methods:

### 1. YAML Configuration (Recommended)

Copy `config.yaml.example` to `config.yaml` and modify as needed:

```bash
cp config.yaml.example config.yaml
```

The application will automatically detect and use the YAML configuration if `config.yaml` exists.

You can also specify a custom config file path using the `CONFIG_FILE` environment variable:

```bash
CONFIG_FILE=custom-config.yaml npm run start
```

### 2. Environment Variables (Legacy)

Copy `.env.example` to `.env` and configure the following variables:

- `PORT` - Port number for the application (default: 3000)
- `NODE_ENV` - Environment mode (development, production)
- `LOGGER_LEVEL` - Logging level (error, warn, info, debug, verbose)
- `LOGGER_PRETTY_ENABLED` - Enable pretty printing for logs (true/false)
- `PRICE_PROXY_*` - Price proxy configuration variables
- `ALPHAVANTAGE_API_KEY` - AlphaVantage API key
- `FINNHUB_API_KEY` - Finnhub API key
- `CRYPTOCOMPARE_API_KEY` - CryptoCompare API key

The application will fall back to environment variables if no YAML configuration is found.

## License

UNLICENSED
