#!/usr/bin/env node
'use strict';

// Data Feeds Builder
// - Reads data-feeds.json
// - For each feed, checks data availability on providers via local Price Aggregator
// - Builds an array of objects: { name, decimals, smartDataFeed, deltaC, alphaPPB, dataSources }
// - Resumable: persists progress after each feed so you can stop and continue later

const fs = require('fs');
const path = require('path');
const http = require('http');

// Price Aggregator port now always passed via function arguments (no global mutable state)

// -------------------------------
// CLI options
// -------------------------------
function parseArgs(argv) {
  const args = {
    force: false,
    verbose: false,
    timeoutMs: 8000,
    out: path.resolve(__dirname, 'data-feeds-map.json'),
    state: path.resolve(__dirname, '.progress', 'data-feeds-progress.json'),
    progress: false,
    priceAggregatorPort: 3000,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--timeout' && argv[i + 1]) {
      args.timeoutMs = Number(argv[++i]);
    } else if (a === '--out' && argv[i + 1]) {
      args.out = path.resolve(argv[++i]);
    } else if (a === '--state' && argv[i + 1]) {
      args.state = path.resolve(argv[++i]);
    } else if (a === '--no-progress') {
      args.progress = false;
    } else if (a === '--progress') {
      args.progress = true;
    } else if (a === '--price-aggregator-port' && argv[i + 1]) {
      args.priceAggregatorPort = Number(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      printHelpAndExit();
    }
  }
  return args;
}

function printHelpAndExit() {
  const help = `Usage: node data-feeds-builder.js [options]

Options:
  --force                 Ignore previous progress and rebuild from scratch
  --verbose, -v           Verbose logging
  --timeout <ms>          HTTP timeout per request (default: 8000)
  --out <file>            Output JSON file (default: data-feed-generator/data-feeds-map.json)
  --state <file>          Progress state file (default: data-feed-generator/.progress/data-feeds-progress.json)
  --[no-]progress         Show a live progress line (default: off)
  --price-aggregator-port <port>  Port of running Price Aggregator service (default: 3000)
  --help, -h              Show this help
`;
  console.log(help);
  process.exit(0);
}

// -------------------------------
// Utilities
// -------------------------------
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return fallback;
  }
}

function writeJsonAtomicSync(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse price that may come as string or number; returns finite number or NaN
function parsePrice(value) {
  if (value == null) return NaN;
  if (typeof value === 'number') return isFinite(value) ? value : NaN;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return NaN;
    // Remove common thousand separators (comma) if any, but keep decimal point
    const normalized = trimmed.replace(/,/g, '');
    const num = Number(normalized);
    return isFinite(num) ? num : NaN;
  }
  return NaN;
}

