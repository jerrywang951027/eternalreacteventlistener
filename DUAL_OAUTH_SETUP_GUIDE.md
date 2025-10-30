# Dual OAuth Flow Setup Guide

## Overview
Your application now supports **TWO OAuth flows**:
1. **Authorization Code Grant** (default) - Interactive user login
2. **Client Credentials** (username-password) - Direct server-to-server authentication

## New Configuration Field: `oAuthType`

Each org now has an `oAuthType` field that determines which OAuth flow to use:

- `authorizationCode` - User logs in via Salesforce login page (default)
- `clientCredential` - Direct login using username/password (no user interaction)

## Configuration Structure

### Authorization Code Org (Default)
```json
{
  "name": "My Production Org",
  "clientId": "3MVG9...",
  "clientSecret": "D961B407...",
  "url": "https://login.salesforce.com",
  "agentId": "0XxHo0000006y38KAA",
  "agentType": "ASA",
  "orgId": "00D5e0000008cWEEAY",
  "oAuthType": "authorizationCode"
}
```

### Client Credential Org (CommsOnCore20251023)
```json
{
  "name": "CommsOnCore20251023",
  "clientId": "3MVG9Rr0EZ2YOVMb...",
  "clientSecret": "D961B4077C551925...",
  "url": "https://trailsignup-a7c14218a38123.my.salesforce.com",
  "agentId": "0XxHo0000006y38KAA",
  "agentType": "ASA",
  "orgId": "00D5e0000008cWEEAY",
  "oAuthType": "clientCredential",
  "username": "integration.user@example.com",
  "password": "MyPassword123SecurityToken456"
}
```

## How to Configure

### Option 1: Using Admin Console (Recommended)

1. **Log in to your application**
2. **Go to Admin Console → Org Management → Manage All Orgs**
3. **For each org:**
   - Click **Edit**
   - Add field: `oAuthType` = `authorizationCode` (for most orgs)
   - Click **Save**

4. **For CommsOnCore20251023:**
   - Click **Edit**
   - Add field: `oAuthType` = `clientCredential`
   - Add field: `username` = Your Salesforce integration user username
   - Add field: `password` = Your password + security token (concatenated)
   - Click **Save**

5. **Restart the server**

### Option 2: Edit .env File Directly

Edit `server/.env` and update the `SALESFORCE_ORGS` line:

```bash
SALESFORCE_ORGS=[{"name":"rca-ido-20250911","clientId":"...","clientSecret":"...","url":"...","agentId":"...","agentType":"ASA","orgId":"...","oAuthType":"authorizationCode"},{"name":"CommsOnCore20251023","clientId":"...","clientSecret":"...","url":"...","agentId":"...","agentType":"ASA","orgId":"...","oAuthType":"clientCredential","username":"integration.user@example.com","password":"MyPassword123Token456"}]
```

**Important:**
- The `password` field must include the security token appended to the password
- Format: `password` = `YourPassword` + `SecurityToken`
- Example: If password is `MyPass123` and token is `Token456`, set `password` = `MyPass123Token456`
- Restart the server after editing

## Getting Your Security Token

1. Log in to Salesforce as the integration user
2. Go to **Settings** → **Reset My Security Token**
3. Salesforce will email the new token
4. Concatenate password + token (no space or separator)

## How It Works

### Authorization Code Flow (Default)

**Flow:**
```
User Clicks Login → Redirects to Salesforce → User Enters Credentials → 
Salesforce Redirects Back with Code → Server Exchanges Code for Token → 
User Logged In
```

**Backend:** `login.js` - `handleSalesforceLogin()` + `handleSalesforceCallback()`

**Frontend:** Opens Salesforce login in popup, waits for callback

### Client Credentials Flow (CommsOnCore20251023)

**Flow:**
```
User Clicks Login → Server Authenticates with Username/Password → 
Token Returned Immediately → User Logged In (No Redirect)
```

**Backend:** `login.js` - `handleClientCredentialLogin()`

**Uses jsforce username-password OAuth:**
```javascript
const conn = new jsforce.Connection({
  oauth2: { clientId, clientSecret, redirectUri },
  loginUrl: url
});
await conn.login(username, password);
```

**Frontend:** Direct response, no popup needed

## Code Changes Summary

### 1. Backend - envManager.js
- Added `oAuthType`, `username`, `password` fields
- Preserves all fields dynamically
- Default `oAuthType` = `authorizationCode`

### 2. Backend - login.js
- `handleSalesforceLogin()` - Checks `oAuthType` and routes to appropriate flow
- `handleClientCredentialLogin()` - NEW method for client credential flow
- Uses jsforce `conn.login(username, password)` for username-password OAuth

### 3. Frontend - LoginPage.js
- Checks response for `authType: 'clientCredential'`
- If client credential: No popup, direct login
- If authorization code: Opens Salesforce popup (existing flow)

## Security Considerations

