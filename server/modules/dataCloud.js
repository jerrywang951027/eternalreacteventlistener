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

  /**
   * Get Data Cloud metadata using V3 API (Salesforce native endpoint)
   * Uses the Salesforce bearer token directly without separate Data Cloud authentication
   */
  async getV3Metadata(req, res) {
    try {
      const { entityType } = req.query;

      if (!entityType) {
        return res.status(400).json({
          success: false,
          message: 'entityType parameter is required (e.g., DataLakeObject or DataModel)'
        });
      }

      // Get Salesforce credentials from session
      const salesforce = req.session?.salesforce;
      
      if (!salesforce || !salesforce.instanceUrl || !salesforce.accessToken) {
        return res.status(401).json({
          success: false,
          message: 'Not authenticated with Salesforce'
        });
      }

      const instanceUrl = salesforce.instanceUrl;
      const accessToken = salesforce.accessToken;

      console.log('🌥️ [DATACLOUD-V3] Fetching V3 metadata...');
      console.log('🌥️ [DATACLOUD-V3] Entity Type:', entityType);
      console.log('🌥️ [DATACLOUD-V3] Instance URL:', instanceUrl);

      // V3 API endpoint: /services/data/v65.0/ssot/metadata
      const metadataUrl = `${instanceUrl}/services/data/v65.0/ssot/metadata?entityType=${entityType}`;
      console.log('🌥️ [DATACLOUD-V3] Metadata URL:', metadataUrl);

      const metadataResponse = await axios.get(
        metadataUrl,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (metadataResponse.data) {
        console.log('✅ [DATACLOUD-V3] Metadata fetched successfully');
        console.log('✅ [DATACLOUD-V3] Response structure:', JSON.stringify(metadataResponse.data).substring(0, 500) + '...');

        // The V3 API returns: {"metadata": [...]}
        // Extract the metadata array from the response
        let metadata = metadataResponse.data;
        
        // If it's wrapped in a metadata property, unwrap it
        if (metadata.metadata && Array.isArray(metadata.metadata)) {
          metadata = metadata.metadata;
        }
        // If it's wrapped in a data property, unwrap it
        else if (metadata.data && Array.isArray(metadata.data)) {
          metadata = metadata.data;
        }

        console.log('✅ [DATACLOUD-V3] Extracted metadata array length:', Array.isArray(metadata) ? metadata.length : 'not an array');

        return res.json({
          success: true,
          metadata: metadata,
          entityType: entityType
        });
      } else {
        throw new Error('Invalid response from Data Cloud V3 metadata endpoint');
      }
    } catch (error) {
      console.error('❌ [DATACLOUD-V3] Error fetching metadata:', error.message);
      
      if (error.response) {
        console.error('❌ [DATACLOUD-V3] Response Status:', error.response.status);
        console.error('❌ [DATACLOUD-V3] Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      
      return res.status(error.response?.status || 500).json({
        success: false,
        message: 'Failed to fetch V3 metadata',
        error: error.response?.data?.message || error.message,
        details: error.response?.data
      });
    }
  }

  /**
   * Execute a Data Cloud SQL query using V3 API (Salesforce native endpoint)
   * Uses the Salesforce bearer token directly without separate Data Cloud authentication
   */
  async executeV3Query(req, res) {
    try {
      const { sql } = req.body;

      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'SQL query is required'
        });
      }

      // Get Salesforce credentials from session
      const salesforce = req.session?.salesforce;
      
      if (!salesforce || !salesforce.instanceUrl || !salesforce.accessToken) {
        return res.status(401).json({
          success: false,
          message: 'Not authenticated with Salesforce'
        });
      }

      const instanceUrl = salesforce.instanceUrl;
      const accessToken = salesforce.accessToken;

      console.log('🌥️ [DATACLOUD-V3] Executing V3 query...');
      console.log('🌥️ [DATACLOUD-V3] Query:', sql.substring(0, 100) + (sql.length > 100 ? '...' : ''));
      console.log('🌥️ [DATACLOUD-V3] Instance URL:', instanceUrl);

      // V3 API endpoint: /services/data/v65.0/ssot/query-sql
      const queryUrl = `${instanceUrl}/services/data/v65.0/ssot/query-sql`;
      console.log('🌥️ [DATACLOUD-V3] Query URL:', queryUrl);

      // Track query execution time
      const startTime = Date.now();

      const queryResponse = await axios.post(
        queryUrl,
        { sql },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const endTime = Date.now();
      const queryTimeMills = endTime - startTime;

      if (queryResponse.data) {
        console.log('✅ [DATACLOUD-V3] Query executed successfully');
        console.log('✅ [DATACLOUD-V3] Initial query time:', queryTimeMills, 'ms');
        console.log('✅ [DATACLOUD-V3] Initial response:', JSON.stringify(queryResponse.data).substring(0, 200) + '...');

        const initialData = queryResponse.data;
        const returnedRows = initialData.returnedRows || 0;
        const totalRowCount = initialData.status?.rowCount || returnedRows;
        const queryId = initialData.status?.queryId;

        console.log(`📊 [DATACLOUD-V3] Returned rows: ${returnedRows}, Total rows: ${totalRowCount}`);

        // Check if we need to fetch more rows
        if (returnedRows < totalRowCount && queryId) {
          console.log(`🔄 [DATACLOUD-V3] Fetching remaining ${totalRowCount - returnedRows} rows...`);
          
          // Accumulate all data rows
          let allData = Array.isArray(initialData.data) ? [...initialData.data] : [];
          let offset = returnedRows;
          const rowLimit = 500; // Fetch 500 rows per request
          
          try {
            while (offset < totalRowCount) {
              console.log(`🔄 [DATACLOUD-V3] Fetching rows ${offset} to ${Math.min(offset + rowLimit, totalRowCount)}...`);
              
              const paginationUrl = `${instanceUrl}/services/data/v65.0/ssot/query-sql/${queryId}/rows?rowLimit=${rowLimit}&offset=${offset}`;
              
              try {
                const paginationResponse = await axios.get(
                  paginationUrl,
                  {
                    headers: {
                      'Authorization': `Bearer ${accessToken}`,
                      'Content-Type': 'application/json'
                    }
                  }
                );

                if (paginationResponse.data && Array.isArray(paginationResponse.data.data)) {
                  const fetchedRows = paginationResponse.data.data;
                  allData = allData.concat(fetchedRows);
                  offset += fetchedRows.length;
                  console.log(`✅ [DATACLOUD-V3] Fetched ${fetchedRows.length} rows, total accumulated: ${allData.length}`);
                  
                  // Break if no more rows returned
                  if (fetchedRows.length === 0) {
                    console.log(`⚠️ [DATACLOUD-V3] No more rows returned, stopping pagination`);
                    break;
                  }
                } else {
                  console.error(`❌ [DATACLOUD-V3] Invalid pagination response at offset ${offset}`);
                  break; // Stop pagination but return what we have
                }
              } catch (paginationError) {
                console.error(`❌ [DATACLOUD-V3] Error fetching rows at offset ${offset}:`, paginationError.message);
                console.error(`⚠️ [DATACLOUD-V3] Returning ${allData.length} rows retrieved so far`);
                break; // Stop pagination but return what we have
              }
            }

            const finalEndTime = Date.now();
            const totalQueryTime = finalEndTime - startTime;
            
            console.log(`✅ [DATACLOUD-V3] Pagination complete! Total rows: ${allData.length}, Total time: ${totalQueryTime}ms`);

            // Update the result with all fetched data
            const result = {
              ...initialData,
              data: allData,
              returnedRows: allData.length,
              queryTimeMills: totalQueryTime,
              startTime: startTime,
              endTime: finalEndTime,
              paginationComplete: allData.length >= totalRowCount
            };

            return res.json({
              success: true,
              result: result
            });

          } catch (paginationError) {
            console.error('❌ [DATACLOUD-V3] Pagination error:', paginationError.message);
            console.error(`⚠️ [DATACLOUD-V3] Returning ${allData.length} rows retrieved before error`);
            
            // Return what we have so far
            const result = {
              ...initialData,
              data: allData,
              returnedRows: allData.length,
              queryTimeMills: Date.now() - startTime,
              startTime: startTime,
              endTime: Date.now(),
              paginationComplete: false,
              paginationError: paginationError.message
            };

            return res.json({
              success: true,
              result: result
            });
          }
        } else {
          // No pagination needed, return as-is
          const result = {
            ...initialData,
            queryTimeMills: queryTimeMills,
            startTime: startTime,
            endTime: endTime,
            paginationComplete: true
          };

          return res.json({
            success: true,
            result: result
          });
        }
      } else {
        throw new Error('Invalid response from Data Cloud V3 query endpoint');
      }
    } catch (error) {
      console.error('❌ [DATACLOUD-V3] Error executing query:', error.message);
      
      if (error.response) {
        console.error('❌ [DATACLOUD-V3] Response Status:', error.response.status);
        console.error('❌ [DATACLOUD-V3] Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      
      return res.status(error.response?.status || 500).json({
        success: false,
        message: 'Failed to execute V3 query',
        error: error.response?.data?.message || error.message,
        details: error.response?.data
      });
    }
  }

  /**
   * Evaluate RAG search results using Salesforce LLM
   */
  async evaluateRagResults(req, res) {
    try {
      const { prompt, model } = req.body;

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Prompt is required'
        });
      }

      // Get Salesforce credentials from session
      const salesforce = req.session?.salesforce;
      
      if (!salesforce || !salesforce.accessToken) {
        return res.status(401).json({
          success: false,
          message: 'Not authenticated with Salesforce'
        });
      }

      const accessToken = salesforce.accessToken;

      // Use provided model or default to GPT-4 Omni
      const selectedModel = model || 'sfdc_ai__DefaultGPT4Omni';
      
      console.log('🤖 [RAG-EVAL] Evaluating RAG results with LLM...');
      console.log('🤖 [RAG-EVAL] Selected model:', selectedModel);
      console.log('🤖 [RAG-EVAL] Prompt length:', prompt.length);
      console.log('🤖 [RAG-EVAL] Prompt preview (first 500 chars):', prompt.substring(0, 500));
      
      // No processing needed - the prompt is already fully parsed by the frontend!

      // Call Salesforce LLM API with selected model
      const llmUrl = `https://api.salesforce.com/einstein/platform/v1/models/${selectedModel}/chat-generations`;
      
      const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json;charset=utf-8',
        'x-sfdc-app-context': 'EinsteinGPT',
        'x-client-feature-id': 'ai-platform-models-connected-app'
      };

      const requestBody = {
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      };

      // Save request to file for debugging
      const fs = require('fs');
      const path = require('path');
      const requestForFile = {
        url: llmUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody
      };
      
      try {
        const filePath = path.join(__dirname, '../../ragEvalRequest.json');
        fs.writeFileSync(filePath, JSON.stringify(requestForFile, null, 2));
        console.log('💾 [RAG-EVAL] Request saved to:', filePath);
      } catch (fileError) {
        console.error('❌ [RAG-EVAL] Failed to save request to file:', fileError.message);
      }

      console.log('\n========== RAG-EVAL LLM REQUEST - START ==========');
      console.log('🤖 [RAG-EVAL] REQUEST URL:', llmUrl);
      console.log('🤖 [RAG-EVAL] REQUEST METHOD:', 'POST');
      console.log('🤖 [RAG-EVAL] REQUEST HEADERS:', JSON.stringify({
        ...requestHeaders,
        'Authorization': `Bearer ${accessToken.substring(0, 20)}...${accessToken.substring(accessToken.length - 10)}`
      }, null, 2));
      console.log('🤖 [RAG-EVAL] REQUEST BODY:', JSON.stringify({
        ...requestBody,
        messages: [{
          role: requestBody.messages[0].role,
          content: requestBody.messages[0].content.substring(0, 500) + '...[truncated]'
        }]
      }, null, 2));
      console.log('🤖 [RAG-EVAL] Full prompt length:', prompt.length);
      console.log('========== RAG-EVAL LLM REQUEST - END ==========\n');

      const startTime = Date.now();

      const llmResponse = await axios.post(
        llmUrl,
        requestBody,
        {
          headers: requestHeaders,
          timeout: 60000 // 60 second timeout
        }
      );

      const endTime = Date.now();
      const evaluationTime = endTime - startTime;

      if (llmResponse.data) {
        console.log('\n========== RAG-EVAL LLM RESPONSE - START ==========');
        console.log('✅ [RAG-EVAL] LLM evaluation completed');
        console.log('✅ [RAG-EVAL] Evaluation time:', evaluationTime, 'ms');
        console.log('✅ [RAG-EVAL] Response Status:', llmResponse.status);
        console.log('✅ [RAG-EVAL] Response Data:', JSON.stringify(llmResponse.data, null, 2));
        console.log('========== RAG-EVAL LLM RESPONSE - END ==========\n');

        return res.json({
          success: true,
          evaluation: llmResponse.data,
          evaluationTime: evaluationTime,
          promptUsed: prompt
        });
      } else {
        throw new Error('Invalid response from LLM API');
      }
    } catch (error) {
      console.error('\n========== RAG-EVAL LLM ERROR - START ==========');
      console.error('❌ [RAG-EVAL] Error evaluating RAG results:', error.message);
      
      if (error.response) {
        console.error('❌ [RAG-EVAL] Response Status:', error.response.status);
        console.error('❌ [RAG-EVAL] Response Status Text:', error.response.statusText);
        console.error('❌ [RAG-EVAL] Response Headers:', JSON.stringify(error.response.headers, null, 2));
        console.error('❌ [RAG-EVAL] Response Data:', JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        console.error('❌ [RAG-EVAL] No response received from server');
        console.error('❌ [RAG-EVAL] Request details:', error.request);
      } else {
        console.error('❌ [RAG-EVAL] Error setting up request:', error.message);
      }
      
      console.error('❌ [RAG-EVAL] Full error stack:', error.stack);
      console.error('========== RAG-EVAL LLM ERROR - END ==========\n');
      
      return res.status(error.response?.status || 500).json({
        success: false,
        message: 'Failed to evaluate RAG results',
        error: error.response?.data?.message || error.message,
        details: error.response?.data,
        statusCode: error.response?.status
      });
    }
  }
}

module.exports = DataCloudModule;

