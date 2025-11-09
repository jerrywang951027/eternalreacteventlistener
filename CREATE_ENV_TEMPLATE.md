# Quick .env Setup Guide

## Step 1: Create your .env file

Copy and paste this template into a new `.env` file in the project root:

```bash
# Session Configuration
SESSION_SECRET=your-random-secret-key-here
NODE_ENV=development
PORT=15000
CLIENT_PORT=3000
APP_URL=http://localhost:3000

# IMPORTANT: This MUST be a single line JSON string (no line breaks!)
SALESFORCE_ORGS={"org1":{"name":"8x8-jinwangdev8","clientId":"REPLACE_WITH_YOUR_CLIENT_ID_1","clientSecret":"REPLACE_WITH_YOUR_CLIENT_SECRET_1","url":"https://8x82--jinwandev8.sandbox.my.salesforce.com"},"org2":{"name":"8x8-devMNew","clientId":"REPLACE_WITH_YOUR_CLIENT_ID_2","clientSecret":"REPLACE_WITH_YOUR_CLIENT_SECRET_2","url":"https://8x82--devmnew.sandbox.my.salesforce.com"}}

# Legacy fallback (optional)
SALESFORCE_CLIENT_ID=fallback-client-id
SALESFORCE_CLIENT_SECRET=fallback-client-secret
SALESFORCE_REDIRECT_URI=http://localhost:15000/api/auth/salesforce/callback
```

## Step 2: Replace the placeholders

Replace these values with your actual Salesforce Connected App credentials:
- `REPLACE_WITH_YOUR_CLIENT_ID_1`
- `REPLACE_WITH_YOUR_CLIENT_SECRET_1`
- `REPLACE_WITH_YOUR_CLIENT_ID_2` 
- `REPLACE_WITH_YOUR_CLIENT_SECRET_2`

## Step 3: Update org details

Modify the org configurations to match your actual Salesforce orgs:
- Change `"name"` values to your org display names
- Update `"url"` values to your actual Salesforce domains

## JSON Format Helper

If you need to add more orgs or modify the JSON, use this template structure:

```json
{
  "orgKey1": {
    "name": "Display Name",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret", 
    "url": "https://your-org-domain.my.salesforce.com"
  },
  "orgKey2": {
    "name": "Another Org Name",
    "clientId": "another-client-id",
    "clientSecret": "another-client-secret",
    "url": "https://another-domain.my.salesforce.com"
  }
}
```

**Then convert it to a single line** by removing all spaces and line breaks:
```bash
SALESFORCE_ORGS={"orgKey1":{"name":"Display Name","clientId":"your-client-id","clientSecret":"your-client-secret","url":"https://your-org-domain.my.salesforce.com"},"orgKey2":{"name":"Another Org Name","clientId":"another-client-id","clientSecret":"another-client-secret","url":"https://another-domain.my.salesforce.com"}}
```

## Troubleshooting

**JSON parsing errors?**
- Ensure no line breaks in the SALESFORCE_ORGS value
- Check that all quotes are properly escaped
- Validate your JSON using an online JSON validator first

**No orgs showing in dropdown?**
- Check server console for error messages
- Verify all required fields are present (name, clientId, clientSecret, url)
- Ensure your .env file is in the correct location (project root)

**Login failing?**
- Verify your clientId and clientSecret are correct
- Check that your Connected App callback URL matches: `http://localhost:15000/api/auth/salesforce/callback`