// -------------------------------
// Progress helpers
// -------------------------------
function formatDuration(ms) {
  if (!isFinite(ms) || ms <= 0) return '00:00';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function makeProgressPrinter(enabled, total, startedAt) {
  if (!enabled) {
    return () => {};
  }
  return (processedCount, currentName) => {
    const pct = total > 0 ? Math.floor((processedCount * 100) / total) : 100;
    const elapsed = Date.now() - startedAt;
    const perItem = processedCount > 0 ? elapsed / processedCount : 0;
    const eta =
      perItem > 0
        ? Math.max(0, Math.round(perItem * (total - processedCount)))
        : 0;
    const line = `[${String(pct).padStart(
      3,
      ' '
    )}%] ${processedCount}/${total} ETA ${formatDuration(eta)} - ${
      currentName || ''
    }`;
    try {
      process.stdout.write('\r' + line);
    } catch (_e) {
      // Fallback if stdout isn't a TTY
      console.log(line);
    }
  };
}

function isPairName(name) {
  if (typeof name !== 'string') return false;
  // Must contain exactly one '/' with non-empty sides
  const match = name.match(/^\s*[^\/]+\s*\/\s*[^\/]+\s*$/);
  return Boolean(match);
}

// -------------------------------
// Price aggregator URL generator
// -------------------------------
function generatePriceAggregatorUrl(provider, base, quote, port) {
  const providerMap = {
    Binance: 'binance',
    CryptoCompare: 'cryptocompare',
    CoinGecko: 'coingecko',
    Coinbase: 'coinbase',
    Kraken: 'kraken',
    OKX: 'okx',
    Frankfurter: 'frankfurter',
    'exchangerate.host': 'exchangerate-host',
    AlphaVantage: 'alphavantage',
    Finnhub: 'finnhub',
  };

  const providerName = providerMap[provider];
  if (!providerName) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  let targetQuote = quote;
  if (quote === 'USD' && (provider === 'Binance' || provider === 'OKX')) {
    targetQuote = 'USDT';
  }

  const runtimeUrl = `http://127.0.0.1:${port}/quote/${providerName}/${base.toUpperCase()}/${targetQuote.toUpperCase()}`;
  const outputUrl = `http://127.0.0.1:$PRICE_AGGREGATOR_PORT/quote/${providerName}/${base.toUpperCase()}/${targetQuote.toUpperCase()}`;
  return { runtimeUrl, outputUrl };
}

// -------------------------------
// HTTP helper with timeout and simple retry
// -------------------------------
function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      url,
      {
        headers: {
          accept: 'application/json',
        },
      },
      (res) => {
        const { statusCode } = res;
        const contentType = res.headers['content-type'] || '';
        let error;
        if (statusCode < 200 || statusCode >= 300) {
          error = new Error(`Request Failed. Status Code: ${statusCode}`);
          error.statusCode = statusCode;
        } else if (!contentType.includes('application/json')) {
          // Some endpoints may return text/plain JSON; relax this
        }
        if (error) {
          res.resume();
          reject(error);
          return;
        }
        let rawData = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', (e) => reject(e));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

async function getJsonWithRetry(
  url,
  timeoutMs,
  attempts = 2,
  max429Retries = 10
) {
  let lastError;
  let retries429 = 0;
  for (let i = 0; ; i++) {
    try {
      return await httpGetJson(url, timeoutMs);
    } catch (e) {
      lastError = e;
      if (e && e.statusCode === 429 && retries429 < max429Retries) {
        retries429++;
        console.log(
          `429 Too Many Requests: retry ${retries429}/${max429Retries} in 10s -> ${url}`
        );
        await sleep(10_000);
        continue;
      }
      if (i < attempts - 1) {
        await sleep(250 + i * 500);
        continue;
      }
      break;
    }
  }
  throw lastError;
}

// -------------------------------
// Availability checkers
// -------------------------------
async function checkBinance(symbol, timeoutMs, verbose, port) {
  const { runtimeUrl, outputUrl } = generatePriceAggregatorUrl(
    'Binance',
    symbol,
    'USD',
    port
  );
  try {
    const data = await getJsonWithRetry(runtimeUrl, timeoutMs, 2);
    const num = data ? parsePrice(data.price) : NaN;
    const ok = isFinite(num);
    if (data && !ok)
      console.log(
        `Binance ${symbol}/USDT: value at path 'price' is not numeric -> ${
          data && data.price
        } (url: ${runtimeUrl})`
      );
    console.log(`Binance ${symbol}/USDT: ${ok ? 'OK' : 'N/A'}`);
    return ok
      ? { provider: 'Binance', url: outputUrl, path: 'price', value: num }
      : null;
  } catch (_e) {
    const e = _e || {};
    // Treat 429, 404 and 400 (e.g., Invalid symbol) as non-errors
    if (
      !(
        e &&
        (e.statusCode === 429 || e.statusCode === 404 || e.statusCode === 400)
      )
    ) {
      console.log(
        `Binance ${symbol}/USDT error: ${
          e && (e.stack || e.message) ? e.message || e.stack : String(e)
        } (runtime URL used)`
      );
    }
    console.log(`Binance ${symbol}/USDT: N/A`);
    return null;
  }
}

async function checkCryptoCompare(symbol, timeoutMs, verbose, port) {
  const { runtimeUrl, outputUrl } = generatePriceAggregatorUrl(
    'CryptoCompare',
    symbol,
    'USD',
    port
  );
  try {
    const data = await getJsonWithRetry(runtimeUrl, timeoutMs, 2);
    const num = data ? parsePrice(data.price) : NaN;
    const ok = isFinite(num);
    console.log(`CryptoCompare ${symbol}/USD: ${ok ? 'OK' : 'N/A'}`);
    return ok
      ? {
          provider: 'CryptoCompare',
          url: outputUrl,
          path: 'price',
          value: num,
        }
      : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(
        `CryptoCompare ${symbol}/USD error: ${
          e && (e.stack || e.message) ? e.message || e.stack : String(e)
        } (runtime URL used)`
      );
    }
    console.log(`CryptoCompare ${symbol}/USD: N/A`);
    return null;
  }
}

async function checkCoinGecko(symbol, timeoutMs, verbose, port) {
  const { runtimeUrl, outputUrl } = generatePriceAggregatorUrl(
    'CoinGecko',
    symbol,
    'USD',
    port
  );
  try {
    const data = await getJsonWithRetry(runtimeUrl, timeoutMs, 2);
    const num = data ? parsePrice(data.price) : NaN;
    const ok = isFinite(num);
    console.log(`CoinGecko ${symbol}/USD: ${ok ? 'OK' : 'N/A'}`);
    return ok
      ? {
          provider: 'CoinGecko',
          url: outputUrl,
          path: 'price',
          value: num,
        }
      : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(
        `CoinGecko ${symbol}/USD error: ${
          e && (e.stack || e.message) ? e.message || e.stack : String(e)
        } (runtime URL used)`
      );
    }
    console.log(`CoinGecko ${symbol}/USD: N/A`);
    return null;
  }
}

