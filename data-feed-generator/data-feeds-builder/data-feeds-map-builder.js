#!/usr/bin/env node
"use strict";

// Data Feeds Builder
// - Reads data-feeds.json
// - For each feed, checks data availability on CoinGecko, CryptoCompare, Binance
// - Builds an array of objects: { name, decimals, smartDataFeed, deltaC, alphaPPB, dataSources }
// - Resumable: persists progress after each feed so you can stop and continue later

const fs = require("fs");
const path = require("path");
const https = require("https");
let globalHttpAgent = undefined;
(function setupProxyAgent() {
  const log = (...args) => {
    try { console.warn('[proxy]', ...args); } catch (_) {}
  };
  try {
    const env = process.env || {};
    let proxyUrlStr = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.SOCKS_PROXY || env.socks_proxy;
    if (!proxyUrlStr || !String(proxyUrlStr).trim()) return;
    proxyUrlStr = String(proxyUrlStr).trim();

    // Detect protocol
    const lower = proxyUrlStr.toLowerCase();
    const isSocks = lower.startsWith('socks://') || lower.startsWith('socks5://') || lower.startsWith('socks4://');
    const isHttpish = lower.startsWith('http://') || lower.startsWith('https://');

    if (!isSocks && !isHttpish) {
      log(`Unsupported proxy protocol in ${proxyUrlStr}. Supported: http, https, socks, socks5, socks4. Skipping proxy.`);
      return;
    }

    if (isSocks) {
      // Try to use socks-proxy-agent if available
      try {
        const SocksProxyAgent = require('socks-proxy-agent');
        globalHttpAgent = SocksProxyAgent.SocksProxyAgent ? new SocksProxyAgent.SocksProxyAgent(proxyUrlStr) : new SocksProxyAgent(proxyUrlStr);
        log(`Using socks-proxy-agent for ${proxyUrlStr}`);
        return;
      } catch (e) {
        if (lower.startsWith('socks4://')) {
          log(`socks-proxy-agent not available (err: ${e && e.message ? e.message : String(e)}). Built-in fallback does not support SOCKS4. Skipping proxy.`);
          return;
        }
        log(`socks-proxy-agent not available (err: ${e && e.message ? e.message : String(e)}). Falling back to built-in SOCKS5 tunneler for ${proxyUrlStr}`);
      }

      // Minimal SOCKS5 tunneling agent (supports no-auth and username/password)
      const net = require('net');
      const tls = require('tls');
      const { URL } = require('url');

      let purl;
      try {
        purl = new URL(proxyUrlStr.replace(/^socks:\/\//i, 'socks5://'));
      } catch (e) {
        log(`Invalid SOCKS proxy URL: ${proxyUrlStr} (${e && e.message ? e.message : String(e)}) — skipping proxy.`);
        return;
      }
      const proxyHost = purl.hostname;
      const proxyPort = Number(purl.port) || 1080;
      const username = purl.username ? decodeURIComponent(purl.username) : null;
      const password = purl.password ? decodeURIComponent(purl.password) : null;
      if (!proxyHost) {
        log(`Missing host in SOCKS proxy URL: ${proxyUrlStr} — skipping proxy.`);
        return;
      }

      class Socks5HttpsAgent extends https.Agent {
        createConnection(options, callback) {
          const targetHost = options.host || options.hostname;
          const targetPort = options.port || 443;

          const socket = net.connect({ host: proxyHost, port: proxyPort });

          const onError = (err) => {
            try { log(`SOCKS5 tunnel error: ${err && err.message ? err.message : String(err)}`); } catch (_) {}
            socket.destroy();
            callback(err);
          };
          socket.once('error', onError);

          socket.once('connect', () => {
            const methods = username ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
            socket.write(methods);

            const readAuthMethod = () => {
              socket.once('data', (buf) => {
                if (buf.length < 2 || buf[0] !== 0x05) return onError(new Error('Invalid SOCKS5 method response'));
                const method = buf[1];
                if (method === 0x00) {
                  sendConnect();
                } else if (method === 0x02 && username) {
                  const u = Buffer.from(username, 'utf8');
                  const p = Buffer.from(password || '', 'utf8');
                  const authReq = Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]);
                  socket.write(authReq);
                  socket.once('data', (abuf) => {
                    if (abuf.length < 2 || abuf[1] !== 0x00) return onError(new Error('SOCKS5 auth failed'));
                    sendConnect();
                  });
                } else {
                  return onError(new Error('SOCKS5: no acceptable auth method'));
                }
              });
            };

            const sendConnect = () => {
              const hostBuf = Buffer.from(targetHost, 'utf8');
              const req = Buffer.concat([
                Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                hostBuf,
                Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])
              ]);
              socket.write(req);
              socket.once('data', (rbuf) => {
                if (rbuf.length < 2 || rbuf[1] !== 0x00) return onError(new Error('SOCKS5 connect failed'));
                const tlsSocket = tls.connect({ socket, servername: targetHost, host: targetHost, port: targetPort });
                tlsSocket.once('error', onError);
                tlsSocket.once('secureConnect', () => {
                  socket.removeListener('error', onError);
                  callback(null, tlsSocket);
                });
              });
            };

            readAuthMethod();
          });
        }
      }

      globalHttpAgent = new Socks5HttpsAgent();
      log(`Using built-in SOCKS5 tunneler for ${proxyUrlStr} (${proxyHost}:${proxyPort})`);
      return;
    }

    // HTTP(S) proxy branch
    // Try to use https-proxy-agent if available
    try {
      const HttpsProxyAgent = require('https-proxy-agent');
      globalHttpAgent = HttpsProxyAgent.HttpsProxyAgent ? new HttpsProxyAgent.HttpsProxyAgent(proxyUrlStr) : new HttpsProxyAgent(proxyUrlStr);
      log(`Using https-proxy-agent for ${proxyUrlStr}`);
      return;
    } catch (e) {
      log(`https-proxy-agent not available (err: ${e && e.message ? e.message : String(e)}). Falling back to built-in CONNECT tunneler for ${proxyUrlStr}`);
    }

    // Lightweight built-in HTTPS CONNECT tunneling agent (no external deps)
    const net = require('net');
    const tls = require('tls');
    const { URL } = require('url');

    let purl;
    try {
      purl = new URL(proxyUrlStr);
    } catch (e) {
      log(`Invalid HTTP(S) proxy URL: ${proxyUrlStr} (${e && e.message ? e.message : String(e)}) — skipping proxy.`);
      return;
    }
    const proxyHost = purl.hostname;
    const proxyPort = Number(purl.port) || (purl.protocol === 'https:' ? 443 : 80);
    const proxyIsHttps = purl.protocol === 'https:';
    const proxyAuth = purl.username ? `${decodeURIComponent(purl.username)}:${decodeURIComponent(purl.password || '')}` : null;
    if (!proxyHost) {
      log(`Missing host in HTTP(S) proxy URL: ${proxyUrlStr} — skipping proxy.`);
      return;
    }

    class HttpsTunnelAgent extends https.Agent {
      createConnection(options, callback) {
        const targetHost = options.host || options.hostname;
        const targetPort = options.port || 443;
        const connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
          `Host: ${targetHost}:${targetPort}\r\n` +
          (proxyAuth ? `Proxy-Authorization: Basic ${Buffer.from(proxyAuth).toString('base64')}\r\n` : '') +
          `Connection: keep-alive\r\n` +
          `\r\n`;

        const onConnected = (proxySocket) => {
          let buffered = '';
          const onData = (chunk) => {
            buffered += chunk.toString('utf8');
            if (buffered.includes('\r\n\r\n')) {
              proxySocket.removeListener('data', onData);
              const statusLine = buffered.split('\r\n')[0];
              const match = statusLine.match(/^HTTP\/\d+\.\d+\s+(\d+)/);
              const statusCode = match ? Number(match[1]) : 0;
              if (statusCode !== 200) {
                proxySocket.destroy();
                return callback(new Error(`Proxy CONNECT failed with status ${statusCode}`));
              }
              const tlsSocket = tls.connect({
                socket: proxySocket,
                servername: targetHost,
                host: targetHost,
                port: targetPort,
              });
              tlsSocket.once('error', (err) => {
                try { log(`TLS over proxy error: ${err && err.message ? err.message : String(err)}`); } catch (_) {}
                callback(err);
              });
              tlsSocket.once('secureConnect', () => callback(null, tlsSocket));
            }
          };
          proxySocket.on('data', onData);
          proxySocket.write(connectReq);
        };

        const onConnError = (err) => {
          try { log(`Proxy socket error: ${err && err.message ? err.message : String(err)}`); } catch (_) {}
          callback(err);
        };

        if (proxyIsHttps) {
          const socket = tls.connect({ host: proxyHost, port: proxyPort, servername: proxyHost });
          socket.once('secureConnect', () => onConnected(socket));
          socket.once('error', onConnError);
          return;
        } else {
          const socket = net.connect({ host: proxyHost, port: proxyPort }, () => onConnected(socket));
          socket.once('error', onConnError);
          return;
        }
      }
    }

    globalHttpAgent = new HttpsTunnelAgent();
    log(`Using built-in HTTP CONNECT tunneler for ${proxyUrlStr} (${proxyIsHttps ? 'HTTPS' : 'HTTP'} proxy ${proxyHost}:${proxyPort})`);
  } catch (e) {
    // Proceed without proxy but inform the user once
    try { console.warn('[proxy] Proxy setup failed:', e && e.message ? e.message : String(e)); } catch (_) {}
  }
})();

