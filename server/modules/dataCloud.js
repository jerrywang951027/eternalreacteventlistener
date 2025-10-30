const axios = require('axios');

class DataCloudModule {
  constructor() {
    // Store Data Cloud access tokens per session
    this.dataCloudTokens = new Map();
  }

  /**
   * Connect to Data Cloud and retrieve access token
   * Two-step process:
   * 1. Get temporary Salesforce core access token using client credentials
   * 2. Use that token to get Data Cloud access token
   * Stores the token and tenant URL in session
   */
  async connectDataCloud(req, res) {
    try {
      const salesforce = req.session?.salesforce;
      
      if (!salesforce || !salesforce.instanceUrl) {
        return res.status(401).json({
          success: false,
          message: 'Not authenticated with Salesforce'
        });
      }

      // Get current org configuration from login module
      const loginModule = req.app.locals.loginModule;
      if (!loginModule) {
        return res.status(500).json({
          success: false,
          message: 'Login module not available'
        });
      }

      // Find current org's configuration
      const orgKey = salesforce.orgKey;
      const orgName = orgKey?.replace(/^org_\d+_/, '') || '';
      
      console.log('🌥️ [DATACLOUD] Looking for org configuration:', orgName);
      
      const orgConfig = loginModule.orgConfigurations.find(org => 
        org.name.toLowerCase() === orgName.toLowerCase() ||
        org.name.replace(/[^a-z0-9]/gi, '').toLowerCase() === orgName.replace(/[^a-z0-9]/gi, '').toLowerCase()
      );

      if (!orgConfig) {
        return res.status(404).json({
          success: false,
          message: `Org configuration not found for: ${orgName}`
        });
      }

      if (!orgConfig.dataCloudClientId || !orgConfig.dataCloudClientSecret) {
        return res.status(400).json({
          success: false,
          message: 'Data Cloud credentials not configured. Please add dataCloudClientId and dataCloudClientSecret to org configuration.'
        });
      }

      const instanceUrl = salesforce.instanceUrl;

      console.log('🌥️ [DATACLOUD] ========== STEP 1: Getting Temporary Core Access Token ==========');
      console.log('🌥️ [DATACLOUD] Instance URL:', instanceUrl);
      console.log('🌥️ [DATACLOUD] Client ID:', orgConfig.dataCloudClientId.substring(0, 20) + '...');
      
      // STEP 1: Get temporary Salesforce core access token using client credentials
      const coreTokenFormData = new URLSearchParams();
      coreTokenFormData.append('grant_type', 'client_credentials');
      coreTokenFormData.append('client_id', orgConfig.dataCloudClientId);
      coreTokenFormData.append('client_secret', orgConfig.dataCloudClientSecret);

      console.log('🌥️ [DATACLOUD] STEP 1 REQUEST:');
      console.log('  URL:', `${instanceUrl}/services/oauth2/token`);
      console.log('  Method: POST');
      console.log('  Headers:', { 'Content-Type': 'application/x-www-form-urlencoded' });
      console.log('  Body:', {
        grant_type: 'client_credentials',
        client_id: orgConfig.dataCloudClientId.substring(0, 20) + '...',
        client_secret: '***REDACTED***'
      });

      const coreTokenResponse = await axios.post(
        `${instanceUrl}/services/oauth2/token`,
        coreTokenFormData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      console.log('🌥️ [DATACLOUD] STEP 1 RESPONSE:');
      console.log('  Status:', coreTokenResponse.status);
      console.log('  Data:', {
        ...coreTokenResponse.data,
        access_token: coreTokenResponse.data.access_token ? coreTokenResponse.data.access_token.substring(0, 20) + '...' : 'N/A'
      });

      const temporaryCoreToken = coreTokenResponse.data.access_token;

      if (!temporaryCoreToken) {
        throw new Error('Failed to retrieve temporary core access token');
      }

      console.log('✅ [DATACLOUD] STEP 1 COMPLETE: Temporary core access token retrieved');

      // STEP 2: Use temporary token to get Data Cloud access token
      console.log('🌥️ [DATACLOUD] ========== STEP 2: Getting Data Cloud Access Token ==========');
      
      const dcTokenFormData = new URLSearchParams();
      dcTokenFormData.append('grant_type', 'urn:salesforce:grant-type:external:cdp');
      dcTokenFormData.append('subject_token', temporaryCoreToken);
      dcTokenFormData.append('subject_token_type', 'urn:ietf:params:oauth:token-type:access_token');

      console.log('🌥️ [DATACLOUD] STEP 2 REQUEST:');
      console.log('  URL:', `${instanceUrl}/services/a360/token`);
      console.log('  Method: POST');
      console.log('  Headers:', { 'Content-Type': 'application/x-www-form-urlencoded' });
      console.log('  Body:', {
        grant_type: 'urn:salesforce:grant-type:external:cdp',
        subject_token: temporaryCoreToken.substring(0, 20) + '...',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token'
      });

      const dcTokenResponse = await axios.post(
        `${instanceUrl}/services/a360/token`,
        dcTokenFormData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      console.log('🌥️ [DATACLOUD] STEP 2 RESPONSE:');
      console.log('  Status:', dcTokenResponse.status);
      console.log('  Data:', {
        ...dcTokenResponse.data,
        access_token: dcTokenResponse.data.access_token ? dcTokenResponse.data.access_token.substring(0, 20) + '...' : 'N/A'
      });

      if (dcTokenResponse.data && dcTokenResponse.data.access_token) {
        const dcAccessToken = dcTokenResponse.data.access_token;
        const dcTenantUrl = dcTokenResponse.data.instance_url;

        console.log('✅ [DATACLOUD] STEP 2 COMPLETE: Data Cloud access token retrieved');
        console.log('✅ [DATACLOUD] Data Cloud tenant URL:', dcTenantUrl);
        console.log('✅ [DATACLOUD] ========== CONNECTION SUCCESSFUL ==========');

        // Store in session
        req.session.dataCloudAccessToken = dcAccessToken;
        req.session.dataCloudTenantUrl = dcTenantUrl;

        // Also store in memory map (backup)
        const sessionId = req.sessionID;
        this.dataCloudTokens.set(sessionId, {
          accessToken: dcAccessToken,
          tenantUrl: dcTenantUrl,
          expiresAt: Date.now() + (dcTokenResponse.data.expires_in * 1000)
        });

        return res.json({
          success: true,
          message: 'Successfully connected to Data Cloud',
          data: {
            tenantUrl: dcTenantUrl,
            expiresIn: dcTokenResponse.data.expires_in
          }
        });
      } else {
        throw new Error('Invalid response from Data Cloud token endpoint');
      }
    } catch (error) {
      console.error('❌ [DATACLOUD] ========== CONNECTION FAILED ==========');
      console.error('❌ [DATACLOUD] Error:', error.message);
      
      if (error.response) {
        console.error('❌ [DATACLOUD] Response Status:', error.response.status);
        console.error('❌ [DATACLOUD] Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to connect to Data Cloud',
        error: error.response?.data?.error_description || error.response?.data?.message || error.message
      });
    }
  }

  /**
   * Execute a Data Cloud SQL query
   */
  async executeQuery(req, res) {
    try {
      const { sql } = req.body;

      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'SQL query is required'
        });
      }

      // Get Data Cloud credentials from session
      const dcAccessToken = req.session?.dataCloudAccessToken;
      const dcTenantUrl = req.session?.dataCloudTenantUrl;

      if (!dcAccessToken || !dcTenantUrl) {
        return res.status(401).json({
          success: false,
          message: 'Not connected to Data Cloud. Please connect first.'
        });
      }

      console.log('🌥️ [DATACLOUD] Executing query...');
      console.log('🌥️ [DATACLOUD] Query:', sql.substring(0, 100) + '...');
      console.log('🌥️ [DATACLOUD] Tenant URL:', dcTenantUrl);

      // Data Cloud instance_url is just hostname without protocol, so add https://
      const queryUrl = dcTenantUrl.startsWith('http') 
        ? `${dcTenantUrl}/api/v1/query`
        : `https://${dcTenantUrl}/api/v1/query`;
      console.log('🌥️ [DATACLOUD] Query URL:', queryUrl);

      const queryResponse = await axios.post(
        queryUrl,
        { sql },
        {
          headers: {
            'Authorization': `Bearer ${dcAccessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (queryResponse.data) {
        console.log('✅ [DATACLOUD] Query executed successfully');
        console.log('✅ [DATACLOUD] Rows returned:', queryResponse.data.rowCount || 0);

        return res.json({
          success: true,
          result: queryResponse.data
        });
      } else {
        throw new Error('Invalid response from Data Cloud query endpoint');
      }
    } catch (error) {
      console.error('❌ [DATACLOUD] Error executing query:', error.message);
      console.error('❌ [DATACLOUD] Error details:', error.response?.data);
      
      return res.status(500).json({
        success: false,
        message: 'Failed to execute query',
        error: error.response?.data?.message || error.message
      });
    }
  }

  /**
   * Get current Data Cloud connection status
   */
  async getConnectionStatus(req, res) {
    try {
      const dcAccessToken = req.session?.dataCloudAccessToken;
      const dcTenantUrl = req.session?.dataCloudTenantUrl;

      return res.json({
        success: true,
        connected: !!(dcAccessToken && dcTenantUrl),
        tenantUrl: dcTenantUrl || null
      });
    } catch (error) {
      console.error('❌ [DATACLOUD] Error getting connection status:', error);
      
      return res.status(500).json({
        success: false,
        message: 'Failed to get connection status',
        error: error.message
      });
    }
  }

  /**
   * Get Data Cloud metadata for entity types (DataLakeObject or DataModel)
   */
  async getMetadata(req, res) {
    try {
      const { entityType } = req.query;

      if (!entityType) {
        return res.status(400).json({
          success: false,
          message: 'entityType parameter is required'
        });
      }

      // Get Data Cloud credentials from session
      const dcAccessToken = req.session?.dataCloudAccessToken;
      const dcTenantUrl = req.session?.dataCloudTenantUrl;

      if (!dcAccessToken || !dcTenantUrl) {
        return res.status(401).json({
          success: false,
          message: 'Not connected to Data Cloud. Please connect first.'
        });
      }

      console.log('🌥️ [DATACLOUD] Fetching metadata...');
      console.log('🌥️ [DATACLOUD] Entity Type:', entityType);
      console.log('🌥️ [DATACLOUD] Tenant URL:', dcTenantUrl);

      // Data Cloud instance_url is just hostname without protocol, so add https://
      const metadataUrl = dcTenantUrl.startsWith('http') 
        ? `${dcTenantUrl}/api/v1/metadata?entityType=${entityType}`
        : `https://${dcTenantUrl}/api/v1/metadata?entityType=${entityType}`;
      console.log('🌥️ [DATACLOUD] Metadata URL:', metadataUrl);

      const metadataResponse = await axios.get(
        metadataUrl,
        {
          headers: {
            'Authorization': `Bearer ${dcAccessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (metadataResponse.data) {
        console.log('✅ [DATACLOUD] Metadata fetched successfully');
        console.log('✅ [DATACLOUD] Response structure:', JSON.stringify(metadataResponse.data).substring(0, 500));
        
        // Check if data is array or has a nested structure
        let metadata = metadataResponse.data;
        if (!Array.isArray(metadata)) {
          console.log('⚠️ [DATACLOUD] Response is not an array, checking for nested data...');
          // Try common response wrapper patterns
          if (metadata.data) metadata = metadata.data;
          else if (metadata.metadata) metadata = metadata.metadata;
          else if (metadata.result) metadata = metadata.result;
          else if (metadata.objects) metadata = metadata.objects;
        }
        
        console.log('✅ [DATACLOUD] Objects count:', Array.isArray(metadata) ? metadata.length : 'Not an array');

        return res.json({
          success: true,
          metadata: metadata
        });
      } else {
        throw new Error('Invalid response from Data Cloud metadata endpoint');
      }
    } catch (error) {
      console.error('❌ [DATACLOUD] Error fetching metadata:', error.message);
      console.error('❌ [DATACLOUD] Error details:', error.response?.data);
      
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch metadata',
        error: error.response?.data?.message || error.message
      });
    }
  }

  /**
   * Disconnect from Data Cloud (clear session data)
   */
  async disconnectDataCloud(req, res) {
    try {
      // Clear session data
      delete req.session.dataCloudAccessToken;
      delete req.session.dataCloudTenantUrl;

      // Clear from memory map
      const sessionId = req.sessionID;
      this.dataCloudTokens.delete(sessionId);

      console.log('✅ [DATACLOUD] Disconnected from Data Cloud');

      return res.json({
        success: true,
        message: 'Disconnected from Data Cloud'
      });
    } catch (error) {
      console.error('❌ [DATACLOUD] Error disconnecting:', error);
      
      return res.status(500).json({
        success: false,
        message: 'Failed to disconnect',
        error: error.message
      });
    }
  }
}

module.exports = DataCloudModule;

