// find-missing-templates.js
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function toTemplateFileName(feedKey) {
  const parts = feedKey.split('/').map(s => s.trim());
  if (parts.length !== 2) return null;
  const sanitize = (s) =>
    s.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  const l = sanitize(parts[0]);
  const r = sanitize(parts[1]);
  if (!l || !r) return null;
  return `${l}-${r}.toml`;
}

function main() {
  const [templatesArg, feedsArg, outArg] = process.argv.slice(2);
  if (!templatesArg || !feedsArg || !outArg) {
    console.error('Usage: node find-missing-templates.js <templatesDir> <feedsJson> <outJson>');
    process.exit(1);
  }

  const templatesDir = templatesArg;
  const inputJsonPath = feedsArg;
  const outputJsonPath = outArg;

  if (!fs.existsSync(inputJsonPath)) {
    console.error(`Input not found: ${inputJsonPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(templatesDir) || !fs.statSync(templatesDir).isDirectory()) {
    console.error(`Templates dir not found: ${templatesDir}`);
    process.exit(1);
  }

  const feedMap = JSON.parse(fs.readFileSync(inputJsonPath, 'utf8'));
  const templateFiles = new Set(
    fs.readdirSync(templatesDir).filter(f => f.toLowerCase().endsWith('.toml'))
  );

  const missing = {};
  for (const [feedKey, address] of Object.entries(feedMap)) {
    const fileName = toTemplateFileName(feedKey);
    if (!fileName) continue;
    if (!templateFiles.has(fileName)) {
      missing[feedKey] = address;
    }
  }

  fs.writeFileSync(outputJsonPath, JSON.stringify(missing, null, 2));
  console.log(Object.keys(missing).length);
}

if (require.main === module) {
  main();
}