// -------------------------------
// Additional providers
// -------------------------------
async function checkCoinbase(base, quote, timeoutMs, port) {
  const { runtimeUrl, outputUrl } = generatePriceAggregatorUrl(
    'Coinbase',
    base,
    quote,
    port
  );
  try {
    const data = await getJsonWithRetry(runtimeUrl, timeoutMs, 2);
    const num = data ? parsePrice(data.price) : NaN;
    const ok = isFinite(num);
    if (data && !ok)
      console.log(
        `Coinbase ${base}-${quote}: value at path 'price' is not numeric -> ${
          data && data.price
        } (url: ${runtimeUrl})`
      );
    console.log(`Coinbase ${base}-${quote}: ${ok ? 'OK' : 'N/A'}`);
    return ok
      ? { provider: 'Coinbase', url: outputUrl, path: 'price', value: num }
      : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(
        `Coinbase ${base}-${quote} error: ${
          e && (e.stack || e.message) ? e.message || e.stack : String(e)
        } (runtime URL used)`
      );
    }
    console.log(`Coinbase ${base}-${quote}: N/A`);
    return null;
  }
}

async function checkKraken(base, quote, timeoutMs, port) {
  const { runtimeUrl, outputUrl } = generatePriceAggregatorUrl(
    'Kraken',
    base,
    quote,
    port
  );
  try {
    const data = await getJsonWithRetry(runtimeUrl, timeoutMs, 2);
    const num = data ? parsePrice(data.price) : NaN;
    const ok = isFinite(num);
    if (data && !ok)
      console.log(
        `Kraken ${base}${quote}: value at path 'price' is not numeric -> ${
          data && data.price
        } (url: ${runtimeUrl})`
      );
    console.log(`Kraken ${base}${quote}: ${ok ? 'OK' : 'N/A'}`);
    return ok
      ? { provider: 'Kraken', url: outputUrl, path: 'price', value: num }
      : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(
        `Kraken ${base}${quote} error: ${
          e && (e.stack || e.message) ? e.message || e.stack : String(e)
        } (runtime URL used)`
      );
    }
    console.log(`Kraken ${base}${quote}: N/A`);
    return null;
  }
}