// -------------------------------
// CLI options
// -------------------------------
function parseArgs(argv) {
  const args = {
    force: false,
    verbose: false,
    timeoutMs: 8000,
    out: path.resolve(__dirname, "data-feeds-map.json"),
    state: path.resolve(__dirname, ".progress", "data-feeds-progress.json"),
    cacheDir: path.resolve(__dirname, ".cache"),
    progress: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--timeout" && argv[i + 1]) {
      args.timeoutMs = Number(argv[++i]);
    } else if (a === "--out" && argv[i + 1]) {
      args.out = path.resolve(argv[++i]);
    } else if (a === "--state" && argv[i + 1]) {
      args.state = path.resolve(argv[++i]);
    } else if (a === "--cache-dir" && argv[i + 1]) {
      args.cacheDir = path.resolve(argv[++i]);
    } else if (a === "--no-progress") {
      args.progress = false;
    } else if (a === "--progress") {
      args.progress = true;
    } else if (a === "--help" || a === "-h") {
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
  --cache-dir <dir>       Cache directory (default: data-feed-generator/.cache)
  --[no-]progress         Show a live progress line (default: off)
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
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_e) {
    return fallback;
  }
}

function writeJsonAtomicSync(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------------------
// Progress helpers
// -------------------------------
function formatDuration(ms) {
  if (!isFinite(ms) || ms <= 0) return "00:00";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
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
    const eta = perItem > 0 ? Math.max(0, Math.round(perItem * (total - processedCount))) : 0;
    const line = `[${String(pct).padStart(3, " ")}%] ${processedCount}/${total} ETA ${formatDuration(eta)} - ${currentName || ""}`;
    try {
      process.stdout.write("\r" + line);
    } catch (_e) {
      // Fallback if stdout isn't a TTY
      console.log(line);
    }
  };
}

