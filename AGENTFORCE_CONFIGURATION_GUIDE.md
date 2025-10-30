# Agentforce Configuration Guide

## Overview
This document describes the new Agentforce configuration options and how to use them.

## New Configuration Fields

### 1. `agentType` - Controls bypassUser Behavior
Determines the type of agent and how session requests are handled.

**Values:**
- `AEA` (Agent Embedded Automation) → `bypassUser: false`
- `ASA` (Agent Service Agent) → `bypassUser: true` (default)

**Example:**
```json
{
  "name": "My Org",
  "clientId": "...",
  "clientSecret": "...",
  "url": "https://...",
  "agentId": "0XxHo0000006y38KAA",
  "agentType": "AEA"
}
```

### 2. `orgId` - Salesforce Organization ID
Used to construct the `x-sfdc-tenant-id` header for API requests.

**Format:** 15 or 18 character Salesforce Org ID (e.g., `00DRL00000BrEq32AF`)

**How it's used:** The orgId is appended to create the tenant ID: `core/prod/{orgId}`

**Example:**
```json
{
  "name": "My Org",
  "clientId": "...",
  "clientSecret": "...",
  "url": "https://...",
  "agentId": "0XxHo0000006y38KAA",
  "agentType": "ASA",
  "orgId": "00D5e0000008cWEEAY"
}
```

## Default Values
- If `agentType` is not specified, it defaults to `ASA` (bypassUser = true)
- If `orgId` is not specified, it defaults to `00DRL00000BrEq32AF`

## How to Configure

### Method 1: Using Admin Console (Recommended)

1. Log in to your application
2. Navigate to the **Admin Console** tab
3. Select **Org Management** → **Manage All Orgs**
4. Click on the org you want to configure
5. Click **Edit**
6. Add new fields:
   - Click **Add Field**
   - Enter field name: `agentType`
   - Set value: `AEA` or `ASA`
   - Click **Add Field** again
   - Enter field name: `orgId`
   - Set value: Your Salesforce Org ID (15 or 18 characters)
7. Click **Save**
8. **Restart the server** for changes to take effect

### Method 2: Directly Edit .env File

Edit `server/.env` file and update the `SALESFORCE_ORGS` JSON array:

```bash
SALESFORCE_ORGS=[{"name":"My Org","clientId":"...","clientSecret":"...","url":"https://...","agentId":"0XxHo0000006y38KAA","agentType":"AEA","orgId":"00D5e0000008cWEEAY"}]
```

**Important:** 
- The JSON must be on a single line
- Restart the server after editing

## Implementation Details

### Backend Changes

1. **envManager.js**
   - Now preserves ALL fields dynamically when parsing and saving
   - No longer hardcodes which fields to save
   - Custom fields added through UI will persist

2. **agentforce.js - startAgentSession()**
   - Reads `agentType` from org configuration
   - Determines `bypassUser` based on agent type:
     ```javascript
     const bypassUser = agentType.toUpperCase() === 'AEA' ? false : true;
     ```
   - Reads `orgId` from org configuration
   - Constructs tenant ID header:
     ```javascript
     const tenantId = `core/prod/${orgId}`;
     ```
   - Logs all configuration for debugging

3. **login.js**
   - Already preserves all fields from environment variables
   - No changes needed

## Verification

After configuring and restarting the server, check the server logs when starting an Agentforce session:

```
🤖 [AGENTFORCE] Agent Type: AEA, bypassUser: false
📤 [AGENTFORCE] Starting agentforce session with agent 0XxHo0000006y38KAA for org My Org
🌐 [AGENTFORCE] Using endpoint: https://...
🔑 [AGENTFORCE] Using tenant ID: core/prod/00D5e0000008cWEEAY
⚙️  [AGENTFORCE] Request payload: {...}
```

## Troubleshooting

### Fields not persisting after adding through Admin Console

**Problem:** Before this update, only hardcoded fields (name, clientId, clientSecret, url, agentId) were saved.

**Solution:** This has been fixed! Now ALL fields are saved dynamically. Just make sure to:
1. Add the fields through Admin Console
2. Click Save
3. Restart the server

### Agent session fails with authentication error

**Problem:** Wrong orgId or tenant ID format.

**Solution:** 
- Verify orgId is a valid 15 or 18 character Salesforce Org ID
- Check server logs for the constructed tenant ID
- Ensure the format is `core/prod/{orgId}`

### bypassUser not working as expected

**Problem:** Agent type not being recognized.

**Solution:**
- Verify `agentType` field is set to exactly `AEA` or `ASA` (case-insensitive)
- Check server logs for "Agent Type" message
- If not set, system defaults to ASA (bypassUser = true)

## Finding Your Salesforce Org ID

1. Log in to your Salesforce org
2. Go to **Setup** → **Company Information**
3. Look for **Salesforce.com Organization ID**
4. Copy the 15 or 18 character ID

## Example Complete Configuration

```json
{
  "name": "Production Org",
  "clientId": "3MVG9...",
  "clientSecret": "D961B407...",
  "url": "https://trailsignup-a7c14218a38123.my.salesforce.com",
  "agentId": "0XxHo0000006y38KAA",
  "agentType": "AEA",
  "orgId": "00D5e0000008cWEEAY"
}
```

With this configuration, when starting an Agentforce session:
- `bypassUser` will be `false` (because agentType is AEA)
- `x-sfdc-tenant-id` header will be `core/prod/00D5e0000008cWEEAY`

