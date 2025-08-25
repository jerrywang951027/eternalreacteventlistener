#!/usr/bin/env node

/**
 * Script to fix multi-line SALESFORCE_ORGS in .env file
 */

const fs = require('fs');
const path = require('path');

const envFilePath = path.join(__dirname, '.env');

console.log('🔧 Fixing .env SALESFORCE_ORGS JSON format...');

// Read the current .env file
const envContent = fs.readFileSync(envFilePath, 'utf8');
const lines = envContent.split('\n');

let salesforceOrgsStart = -1;
let salesforceOrgsEnd = -1;

// Find the SALESFORCE_ORGS section
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  
  if (line.startsWith('SALESFORCE_ORGS=')) {
    salesforceOrgsStart = i;
    console.log(`📍 Found SALESFORCE_ORGS start at line ${i + 1}`);
  }
  
  // Look for the closing brace of the JSON
  if (salesforceOrgsStart !== -1 && line === '}' && salesforceOrgsEnd === -1) {
    salesforceOrgsEnd = i;
    console.log(`📍 Found SALESFORCE_ORGS end at line ${i + 1}`);
    break;
  }
}

if (salesforceOrgsStart === -1 || salesforceOrgsEnd === -1) {
  console.log('❌ Could not find complete SALESFORCE_ORGS section');
  process.exit(1);
}

// Extract the JSON content
let jsonContent = '';
for (let i = salesforceOrgsStart; i <= salesforceOrgsEnd; i++) {
  const line = lines[i];
  if (i === salesforceOrgsStart) {
    // First line: get everything after SALESFORCE_ORGS=
    jsonContent += line.substring(line.indexOf('=') + 1);
  } else {
    // Subsequent lines: get the whole line
    jsonContent += line;
  }
}

console.log('🔍 Extracted JSON content:');
console.log(jsonContent.substring(0, 200) + '...');

try {
  // Parse the JSON to validate it
  const parsedJson = JSON.parse(jsonContent);
  console.log('✅ JSON is valid!');
  
  // Convert to single line (minified)
  const minifiedJson = JSON.stringify(parsedJson);
  console.log(`📏 Minified JSON length: ${minifiedJson.length} characters`);
  
  // Create backup
  fs.writeFileSync(envFilePath + '.backup', envContent);
  console.log('💾 Created backup: .env.backup');
  
  // Create new lines array
  const newLines = [...lines];
  
  // Remove the old multi-line SALESFORCE_ORGS
  newLines.splice(salesforceOrgsStart, (salesforceOrgsEnd - salesforceOrgsStart + 1));
  
  // Insert the new single-line SALESFORCE_ORGS
  newLines.splice(salesforceOrgsStart, 0, `SALESFORCE_ORGS=${minifiedJson}`);
  
  // Write back to file
  const newContent = newLines.join('\n');
  fs.writeFileSync(envFilePath, newContent);
  
  console.log('✅ Successfully converted SALESFORCE_ORGS to single line!');
  console.log('🎉 Your .env file has been fixed!');
  
  // Show the new line
  console.log('\n📝 New SALESFORCE_ORGS line:');
  console.log(`SALESFORCE_ORGS=${minifiedJson.substring(0, 100)}...`);
  
} catch (error) {
  console.log('❌ Error parsing JSON:', error.message);
  console.log('💡 Your JSON has syntax errors. Please check:');
  console.log('   - All quotes are properly closed');
  console.log('   - No trailing commas');
  console.log('   - All braces and brackets match');
  process.exit(1);
}
