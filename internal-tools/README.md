# Chainlink Internal Tools

This directory contains internal tools for managing and validating Chainlink data feeds.

## Installation

```bash
cd internal-tools
npm install
```

## Available Tools

### 1. Generate Feed Mapping (`generate_feed_mapping.js`)

Extracts feed names from TOML template files and maps them to contract addresses from a source JSON file.

**Usage:**
```bash
node generate_feed_mapping.js <source_json_path> <templates_dir> <output_json_path> [exclude_single_source]
```

**Example:**
```bash
node generate_feed_mapping.js \
  ../scripts/bash/data/feed-cas.chainid-204.json \
  ../data-feed-generator/data-feeds-builder/templates \
  ../test_output_exclude.json
```

**Parameters:**
- `source_json_path`: Path to JSON file containing feed name to address mappings
- `templates_dir`: Path to directory containing TOML template files
- `output_json_path`: Path where output JSON will be written
- `exclude_single_source`: Optional. Set to "false" to include single-source feeds (default: true)

**Features:**
- Extracts `name` field from TOML files
- Counts data sources in `observationSource`
- Excludes single-source feeds by default
- Outputs detailed logging of processed feeds

---

### 2. Validate Feed Prices (`validate_feed_prices.js`)

Validates oracle node price data by comparing prices from Chainlink contracts against external data sources.

**Usage:**
```bash
node validate_feed_prices.js <feeds_json> <templates_dir> <rpc_url> [threshold_percent]
```

**Example:**
```bash
node validate_feed_prices.js \
  ../test_output_exclude.json \
  ../data-feed-generator/data-feeds-builder/templates \
  https://opbnb-mainnet-rpc.bnbchain.org \
  5.0
```

**Parameters:**
- `feeds_json`: Path to JSON file with feed names and contract addresses
- `templates_dir`: Path to directory with TOML templates
- `rpc_url`: Blockchain RPC endpoint URL
- `threshold_percent`: Optional. Acceptable deviation percentage (default: 5.0)

**Features:**
- Queries contract `latestAnswer()` and `decimals()` methods
- Fetches prices from external sources (CoinGecko, Coinbase, Binance, Kraken, CryptoCompare)
- Calculates percentage deviation
- Reports OK/NOT OK status based on threshold
- Provides summary statistics

---

### 3. Find Unhandled Feeds (`get-unhandled-feeds.js`)

Identifies feeds from a source JSON that don't have corresponding TOML template files.

**Usage:**
```bash
node get-unhandled-feeds.js <templates_dir> <feeds_json> <output_json>
```

**Example:**
```bash
node get-unhandled-feeds.js \
  ../data-feed-generator/data-feeds-builder/templates \
  ../scripts/bash/data/feed-cas.chainid-204.json \
  ../temp/unhandled-feeds/unhandled-feed-cas.json
```

**Parameters:**
- `templates_dir`: Path to directory containing TOML template files
- `feeds_json`: Path to JSON file with all feeds
- `output_json`: Path where output JSON with missing feeds will be written

**Features:**
- Converts feed names to expected template filenames
- Identifies feeds without templates
- Outputs count and details of missing templates

---

## NPM Scripts

For convenience, you can use the following npm scripts:

```bash
# Generate feed mapping
npm run generate-mapping -- <source_json> <templates_dir> <output_json>

# Validate feed prices
npm run validate-prices -- <feeds_json> <templates_dir> <rpc_url> [threshold]

# Find unhandled feeds
npm run find-unhandled -- <templates_dir> <feeds_json> <output_json>
```

## Dependencies

- **ethers**: ^5.7.2 - Ethereum library for blockchain interaction

## Directory Structure

```
internal-tools/
├── README.md                    # This file
├── package.json                 # Node.js package configuration
├── generate_feed_mapping.js     # Feed mapping generator
├── validate_feed_prices.js      # Price validation tool
├── get-unhandled-feeds.js       # Unhandled feeds finder
└── node_modules/                # Installed dependencies
```

## Notes

- All scripts include detailed error handling and logging
- Relative paths in examples assume you're running from `internal-tools/` directory
- For validate_feed_prices.js, ensure you have access to a working RPC endpoint
- External API calls have timeouts to prevent hanging

## Related Documentation

See also:
- `../VALIDATE_FEED_PRICES_README.md` - Detailed documentation for the price validation script