### Authorization Code Flow ✅
- ✅ User enters credentials on Salesforce (not your app)
- ✅ Client secret never exposed to browser
- ✅ User-specific permissions apply
- ✅ Recommended for interactive users

### Client Credentials Flow ⚠️
- ⚠️ Username/password stored in server configuration
- ⚠️ All operations run as the integration user
- ⚠️ Integration user permissions apply to all operations
- ⚠️ Use only for trusted server-to-server scenarios

## When to Use Each Flow

### Use Authorization Code (Default) When:
- ✅ Multiple users need to log in
- ✅ User-specific permissions must be enforced
- ✅ User needs to see/approve app access
- ✅ Following security best practices

### Use Client Credentials When:
- ✅ Server-to-server integration
- ✅ Single integration user for all operations
- ✅ No interactive user login needed
- ✅ Background/scheduled processes
- ⚠️ **Use sparingly and securely!**

## Testing

### Test Authorization Code Flow

1. Select any org EXCEPT CommsOnCore20251023
2. Click "🚀 Connect to Salesforce"
3. **Should:** Open Salesforce login popup
4. Enter your Salesforce credentials
5. **Should:** Close popup and log you in

### Test Client Credentials Flow

1. Configure CommsOnCore20251023 with username/password
2. Select "CommsOnCore20251023" from dropdown
3. Click "🚀 Connect to Salesforce"
4. **Should:** NO popup, immediate login
5. **Should:** See "Client credential authentication successful" in console

## Troubleshooting

### Client Credential Login Fails

**Problem:** "Client credential authentication failed: INVALID_LOGIN"

**Solutions:**
1. ✅ Verify username is correct
2. ✅ Verify password includes security token appended
3. ✅ Check if user account is active
4. ✅ Verify user has API Enabled permission
5. ✅ Check IP restrictions in Salesforce
6. ✅ Try resetting security token

### Missing Fields Error

**Problem:** "Client credential flow requires username and password fields"

**Solution:** Add both `username` and `password` fields to org configuration

### Wrong OAuth Flow Used

**Problem:** Popup opens for client credential org

**Solution:** 
1. Check `oAuthType` is set to `clientCredential` (not `authorizationCode`)
2. Restart server after configuration change
3. Clear browser cache

## Connected App Setup

Both OAuth flows require a Connected App in Salesforce:

### For Authorization Code Flow:
1. **Enable OAuth Settings:** ✅ Checked
2. **Callback URL:** `http://localhost:5000/api/auth/salesforce/callback`
3. **OAuth Scopes:**
   - `Access and manage your data (api)`
   - `Perform requests on your behalf at any time (refresh_token, offline_access)`

### For Client Credentials Flow:
1. Same as above, BUT:
2. **Relax IP Restrictions:** Consider relaxing for integration user
3. **User Permissions:** Integration user must have:
   - API Enabled
   - Any required object/field permissions
   - Profile with necessary access

## Example: Complete Configuration

```bash
SALESFORCE_ORGS=[
  {
    "name": "8x8-acceptance",
    "clientId": "3MVG9EJ2FoGDnkgWm2SaIu...",
    "clientSecret": "D9C1A1B531A1BF49113...",
    "url": "https://8x82--aceptncev8.sandbox.my.salesforce.com",
    "agentId": "0XxQZ0000000Ty50AE",
    "agentType": "ASA",
    "orgId": "00DQZ0000000Ty5",
    "oAuthType": "authorizationCode"
  },
  {
    "name": "CommsOnCore20251023",
    "clientId": "3MVG9Rr0EZ2YOVMb4umpU32...",
    "clientSecret": "D961B4077C551925EEB602...",
    "url": "https://trailsignup-a7c14218a38123.my.salesforce.com",
    "agentId": "0XxHo0000006y38KAA",
    "agentType": "AEA",
    "orgId": "00D5e0000008cWEEAY",
    "oAuthType": "clientCredential",
    "username": "integration@commsoncore.com",
    "password": "SecurePass123SecurityToken456"
  }
]
```

## Migration Path

All existing orgs will default to `authorizationCode` if `oAuthType` is not specified. No breaking changes!

### To Add Client Credentials:

1. ✅ Create/identify integration user in Salesforce
2. ✅ Ensure user has API access and necessary permissions
3. ✅ Get security token for the user
4. ✅ Add `oAuthType`, `username`, `password` fields to org config
5. ✅ Restart server
6. ✅ Test login

## Summary

✅ **All existing orgs:** Continue using Authorization Code (no changes needed)  
✅ **CommsOnCore20251023:** Configured with Client Credentials  
✅ **Backward compatible:** Defaults to Authorization Code  
✅ **Secure:** Client credentials stored server-side only  
✅ **Flexible:** Easy to switch between flows per org  

The application now intelligently routes each org to its appropriate OAuth flow based on the `oAuthType` configuration! 🎉


