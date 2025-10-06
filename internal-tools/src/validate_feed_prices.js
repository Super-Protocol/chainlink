#!/usr/bin/env node
/**
 * Script to validate oracle node price data against external sources.
 *
 * This script:
 * 1. Reads feeds from test_output_exclude.json
 * 2. Gets latest price from contract via latestAnswer()
 * 3. Gets latest price from external sources (parsed from TOML templates)
 * 4. Calculates percentage deviation
 * 5. Reports OK/NOT OK based on acceptable threshold
 *
 * Usage:
 *     node validate_feed_prices.js <feeds_json> <templates_dir> <rpc_url> [threshold_percent]
 *
 * Arguments:
 *     feeds_json: Path to JSON file with feed names and contract addresses
 *     templates_dir: Path to directory with TOML template files
 *     rpc_url: Blockchain RPC endpoint URL
 *     threshold_percent: Optional. Acceptable deviation percentage (default: 5.0)
 *
 * Requirements:
 *     npm install ethers@5
 */

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Chainlink AggregatorV3Interface ABI (only the methods we need)
const AGGREGATOR_V3_ABI = [
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'latestAnswer',
    outputs: [{ internalType: 'int256', name: '', type: 'int256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

/**
 * Parse TOML file to extract data sources from observationSource field
 */
function extractDataSourcesFromToml(tomlPath) {
  try {
    const content = fs.readFileSync(tomlPath, 'utf-8');
    const match = content.match(/observationSource\s*=\s*"""([\s\S]*?)"""/);
    if (!match) return [];

    const observationSource = match[1];
    const sources = [];

    // Extract URLs like: http://127.0.0.1:$PRICE_AGGREGATOR_PORT/quote/binance/1INCH/USDT
    const urlRegex = /url="http:\/\/127\.0\.0\.1:\$PRICE_AGGREGATOR_PORT\/quote\/([^\/]+)\/([^\/]+)\/([^"]+)"/g;
    let urlMatch;

    while ((urlMatch = urlRegex.exec(observationSource)) !== null) {
      const [, provider, base, quote] = urlMatch;
      sources.push({ provider: provider.toLowerCase(), base, quote });
    }

    return sources;
  } catch (error) {
    console.error(`Error parsing TOML ${tomlPath}: ${error.message}`);
    return [];
  }
}

/**
 * Convert feed name to TOML filename
 */
function feedNameToTomlFile(feedName) {
  const parts = feedName.split('/').map(s => s.trim());
  if (parts.length !== 2) return null;

  const sanitize = (s) =>
    s.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');

  const left = sanitize(parts[0]);
  const right = sanitize(parts[1]);
  if (!left || !right) return null;

  return `${left}-${right}.toml`;
}

/**
 * Fetch JSON from URL with timeout
 */
function fetchJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const req = protocol.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';

      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Get price from CoinGecko
 */
async function getPriceFromCoinGecko(base, quote) {
  // Map common symbols to CoinGecko IDs
  const symbolToId = {
    '1inch': '1inch',
    'aave': 'aave',
    'ada': 'cardano',
    'algo': 'algorand',
    'ampl': 'ampleforth',
    'ape': 'apecoin',
    'arb': 'arbitrum',
    'atom': 'cosmos',
    'avax': 'avalanche-2',
    'axs': 'axie-infinity',
    'badger': 'badger-dao',
    'bal': 'balancer',
    'band': 'band-protocol',
    'bat': 'basic-attention-token',
    'bch': 'bitcoin-cash',
    'bnb': 'binancecoin',
    'btc': 'bitcoin',
    'comp': 'compound-governance-token',
    'crv': 'curve-dao-token',
    'dai': 'dai',
    'doge': 'dogecoin',
    'dot': 'polkadot',
    'eth': 'ethereum',
    'fil': 'filecoin',
    'frax': 'frax',
    'link': 'chainlink',
    'ltc': 'litecoin',
    'matic': 'matic-network',
    'pol': 'matic-network',
    'near': 'near',
    'shib': 'shiba-inu',
    'sol': 'solana',
    'sushi': 'sushi',
    'uni': 'uniswap',
    'usdc': 'usd-coin',
    'usdt': 'tether',
    'wbtc': 'wrapped-bitcoin',
    'xrp': 'ripple',
  };

  const id = symbolToId[base.toLowerCase()] || base.toLowerCase();
  const vsCurrency = quote.toLowerCase();

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${vsCurrency}`;

  try {
    const data = await fetchJson(url);
    if (data && data[id] && typeof data[id][vsCurrency] === 'number') {
      return data[id][vsCurrency];
    }
  } catch (e) {
    // Silently fail
  }

  return null;
}

/**
 * Get price from Coinbase
 */
async function getPriceFromCoinbase(base, quote) {
  const pair = `${base.toUpperCase()}-${quote.toUpperCase()}`;
  const url = `https://api.coinbase.com/v2/prices/${pair}/spot`;

  try {
    const data = await fetchJson(url);
    if (data && data.data && data.data.amount) {
      return parseFloat(data.data.amount);
    }
  } catch (e) {
    // Silently fail
  }

  return null;
}

/**
 * Get price from Binance
 */
async function getPriceFromBinance(base, quote) {
  const symbol = `${base.toUpperCase()}${quote.toUpperCase()}`;
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;

  try {
    const data = await fetchJson(url);
    if (data && data.price) {
      return parseFloat(data.price);
    }
  } catch (e) {
    // Silently fail
  }

  return null;
}

/**
 * Get price from Kraken
 */
async function getPriceFromKraken(base, quote) {
  const pair = `${base.toUpperCase()}${quote.toUpperCase()}`;
  const url = `https://api.kraken.com/0/public/Ticker?pair=${pair}`;

  try {
    const data = await fetchJson(url);
    if (data && data.result) {
      const pairKey = Object.keys(data.result)[0];
      if (pairKey && data.result[pairKey] && data.result[pairKey].c) {
        return parseFloat(data.result[pairKey].c[0]);
      }
    }
  } catch (e) {
    // Silently fail
  }

  return null;
}

/**
 * Get price from CryptoCompare
 */
async function getPriceFromCryptoCompare(base, quote) {
  const url = `https://min-api.cryptocompare.com/data/price?fsym=${base.toUpperCase()}&tsyms=${quote.toUpperCase()}`;

  try {
    const data = await fetchJson(url);
    if (data && typeof data[quote.toUpperCase()] === 'number') {
      return data[quote.toUpperCase()];
    }
  } catch (e) {
    // Silently fail
  }

  return null;
}

/**
 * Get price from external source
 */
async function getPriceFromSource(provider, base, quote) {
  switch (provider) {
    case 'coingecko':
      return await getPriceFromCoinGecko(base, quote);
    case 'coinbase':
      return await getPriceFromCoinbase(base, quote);
    case 'binance':
      return await getPriceFromBinance(base, quote);
    case 'kraken':
      return await getPriceFromKraken(base, quote);
    case 'cryptocompare':
      return await getPriceFromCryptoCompare(base, quote);
    default:
      return null;
  }
}

/**
 * Get price from any available external source
 */
async function getExternalPrice(sources) {
  for (const source of sources) {
    try {
      const price = await getPriceFromSource(source.provider, source.base, source.quote);
      if (price !== null && price > 0) {
        return { price, provider: source.provider };
      }
    } catch (e) {
      // Try next source
    }
  }
  return null;
}

/**
 * Main validation function
 */
async function validateFeeds(feedsJsonPath, templatesDir, rpcUrl, thresholdPercent = 5.0) {
  // Load ethers
  let ethers;
  try {
    ethers = require('ethers');
  } catch (e) {
    console.error('Error: ethers library not found. Please install it: npm install ethers@5');
    process.exit(1);
  }

  // Load feeds
  let feeds;
  try {
    feeds = JSON.parse(fs.readFileSync(feedsJsonPath, 'utf-8'));
  } catch (e) {
    console.error(`Error loading feeds from ${feedsJsonPath}: ${e.message}`);
    process.exit(1);
  }

  // Setup provider
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  console.log(`Validating ${Object.keys(feeds).length} feeds...`);
  console.log(`Threshold: ${thresholdPercent}%`);
  console.log(`RPC: ${rpcUrl}`);
  console.log('');

  const results = [];

  for (const [feedName, contractAddress] of Object.entries(feeds)) {
    const result = {
      feed: feedName,
      address: contractAddress,
      contractPrice: null,
      externalPrice: null,
      deviation: null,
      status: 'ERROR',
      error: null,
    };

    try {
      // Get TOML file
      const tomlFile = feedNameToTomlFile(feedName);
      if (!tomlFile) {
        result.error = 'Could not determine TOML filename';
        results.push(result);
        continue;
      }

      const tomlPath = path.join(templatesDir, tomlFile);
      if (!fs.existsSync(tomlPath)) {
        result.error = `TOML file not found: ${tomlFile}`;
        results.push(result);
        continue;
      }

      // Extract data sources
      const sources = extractDataSourcesFromToml(tomlPath);
      if (sources.length === 0) {
        result.error = 'No data sources found in TOML';
        results.push(result);
        continue;
      }

      // Get contract price
      const contract = new ethers.Contract(contractAddress, AGGREGATOR_V3_ABI, provider);

      const [latestAnswer, decimals] = await Promise.all([
        contract.latestAnswer(),
        contract.decimals(),
      ]);

      const contractPrice = parseFloat(ethers.utils.formatUnits(latestAnswer, decimals));
      result.contractPrice = contractPrice;

      // Get external price
      const externalResult = await getExternalPrice(sources);
      if (!externalResult) {
        result.error = 'Could not fetch external price from any source';
        results.push(result);
        continue;
      }

      const externalPrice = externalResult.price;
      result.externalPrice = externalPrice;
      result.externalProvider = externalResult.provider;

      // Calculate deviation
      const deviation = ((contractPrice - externalPrice) / externalPrice) * 100;
      result.deviation = deviation;

      // Check if within threshold
      if (Math.abs(deviation) <= thresholdPercent) {
        result.status = 'OK';
      } else {
        result.status = 'NOT OK';
      }

    } catch (e) {
      result.error = e.message;
    }

    results.push(result);

    // Print result
    const status = result.status === 'OK' ? '✓ OK' : result.status === 'NOT OK' ? '✗ NOT OK' : '⚠ ERROR';
    const devStr = result.deviation !== null ? `${result.deviation.toFixed(2)}%` : 'N/A';
    const contractStr = result.contractPrice !== null ? result.contractPrice.toFixed(8) : 'N/A';
    const externalStr = result.externalPrice !== null ? result.externalPrice.toFixed(8) : 'N/A';
    const providerStr = result.externalProvider ? `(${result.externalProvider})` : '';

    console.log(`[${status}] ${feedName}`);
    console.log(`  Contract: ${contractStr} | External: ${externalStr} ${providerStr} | Deviation: ${devStr}`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
    console.log('');
  }

  // Summary
  const ok = results.filter(r => r.status === 'OK').length;
  const notOk = results.filter(r => r.status === 'NOT OK').length;
  const errors = results.filter(r => r.status === 'ERROR').length;

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total feeds: ${results.length}`);
  console.log(`✓ OK: ${ok}`);
  console.log(`✗ NOT OK: ${notOk}`);
  console.log(`⚠ ERROR: ${errors}`);
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length < 3 || args.length > 4) {
    console.log('Usage: node validate_feed_prices.js <feeds_json> <templates_dir> <rpc_url> [threshold_percent]');
    console.log('');
    console.log('Arguments:');
    console.log('  feeds_json: Path to JSON file with feed names and contract addresses');
    console.log('  templates_dir: Path to directory with TOML template files');
    console.log('  rpc_url: Blockchain RPC endpoint URL');
    console.log('  threshold_percent: Optional. Acceptable deviation percentage (default: 5.0)');
    console.log('');
    console.log('Example:');
    console.log('  node validate_feed_prices.js test_output_exclude.json data-feed-generator/data-feeds-builder/templates https://rpc.example.com 5.0');
    process.exit(1);
  }

  const [feedsJsonPath, templatesDir, rpcUrl, thresholdArg] = args;
  const thresholdPercent = thresholdArg ? parseFloat(thresholdArg) : 5.0;

  if (isNaN(thresholdPercent) || thresholdPercent < 0) {
    console.error('Error: threshold_percent must be a positive number');
    process.exit(1);
  }

  validateFeeds(feedsJsonPath, templatesDir, rpcUrl, thresholdPercent)
    .then(() => {
      console.log('Validation complete.');
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

if (require.main === module) {
  main();
}

module.exports = { validateFeeds };
