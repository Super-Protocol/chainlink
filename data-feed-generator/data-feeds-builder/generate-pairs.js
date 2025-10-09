#!/usr/bin/env node
'use strict';

/**
 * generate-pairs.js
 *
 * Script for automatic generation of pairs.json from TOML templates.
 *
 * Description:
 * - Scans all *.toml files in the templates/ directory
 * - Extracts currency pairs from URLs in observationSource sections
 * - Groups pairs by data sources (binance, coinbase, coingecko, etc.)
 * - Filters duplicates and sorts results
 * - Saves result to price-aggregator/pairs.json
 *
 * Usage:
 * node generate-pairs.js
 *
 * Output:
 * Creates/updates ../../price-aggregator/pairs.json file with currency pairs
 * in format { "source": ["SYMBOL1/SYMBOL2", ...] }
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const PAIRS_OUTPUT_PATH = path.resolve(ROOT, '../../price-aggregator/pairs.json');


// Regular expression to find pairs in URLs with named capture groups
// Pattern: /quote/source/SYMBOL1/SYMBOL2 or /quote/source/id/SYMBOL2
const PATTERN = /\/quote\/(?<source>[^\/]+)\/(?<symbol1>[^\/]+)\/(?<symbol2>[^\/\s"\]]+)/g;

/**
 * Extracts all pairs from TOML template files
 */
function extractPairsFromTemplates() {
  console.log('Scanning templates directory...');

  if (!fs.existsSync(TEMPLATES_DIR)) {
    throw new Error(`Templates directory not found: ${TEMPLATES_DIR}`);
  }

  const tomlFiles = fs.readdirSync(TEMPLATES_DIR)
    .filter(file => file.endsWith('.toml'))
    .map(file => path.join(TEMPLATES_DIR, file));

  console.log(`Found ${tomlFiles.length} TOML files`);

  const sourcesPairs = {};


  tomlFiles.forEach(filePath => {
    const fileName = path.basename(filePath);
    console.log(`Processing ${fileName}...`);

    try {
      const content = fs.readFileSync(filePath, 'utf8');

      // Find observationSource section
      const observationMatch = content.match(/observationSource\s*=\s*"""([\s\S]*?)"""/);
      if (!observationMatch) {
        console.log(`  - No observationSource in ${fileName}`);
        return;
      }

      const observationSource = observationMatch[1];

        // Apply regular expression to find pairs
        let match;
        while ((match = PATTERN.exec(observationSource)) !== null) {
          const { source, symbol1, symbol2 } = match.groups;
          const pair = `${symbol1}/${symbol2}`;

          // Initialize source if it doesn't exist
          if (!sourcesPairs[source]) {
            sourcesPairs[source] = new Set();
          }

          sourcesPairs[source].add(pair);
          console.log(`  - Found pair: ${source} -> ${pair}`);
        }

    } catch (error) {
      console.error(`Error processing ${fileName}:`, error.message);
    }
  });

  // Convert Set to sorted arrays
  const result = {};
  Object.keys(sourcesPairs).sort().forEach(source => {
    result[source] = Array.from(sourcesPairs[source]).sort();
  });

  return result;
}

/**
 * Saves pairs to JSON file
 */
function savePairsToFile(pairs) {
  console.log('\nSaving results...');

  // Create directory if it doesn't exist
  const outputDir = path.dirname(PAIRS_OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save with pretty formatting
  const jsonContent = JSON.stringify(pairs, null, 2);
  fs.writeFileSync(PAIRS_OUTPUT_PATH, jsonContent, 'utf8');

  console.log(`File saved: ${PAIRS_OUTPUT_PATH}`);
}

/**
 * Prints statistics
 */
function printStatistics(pairs) {
  console.log('\n=== STATISTICS ===');

  let totalPairs = 0;
  const sources = Object.keys(pairs).sort();

  sources.forEach(source => {
    const count = pairs[source].length;
    totalPairs += count;
    console.log(`${source}: ${count} pairs`);
  });

  console.log(`\nTotal sources: ${sources.length}`);
  console.log(`Total unique pairs: ${totalPairs}`);

  // Show examples for each source
  console.log('\n=== PAIR EXAMPLES ===');
  sources.forEach(source => {
    const examples = pairs[source].slice(0, 5);
    console.log(`${source}: ${examples.join(', ')}${pairs[source].length > 5 ? '...' : ''}`);
  });
}

/**
 * Main function
 */
function main() {
  try {
    console.log('=== PAIRS.JSON GENERATION ===\n');

    // Extract pairs from templates
    const pairs = extractPairsFromTemplates();

    // Save to file
    savePairsToFile(pairs);

    // Print statistics
    printStatistics(pairs);

    console.log('\n✅ Generation completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run if file is called directly
if (require.main === module) {
  main();
}

module.exports = {
  extractPairsFromTemplates,
  savePairsToFile,
  printStatistics,
  main
};
