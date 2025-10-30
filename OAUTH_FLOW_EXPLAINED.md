# OAuth Flow in Salesforce Explorer Application

## Grant Type: **Authorization Code Grant** (Web Server Flow)

Your application uses the **OAuth 2.0 Authorization Code Grant**, which is Salesforce's recommended flow for web applications with a secure backend.

## Why Authorization Code Grant?

✅ **User Context** - Operations are performed in the context of the authenticated user  
✅ **User Permissions** - Respects the user's permissions and sharing rules  
✅ **Refresh Tokens** - Can obtain refresh tokens for long-term access  
✅ **Secure** - Client secret is stored securely on the server, never exposed to browser  
✅ **Interactive** - User explicitly authorizes the application  

## OAuth Flow Step-by-Step

### Step 1: User Initiates Login
**Location:** `server/modules/login.js` - `handleSalesforceLogin()` (lines 148-225)

```javascript
// Create OAuth2 connection with your Connected App credentials
const oauth2 = new jsforce.OAuth2({
  clientId,           // From your org configuration
  clientSecret,       // From your org configuration
  redirectUri: 'http://localhost:5000/api/auth/salesforce/callback',
  loginUrl: loginUrl  // e.g., https://login.salesforce.com
});

// Generate authorization URL
const authUrl = oauth2.getAuthorizationUrl({
  scope: 'api',
  state: 'mystate'
});

// Return URL to frontend
res.json({ success: true, authUrl });
```

**What happens:**
- Server creates an OAuth2 object with your Connected App settings
- Generates an authorization URL pointing to Salesforce
- Sends this URL back to the frontend
- Frontend redirects user to this URL

**Example URL generated:**
```
https://login.salesforce.com/services/oauth2/authorize?
  response_type=code&
  client_id=3MVG9...&
  redirect_uri=http://localhost:5000/api/auth/salesforce/callback&
  scope=api&
  state=mystate
```

### Step 2: User Authenticates with Salesforce
**Location:** Salesforce Login Page (external)

- User is redirected to Salesforce
- User enters their Salesforce username and password
- User may see "Allow Access?" page (first time)
- User authorizes the application

**This is the key difference from Client Credentials:**  
The actual user logs in with their own credentials, not the app's credentials.

### Step 3: Salesforce Redirects Back with Code
**Location:** Callback URL

After successful authentication, Salesforce redirects to:
```
http://localhost:5000/api/auth/salesforce/callback?code=AUTHORIZATION_CODE&state=mystate
```

The `code` parameter is the **authorization code** - a short-lived (typically 15 minutes) code that can be exchanged for tokens.

### Step 4: Server Exchanges Code for Tokens
**Location:** `server/modules/login.js` - `handleSalesforceCallback()` (lines 249-305)

```javascript
// Extract the authorization code from query parameters
const { code, state } = req.query;

// Create connection with OAuth2 settings
const conn = new jsforce.Connection({
  oauth2: req.session.oauth2
});

// Exchange authorization code for access token and refresh token
const userInfo = await conn.authorize(code);

// Store tokens in session
req.session.salesforce = {
  accessToken: conn.accessToken,      // For API calls
  refreshToken: conn.refreshToken,    // For getting new access tokens
  instanceUrl: conn.instanceUrl,      // User's Salesforce instance
  organizationId: userInfo.organizationId,
  userId: userInfo.id,
  // ... other user details
};
```

**Behind the scenes, jsforce makes this request:**
```http
POST https://login.salesforce.com/services/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=AUTHORIZATION_CODE&
client_id=3MVG9...&
client_secret=YOUR_CLIENT_SECRET&
redirect_uri=http://localhost:5000/api/auth/salesforce/callback
```

**Salesforce responds with:**
```json
{
  "access_token": "00D5e0000008cWEE!AR8AQP...",
  "refresh_token": "5Aep861KIwKdekr9yGfg...",
  "instance_url": "https://yourinstance.salesforce.com",
  "id": "https://login.salesforce.com/id/00D5e0000008cWEEAY/0055e000000FvI3AAK",
  "token_type": "Bearer",
  "issued_at": "1730140234567",
  "signature": "..."
}
```

### Step 5: Application Uses Access Token
**Location:** Throughout the application

All subsequent API calls use the access token:

```javascript
// In agentforce.js, platform events, etc.
const accessToken = req.session.salesforce.accessToken;

const response = await axios.post(
  'https://api.salesforce.com/einstein/ai-agent/v1/agents/{agentId}/sessions',
  requestPayload,
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  }
);
```

## Comparison: Authorization Code vs Client Credentials

### Authorization Code Grant (What You're Using) ✅