async function checkOKX(base, quote, timeoutMs, port) {
  const { runtimeUrl, outputUrl } = generatePriceAggregatorUrl(
    'OKX',
    base,
    quote,
    port
  );
  try {
    const data = await getJsonWithRetry(runtimeUrl, timeoutMs, 2);
    const num = data ? parsePrice(data.price) : NaN;
    const ok = isFinite(num);
    if (data && !ok)
      console.log(
        `OKX ${base}-${quote}: value at path 'price' is not numeric -> ${
          data && data.price
        } (url: ${runtimeUrl})`
      );
    console.log(`OKX ${base}-${quote}: ${ok ? 'OK' : 'N/A'}`);
    return ok
      ? { provider: 'OKX', url: outputUrl, path: 'price', value: num }
      : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(
        `OKX ${base}-${quote} error: ${
          e && (e.stack || e.message) ? e.message || e.stack : String(e)
        } (runtime URL used)`
      );
    }
    console.log(`OKX ${base}-${quote}: N/A`);
    return null;
  }
}

async function checkFrankfurter(base, quote, timeoutMs, port) {
  const { runtimeUrl, outputUrl } = generatePriceAggregatorUrl(
    'Frankfurter',
    base,
    quote,
    port
  );
  try {
    const data = await getJsonWithRetry(runtimeUrl, timeoutMs, 2);
    const num = data ? parsePrice(data.price) : NaN;
    const ok = isFinite(num);
    console.log(
      `Frankfurter ${base.toUpperCase()}/${quote.toUpperCase()}: ${
        ok ? 'OK' : 'N/A'
      }`
    );
    return ok
      ? {
          provider: 'Frankfurter',
          url: outputUrl,
          path: 'price',
          value: num,
        }
      : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(
        `Frankfurter ${base.toUpperCase()}/${quote.toUpperCase()} error: ${
          e && (e.stack || e.message) ? e.message || e.stack : String(e)
        } (runtime URL used)`
      );
    }
    console.log(
      `Frankfurter ${base.toUpperCase()}/${quote.toUpperCase()}: N/A`
    );
    return null;
  }
}

async function checkExchangerateHost(base, quote, timeoutMs, port) {
  const { runtimeUrl, outputUrl } = generatePriceAggregatorUrl(
    'exchangerate.host',
    base,
    quote,
    port
  );
  try {
    const data = await getJsonWithRetry(runtimeUrl, timeoutMs, 2);
    const num = data ? parsePrice(data.price) : NaN;
    const ok = isFinite(num);
    console.log(
      `exchangerate.host ${base.toUpperCase()}/${quote.toUpperCase()}: ${
        ok ? 'OK' : 'N/A'
      }`
    );
    return ok
      ? {
          provider: 'exchangerate.host',
          url: outputUrl,
          path: 'price',
          value: num,
        }
      : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(
        `exchangerate.host ${base.toUpperCase()}/${quote.toUpperCase()} error: ${
          e && (e.stack || e.message) ? e.message || e.stack : String(e)
        } (runtime URL used)`
      );
    }
    console.log(
      `exchangerate.host ${base.toUpperCase()}/${quote.toUpperCase()}: N/A`
    );
    return null;
  }
}

