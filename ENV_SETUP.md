# Environment Configuration for Multi-Org Support

## .env File Setup

Create a `.env` file in the root directory with the following structure:

```bash
# Session Configuration
SESSION_SECRET=your-secret-key-here
NODE_ENV=development
PORT=15000
CLIENT_PORT=3000
APP_URL=http://localhost:3000

# Predefined Salesforce Organizations (MUST be single line JSON)
SALESFORCE_ORGS={"org1":{"name":"8x8-jinwangdev8","clientId":"your-client-id-1","clientSecret":"your-client-secret-1","url":"https://8x82--jinwandev8.sandbox.my.salesforce.com"},"org2":{"name":"8x8-devMNew","clientId":"your-client-id-2","clientSecret":"your-client-secret-2","url":"https://8x82--devmnew.sandbox.my.salesforce.com"},"production":{"name":"Production Org","clientId":"your-production-client-id","clientSecret":"your-production-client-secret","url":"https://login.salesforce.com"}}

# Legacy fallback (will be deprecated)
SALESFORCE_CLIENT_ID=fallback-client-id
SALESFORCE_CLIENT_SECRET=fallback-client-secret
SALESFORCE_REDIRECT_URI=http://localhost:15000/api/auth/salesforce/callback
```

## Configuration Details

### ⚠️ Important: Single-Line JSON Format
The `SALESFORCE_ORGS` environment variable **MUST** be a single-line JSON string. Multi-line JSON will cause parsing errors.

**Correct Format (single line):**
```bash
SALESFORCE_ORGS={"org1":{"name":"My Org","clientId":"123","clientSecret":"abc","url":"https://example.com"},"org2":{"name":"Another Org","clientId":"456","clientSecret":"def","url":"https://another.com"}}
```

**Incorrect Format (multi-line - will fail):**
```bash
SALESFORCE_ORGS={
  "org1": {
    "name": "My Org",
    ...
  }
}
```

### Organization Structure
Each organization in the `SALESFORCE_ORGS` JSON object should have:

- **`name`**: Display name for the organization (shown in dropdown)
- **`clientId`**: Connected App Consumer Key from Salesforce
- **`clientSecret`**: Connected App Consumer Secret from Salesforce  
- **`url`**: Salesforce login URL for the organization
  - Production: `https://login.salesforce.com`
  - Sandbox: `https://test.salesforce.com` or custom domain
  - Custom: Your organization's specific domain

### Connected App Setup
For each organization, create a Connected App in Salesforce Setup:

1. **Setup** → **App Manager** → **New Connected App**
2. **Connected App Name**: `Eternal React Event Listener`
3. **API Name**: Auto-generated
4. **Contact Email**: Your email
5. **Enable OAuth Settings**: ✅ Checked
6. **Callback URL**: `http://localhost:15000/api/auth/salesforce/callback`
7. **Selected OAuth Scopes**: 
   - Access and manage your data (api)
   - Perform requests on your behalf at any time (refresh_token, offline_access)
8. **Require Secret for Web Server Flow**: ✅ Checked
9. **Save** and note the Consumer Key (clientId) and Consumer Secret (clientSecret)

### Environment Variables
- **`SESSION_SECRET`**: Random string for session encryption
- **`NODE_ENV`**: `development` or `production`
- **`PORT`**: Server port (default: 15000)
- **`CLIENT_PORT`**: React dev server port (default: 3000)
- **`APP_URL`**: Frontend URL for production deployments

## Security Notes

⚠️ **Important**: 
- Never commit your `.env` file to version control
- Keep your `clientSecret` values secure
- Use different Connected Apps for different environments
- Regularly rotate your credentials

## Testing the Configuration

After setting up your `.env` file:

1. Start the server: `npm run dev`
2. Navigate to `http://localhost:3000`
3. You should see your configured organizations in the dropdown
4. Select an org and test the login flow

## Troubleshooting

- **"No organizations are configured"**: Check that your `SALESFORCE_ORGS` JSON is valid
- **Login fails**: Verify your `clientId`, `clientSecret`, and callback URL
- **Organizations not loading**: Check server console for JSON parsing errors