function isPairName(name) {
  if (typeof name !== "string") return false;
  // Must contain exactly one '/' with non-empty sides
  const match = name.match(/^\s*[^\/]+\s*\/\s*[^\/]+\s*$/);
  return Boolean(match);
}

// -------------------------------
// HTTP helper with timeout and simple retry
// -------------------------------
function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent: globalHttpAgent,
        headers: {
          "user-agent": "data-feeds-builder/1.0 (+https://superprotocol.io)",
          accept: "application/json",
        },
      },
      (res) => {
        const { statusCode } = res;
        const contentType = res.headers["content-type"] || "";
        let error;
        if (statusCode < 200 || statusCode >= 300) {
          error = new Error(`Request Failed. Status Code: ${statusCode}`);
          error.statusCode = statusCode;
        } else if (!contentType.includes("application/json")) {
          // Some endpoints may return text/plain JSON; relax this
        }
        if (error) {
          res.resume();
          reject(error);
          return;
        }
        let rawData = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          rawData += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(rawData);
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", (e) => reject(e));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Request timeout"));
    });
  });
}

async function getJsonWithRetry(url, timeoutMs, attempts = 2, max429Retries = 10) {
  let lastError;
  let retries429 = 0;
  for (let i = 0; ; i++) {
    try {
      return await httpGetJson(url, timeoutMs);
    } catch (e) {
      lastError = e;
      if (e && e.statusCode === 429 && retries429 < max429Retries) {
        retries429++;
        console.log(`429 Too Many Requests: retry ${retries429}/${max429Retries} in 10s -> ${url}`);
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
// CoinGecko coins list cache
// -------------------------------
async function loadCoinGeckoCoins(cacheDir, timeoutMs, force) {
  ensureDirSync(cacheDir);
  const cachePath = path.join(cacheDir, "coingecko_coins.json");
  if (!force && fs.existsSync(cachePath)) {
    return readJsonSafe(cachePath, []);
  }
  const url = "https://api.coingecko.com/api/v3/coins/list?include_platform=false";
  const data = await getJsonWithRetry(url, timeoutMs, 3);
  if (!Array.isArray(data)) return [];
  writeJsonAtomicSync(cachePath, data);
  return data;
}

function mapSymbolToCoinGeckoId(symbol, coinsList) {
  if (!symbol) return null;
  const sym = String(symbol).toLowerCase();
  // Prefer exact symbol matches
  const exact = coinsList.find((c) => c && c.symbol === sym);
  if (exact) return exact.id;
  // Fallback: startsWith or includes in name
  const starts = coinsList.find((c) => c && typeof c.symbol === "string" && c.symbol.startsWith(sym));
  if (starts) return starts.id;
  const nameMatch = coinsList.find((c) => c && typeof c.name === "string" && c.name.toLowerCase() === sym);
  if (nameMatch) return nameMatch.id;
  return null;
}

// -------------------------------
// Availability checkers
// -------------------------------
async function checkBinance(symbol, timeoutMs, verbose) {
  // Check SYMBOLUSDT spot pair
  const testSymbol = `${symbol.toUpperCase()}USDT`;
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(testSymbol)}`;
  try {
    const data = await getJsonWithRetry(url, timeoutMs, 2);
    const has = data && typeof data.price === "string" && data.price.length > 0;
    const num = has ? Number(data.price) : NaN;
    const ok = has && isFinite(num);
    if (has && !ok) console.log(`Binance ${testSymbol}: value at path 'price' is not numeric -> ${data.price} (url: ${url})`);
    console.log(`Binance ${testSymbol}: ${ok ? "OK" : "N/A"}`);
    return ok ? { provider: "Binance", url, path: "price", value: num } : null;
  } catch (_e) {
    const e = _e || {};
    // Treat 429, 404 and 400 (e.g., Invalid symbol) as non-errors
    if (!(e && (e.statusCode === 429 || e.statusCode === 404 || e.statusCode === 400))) {
      console.log(`Binance ${testSymbol} error: ${e && (e.stack || e.message) ? (e.message || e.stack) : String(e)} (url: ${url})`);
    }
    console.log(`Binance ${testSymbol}: N/A`);
    return null;
  }
}

async function checkCryptoCompare(symbol, timeoutMs, verbose) {
  const url = `https://min-api.cryptocompare.com/data/price?fsym=${encodeURIComponent(symbol.toUpperCase())}&tsyms=USD`;
  try {
    const data = await getJsonWithRetry(url, timeoutMs, 2);
    const ok = data && typeof data.USD === "number" && isFinite(data.USD);
    console.log(`CryptoCompare ${symbol}/USD: ${ok ? "OK" : "N/A"}`);
    return ok ? { provider: "CryptoCompare", url, path: "USD", value: data.USD } : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(`CryptoCompare ${symbol}/USD error: ${e && (e.stack || e.message) ? (e.message || e.stack) : String(e)} (url: ${url})`);
    }
    console.log(`CryptoCompare ${symbol}/USD: N/A`);
    return null;
  }
}

async function checkCoinGecko(symbol, coinsList, timeoutMs, verbose) {
  const id = mapSymbolToCoinGeckoId(symbol, coinsList);
  if (!id) {
    console.log(`CoinGecko ${symbol}: id not found`);
    return null;
  }
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`;
  try {
    const data = await getJsonWithRetry(url, timeoutMs, 2);
    const ok = data && data[id] && typeof data[id].usd === "number" && isFinite(data[id].usd);
    console.log(`CoinGecko ${id}/usd: ${ok ? "OK" : "N/A"}`);
    return ok ? { provider: "CoinGecko", url, path: `${id}.usd`, value: data[id].usd } : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(`CoinGecko ${id}/usd error: ${e && (e.stack || e.message) ? (e.message || e.stack) : String(e)} (url: ${url})`);
    }
    console.log(`CoinGecko ${id}/usd: N/A`);
    return null;
  }
}

// -------------------------------
// Additional providers
// -------------------------------
async function checkCoinbase(base, quote, timeoutMs) {
  const pair = `${base.toUpperCase()}-${quote.toUpperCase()}`;
  const url = `https://api.coinbase.com/v2/prices/${pair}/spot`;
  try {
    const data = await getJsonWithRetry(url, timeoutMs, 2);
    const has = data && data.data && typeof data.data.amount === "string" && data.data.amount.length > 0;
    const num = has ? Number(data.data.amount) : NaN;
    const ok = has && isFinite(num);
    if (has && !ok) console.log(`Coinbase ${pair}: value at path 'data.amount' is not numeric -> ${data.data.amount} (url: ${url})`);
    console.log(`Coinbase ${pair}: ${ok ? "OK" : "N/A"}`);
    return ok ? { provider: "Coinbase", url, path: "data.amount", value: num } : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(`Coinbase ${pair} error: ${e && (e.stack || e.message) ? (e.message || e.stack) : String(e)} (url: ${url})`);
    }
    console.log(`Coinbase ${pair}: N/A`);
    return null;
  }
}

function krakenMapSymbol(sym) {
  const s = sym.toUpperCase();
  if (s === "BTC") return "XBT";
  return s;
}

async function checkKraken(base, quote, timeoutMs) {
  const b = krakenMapSymbol(base);
  const q = krakenMapSymbol(quote);
  const pair = `${b}${q}`;
  const url = `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pair)}`;
  try {
    const data = await getJsonWithRetry(url, timeoutMs, 2);
    const hasError = data && Array.isArray(data.error) && data.error.length > 0;
    if (hasError) {
      const msg = Array.isArray(data.error) ? data.error.join('; ') : '';
      if (/Unknown asset pair/i.test(msg)) {
        console.log(`Kraken ${pair}: N/A (unknown asset pair)`);
      } else {
        console.log(`Kraken ${pair} error: ${msg || "API returned 'error' field"} (url: ${url})`);
        console.log(`Kraken ${pair}: N/A`);
      }
      return null;
    }
    const result = data && data.result ? data.result : null;
    const firstKey = result ? Object.keys(result)[0] : null;
    const ticker = firstKey ? result[firstKey] : null;
    const price = ticker && ticker.c && Array.isArray(ticker.c) ? ticker.c[0] : null;
    const has = typeof price === "string" && price.length > 0;
    const num = has ? Number(price) : NaN;
    const ok = has && isFinite(num);
    if (has && !ok) console.log(`Kraken ${pair}: value at path 'result.${firstKey}.c[0]' is not numeric -> ${price} (url: ${url})`);
    console.log(`Kraken ${pair}: ${ok ? "OK" : "N/A"}`);
    return ok ? { provider: "Kraken", url, path: `result.${firstKey}.c[0]`, value: num } : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(`Kraken ${pair} error: ${e && (e.stack || e.message) ? (e.message || e.stack) : String(e)} (url: ${url})`);
    }
    console.log(`Kraken ${pair}: N/A`);
    return null;
  }
}

