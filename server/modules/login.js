const jsforce = require('jsforce');

class LoginModule {
  constructor() {
    this.NODE_ENV = process.env.NODE_ENV || 'development';
    this.loadOrgConfigurations();
  }

  /**
   * Load org configurations from environment variables
   */
  loadOrgConfigurations() {
    try {
      console.log('🔄 [LOGIN] Loading org configurations from environment...');
      const orgsEnvVar = process.env.SALESFORCE_ORGS;
      
      if (!orgsEnvVar) {
        console.error('❌ [LOGIN] SALESFORCE_ORGS environment variable not set');
        console.error('❌ [LOGIN] All environment variables:', Object.keys(process.env).filter(k => k.includes('SALESFORCE')));
        this.orgConfigurations = [];
        return;
      }

      console.log('🔄 [LOGIN] SALESFORCE_ORGS found, length:', orgsEnvVar.length);
      
      // Parse JSON first, then validate structuref
      const trimmedJson = orgsEnvVar.trim();

      console.log('🔄 [LOGIN] Parsing JSON...');
      const parsedOrgs = JSON.parse(trimmedJson);
      console.log('✅ [LOGIN] JSON parsed successfully, found', parsedOrgs.length, 'orgs');
      
      // Validate that it's an array of org objects
      if (!Array.isArray(parsedOrgs)) {
        throw new Error('SALESFORCE_ORGS must be a JSON array of org configurations');
      }
      
      if (parsedOrgs.length === 0) {
        throw new Error('SALESFORCE_ORGS must contain at least one org configuration');
      }
      
      // Validate array structure and keep as array
      const orgNames = [];
      
      parsedOrgs.forEach((org, index) => {
        if (typeof org !== 'object' || Array.isArray(org) || org === null) {
          throw new Error(`Invalid org configuration at index ${index}: must be an object`);
        }
        
        if (!org.name || !org.clientId || !org.clientSecret || !org.url) {
          throw new Error(`Invalid org configuration at index ${index}: missing required fields (name, clientId, clientSecret, url)`);
        }
        
        if (typeof org.name !== 'string' || typeof org.clientId !== 'string' || 
            typeof org.clientSecret !== 'string' || typeof org.url !== 'string') {
          throw new Error(`Invalid org configuration at index ${index}: all fields must be strings`);
        }
        
        orgNames.push(org.name);
      });

      // Keep as array instead of converting to object
      this.orgConfigurations = parsedOrgs;

      console.log(`📋 [LOGIN] Successfully loaded ${parsedOrgs.length} org configurations: ${orgNames.join(', ')}`);
      
    } catch (error) {
      console.error('❌ [LOGIN] Error parsing SALESFORCE_ORGS from environment:', error.message);
      console.error('💡 [LOGIN] Ensure SALESFORCE_ORGS is a single-line JSON array like:');
      console.error('💡 [LOGIN] SALESFORCE_ORGS=[{"name":"My Org","clientId":"123","clientSecret":"abc","url":"https://example.com"}]');
      this.orgConfigurations = [];
    }
  }