async function checkAlphaVantage(base, quote, timeoutMs, port) {
  const { runtimeUrl, outputUrl } = generatePriceAggregatorUrl(
    'AlphaVantage',
    base,
    quote,
    port
  );
  try {
    const data = await getJsonWithRetry(runtimeUrl, timeoutMs, 2);
    const num = data ? parsePrice(data.price) : NaN;
    const ok = isFinite(num);
    console.log(
      `AlphaVantage ${base.toUpperCase()}/${quote.toUpperCase()}: ${
        ok ? 'OK' : 'N/A'
      }`
    );
    return ok
      ? {
          provider: 'AlphaVantage',
          url: outputUrl,
          path: 'price',
          value: num,
        }
      : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(
        `AlphaVantage ${base.toUpperCase()}/${quote.toUpperCase()} error: ${
          e && (e.stack || e.message) ? e.message || e.stack : String(e)
        } (runtime URL used)`
      );
    }
    console.log(
      `AlphaVantage ${base.toUpperCase()}/${quote.toUpperCase()}: N/A`
    );
    return null;
  }
}

async function checkFinnhub(base, timeoutMs, port) {
  const { runtimeUrl, outputUrl } = generatePriceAggregatorUrl(
    'Finnhub',
    base,
    'USD',
    port
  );
  try {
    const data = await getJsonWithRetry(runtimeUrl, timeoutMs, 2);
    const num = data ? parsePrice(data.price) : NaN;
    const ok = isFinite(num);
    console.log(`Finnhub ${base.toUpperCase()}: ${ok ? 'OK' : 'N/A'}`);
    return ok
      ? {
          provider: 'Finnhub',
          url: outputUrl,
          path: 'price',
          value: num,
        }
      : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(
        `Finnhub ${base.toUpperCase()} error: ${
          e && (e.stack || e.message) ? e.message || e.stack : String(e)
        }`
      );
    }
    console.log(`Finnhub ${base.toUpperCase()}: N/A`);
    return null;
  }
}