async function checkOKX(base, quote, timeoutMs) {
  const instId = `${base.toUpperCase()}-${quote.toUpperCase()}`;
  const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
  try {
    const data = await getJsonWithRetry(url, timeoutMs, 2);
    const has = data && data.code === "0" && Array.isArray(data.data) && data.data[0] && typeof data.data[0].last === "string" && data.data[0].last.length > 0;
    const num = has ? Number(data.data[0].last) : NaN;
    const ok = has && isFinite(num);
    if (has && !ok) console.log(`OKX ${instId}: value at path 'data[0].last' is not numeric -> ${data.data[0].last} (url: ${url})`);
    console.log(`OKX ${instId}: ${ok ? "OK" : "N/A"}`);
    return ok ? { provider: "OKX", url, path: "data[0].last", value: num } : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(`OKX ${instId} error: ${e && (e.stack || e.message) ? (e.message || e.stack) : String(e)} (url: ${url})`);
    }
    console.log(`OKX ${instId}: N/A`);
    return null;
  }
}

async function checkFrankfurter(base, quote, timeoutMs) {
  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(base.toUpperCase())}&to=${encodeURIComponent(quote.toUpperCase())}`;
  try {
    const data = await getJsonWithRetry(url, timeoutMs, 2);
    const ok = data && data.rates && typeof data.rates[quote.toUpperCase()] === "number" && isFinite(data.rates[quote.toUpperCase()]);
    console.log(`Frankfurter ${base.toUpperCase()}/${quote.toUpperCase()}: ${ok ? "OK" : "N/A"}`);
    return ok ? { provider: "Frankfurter", url, path: `rates.${quote.toUpperCase()}`, value: data.rates[quote.toUpperCase()] } : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(`Frankfurter ${base.toUpperCase()}/${quote.toUpperCase()} error: ${e && (e.stack || e.message) ? (e.message || e.stack) : String(e)} (url: ${url})`);
    }
    console.log(`Frankfurter ${base.toUpperCase()}/${quote.toUpperCase()}: N/A`);
    return null;
  }
}

async function checkExchangerateHost(base, quote, timeoutMs) {
  const key = process.env.EXCHANGERATE_HOST_KEY;
  const baseUrl = `https://api.exchangerate.host/latest?base=${encodeURIComponent(base.toUpperCase())}&symbols=${encodeURIComponent(quote.toUpperCase())}`;
  const url = key ? `${baseUrl}&access_key=${encodeURIComponent(key)}` : baseUrl;
  try {
    const data = await getJsonWithRetry(url, timeoutMs, 2);
    const ok = data && data.rates && typeof data.rates[quote.toUpperCase()] === "number" && isFinite(data.rates[quote.toUpperCase()]);
    console.log(`exchangerate.host ${base.toUpperCase()}/${quote.toUpperCase()}: ${ok ? "OK" : "N/A"}${key ? "" : " (no key)"}`);
    return ok ? { provider: "exchangerate.host", url, path: `rates.${quote.toUpperCase()}`, value: data.rates[quote.toUpperCase()] } : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(`exchangerate.host ${base.toUpperCase()}/${quote.toUpperCase()} error: ${e && (e.stack || e.message) ? (e.message || e.stack) : String(e)} (url: ${url})`);
    }
    console.log(`exchangerate.host ${base.toUpperCase()}/${quote.toUpperCase()}: N/A${key ? "" : " (no key)"}`);
    return null;
  }
}

