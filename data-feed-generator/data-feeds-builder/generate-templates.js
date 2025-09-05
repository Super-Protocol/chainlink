#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname);
const MAP_PATH = path.join(ROOT, "data-feeds-map.json");
const CAS_PATH = path.join(ROOT, "feed-cas.json");
const TEMPLATE_PATH = path.join(ROOT, "job-template.toml");
const OUTPUT_DIR = path.join(ROOT, "templates");

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function slugifyNameToFilename(name) {
  return name
    .toLowerCase()
    .replace(/\s*\/\s*/g, "-") // replace " / " with '-'
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .concat(".toml");
}

function generateDeterministicJobId(name, ca) {
  const ns = "d113bc61-4f8b-5d2a-9a35-4d7c7a599c9e"; // arbitrary fixed namespace UUIDv5-like
  const hash = crypto.createHash("sha1").update(String(ns) + "|" + name + "|" + ca).digest();
  const bytes = Buffer.from(hash.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // set version 5 (0b0101 << 4)
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString("hex");
  return `${hex.substr(0, 8)}-${hex.substr(8, 4)}-${hex.substr(12, 4)}-${hex.substr(16, 4)}-${hex.substr(20)}`;
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
  let d = Number.parseInt(String(decimalsRaw ?? ""), 10);
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

  dataSources.forEach((url, idx) => {
    const i = idx + 1;
    const ds = `ds${i}`;
    const parse = `${ds}_parse`;
    const mult = `${ds}_multiply`;

    lines.push(`${ds} [type=http method=GET url="${url}"];`);

    let pathExpr = "";
    if (url.includes("api.binance.com")) {
      pathExpr = "price";
    } else if (url.includes("min-api.cryptocompare.com")) {
      pathExpr = "USD";
    } else if (url.includes("api.coingecko.com") && url.includes("/simple/price")) {
      const id = parseQueryParam(url, "ids");
      if (id) pathExpr = `${id},usd`;
    }

    if (!pathExpr) {
      // Fallback: try best-effort common fields
      pathExpr = url.includes("coingecko") ? "usd" : "USD";
    }

    lines.push(`${parse} [type=jsonparse path="${pathExpr}"];`);
    lines.push(`${mult} [type=multiply times=${timesStr}];`);
    edges.push(`${ds} -> ${parse} -> ${mult};`);
    medianInputs.push(`${mult}`);
  });

  medianInputs.forEach((m) => {
    edges.push(`${m} -> median;`);
  });
  lines.push("median [type=median];");

  const all = [];
  all.push(...lines);
  all.push("");
  all.push(...edges);
  return all.join("\n");
}

function replacePlaceholders(template, { jobName, jobId, jobCa, observationSource }) {
  function indentBlock(text, spaces = 4) {
    const pad = " ".repeat(spaces);
    return text
      .split("\n")
      .map((line) => pad + line)
      .join("\n");
  }

  let out = template
    .replace(/\$JOB_NAME/g, jobName)
    .replace(/\$JOB_ID/g, jobId)
    .replace(/\$JOB_CA/g, jobCa);

  out = out.replace(/observationSource\s*=\s*"""[\s\S]*?"""/m, () => {
    return `observationSource = """
${indentBlock(observationSource)}
"""`;
  });

  return out;
}

function main() {
  const feeds = readJson(MAP_PATH);
  const cas = readJson(CAS_PATH);
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
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

    const jobName = `OCR Oracle: ${feed.name} Price Feed`;
    const jobId = generateDeterministicJobId(feed.name, ca);
    const observationSource = buildObservationSource(feed.dataSources, feed.decimals);

    const rendered = replacePlaceholders(template, {
      jobName,
      jobId,
      jobCa: ca,
      observationSource,
    });

    const filename = slugifyNameToFilename(feed.name);
    const dest = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(dest, rendered, "utf8");
    generated++;
    console.log(`Generated: ${dest}`);
  }

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