// -------------------------------
// Main
// -------------------------------
async function main() {
  const args = parseArgs(process.argv);
  const port = args.priceAggregatorPort;
  ensureDirSync(path.dirname(args.out));
  ensureDirSync(path.dirname(args.state));

  // Load input feeds
  const inputPath = path.resolve(__dirname, '../data-feeds.json');
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }
  /** @type {{ uniquePair: Record<string, {decimals?: string, smartDataFeed?: boolean, deltaC?: string, alphaPPB?: string}> }} */
  const input = readJsonSafe(inputPath, { uniquePair: {} });
  const entries = Object.entries(input.uniquePair || {});
  if (entries.length === 0) {
    console.error('No feeds found in data-feeds.json');
    writeJsonAtomicSync(args.out, []);
    process.exit(0);
  }

  // Load or reset progress
  let progress = {};
  if (!args.force) {
    progress = readJsonSafe(args.state, {});
  } else if (fs.existsSync(args.state)) {
    fs.unlinkSync(args.state);
  }

  const resultsArray = [];
  let processedCount = 0;
  const totalCount = entries.length;
  const startedAt = Date.now();
  const printProgress = makeProgressPrinter(
    args.progress,
    totalCount,
    startedAt
  );
  for (const [name, cfg] of entries) {
    if (!isPairName(name)) {
      console.log(`Skipping (not a pair): ${name}`);
      if (progress[name]) {
        delete progress[name];
        writeJsonAtomicSync(args.state, progress);
      }
      continue;
    }
    const cached = progress[name];
    if (cached) {
      const ds = Array.isArray(cached.dataSources) ? cached.dataSources : [];
      const hasFullUrls =
        ds.length === 0 ||
        ds.every((s) => typeof s === 'string' && s.startsWith('http'));
      if (hasFullUrls) {
        console.log(`Skipping (cached): ${name}`);
        resultsArray.push(cached);
        processedCount++;
        printProgress(processedCount, name);
        continue;
      } else {
        console.log(`Recomputing legacy dataSources for: ${name}`);
      }
    }

    console.log(`Processing: ${name}`);
    const { baseSymbol, isUsdQuote } = parseName(name);
    let dataSources = [];

    const shouldCheckApis =
      Boolean(baseSymbol) && isUsdQuote === true && cfg.smartDataFeed === false;
    if (shouldCheckApis) {
      const quote = 'USD';
      const checks = await Promise.all([
        checkBinance(baseSymbol, args.timeoutMs, args.verbose, port),
        checkCryptoCompare(baseSymbol, args.timeoutMs, args.verbose, port),
        checkCoinGecko(baseSymbol, args.timeoutMs, args.verbose, port),
        checkCoinbase(baseSymbol, quote, args.timeoutMs, port),
        checkKraken(baseSymbol, quote, args.timeoutMs, port),
        checkOKX(baseSymbol, quote, args.timeoutMs, port),
        checkFrankfurter(baseSymbol, quote, args.timeoutMs, port),
        checkExchangerateHost(baseSymbol, quote, args.timeoutMs, port),
        checkAlphaVantage(baseSymbol, quote, args.timeoutMs, port),
        checkFinnhub(baseSymbol, args.timeoutMs, port),
      ]);
      for (const res of checks) {
        if (!res) continue;
        if (typeof res === 'string') {
          dataSources.push({
            provider: 'unknown',
            url: res,
            path: null,
            value: null,
          });
        } else if (res && typeof res === 'object') {
          const provider =
            typeof res.provider === 'string' && res.provider
              ? res.provider
              : 'unknown';
          const url = typeof res.url === 'string' ? res.url : '';
          const path = typeof res.path === 'string' ? res.path : null;
          const value =
            typeof res.value === 'number' && isFinite(res.value)
              ? res.value
              : null;
          if (url) dataSources.push({ provider, url, path, value });
        }
      }

      // Print collected quotes for this pair
      if (dataSources.length > 0) {
        console.log(`Quotes for ${name}:`);
        for (const ds of dataSources) {
          const provider = ds.provider || 'unknown';
          const u = ds.url || '';
          const p = ds.path || '';
          const v = typeof ds.value === 'number' ? ds.value : 'N/A';
          console.log(`  - ${provider}: value=${v} path=${p} url=${u}`);
        }
      } else {
        console.log(`No quotes collected for ${name}`);
      }
    } else {
      if (args.verbose)
        console.log(
          `  Skipping API checks (name format or smartDataFeed): ${name}`
        );
    }

    const item = {
      name,
      decimals: cfg.decimals ?? null,
      smartDataFeed: Boolean(cfg.smartDataFeed),
      deltaC: cfg.deltaC ?? null,
      alphaPPB: cfg.alphaPPB ?? null,
      dataSources,
    };

    // Save to progress immediately for resumability
    progress[name] = item;
    writeJsonAtomicSync(args.state, progress);

    resultsArray.push(item);
    processedCount++;
    printProgress(processedCount, name);
  }

  // Sort results by name for stable output
  resultsArray.sort((a, b) => a.name.localeCompare(b.name));
  writeJsonAtomicSync(args.out, resultsArray);

  if (args.progress) process.stdout.write('\n');
  console.log(`Done. Processed ${processedCount} feeds.`);
  console.log(`Output: ${args.out}`);
  console.log(`State: ${args.state}`);
}

function parseName(name) {
  // Expect format: "SYMBOL / USD" (with spaces around slash)
  if (typeof name !== 'string') return { baseSymbol: null, isUsdQuote: false };
  const parts = name.split('/');
  if (parts.length !== 2) return { baseSymbol: null, isUsdQuote: false };
  const base = parts[0].trim();
  const quote = parts[1].trim();
  const isUsd = quote.toUpperCase() === 'USD';
  if (!base) return { baseSymbol: null, isUsdQuote: isUsd };
  // Some feeds may include spaces in base (e.g., "Bitcoin Cash"); map to symbol-like token
  // Here we assume the provided name already uses ticker symbols (e.g., BTC, 1INCH, AAPL)
  return { baseSymbol: base, isUsdQuote: isUsd };
}

// Execute if run directly
if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
