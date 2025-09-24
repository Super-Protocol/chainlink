# Price Aggregator Service

A NestJS-based microservice for aggregating and managing price data from Chainlink oracles.

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

The application is configured using a YAML file.

Copy `config.example.yaml` to `config.yaml` and modify as needed:

```bash
cp config.example.yaml config.yaml
```

The application will automatically detect and use the YAML configuration if `config.yaml` exists.

You can also specify a custom config file path using the `CONFIG_FILE` environment variable:

```bash
CONFIG_FILE=custom-config.yaml npm run start
```

## License

UNLICENSED
