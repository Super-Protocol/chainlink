#!/usr/bin/env node
/**
 * Script to generate a JSON mapping of feed names to contract addresses.
 *
 * This script reads TOML template files from a directory, extracts the 'name' field,
 * and maps it to the corresponding contract address from a source JSON file.
 *
 * Usage:
 *     node generate_feed_mapping.js <source_json_path> <templates_dir> <output_json_path> [exclude_single_source]
 *
 * Arguments:
 *     source_json_path: Path to the JSON file containing feed name to address mappings
 *     templates_dir: Path to the directory containing TOML template files
 *     output_json_path: Path where the output JSON file will be written
 *     exclude_single_source: Optional. Set to 'false' to include single-source feeds (default: true)
 */

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

/**
 * Extract the 'name' field value from a TOML file.
 *
 * @param {string} tomlPath - Path to the TOML file
 * @returns {string|null} The value of the 'name' field, or null if not found
 */
function extractNameFromToml(tomlPath) {
  try {
    const content = fs.readFileSync(tomlPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      // Look for lines like: name = "1INCH / USD"
      const match = line.trim().match(/^name\s*=\s*"([^"]+)"/);
      if (match) {
        return match[1];
      }
    }
  } catch (error) {
    console.error(`Error reading ${tomlPath}: ${error.message}`);
  }
  return null;
}

/**
 * Count the number of data sources in observationSource field.
 *
 * @param {string} tomlPath - Path to the TOML file
 * @returns {number} The number of data sources (ds1, ds2, etc.)
 */
function countDataSources(tomlPath) {
  try {
    const content = fs.readFileSync(tomlPath, 'utf-8');

    // Extract the observationSource field (it's a multi-line string)
    const observationSourceMatch = content.match(/observationSource\s*=\s*"""([\s\S]*?)"""/);
    if (!observationSourceMatch) {
      return 0;
    }

    const observationSource = observationSourceMatch[1];

    // Find all data source definitions like: ds1 [type=http, ds2 [type=http, etc.
    const dataSourceMatches = observationSource.match(/ds\d+\s*\[type=http/g);

    return dataSourceMatches ? dataSourceMatches.length : 0;
  } catch (error) {
    console.error(`Error reading ${tomlPath}: ${error.message}`);
    return 0;
  }
}

/**
 * Process all TOML templates and generate the output JSON mapping.
 *
 * @param {string} sourceJsonPath - Path to the source JSON file with address mappings
 * @param {string} templatesDir - Directory containing TOML template files
 * @param {string} outputJsonPath - Path to write the output JSON file
 * @param {boolean} excludeSingleSource - Whether to exclude feeds with single data source (default: true)
 */
function processTemplates(sourceJsonPath, templatesDir, outputJsonPath, excludeSingleSource = true) {
  // Load the source JSON file
  let sourceData;
  try {
    const sourceContent = fs.readFileSync(sourceJsonPath, 'utf-8');
    sourceData = JSON.parse(sourceContent);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Error: Source JSON file not found: ${sourceJsonPath}`);
    } else if (error instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in source file: ${error.message}`);
    } else {
      console.error(`Error reading source file: ${error.message}`);
    }
    process.exit(1);
  }

  // Check if templates directory exists
  if (!fs.existsSync(templatesDir)) {
    console.error(`Error: Templates directory not found: ${templatesDir}`);
    process.exit(1);
  }

  const stats = fs.statSync(templatesDir);
  if (!stats.isDirectory()) {
    console.error(`Error: Templates directory not found: ${templatesDir}`);
    process.exit(1);
  }

  // Process all TOML files in the templates directory
  const result = {};
  const singleSourceFeeds = [];
  let tomlFiles;

  try {
    const allFiles = fs.readdirSync(templatesDir);
    tomlFiles = allFiles
      .filter(f => f.toLowerCase().endsWith('.toml'))
      .sort();
  } catch (error) {
    console.error(`Error reading templates directory: ${error.message}`);
    process.exit(1);
  }

  if (tomlFiles.length === 0) {
    console.error(`Warning: No TOML files found in ${templatesDir}`);
  }

  for (const fileName of tomlFiles) {
    const tomlPath = path.join(templatesDir, fileName);
    const name = extractNameFromToml(tomlPath);

    if (name) {
      // Check if this name exists in the source data
      if (name in sourceData) {
        // Count data sources in observationSource
        const sourceCount = countDataSources(tomlPath);

        // Check if it's a single-source feed
        if (sourceCount === 1) {
          singleSourceFeeds.push(name);

          // Only add to result if we're not excluding single-source feeds
          if (!excludeSingleSource) {
            result[name] = sourceData[name];
          }
        } else {
          // Multi-source feed, always include
          result[name] = sourceData[name];
        }
      } else {
        console.error(`Warning: '${name}' from ${fileName} not found in source JSON`);
      }
    } else {
      console.error(`Warning: Could not extract 'name' field from ${fileName}`);
    }
  }

  // Log single-source feeds information
  if (singleSourceFeeds.length > 0) {
    console.log(`\nFeeds with single data source (${singleSourceFeeds.length} total):`);
    singleSourceFeeds.forEach(name => console.log(`  - ${name}`));
    if (excludeSingleSource) {
      console.log(`\nThese feeds were excluded from the output.`);
    } else {
      console.log(`\nThese feeds were included in the output.`);
    }
  }

  // Write the output JSON file
  try {
    const outputDir = path.dirname(outputJsonPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputJsonPath, JSON.stringify(result, null, 2) + '\n', 'utf-8');

    console.log(`Successfully generated ${outputJsonPath}`);
    console.log(`Processed ${tomlFiles.length} TOML files`);
    console.log(`Matched ${Object.keys(result).length} feeds`);
  } catch (error) {
    console.error(`Error writing output file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length < 3 || args.length > 4) {
    console.log('Usage: node generate_feed_mapping.js <source_json_path> <templates_dir> <output_json_path> [exclude_single_source]');
    console.log();
    console.log('Arguments:');
    console.log('  source_json_path: Path to the JSON file containing feed name to address mappings');
    console.log('  templates_dir: Path to the directory containing TOML template files');
    console.log('  output_json_path: Path where the output JSON file will be written');
    console.log('  exclude_single_source: Optional. Set to "false" to include single-source feeds (default: true)');
    process.exit(1);
  }

  const [sourceJsonPath, templatesDir, outputJsonPath, excludeSingleSourceArg] = args;

  // Parse the exclude_single_source argument (default: true)
  let excludeSingleSource = true;
  if (excludeSingleSourceArg !== undefined) {
    excludeSingleSource = excludeSingleSourceArg.toLowerCase() !== 'false';
  }

  processTemplates(sourceJsonPath, templatesDir, outputJsonPath, excludeSingleSource);
}

if (require.main === module) {
  main();
}

module.exports = { extractNameFromToml, processTemplates };
