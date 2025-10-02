/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const {
  setConfigForContract,
  flushDonConfigCache,
  initConnector,
  shutdownConnector,
} = require('./set-config');
const { helpers } = require('@super-protocol/sdk-js');

function findTomlFiles(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((de) => de.isFile() && de.name.endsWith('.toml'))
    .map((de) => path.join(dir, de.name));
  return files;
}

function extractContractAddress(tomlPath) {
  const content = fs.readFileSync(tomlPath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*contractAddress\s*=\s*([^#\n]+)/);
    if (m) {
      const raw = m[1].replace(/#.*$/, '').trim().replace(/"/g, '');
      return raw;
    }
  }
  return null;
}

function isValidAddress(addr) {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

async function main() {
  const templatesDir = process.env.JOB_RENDERS_DIR;
  if (!templatesDir) throw new Error('JOB_RENDERS_DIR is required');
  if (!fs.existsSync(templatesDir) || !fs.statSync(templatesDir).isDirectory()) {
    throw new Error(`Directory not found: ${templatesDir}`);
  }

  await initConnector({});
  try {
    const files = findTomlFiles(templatesDir);
    if (files.length === 0) {
      console.error(`No .toml files found in ${templatesDir}`);
      await flushDonConfigCache();
      return;
    }

    const items = files.map((file) => ({ file, addr: extractContractAddress(file) }));
    const valid = items.filter(({ file, addr }) => {
      if (!addr) { console.log(`[skip] No contractAddress in ${path.basename(file)}`); return false; }
      if (addr.startsWith('$')) { console.log(`[skip] Placeholder contractAddress (${addr}) in ${path.basename(file)}`); return false; }
      if (!isValidAddress(addr)) { console.log(`[skip] Invalid contractAddress '${addr}' in ${path.basename(file)}`); return false; }
      return true;
    });

    const batchSize = Number(process.env.SET_CONFIG_BATCH_SIZE || '10');
    for (let start = 0; start < valid.length; start += batchSize) {
      const batch = valid.slice(start, start + batchSize);
      console.log(
        `\n[batch] Processing items ${start + 1}-${Math.min(
          start + batch.length,
          valid.length
        )} of ${valid.length}`
      );
      await Promise.all(
        batch.map(async (current) =>
          helpers.tryWithInterval({
            handler: async () => {
              console.log(
                `[run ] ${path.basename(current.file)}: contractAddress=${
                  current.addr
                }`
              );
      try {
        await setConfigForContract(current.addr);
      } catch (e) {
                console.error(
                  `[fail] ${path.basename(current.file)}:`,
                  e?.message || e
                );
                throw e;
      }
            },
            checkError: () => ({ retryable: true }),
            retryMax: 3,
            retryIntervalMs: 2000,
          })
        )
      );
    }
    await flushDonConfigCache();
  } finally {
    shutdownConnector();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
