# Salesforce OAuth - Client Credentials Clarification

## The Problem

Standard OAuth 2.0 supports **Client Credentials Grant**, which allows server-to-server authentication using only:
- `client_id`
- `client_secret`

**However, Salesforce does NOT support this grant type!**

## What Salesforce Actually Supports

### 1. Authorization Code Grant (Web Server Flow) ✅
**What we currently use for most orgs**
- User logs in interactively
- User authorizes the app
- Requires: clientId, clientSecret, user interaction
- **Best for:** Interactive web applications

### 2. Username-Password Flow (Resource Owner Password Credentials) ⚠️
**What we implemented for "clientCredential"**
- Direct authentication with username/password
- Requires: clientId, clientSecret, username, password + security token
- **Best for:** Trusted applications where you own the credentials
- **Drawback:** Requires storing password

### 3. JWT Bearer Token Flow (Server-to-Server) 🔒
**True server-to-server without passwords!**
- Uses digital certificate for authentication
- Requires: clientId, certificate/private key, username (for context, no password)
- **Best for:** Server-to-server integrations
- **Benefit:** No password storage needed!

### 4. Refresh Token Flow
- Uses refresh token to get new access token
- Requires: Already having a valid refresh token
- **Best for:** Maintaining long-lived sessions

## Why Username + Password is Required

For Salesforce "client credentials" (username-password flow), you need:

```
POST https://login.salesforce.com/services/oauth2/token
grant_type=password
client_id=YOUR_CLIENT_ID
client_secret=YOUR_CLIENT_SECRET
username=YOUR_USERNAME              ← REQUIRED
password=YOUR_PASSWORD_AND_TOKEN    ← REQUIRED
```

**You cannot omit username and password.** Salesforce requires them to establish the user context for the session.

## Alternative: JWT Bearer Token Flow

If you want **server-to-server authentication WITHOUT storing passwords**, use JWT Bearer Token Flow:

### Requirements:
1. ✅ Connected App with "Use Digital Signatures" enabled
2. ✅ Certificate uploaded to Connected App
3. ✅ Private key (.key file) stored securely on server
4. ✅ Username of the Salesforce user (for context)
5. ❌ NO password needed!

### JWT Flow Process:
```javascript
// Create JWT assertion
const jwt = createJWT({
  iss: clientId,           // Your client ID
  sub: username,           // Salesforce username (for context)
  aud: loginUrl,           // https://login.salesforce.com
  exp: expirationTime
});

// Sign with private key
const signedJWT = sign(jwt, privateKey);

// Exchange JWT for access token
POST https://login.salesforce.com/services/oauth2/token
grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
assertion=SIGNED_JWT_TOKEN
```

**No password needed!** Authentication is based on the certificate.

## Recommendations

### For CommsOnCore20251023, you have 3 options:

#### Option 1: Username-Password Flow (Current Implementation) ⚠️
**Pros:**
- ✅ Simple to set up
- ✅ Works immediately
- ✅ Already implemented

**Cons:**
- ❌ Must store password + security token
- ❌ Security token changes when reset
- ❌ Password must be updated if changed
- ❌ Less secure than JWT

**Configuration:**
```json
{
  "name": "CommsOnCore20251023",
  "oAuthType": "clientCredential",
  "username": "integration@example.com",
  "password": "MyPassword123Token456"
}
```

#### Option 2: JWT Bearer Token Flow (Recommended for Production) 🔒
**Pros:**
- ✅ More secure (certificate-based)
- ✅ No password storage
- ✅ Better for server-to-server
- ✅ Industry best practice

**Cons:**
- ⚠️ More complex setup
- ⚠️ Requires certificate generation
- ⚠️ Need to upload cert to Salesforce

**Configuration:**
```json
{
  "name": "CommsOnCore20251023",
  "oAuthType": "jwtBearer",
  "username": "integration@example.com",
  "privateKeyPath": "./certs/salesforce-private.key",
  "audience": "https://trailsignup-a7c14218a38123.my.salesforce.com"
}
```

#### Option 3: Stay with Authorization Code (Keep Current) ✅
**Pros:**
- ✅ No password/certificate storage
- ✅ Most secure for interactive use
- ✅ User explicitly authorizes

**Cons:**
- ⚠️ Requires user interaction (popup)
- ⚠️ Not suitable for automation

## What You Should Do

### If you want NO password storage:

**You MUST use JWT Bearer Token Flow**, which requires:

1. **Generate a certificate:**
   ```bash
   # Generate private key
   openssl genrsa -out salesforce-private.key 2048
   
   # Generate certificate signing request
   openssl req -new -key salesforce-private.key -out salesforce.csr
   
   # Generate self-signed certificate
   openssl x509 -req -days 365 -in salesforce.csr -signkey salesforce-private.key -out salesforce.crt
   ```

2. **Upload certificate to Salesforce:**
   - Setup → App Manager → Your Connected App
   - Edit → Use Digital Signatures
   - Upload `salesforce.crt`
   - Save

3. **Configure org with JWT:**
   ```json
   {
     "oAuthType": "jwtBearer",
     "username": "integration@example.com",
     "privateKeyPath": "./certs/salesforce-private.key"
   }
   ```

4. **I can implement JWT Bearer Token Flow** if you want this approach

### If password storage is acceptable:

Keep the current username-password flow implementation. It works, just requires storing credentials.

## Summary Table

| Grant Type | ClientId | ClientSecret | Username | Password | Certificate | User Popup |
|------------|----------|--------------|----------|----------|-------------|------------|
| **Authorization Code** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Username-Password** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **JWT Bearer** | ✅ | ❌ | ✅* | ❌ | ✅ | ❌ |

*Username for context only, not for authentication

## Decision Point

**What would you like to do?**

1. **Keep username-password flow** (current) - Simple but requires password
2. **Implement JWT Bearer Token flow** - More secure, no password, but needs certificate setup
3. **Revert to Authorization Code** - Most secure for interactive users

Let me know and I can implement whichever approach you prefer!


