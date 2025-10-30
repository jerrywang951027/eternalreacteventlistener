# Data Cloud Setup Guide

## Overview
The Data Cloud Query feature uses a two-step authentication process to access Salesforce Data Cloud.

## Authentication Flow

### Step 1: Get Temporary Salesforce Core Access Token
- Uses **Client Credentials Grant Type**
- Credentials: `dataCloudClientId` and `dataCloudClientSecret` from org configuration
- Endpoint: `${instanceUrl}/services/oauth2/token`

### Step 2: Exchange for Data Cloud Access Token
- Uses the temporary token from Step 1
- Endpoint: `${instanceUrl}/services/a360/token`
- Returns Data Cloud tenant URL and access token

## Configuration Steps

### 1. Add Data Cloud Credentials to Your Org

You need to add three fields to your org configuration:

1. **dataCloud** (boolean) - Set to `true` to enable the Data Cloud Query tab
2. **dataCloudClientId** (string) - Client ID for Data Cloud authentication
3. **dataCloudClientSecret** (string) - Client Secret for Data Cloud authentication

### 2. Using Admin Console (Recommended)

1. Log in to your application
2. Navigate to **Admin Console** → **Org Management** → **Manage All Orgs**
3. Select the org you want to configure
4. Click **Edit**
5. Add the following fields:
   - Click **Add Field**
   - Field name: `dataCloud`
   - Value: `true`
   - Click **Add Field** again
   - Field name: `dataCloudClientId`
   - Value: `<your-data-cloud-client-id>`
   - Click **Add Field** again
   - Field name: `dataCloudClientSecret`
   - Value: `<your-data-cloud-client-secret>`
6. Click **Save**
7. **Restart the server**

### 3. Directly Edit .env File

Edit `server/.env` file and update the `SALESFORCE_ORGS` JSON:

```json
[
  {
    "name": "My Org",
    "clientId": "3MVG9...",
    "clientSecret": "ABC123...",
    "url": "https://myorg.my.salesforce.com",
    "agentId": "0XxHo0000006y38KAA",
    "agentType": "ASA",
    "orgId": "00D5e0000008cWEEAY",
    "oAuthType": "authorizationCode",
    "dataCloud": true,
    "dataCloudClientId": "3MVG9...",
    "dataCloudClientSecret": "DEF456..."
  }
]
```

## Usage

### 1. Connect to Data Cloud

1. Log in to an org with `dataCloud: true`
2. Navigate to the **Data Cloud Query** tab
3. Click **Connect DataCloud** button
4. Once connected, the SQL Query Editor and Query Result sections will be enabled

### 2. Execute Queries

1. Enter your SQL query in the **SQL Query Editor**
2. Click **Execute Query**
3. Results will be displayed in the **Query Result** section with:
   - Query metadata (Query ID, row count, execution time)
   - Dynamic table with columns ordered by metadata
   - Multi-line text fields displayed properly

## Server Logs

When you click "Connect DataCloud", the server will log detailed information about both authentication steps:

```
🌥️ [DATACLOUD] ========== STEP 1: Getting Temporary Core Access Token ==========
🌥️ [DATACLOUD] Instance URL: https://myorg.my.salesforce.com
🌥️ [DATACLOUD] Client ID: 3MVG9...
🌥️ [DATACLOUD] STEP 1 REQUEST:
  URL: https://myorg.my.salesforce.com/services/oauth2/token
  Method: POST
  Headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  Body: { grant_type: 'client_credentials', client_id: '3MVG9...', client_secret: '***REDACTED***' }
🌥️ [DATACLOUD] STEP 1 RESPONSE:
  Status: 200
  Data: { access_token: '00D...', ... }
✅ [DATACLOUD] STEP 1 COMPLETE: Temporary core access token retrieved

🌥️ [DATACLOUD] ========== STEP 2: Getting Data Cloud Access Token ==========
🌥️ [DATACLOUD] STEP 2 REQUEST:
  URL: https://myorg.my.salesforce.com/services/a360/token
  Method: POST
  Headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  Body: { grant_type: 'urn:salesforce:grant-type:external:cdp', subject_token: '00D...', ... }
🌥️ [DATACLOUD] STEP 2 RESPONSE:
  Status: 200
  Data: { access_token: 'xxx...', instance_url: 'gq4d8nb-gfswcnjsgy3dcnzxg4.c360a.salesforce.com', ... }
✅ [DATACLOUD] STEP 2 COMPLETE: Data Cloud access token retrieved
✅ [DATACLOUD] Data Cloud tenant URL: gq4d8nb-gfswcnjsgy3dcnzxg4.c360a.salesforce.com
✅ [DATACLOUD] ========== CONNECTION SUCCESSFUL ==========
```

## Troubleshooting

### "Data Cloud credentials not configured"
- Ensure `dataCloudClientId` and `dataCloudClientSecret` are added to your org configuration
- Restart the server after updating configuration

### "Org configuration not found"
- Verify the org name matches exactly (case-insensitive)
- Check server logs for the org name being searched

### "Failed to retrieve temporary core access token"
- Verify `dataCloudClientId` and `dataCloudClientSecret` are correct
- Ensure the Connected App has proper permissions
- Check server logs for detailed error information

### "Invalid response from Data Cloud token endpoint"
- The temporary token may not have permissions to access Data Cloud
- Verify the Connected App is configured for Data Cloud access
- Check server logs for the full response

## Security Notes

- `dataCloudClientSecret` is stored in the backend but **not** displayed in the Admin Console UI
- Access tokens are masked in server logs (only first 20 characters shown)
- Session-based token storage with automatic cleanup
- All API requests require authentication

## API Endpoints

- **POST** `/api/datacloud/connect` - Connect to Data Cloud (two-step auth)
- **POST** `/api/datacloud/query` - Execute SQL query
- **GET** `/api/datacloud/status` - Get connection status
- **POST** `/api/datacloud/disconnect` - Disconnect from Data Cloud

