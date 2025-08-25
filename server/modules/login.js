const jsforce = require('jsforce');

class LoginModule {
  constructor(syncGlobalConnectionCallback = null) {
    this.NODE_ENV = process.env.NODE_ENV || 'development';
    this.syncGlobalConnection = syncGlobalConnectionCallback;
    this.loadOrgConfigurations();
  }

  /**
   * Load org configurations from environment variables
   */
  loadOrgConfigurations() {
    try {
      const orgsEnvVar = process.env.SALESFORCE_ORGS;
      
      if (!orgsEnvVar) {
        console.warn('⚠️ [LOGIN] SALESFORCE_ORGS environment variable not set');
        this.orgConfigurations = [];
        return;
      }

      // Parse JSON first, then validate structuref
      const trimmedJson = orgsEnvVar.trim();

      const parsedOrgs = JSON.parse(trimmedJson);
      
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
   * Handle Salesforce login request (updated for multi-org support)
   */
  async handleSalesforceLogin(req, res) {
    try {
      const { orgKey, orgType, customUrl } = req.body;
      
      let loginUrl, clientId, clientSecret;

      // New multi-org flow
      if (orgKey) {
        const orgConfig = this.getOrgConfiguration(orgKey);
        if (!orgConfig) {
          return res.status(400).json({ success: false, message: 'Invalid org selection' });
        }
        
        loginUrl = orgConfig.url;
        clientId = orgConfig.clientId;
        clientSecret = orgConfig.clientSecret;
        
        console.log(`🔗 [LOGIN] Using org configuration: ${orgConfig.name} (${orgKey})`);
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

      // Sync the connection to all modules
      if (this.syncGlobalConnection) {
        this.syncGlobalConnection(conn);
        console.log('🔗 [LOGIN] Global connection synced to all modules');
      }

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
  createConnection(req, globalConnection) {
    // Use global connection or create a new one
    let conn = globalConnection;
    if (!conn) {
      conn = new jsforce.Connection({
        oauth2: req.session.oauth2,
        accessToken: req.session.salesforce.accessToken,
        instanceUrl: req.session.salesforce.instanceUrl
      });
    }
    return conn;
  }
}

module.exports = LoginModule;