  /**
   * Get available org configurations (without sensitive data)
   * Returns org data in the format expected by the frontend
   */
  getAvailableOrgs() {
    const publicOrgInfo = {};
    
    // Loop through the orgConfigurations array directly
    this.orgConfigurations.forEach((org, index) => {
      // Generate a consistent key for this org based on index and name
      const orgKey = `org_${index}_${org.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      
      publicOrgInfo[orgKey] = {
        id: orgKey,              // Unique identifier for this org
        index: index,            // Array index for backend reference
        name: org.name,          // Display name from org configuration
        url: org.url,            // Salesforce instance URL
        domain: this.extractDomainFromUrl(org.url),  // Extract domain for display
        type: this.determineOrgType(org.url),        // Determine if production/sandbox/custom
        // Note: clientId and clientSecret are NOT exposed for security
      };
    });
    
    return publicOrgInfo;
  }

  /**
   * Extract domain from Salesforce URL for display purposes
   */
  extractDomainFromUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return url; // Return original if URL parsing fails
    }
  }

  /**
   * Determine org type based on URL pattern
   */
  determineOrgType(url) {
    if (url.includes('test.salesforce.com') || url.includes('--')) {
      return 'sandbox';
    } else if (url.includes('login.salesforce.com')) {
      return 'production';
    } else {
      return 'custom';
    }
  }

  /**
   * Get org configuration by index or key
   */
  getOrgConfiguration(orgIdentifier) {
    // If it's a number or numeric string, treat as array index
    if (typeof orgIdentifier === 'number' || /^\d+$/.test(orgIdentifier)) {
      const index = parseInt(orgIdentifier);
      return this.orgConfigurations[index];
    }
    
    // If it's an orgKey (like "org_0_myorg"), extract the index
    if (typeof orgIdentifier === 'string' && orgIdentifier.startsWith('org_')) {
      const match = orgIdentifier.match(/^org_(\d+)_/);
      if (match) {
        const index = parseInt(match[1]);
        return this.orgConfigurations[index];
      }
    }
    
    // Fallback: search by name (case-insensitive)
    return this.orgConfigurations.find(org => 
      org.name.toLowerCase() === orgIdentifier.toLowerCase()
    );
  }

  /**
   * Handle Salesforce login request (updated for multi-org support with dual OAuth)
   */
  async handleSalesforceLogin(req, res) {
    try {
      const { orgKey, orgType, customUrl } = req.body;
      
      let loginUrl, clientId, clientSecret, orgConfig;

      // New multi-org flow
      if (orgKey) {
        orgConfig = this.getOrgConfiguration(orgKey);
        if (!orgConfig) {
          return res.status(400).json({ success: false, message: 'Invalid org selection' });
        }
        
        loginUrl = orgConfig.url;
        clientId = orgConfig.clientId;
        clientSecret = orgConfig.clientSecret;
        
        console.log(`🔗 [LOGIN] Using org configuration: ${orgConfig.name} (${orgKey})`);
        
        // Check OAuth type and route accordingly
        const oAuthType = orgConfig.oAuthType || 'authorizationCode';
        console.log(`🔐 [LOGIN] OAuth type: ${oAuthType}`);
        
        if (oAuthType === 'clientCredential') {
          // Use username-password flow (Salesforce's equivalent to client credentials)
          return await this.handleClientCredentialLogin(req, res, orgConfig, orgKey);
        }
        // Otherwise, continue with authorization code flow below
      } 
      // Legacy flow for backward compatibility
      else if (orgType) {
        switch (orgType) {
          case 'production':
            loginUrl = 'https://login.salesforce.com';
            break;
          case 'sandbox':
            loginUrl = 'https://test.salesforce.com';
            break;
          case 'custom':
            loginUrl = customUrl;
            break;
          default:
            return res.status(400).json({ success: false, message: 'Invalid org type' });
        }
        
        // Use legacy environment variables
        clientId = process.env.SALESFORCE_CLIENT_ID;
        clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
        
        console.log(`🔗 [LOGIN] Using legacy org type: ${orgType}`);
      } else {
        return res.status(400).json({ success: false, message: 'No org selection provided' });
      }

      if (!clientId || !clientSecret) {
        return res.status(500).json({ 
          success: false, 
          message: 'Org configuration incomplete: missing clientId or clientSecret' 
        });
      }

      // Create OAuth2 connection
      const oauth2 = new jsforce.OAuth2({
        clientId,
        clientSecret,
        redirectUri: process.env.SALESFORCE_REDIRECT_URI || 'http://localhost:5000/api/auth/salesforce/callback',
        loginUrl: loginUrl
      });

      req.session.oauth2 = oauth2;
      req.session.orgKey = orgKey;
      req.session.orgType = orgType;
      req.session.loginUrl = loginUrl;

      const authUrl = oauth2.getAuthorizationUrl({
        scope: 'api',
        state: 'mystate'
      });

      res.json({ success: true, authUrl });
    } catch (error) {
      console.error('❌ [LOGIN] Error in Salesforce login:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to initiate Salesforce login: ' + error.message 
      });
    }
  }

  /**
   * Get list of available orgs for frontend
   */
  async getOrgsList(req, res) {
    try {
      const orgs = this.getAvailableOrgs();
      res.json({
        success: true,
        orgs
      });
    } catch (error) {
      console.error('❌ [LOGIN] Error getting orgs list:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get org configurations: ' + error.message
      });
    }
  }

  /**
   * Handle client credential login using pure OAuth 2.0 client credentials grant
   * Using only clientId and clientSecret (no username/password required)
   */
  async handleClientCredentialLogin(req, res, orgConfig, orgKey) {
    try {
      console.log('🔐 [LOGIN] Starting pure client credential authentication...');
      console.log('🔐 [LOGIN] Using ONLY clientId and clientSecret (no username/password)');
      
      const { name, clientId, clientSecret, url } = orgConfig;
      const axios = require('axios');
      
      console.log(`🔐 [LOGIN] Org: ${name}`);
      console.log(`🔐 [LOGIN] Token URL: ${url}/services/oauth2/token`);
      
      // Prepare client credentials grant request
      const tokenUrl = `${url}/services/oauth2/token`;
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      });
      
      // Add audience if specified (optional, similar to Auth0 pattern)
      if (orgConfig.audience) {
        params.append('audience', orgConfig.audience);
        console.log(`📋 [LOGIN] Using audience: ${orgConfig.audience}`);
      }
      
      console.log('📤 [LOGIN] Request parameters:', {
        grant_type: 'client_credentials',
        client_id: clientId.substring(0, 20) + '...',
        client_secret: '***' + clientSecret.substring(clientSecret.length - 4)
      });

      // Make direct OAuth token request
      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      console.log('✅ [LOGIN] Client credential authentication successful!');
      console.log('📋 [LOGIN] Token response:', {
        access_token: response.data.access_token ? (response.data.access_token.substring(0, 20) + '...') : 'N/A',
        instance_url: response.data.instance_url,
        token_type: response.data.token_type,
        issued_at: response.data.issued_at
      });

      // Extract token information
      const { access_token, instance_url, id, token_type, issued_at } = response.data;
      
      if (!access_token) {
        throw new Error('No access token received from Salesforce');
      }

      // Create jsforce connection with the token to get user info
      const conn = new jsforce.Connection({
        instanceUrl: instance_url,
        accessToken: access_token
      });

      // Get user identity information
      let identityInfo;
      try {
        identityInfo = await conn.identity();
        console.log('🔍 [LOGIN] Identity info:', {
          display_name: identityInfo.display_name,
          username: identityInfo.username,
          email: identityInfo.email,
          organization_id: identityInfo.organization_id,
          user_id: identityInfo.user_id
        });
      } catch (identityError) {
        console.warn('⚠️ [LOGIN] Could not fetch identity info:', identityError.message);
        // Use defaults if identity call fails
        identityInfo = {
          display_name: 'Integration User',
          username: 'client_credential_user',
          email: 'integration@example.com',
          organization_id: 'unknown',
          user_id: 'unknown'
        };
      }
      
      // Store connection info in session
      req.session.salesforce = {
        accessToken: access_token,
        refreshToken: response.data.refresh_token || null,
        instanceUrl: instance_url,
        organizationId: identityInfo.organization_id,
        userId: identityInfo.user_id,
        orgType: 'clientCredential',
        orgKey: orgKey,
        orgName: name,
        oAuthType: 'clientCredential',
        // Additional user details
        displayName: identityInfo.display_name,
        username: identityInfo.username,
        email: identityInfo.email
      };

      // Return success immediately (no redirect needed for client credentials)
      return res.json({
        success: true,
        message: 'Client credential authentication successful (no username/password required)',
        authType: 'clientCredential',
        user: {
          userId: identityInfo.user_id,
          organizationId: identityInfo.organization_id,
          instanceUrl: instance_url,
          orgName: name,
          orgKey: orgKey,
          displayName: identityInfo.display_name,
          username: identityInfo.username,
          email: identityInfo.email
        }
      });
      
    } catch (error) {
      console.error('❌ [LOGIN] Client credential authentication failed:', error);
      console.error('📋 [LOGIN] Error details:', {
        message: error.message,
        response_status: error.response?.status,
        response_data: error.response?.data
      });
      
      return res.status(error.response?.status || 401).json({
        success: false,
        message: 'Client credential authentication failed: ' + error.message,
        details: error.response?.data || error.message,
        hint: 'If this fails, the Connected App might need "Enable Client Credentials Flow" or might not support pure client credentials'
      });
    }
  }

  /**
   * Handle Salesforce OAuth callback
   */
  async handleSalesforceCallback(req, res) {
    try {
      const { code, state } = req.query;
      
      if (!req.session.oauth2) {
        const clientUrl = this.NODE_ENV === 'production' 
          ? process.env.APP_URL || 'https://localhost:3000' 
          : 'http://localhost:3000';
        return res.redirect(`${clientUrl}?error=session_expired`);
      }

      const conn = new jsforce.Connection({
        oauth2: req.session.oauth2
      });

      const userInfo = await conn.authorize(code);
      
      // Get detailed user information including name, username, and email
      const identityInfo = await conn.identity();
      console.log('🔍 [LOGIN] Identity info:', {
        display_name: identityInfo.display_name,
        username: identityInfo.username,
        email: identityInfo.email,
        organization_id: identityInfo.organization_id
      });
      
      // Store connection info in session with detailed user data
      req.session.salesforce = {
        accessToken: conn.accessToken,
        refreshToken: conn.refreshToken,
        instanceUrl: conn.instanceUrl,
        organizationId: userInfo.organizationId,
        userId: userInfo.id,
        orgType: req.session.orgType,
        orgKey: req.session.orgKey,
        orgName: req.session.orgKey ? this.getOrgConfiguration(req.session.orgKey)?.name : undefined,
        // Additional user details
        displayName: identityInfo.display_name,
        username: identityInfo.username,
        email: identityInfo.email
      };

      // Note: No longer syncing global connections - each module will create connections per-request

      // Redirect to success page
      const clientUrl = this.NODE_ENV === 'production' 
        ? process.env.APP_URL || 'https://localhost:3000' 
        : 'http://localhost:3000';
      res.redirect(`${clientUrl}?auth=success`);
    } catch (error) {
      console.error('Salesforce auth error:', error);
      const clientUrl = this.NODE_ENV === 'production' 
        ? process.env.APP_URL || 'https://localhost:3000' 
        : 'http://localhost:3000';
      res.redirect(`${clientUrl}?error=auth_failed`);
    }
  }

  /**
   * Get current user information
   */
  async getCurrentUser(req, res) {
    try {
      if (req.session.salesforce) {
        res.json({
          success: true,
          user: {
            userId: req.session.salesforce.userId,
            organizationId: req.session.salesforce.organizationId,
            instanceUrl: req.session.salesforce.instanceUrl,
            orgType: req.session.salesforce.orgType,
            orgKey: req.session.salesforce.orgKey,
            orgName: req.session.salesforce.orgName,
            // Include detailed user information
            displayName: req.session.salesforce.displayName,
            username: req.session.salesforce.username,
            email: req.session.salesforce.email
          }
        });
      } else {
        res.status(401).json({ success: false, message: 'Not authenticated' });
      }
    } catch (error) {
      console.error('Error getting current user:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to get user information: ' + error.message 
      });
    }
  }

  /**
   * Handle logout request
   */
  async handleLogout(req, res, cleanupSubscriptions) {
    try {
      // Clean up subscriptions when user logs out
      console.log('🚪 [LOGIN] User logging out, cleaning up subscriptions...');
      if (cleanupSubscriptions) {
        await cleanupSubscriptions();
      }
      
      req.session.destroy((err) => {
        if (err) {
          console.error('Error destroying session:', err);
          return res.status(500).json({ success: false, message: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logged out successfully' });
      });
    } catch (error) {
      console.error('❌ [LOGIN] Error during logout cleanup:', error);
      // Still try to logout even if cleanup fails
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logged out successfully (with cleanup warnings)' });
      });
    }
  }

  /**
   * Middleware to check if user is authenticated
   */
  requireAuth(req, res, next) {
    // Check session-based auth first (for browser requests)
    if (req.session.salesforce) {
      return next();
    }

    // Check Authorization header for API requests (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7); // Remove 'Bearer ' prefix
      
      // Get instanceUrl from custom header or environment variable
      const instanceUrl = req.headers['x-instance-url'] || 
                         req.headers['x-salesforce-instance'] ||
                         process.env.SALESFORCE_INSTANCE_URL ||
                         'https://login.salesforce.com'; // Default to login.salesforce.com
      
      // Create a minimal session-like object for API requests
      if (!req.session) {
        req.session = {};
      }
      
      req.session.salesforce = {
        accessToken: accessToken,
        instanceUrl: instanceUrl
      };

      // Create basic oauth2 config for jsforce compatibility
      req.session.oauth2 = {
        clientId: process.env.SALESFORCE_CLIENT_ID || 'api_client',
        clientSecret: process.env.SALESFORCE_CLIENT_SECRET || 'api_secret',
        redirectUri: process.env.SALESFORCE_REDIRECT_URI || 'http://localhost:5000/api/auth/salesforce/callback'
      };
      
      console.log(`🔑 [AUTH] API request authenticated with Bearer token for instance: ${instanceUrl}`);
      return next();
    }
    
    return res.status(401).json({ 
      success: false, 
      message: 'Not authenticated. Please provide either session cookies or Authorization: Bearer <token> header.' 
    });
  }

  /**
   * Create Salesforce connection from session
   */
  createConnection(req) {
    return new jsforce.Connection({
      oauth2: req.session.oauth2,
      accessToken: req.session.salesforce.accessToken,
      instanceUrl: req.session.salesforce.instanceUrl
    });
  }
}

module.exports = LoginModule;
