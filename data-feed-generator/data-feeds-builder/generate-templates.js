#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname);
const MAP_PATH = path.join(ROOT, 'data-feeds-map.json');
const CAS_PATH = path.join(
  ROOT,
  '..',
  '..',
  'scripts/bash/data/feed-cas.chainid-5611.json'
);
const TEMPLATE_PATH = path.join(ROOT, 'job-template.toml');
const OUTPUT_DIR = path.join(ROOT, 'templates');
const PAIRS_OUTPUT_PATH = path.resolve(
  ROOT,
  '../../price-aggregator/pairs.json'
);

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function slugifyNameToFilename(name) {
  return name
    .toLowerCase()
    .replace(/\s*\/\s*/g, '-') // replace " / " with '-'
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .concat('.toml');
}

function generateDeterministicJobId(name, ca) {
  const ns = 'd113bc61-4f8b-5d2a-9a35-4d7c7a599c9e'; // arbitrary fixed namespace UUIDv5-like
  const hash = crypto
    .createHash('sha1')
    .update(String(ns) + '|' + name + '|' + ca)
    .digest();
  const bytes = Buffer.from(hash.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // set version 5 (0b0101 << 4)
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString('hex');
  return `${hex.substr(0, 8)}-${hex.substr(8, 4)}-${hex.substr(
    12,
    4
  )}-${hex.substr(16, 4)}-${hex.substr(20)}`;
}

function parseQueryParam(url, key) {
  try {
    const u = new URL(url);
    return u.searchParams.get(key);
  } catch (_e) {
    return null;
  }
}

function decimalsToTimesString(decimalsRaw) {
  let d = Number.parseInt(String(decimalsRaw ?? ''), 10);
  if (!Number.isFinite(d) || d < 0) d = 8; // default
  if (d > 36) d = 36; // protect against absurdly large numbers
  const times = 10n ** BigInt(d);
  return times.toString();
}

function buildObservationSource(dataSources, decimalsRaw) {
  const timesStr = decimalsToTimesString(decimalsRaw);
  const lines = [];
  const edges = [];
  const medianInputs = [];

  dataSources.forEach((entry, idx) => {
    const i = idx + 1;
    const ds = `ds${i}`;
    const parse = `${ds}_parse`;
    const mult = `${ds}_multiply`;

    // Support legacy string URL entries and new object entries with { url, path }
    let url = '';
    let pathExpr = '';
    if (typeof entry === 'string') {
      url = entry;
    } else if (entry && typeof entry === 'object') {
      url = entry.url || '';
      // New structure provides explicit path to the value inside returned JSON
      if (entry.path) {
        const raw = String(entry.path);
        // Normalize path: convert dot notation and bracket indices to Chainlink jsonparse syntax
        // Examples:
        //  - "result.XXBTZUSD.c[0]" -> "result,XXBTZUSD,c,0"
        //  - "data[0].last" -> "data,0,last"
        //  - "[0].value" -> "0,value"
        const segments = [];
        raw.split('.').forEach((seg) => {
          if (!seg) return;
          // Extract name and any bracket indices
          let m;
          const re = /([^\[]+)?(\[[0-9]+\])+/g;
          let lastIndex = 0;
          while ((m = re.exec(seg)) !== null) {
            const name = m[1];
            if (name) segments.push(name);
            // Push each index inside brackets as separate segment
            const idxPart = m[0].slice((name || '').length);
            const idxMatches = idxPart.match(/\[([0-9]+)\]/g) || [];
            idxMatches.forEach((ix) => {
              const num = ix.replace(/\[|\]/g, '');
              segments.push(num);
            });
            lastIndex = re.lastIndex;
          }
          if (lastIndex === 0) {
            // No bracket pattern matched; could be like "c" or "c[0]" not matched by global? handle generic
            // Fallback: split simple name[idx][idx] pattern manually
            const simple = seg;
            const nameMatch = simple.match(/^[^\[]+/);
            if (nameMatch) segments.push(nameMatch[0]);
            const rest = simple.slice(nameMatch ? nameMatch[0].length : 0);
            const idxMatches2 = rest.match(/\[([0-9]+)\]/g) || [];
            idxMatches2.forEach((ix) =>
              segments.push(ix.replace(/\[|\]/g, ''))
            );
          }
        });
        pathExpr = segments.join(',');
      }
    }

    if (!url) return;

    lines.push(`${ds} [type=http method=GET url="${url}"];`);

    // If path not provided (legacy), try best-effort inference
    if (!pathExpr) {
      if (url.includes('api.binance.com')) {
        pathExpr = 'price';
      } else if (url.includes('min-api.cryptocompare.com')) {
        pathExpr = 'USD';
      } else if (
        url.includes('api.coingecko.com') &&
        url.includes('/simple/price')
      ) {
        const id = parseQueryParam(url, 'ids');
        if (id) pathExpr = `${id},usd`;
      } else if (url.includes('api.coinbase.com')) {
        pathExpr = 'data,amount';
      }
      if (!pathExpr) {
        // Fallback: try common fields
        pathExpr = url.includes('coingecko') ? 'usd' : 'USD';
      }
    }

    // Chainlink TOML uses "," as separator for nested keys while arrays use [index]
    // Keep array indexers as-is: convert dots to commas but preserve [n]
    // We already converted dots to commas; ensure brackets remain.

    lines.push(`${parse} [type=jsonparse path="${pathExpr}"];`);
    lines.push(`${mult} [type=multiply times=${timesStr}];`);
    edges.push(`${ds} -> ${parse} -> ${mult};`);
    medianInputs.push(`${mult}`);
  });

  medianInputs.forEach((m) => {
    edges.push(`${m} -> median;`);
  });
  lines.push('median [type=median];');

  const all = [];
  all.push(...lines);
  all.push('');
  all.push(...edges);
  return all.join('\n');
}

function replacePlaceholders(template, { jobName, jobId, observationSource }) {
  function indentBlock(text, spaces = 4) {
    const pad = ' '.repeat(spaces);
    return text
      .split('\n')
      .map((line) => pad + line)
      .join('\n');
  }

  let out = template
    .replace(/\$JOB_NAME/g, jobName)
    .replace(/\$JOB_ID/g, jobId);

  out = out.replace(/observationSource\s*=\s*"""[\s\S]*?"""/m, () => {
    return `observationSource = """
${indentBlock(observationSource)}
"""`;
  });

  return out;
}

// Build observationSource for cross-course feeds (e.g. TOKEN / ETH) by
// grouping dataSources per provider and dividing TOKEN/USD(X) by ETH/USD(X)
// (or other denominator asset) within the same provider, then taking median.
function normalizeSymbol(sym) {
  return String(sym || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function identifyBaseAndDenom(feedName) {
  const parts = String(feedName).split('/');
  if (parts.length < 2) return { base: null, denom: null };
  const base = parts[0].trim();
  const denom = parts[1].trim();
  return { base, denom };
}

function buildCrossCourseObservationSource(feed, contractAddress) {
  const { base, denom } = identifyBaseAndDenom(feed.name || '');
  if (!base || !denom) {
    return buildObservationSource(feed.dataSources || [], feed.decimals); // fallback generic
  }
  const baseLc = base.trim().toLowerCase();
  const denomLc = denom.trim().toLowerCase();
  const timesStr = decimalsToTimesString(feed.decimals);

  // Group by provider
  const byProvider = {};
  for (const ds of feed.dataSources || []) {
    if (!ds || !ds.provider) continue;
    const p = String(ds.provider).toLowerCase();
    if (!byProvider[p]) byProvider[p] = [];
    byProvider[p].push(ds);
  }

  const lines = [];
  const edges = [];
  const divideNodes = [];

  for (const provider of Object.keys(byProvider).sort()) {
    const group = byProvider[provider];
    if (group.length < 2) continue; // need at least two entries per provider

    // Heuristics to pick denom entry (contains denom symbol substring in pair) and base entry
    let denomEntry = group.find((g) =>
      String(g.pair || g.url || '').toLowerCase().includes(denomLc)
    );
    let baseEntry = group.find((g) =>
      String(g.pair || g.url || '').toLowerCase().includes(baseLc)
    );

    // Fallbacks if heuristics failed
    if (!denomEntry) {
      // choose entry with larger price maybe (common for denom = ETH/BTC etc.)
      denomEntry = [...group].sort(
        (a, b) => Number(b.value || 0) - Number(a.value || 0)
      )[0];
    }
    if (!baseEntry) {
      baseEntry = group.find((g) => g !== denomEntry) || group[0];
    }
    if (baseEntry === denomEntry) continue; // cannot proceed

    function buildNodePrefix(entry, symbolDesired) {
      // Try to get quote currency (USD / USDT) from pair
      let quoteCur = '';
      if (entry.pair) {
        const parts = String(entry.pair).split('/');
        if (parts.length === 2) quoteCur = parts[1].toLowerCase();
      }
      if (!quoteCur) {
        // Extract from URL maybe
        const m = String(entry.url || '').match(/\/quote\/[^/]+\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/);
        if (m) quoteCur = m[1].toLowerCase();
      }
      if (!quoteCur) quoteCur = 'usd';
      return `${provider}_${normalizeSymbol(symbolDesired)}_${quoteCur}`;
    }

    const baseNode = buildNodePrefix(baseEntry, base);
    const denomNode = buildNodePrefix(denomEntry, denom);
    const baseParse = `${baseNode}_parse`;
    const baseMultiply = `${baseNode}_multiply`;
    const denomParse = `${denomNode}_parse`;
    const denomMultiply = `${denomNode}_multiply`;
    const divideNode = `${provider}_${normalizeSymbol(base)}_${normalizeSymbol(
      denom
    )}_divide`;

    // Base (comments removed per requirement)
    lines.push(
      `    ${baseNode}          [type="http" method=GET url="${baseEntry.url}" allowUnrestrictedNetworkAccess=true retries=3]`
    );
    lines.push(
      `    ${baseParse}    [type="jsonparse" path="${baseEntry.path || 'price'}"]`
    );
    lines.push(
      `    ${baseMultiply} [type="multiply" times=${timesStr}]`
    );

    // Denom
    lines.push('');
    lines.push(
      `    ${denomNode}          [type="http" method=GET url="${denomEntry.url}" allowUnrestrictedNetworkAccess=true retries=3]`
    );
    lines.push(
      `    ${denomParse}    [type="jsonparse" path="${denomEntry.path || 'price'}"]`
    );
    lines.push(
      `    ${denomMultiply} [type="multiply" times=${timesStr}]`
    );

    // Divide
    lines.push('');
    lines.push(
      `    ${divideNode}    [type="divide" input="$(${baseMultiply})" divisor="$(${denomMultiply})" times=${timesStr}]`
    );

    // Edges
    edges.push(
      `    ${baseNode} -> ${baseParse} -> ${baseMultiply} -> ${divideNode}`
    );
    edges.push(
      `    ${denomNode} -> ${denomParse} -> ${denomMultiply} -> ${divideNode}`
    );
    divideNodes.push(divideNode);
    lines.push('');
  }

  if (divideNodes.length === 0) {
    // fallback to generic median
    return buildObservationSource(feed.dataSources || [], feed.decimals);
  }

  const medianName = 'median';
  // Median node (no allowedFaults attribute per updated requirement)
  lines.push(`    ${medianName} [type=median];`);
  lines.push('');
  // provider pipelines (single indent already added in statements above; remove leading spaces from stored edges)
  edges.forEach((e) => lines.push(e.replace(/^\s+/, '')));
  // aggregation edges to median
  divideNodes.forEach((n) => lines.push(`${n} -> ${medianName};`));

  return lines.join('\n');
}

// Pair aggregation now prefers explicit ds.pair attribute; URL parsing retained only as fallback for legacy entries.
function extractPairFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const noQuery = url.split('?')[0];
    const parts = noQuery.split('/').filter(Boolean);
    const quoteIndex = parts.findIndex((p) => p === 'quote');
    if (quoteIndex !== -1 && parts.length >= quoteIndex + 4) {
      // expect /quote/{provider}/{BASE}/{QUOTE}
      const base = parts[quoteIndex + 2];
      const quote = parts[quoteIndex + 3];
      if (base && quote) return `${base}/${quote}`;
    }
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const prev = parts[parts.length - 2];
      if (/^[A-Za-z0-9._-]+$/.test(prev) && /^[A-Za-z0-9._-]+$/.test(last)) {
        return prev + '/' + last;
      }
    }
  } catch (_e) {
    return null;
  }
  return null;
}

function generatePairsByProvider(feeds) {
  const grouped = {};
  for (const feed of feeds) {
    if (!feed || !Array.isArray(feed.dataSources)) continue;
    for (const ds of feed.dataSources) {
      if (!ds || typeof ds !== 'object') continue;
      const provider = ds.provider;
      if (!provider) continue;
      let pair = ds.pair; // primary source
      if (!pair) {
        // attempt fallback only if url provided (legacy)
        pair = extractPairFromUrl(ds.url);
      }
      if (!pair) continue;
      const key = String(provider).toLowerCase();
      if (!grouped[key]) grouped[key] = new Set();
      grouped[key].add(pair);
    }
  }
  return Object.fromEntries(
    Object.keys(grouped)
      .sort()
      .map((p) => [p, Array.from(grouped[p]).sort()])
  );
}

function writePairsForPriceAggregator(feeds) {
  try {
    const pairs = generatePairsByProvider(feeds);
    ensureDir(path.dirname(PAIRS_OUTPUT_PATH));
    fs.writeFileSync(
      PAIRS_OUTPUT_PATH,
      JSON.stringify(pairs, null, 2) + '\n',
      'utf8'
    );
    console.log(`pairs.json written to ${PAIRS_OUTPUT_PATH}`);
  } catch (e) {
    console.error('Failed to write pairs.json:', e.message);
  }
}

function main() {
  const feeds = readJson(MAP_PATH);
  const cas = readJson(CAS_PATH);
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  ensureDir(OUTPUT_DIR);

  let generated = 0;
  for (const feed of feeds) {
    if (!Array.isArray(feed.dataSources) || feed.dataSources.length === 0) {
      console.log(`Skip (no dataSources): ${feed.name}`);
      continue;
    }
    const ca = cas[feed.name];
    if (!ca) {
      console.log(`Skip (no CA): ${feed.name}`);
      continue;
    }

    const jobName = feed.name;
    const jobId = generateDeterministicJobId(feed.name, ca);
    const observationSource =
      feed.type === 'cross-course'
        ? buildCrossCourseObservationSource(feed, ca)
        : buildObservationSource(feed.dataSources, feed.decimals);

    const rendered = replacePlaceholders(template, {
      jobName,
      jobId,
      jobCa: ca,
      observationSource,
    });

    const filename = slugifyNameToFilename(feed.name);
    const dest = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(dest, rendered, 'utf8');
    generated++;
    console.log(`Generated: ${dest}`);
  }

  writePairsForPriceAggregator(feeds);

  console.log(`Done. Generated ${generated} templates in ${OUTPUT_DIR}`);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e && e.stack ? e.stack : String(e));
    process.exit(1);
  }
}