async function checkAlphaVantage(base, quote, timeoutMs) {
  const key = process.env.ALPHAVANTAGE_API_KEY;
  if (!key) {
    console.log("AlphaVantage: Skipping (no API key)");
    return null;
  }
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${encodeURIComponent(base.toUpperCase())}&to_currency=${encodeURIComponent(quote.toUpperCase())}&apikey=${encodeURIComponent(key)}`;
  try {
    const data = await getJsonWithRetry(url, timeoutMs, 2);
    const obj = data && data["Realtime Currency Exchange Rate"];
    const rate = obj && obj["5. Exchange Rate"] ? Number(obj["5. Exchange Rate"]) : NaN;
    const ok = isFinite(rate);
    console.log(`AlphaVantage ${base.toUpperCase()}/${quote.toUpperCase()}: ${ok ? "OK" : "N/A"}`);
    return ok ? { provider: "AlphaVantage", url, path: "Realtime Currency Exchange Rate.5. Exchange Rate", value: rate } : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(`AlphaVantage ${base.toUpperCase()}/${quote.toUpperCase()} error: ${e && (e.stack || e.message) ? (e.message || e.stack) : String(e)} (url: ${url})`);
    }
    console.log(`AlphaVantage ${base.toUpperCase()}/${quote.toUpperCase()}: N/A`);
    return null;
  }
}

async function checkFinnhub(base, timeoutMs) {
  const token = process.env.FINNHUB_TOKEN;
  if (!token) {
    console.log("Finnhub: Skipping (no token)");
    return null;
  }
  const symbol = base.toUpperCase();
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
  try {
    const data = await getJsonWithRetry(url, timeoutMs, 2);
    const ok = data && typeof data.c === "number" && isFinite(data.c);
    console.log(`Finnhub ${symbol}: ${ok ? "OK" : "N/A"}`);
    return ok ? { provider: "Finnhub", url, path: "c", value: data.c } : null;
  } catch (_e) {
    const e = _e || {};
    if (!(e && (e.statusCode === 429 || e.statusCode === 404))) {
      console.log(`Finnhub ${symbol} error: ${e && (e.stack || e.message) ? (e.message || e.stack) : String(e)} (url: ${url})`);
    }
    console.log(`Finnhub ${symbol}: N/A`);
    return null;
  }
}

// -------------------------------
// Main
// -------------------------------
async function main() {
  const args = parseArgs(process.argv);
  ensureDirSync(path.dirname(args.out));
  ensureDirSync(path.dirname(args.state));
  ensureDirSync(args.cacheDir);

  // Load input feeds
  const inputPath = path.resolve(__dirname, "../data-feeds.json");
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }
  /** @type {{ uniquePair: Record<string, {decimals?: string, smartDataFeed?: boolean, deltaC?: string, alphaPPB?: string}> }} */
  const input = readJsonSafe(inputPath, { uniquePair: {} });
  const entries = Object.entries(input.uniquePair || {});
  if (entries.length === 0) {
    console.error("No feeds found in data-feeds.json");
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

  // Load CoinGecko coins list (cached)
  const coinsList = await loadCoinGeckoCoins(args.cacheDir, args.timeoutMs, false);

  const resultsArray = [];
  let processedCount = 0;
  const totalCount = entries.length;
  const startedAt = Date.now();
  const printProgress = makeProgressPrinter(args.progress, totalCount, startedAt);
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
      const hasFullUrls = ds.length === 0 || ds.every((s) => typeof s === "string" && s.startsWith("http"));
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

    const shouldCheckApis = Boolean(baseSymbol) && isUsdQuote === true && cfg.smartDataFeed === false;
    if (shouldCheckApis) {
      const quote = "USD";
      const checks = await Promise.all([
        checkBinance(baseSymbol, args.timeoutMs, args.verbose),
        checkCryptoCompare(baseSymbol, args.timeoutMs, args.verbose),
        checkCoinGecko(baseSymbol, coinsList, args.timeoutMs, args.verbose),
        checkCoinbase(baseSymbol, quote, args.timeoutMs),
        checkKraken(baseSymbol, quote, args.timeoutMs),
        checkOKX(baseSymbol, quote, args.timeoutMs),
        checkFrankfurter(baseSymbol, quote, args.timeoutMs),
        checkExchangerateHost(baseSymbol, quote, args.timeoutMs),
        checkAlphaVantage(baseSymbol, quote, args.timeoutMs),
        checkFinnhub(baseSymbol, args.timeoutMs),
      ]);
      for (const res of checks) {
        if (!res) continue;
        if (typeof res === "string") {
          dataSources.push({ provider: "unknown", url: res, path: null, value: null });
        } else if (res && typeof res === "object") {
          const provider = typeof res.provider === "string" && res.provider ? res.provider : "unknown";
          const url = typeof res.url === "string" ? res.url : "";
          const path = typeof res.path === "string" ? res.path : null;
          const value = typeof res.value === "number" && isFinite(res.value) ? res.value : null;
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
      if (args.verbose) console.log(`  Skipping API checks (name format or smartDataFeed): ${name}`);
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

  if (args.progress) process.stdout.write("\n");
  console.log(`Done. Processed ${processedCount} feeds.`);
  console.log(`Output: ${args.out}`);
  console.log(`State: ${args.state}`);
}

function parseName(name) {
  // Expect format: "SYMBOL / USD" (with spaces around slash)
  if (typeof name !== "string") return { baseSymbol: null, isUsdQuote: false };
  const parts = name.split("/");
  if (parts.length !== 2) return { baseSymbol: null, isUsdQuote: false };
  const base = parts[0].trim();
  const quote = parts[1].trim();
  const isUsd = quote.toUpperCase() === "USD";
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
