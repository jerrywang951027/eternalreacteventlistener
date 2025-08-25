#!/usr/bin/env node

/**
 * Script to convert multi-line JSON in .env file to single line
 * Usage: node fix-env-json.js
 */

const fs = require('fs');
const path = require('path');

const envFilePath = path.join(__dirname, '.env');

console.log('🔧 Fixing .env SALESFORCE_ORGS JSON format...');

// Check if .env file exists
if (!fs.existsSync(envFilePath)) {
  console.log('❌ .env file not found. Creating template...');
  
  const template = `# Session Configuration
SESSION_SECRET=your-random-secret-key-here
NODE_ENV=development
PORT=5000
CLIENT_PORT=3000
APP_URL=http://localhost:3000

# SALESFORCE_ORGS - Replace with your actual org configurations
SALESFORCE_ORGS={"org1":{"name":"8x8-jinwangdev8","clientId":"REPLACE_WITH_YOUR_CLIENT_ID_1","clientSecret":"REPLACE_WITH_YOUR_CLIENT_SECRET_1","url":"https://8x82--jinwandev8.sandbox.my.salesforce.com"},"org2":{"name":"8x8-devMNew","clientId":"REPLACE_WITH_YOUR_CLIENT_ID_2","clientSecret":"REPLACE_WITH_YOUR_CLIENT_SECRET_2","url":"https://8x82--devmnew.sandbox.my.salesforce.com"}}

# Legacy fallback (optional)
SALESFORCE_CLIENT_ID=fallback-client-id
SALESFORCE_CLIENT_SECRET=fallback-client-secret
SALESFORCE_REDIRECT_URI=http://localhost:5000/api/auth/salesforce/callback`;

  fs.writeFileSync(envFilePath, template);
  console.log('✅ Created .env template file');
  console.log('📝 Please update the SALESFORCE_ORGS values with your actual credentials');
  process.exit(0);
}

// Read the current .env file
const envContent = fs.readFileSync(envFilePath, 'utf8');
console.log('📖 Reading current .env file...');

// Find SALESFORCE_ORGS line(s)
const lines = envContent.split('\n');
let salesforceOrgsStart = -1;
let salesforceOrgsEnd = -1;
let inJsonBlock = false;
let braceCount = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  
  // Skip comments and empty lines
  if (line.startsWith('#') || line === '') continue;
  
  // Check if this line starts with SALESFORCE_ORGS=
  if (line.startsWith('SALESFORCE_ORGS=')) {
    salesforceOrgsStart = i;
    
    // Get the JSON part (everything after =)
    const jsonPart = line.substring('SALESFORCE_ORGS='.length);
    
    // Count braces to see if this is complete JSON on one line
    for (const char of jsonPart) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
    }
    
    if (braceCount === 0) {
      // JSON is complete on this line
      salesforceOrgsEnd = i;
      break;
    } else {
      // Multi-line JSON starts here
      inJsonBlock = true;
      continue;
    }
  }
  
  // If we're in a JSON block, continue counting braces
  if (inJsonBlock) {
    for (const char of line) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
    }
    
    if (braceCount === 0) {
      // JSON block ends here
      salesforceOrgsEnd = i;
      break;
    }
  }
}

if (salesforceOrgsStart === -1) {
  console.log('❌ SALESFORCE_ORGS not found in .env file');
  process.exit(1);
}

console.log(`📍 Found SALESFORCE_ORGS from line ${salesforceOrgsStart + 1} to ${salesforceOrgsEnd + 1}`);

// Extract the multi-line JSON
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
console.log(jsonContent.substring(0, 100) + '...');

// Try to parse and minify the JSON
try {
  const parsedJson = JSON.parse(jsonContent);
  const minifiedJson = JSON.stringify(parsedJson);
  
  console.log('✅ JSON is valid, converting to single line...');
  
  // Replace the multi-line SALESFORCE_ORGS with single line
  const newLines = [...lines];
  
  // Remove the old SALESFORCE_ORGS lines
  newLines.splice(salesforceOrgsStart, (salesforceOrgsEnd - salesforceOrgsStart + 1));
  
  // Insert the new single-line SALESFORCE_ORGS
  newLines.splice(salesforceOrgsStart, 0, `SALESFORCE_ORGS=${minifiedJson}`);
  
  // Write the updated content back to .env
  const newEnvContent = newLines.join('\n');
  
  // Create backup first
  fs.writeFileSync(envFilePath + '.backup', envContent);
  console.log('💾 Created backup: .env.backup');
  
  // Write the new content
  fs.writeFileSync(envFilePath, newEnvContent);
  console.log('✅ Successfully converted SALESFORCE_ORGS to single line!');
  console.log(`📏 JSON length: ${minifiedJson.length} characters`);
  
} catch (error) {
  console.log('❌ Error parsing JSON:', error.message);
  console.log('💡 Please check your JSON syntax');
  process.exit(1);
}
