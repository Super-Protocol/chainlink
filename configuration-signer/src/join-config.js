#!/usr/bin/env node
const jsYaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

function log(...args) {
  console.log('[join-config]', ...args);
}

function errorAndExit(message, err) {
  console.error('[join-config][ERROR]', message);
  if (err) {
    console.error(err.stack || err.toString());
  }
  process.exit(1);
}

(function main() {
  const [, , baseConfigArg, yamlDocArg, outputArg] = process.argv;

  if (!baseConfigArg || !yamlDocArg) {
    console.error('Usage: node src/join-config.js <baseConfig.json> <price-aggregator.yaml> [output.json]');
    process.exit(1);
  }

  const baseConfigPath = path.resolve(process.cwd(), baseConfigArg);
  const yamlDocPath = path.resolve(process.cwd(), yamlDocArg);
  const outputPath = path.resolve(process.cwd(), outputArg || 'join-config.json');

  log('Base config path:', baseConfigPath);
  log('YAML doc path:', yamlDocPath);
  log('Output path:', outputPath);

  if (!fs.existsSync(baseConfigPath)) {
    errorAndExit(`Base config file not found: ${baseConfigPath}`);
  }
  if (!fs.existsSync(yamlDocPath)) {
    errorAndExit(`YAML doc file not found: ${yamlDocPath}`);
  }

  let baseConfig;
  try {
    const baseRaw = fs.readFileSync(baseConfigPath, 'utf8');
    baseConfig = JSON.parse(baseRaw);
    log('Loaded base config JSON.');
  } catch (e) {
    errorAndExit(`Failed to read/parse base config JSON: ${baseConfigPath}`, e);
  }

  let doc;
  try {
    doc = jsYaml.load(fs.readFileSync(yamlDocPath, 'utf8'));
    log('Loaded YAML doc.');
  } catch (e) {
    errorAndExit(`Failed to read/parse YAML doc: ${yamlDocPath}`, e);
  }

  try {
    baseConfig.priceAggregatorConfig = doc;
    fs.writeFileSync(outputPath, JSON.stringify(baseConfig, null, 2));
    log('Successfully wrote merged config to', outputPath);
    // Also print the merged JSON to stdout as in original behavior
    console.log(JSON.stringify(baseConfig, null, 2));
  } catch (e) {
    errorAndExit(`Failed to write output JSON: ${outputPath}`, e);
  }
})();
