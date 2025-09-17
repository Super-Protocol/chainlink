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

## Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

- `PORT` - Port number for the application (default: 3000)
- `NODE_ENV` - Environment mode (development, production)

## License

UNLICENSED