| Aspect | Details |
|--------|---------|
| **User Interaction** | Required - user logs in to Salesforce |
| **Context** | Operations run as the authenticated user |
| **Permissions** | User's permissions and sharing rules apply |
| **Use Case** | Web applications acting on behalf of users |
| **Tokens Obtained** | Access token + Refresh token |
| **Security** | Client secret stored on server only |
| **Example** | Your Salesforce Explorer app |

**Flow:**
```
User → App → Salesforce Login Page → User Authenticates → 
Salesforce Redirects with Code → App Exchanges Code for Tokens → 
App Uses Tokens on Behalf of User
```

### Client Credentials Grant (NOT Used) ❌

| Aspect | Details |
|--------|---------|
| **User Interaction** | None - app authenticates as itself |
| **Context** | Operations run as the integration user/app |
| **Permissions** | App's permissions, not individual users |
| **Use Case** | Server-to-server integrations, background jobs |
| **Tokens Obtained** | Access token only (no refresh token) |
| **Security** | Direct exchange of credentials for token |
| **Example** | ETL jobs, scheduled batch processes |

**Flow:**
```
App → Sends Client ID + Client Secret → 
Receives Access Token → Uses Token for API Calls
(No user involvement)
```

## Why Not Client Credentials?

Your application **cannot** use Client Credentials because:

1. **Salesforce doesn't support it for standard OAuth**  
   Salesforce only supports:
   - Authorization Code (Web Server)
   - User-Agent Flow (for mobile/JavaScript apps)
   - Username-Password Flow (deprecated, not recommended)
   - JWT Bearer Token Flow (for server-to-server)

2. **You need user context**  
   Your app shows user-specific data, respects permissions, and performs actions on behalf of users

3. **Interactive features**  
   Features like Agentforce chat, platform events, and SObject queries need to run as the logged-in user

## Security Considerations

### What's Secure ✅

- **Client Secret** is stored in `.env` on server, never sent to browser
- **Authorization Code** is single-use and short-lived (15 min)
- **Access Token** is stored in server-side session, not localStorage
- **HTTPS** should be used in production
- **State Parameter** prevents CSRF attacks

### What Gets Stored Where

**Server-side session (secure):**
```javascript
req.session.salesforce = {
  accessToken: "...",      // Never sent to browser
  refreshToken: "...",     // Never sent to browser
  instanceUrl: "...",
  userId: "...",
  organizationId: "..."
}
```

**Browser (cookies):**
- Session ID cookie only
- No tokens or secrets

## Token Lifecycle

### Access Token
- **Lifespan:** Typically 2 hours (configurable in Salesforce)
- **Usage:** Included in Authorization header for all API calls
- **Refresh:** Can be refreshed using refresh token

### Refresh Token
- **Lifespan:** Typically 90 days (configurable in Salesforce)
- **Usage:** Used to obtain new access tokens without re-authentication
- **Note:** Your app currently doesn't implement refresh token logic (tokens expire after 2 hours)

## Recommended: Implement Token Refresh

Currently, users must re-login every ~2 hours. You should implement refresh token logic:

```javascript
async refreshAccessToken(refreshToken, oauth2) {
  const conn = new jsforce.Connection({
    oauth2: oauth2,
    refreshToken: refreshToken
  });
  
  // This will automatically refresh the token
  await conn.refreshAccessToken();
  
  return {
    accessToken: conn.accessToken,
    instanceUrl: conn.instanceUrl
  };
}
```

## Connected App Configuration

Your Connected Apps (one per org) must be configured with:

1. **Enable OAuth Settings:** ✅ Checked
2. **Callback URL:** `http://localhost:5000/api/auth/salesforce/callback`
3. **OAuth Scopes:**
   - `api` - Access and manage your data (currently using this)
   - Optional: `refresh_token offline_access` - For refresh tokens
   - Optional: `web` - For Visualforce pages
4. **Consumer Key:** → Your `clientId` in `.env`
5. **Consumer Secret:** → Your `clientSecret` in `.env`

## Summary

**Your Application Uses:**
- ✅ **OAuth 2.0 Authorization Code Grant** (Web Server Flow)
- ✅ User authenticates with their Salesforce credentials
- ✅ App receives authorization code
- ✅ Server exchanges code for access token + refresh token
- ✅ All API calls use the user's access token
- ✅ Operations run in user's context with user's permissions

**Your Application Does NOT Use:**
- ❌ Client Credentials Grant
- ❌ Direct username/password authentication
- ❌ Server-to-server JWT flow

This is the **correct and recommended approach** for interactive web applications that need to access Salesforce data on behalf of users! 🎉


