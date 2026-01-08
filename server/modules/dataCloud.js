const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const csvParser = require('csv-parser');
const path = require('path');

// CSV parsing utilities
/**
 * Fast CSV parsing using streaming csv-parser library
 * This is MUCH faster than the character-by-character approach for large files
 */
function parseCSVFileStream(filePath) {
  return new Promise((resolve, reject) => {
    const headers = [];
    let recordCount = 0;
    const preview = [];
    let headersSet = false;
    
    const startTime = Date.now();
    
    fsSync.createReadStream(filePath)
      .pipe(csvParser())
      .on('headers', (headerList) => {
        headers.push(...headerList);
        headersSet = true;
        console.log(`📋 [CSV STREAMING] Detected ${headerList.length} columns`);
      })
      .on('data', (row) => {
        recordCount++;
        // Keep first 5 records for preview
        if (preview.length < 5) {
          preview.push(row);
        }
        
        // Log progress every 1000 records
        if (recordCount % 1000 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`   📊 Processed ${recordCount.toLocaleString()} records (${elapsed}s)...`);
        }
      })
      .on('end', () => {
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ [CSV STREAMING] Completed: ${recordCount.toLocaleString()} records in ${totalTime}s`);
        
        // Create preview text
        const previewLines = [headers.join(',')];
        preview.forEach(record => {
          const values = headers.map(h => record[h] || '');
          previewLines.push(values.join(','));
        });
        
        resolve({
          headers,
          recordCount,
          preview: previewLines.join('\n')
        });
      })
      .on('error', (error) => {
        console.error(`❌ [CSV STREAMING] Parse error:`, error);
        reject(error);
      });
  });
}

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
  /**
   * Get data streams for ingestion API
   * Exception: Uses Salesforce access token directly (not Data Cloud token)
   * because the endpoint is on Salesforce instance URL, not Data Cloud tenant URL
   */
  async getIngestionStreams(req, res) {
    try {
      const salesforce = req.session?.salesforce;
      
      console.log('🔍 [INGESTION] ========== GET DATA STREAMS REQUEST ==========');
      console.log('🔍 [INGESTION] Session salesforce object:', salesforce ? 'exists' : 'missing');
      
      if (!salesforce) {
        console.error('❌ [INGESTION] No salesforce object in session');
        return res.status(401).json({
          success: false,
          message: 'Not authenticated with Salesforce - no session found'
        });
      }

      console.log('🔍 [INGESTION] Salesforce session keys:', Object.keys(salesforce));
      console.log('🔍 [INGESTION] Has accessToken:', !!salesforce.accessToken);
      console.log('🔍 [INGESTION] Has instanceUrl:', !!salesforce.instanceUrl);
      console.log('🔍 [INGESTION] instanceUrl value:', salesforce.instanceUrl);
      console.log('🔍 [INGESTION] accessToken preview:', salesforce.accessToken ? salesforce.accessToken.substring(0, 20) + '...' : 'missing');

      if (!salesforce.accessToken) {
        console.error('❌ [INGESTION] Missing accessToken in session');
        return res.status(401).json({
          success: false,
          message: 'Not authenticated with Salesforce - no access token found'
        });
      }

      if (!salesforce.instanceUrl) {
        console.error('❌ [INGESTION] Missing instanceUrl in session');
        return res.status(401).json({
          success: false,
          message: 'Not authenticated with Salesforce - no instance URL found'
        });
      }

      // Ensure instanceUrl doesn't have trailing slash
      const instanceUrl = salesforce.instanceUrl.replace(/\/$/, '');
      // Correct URL format: /services/data/v65.0/ssot/data-streams
      const streamsUrl = `${instanceUrl}/services/data/v65.0/ssot/data-streams`;
      
      console.log('📡 [INGESTION] ========== REQUEST DETAILS ==========');
      console.log('📡 [INGESTION] Instance URL:', instanceUrl);
      console.log('📡 [INGESTION] Full Streams URL:', streamsUrl);
      console.log('📡 [INGESTION] Access Token (first 30 chars):', salesforce.accessToken.substring(0, 30) + '...');
      console.log('📡 [INGESTION] Request Method: GET');
      console.log('📡 [INGESTION] Request Headers:', {
        'Authorization': `Bearer ${salesforce.accessToken.substring(0, 20)}...`,
        'Content-Type': 'application/json'
      });

      const response = await axios.get(streamsUrl, {
        headers: {
          'Authorization': `Bearer ${salesforce.accessToken}`,
          'Content-Type': 'application/json'
        },
        validateStatus: function (status) {
          return status < 500; // Don't throw for 4xx errors, we'll handle them
        }
      });

      console.log('📥 [INGESTION] ========== RESPONSE RECEIVED ==========');
      console.log('📥 [INGESTION] Status Code:', response.status);
      console.log('📥 [INGESTION] Status Text:', response.statusText);
      console.log('📥 [INGESTION] Response Headers:', response.headers);
      console.log('📥 [INGESTION] Response Data Type:', typeof response.data);
      console.log('📥 [INGESTION] Response Data Keys:', response.data ? Object.keys(response.data) : 'null');

      if (response.status !== 200) {
        console.error('❌ [INGESTION] Non-200 status code:', response.status);
        console.error('❌ [INGESTION] Response data:', JSON.stringify(response.data, null, 2));
        return res.status(response.status).json({
          success: false,
          message: `Failed to fetch data streams: ${response.status} ${response.statusText}`,
          details: response.data
        });
      }

      console.log('✅ [INGESTION] Response received successfully');
      console.log('📊 [INGESTION] Full response data:', JSON.stringify(response.data, null, 2));

      // Handle different possible response structures
      // The response might be an array directly, or wrapped in a data/items property
      let streams = [];
      if (Array.isArray(response.data)) {
        streams = response.data;
      } else if (response.data.data && Array.isArray(response.data.data)) {
        streams = response.data.data;
      } else if (response.data.items && Array.isArray(response.data.items)) {
        streams = response.data.items;
      } else if (response.data.records && Array.isArray(response.data.records)) {
        streams = response.data.records;
      } else {
        // Try to find any array property
        for (const key in response.data) {
          if (Array.isArray(response.data[key])) {
            streams = response.data[key];
            console.log(`📊 [INGESTION] Found streams array in property: ${key}`);
            break;
          }
        }
      }
      
      console.log('📊 [INGESTION] Extracted streams array length:', streams.length);
      if (streams.length > 0) {
        console.log('📊 [INGESTION] First stream sample:', JSON.stringify(streams[0], null, 2));
        console.log('📊 [INGESTION] First stream keys:', Object.keys(streams[0]));
      } else {
        console.log('⚠️ [INGESTION] No streams found in response');
      }
      
      // Filter for ingestion API type streams and map to simpler format
      // Field name is 'dataStreamType' and value should be 'INGESTAPI'
      const ingestionStreams = streams
        .filter(stream => {
          const dataStreamType = stream.dataStreamType || stream.DataStreamType || stream.dataStreamType__c;
          console.log(`🔍 [INGESTION] Stream: ${stream.name || stream.apiName || stream.label || stream.developerName || 'unnamed'}, dataStreamType: ${dataStreamType}`);
          const isIngestionAPI = dataStreamType === 'INGESTAPI';
          if (isIngestionAPI) {
            console.log('✅ [INGESTION] Found ingestion API stream:', stream.name || stream.apiName || stream.label || stream.developerName);
          }
          return isIngestionAPI;
        })
        .map(stream => ({
          id: stream.id || stream.Id || stream.name || stream.apiName || stream.developerName || stream.DeveloperName,
          apiName: stream.name || stream.apiName || stream.developerName || stream.DeveloperName || stream.FullName,
          name: stream.label || stream.Label || stream.name || stream.apiName || stream.developerName || stream.DeveloperName,
          type: 'ingestion_api',
          object: stream.targetObjectApiName || stream.targetObject || stream.TargetObject__c || 
                 stream.dataSourceObject || stream.object || stream.Object__c
        }));

      console.log(`✅ [INGESTION] ========== SUCCESS ==========`);
      console.log(`✅ [INGESTION] Total streams found: ${streams.length}`);
      console.log(`✅ [INGESTION] Ingestion API streams after filtering: ${ingestionStreams.length}`);
      
      // If no ingestion API streams found but we have streams, log all stream types for debugging
      if (ingestionStreams.length === 0 && streams.length > 0) {
        console.log('⚠️ [INGESTION] No ingestion API streams found. All stream types:');
        streams.forEach((stream, index) => {
          const dataStreamType = stream.dataStreamType || stream.DataStreamType || stream.dataStreamType__c || 'unknown';
          console.log(`  Stream ${index + 1}: ${stream.name || stream.apiName || stream.label || stream.developerName || 'unnamed'} - dataStreamType: ${dataStreamType}`);
        });
      }

      res.json({
        success: true,
        streams: ingestionStreams,
        totalStreams: streams.length,
        filteredStreams: ingestionStreams.length
      });
    } catch (error) {
      console.error('❌ [INGESTION] ========== ERROR ==========');
      console.error('❌ [INGESTION] Error message:', error.message);
      console.error('❌ [INGESTION] Error stack:', error.stack);
      
      if (error.response) {
        console.error('❌ [INGESTION] Response Status:', error.response.status);
        console.error('❌ [INGESTION] Response Status Text:', error.response.statusText);
        console.error('❌ [INGESTION] Response Headers:', error.response.headers);
        console.error('❌ [INGESTION] Response Data:', JSON.stringify(error.response.data, null, 2));
        console.error('❌ [INGESTION] Request URL:', error.config?.url);
        console.error('❌ [INGESTION] Request Method:', error.config?.method);
        console.error('❌ [INGESTION] Request Headers:', error.config?.headers);
      } else if (error.request) {
        console.error('❌ [INGESTION] No response received');
        console.error('❌ [INGESTION] Request details:', {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers
        });
      }
      
      res.status(error.response?.status || 500).json({
        success: false,
        message: 'Failed to fetch data streams: ' + (error.response?.data?.message || error.message),
        details: error.response?.data,
        error: error.message
      });
    }
  }

  /**
   * Authenticate with Salesforce using client credentials (2-step process for Ingestion API only)
   */
  async authenticateForIngestion(req, res) {
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

      const orgKey = salesforce.orgKey;
      const orgName = orgKey?.replace(/^org_\d+_/, '') || '';
      
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

      console.log('🔐 [INGESTION] ========== STEP 1: Getting Temporary Core Access Token ==========');
      console.log('🔐 [INGESTION] Using client credentials flow (client_credentials grant type)');
      console.log('🔐 [INGESTION] Instance URL:', instanceUrl);
      console.log('🔐 [INGESTION] Client ID:', orgConfig.dataCloudClientId.substring(0, 20) + '...');

      // STEP 1: Get temporary Salesforce core access token using client credentials
      const coreTokenFormData = new URLSearchParams();
      coreTokenFormData.append('grant_type', 'client_credentials');
      coreTokenFormData.append('client_id', orgConfig.dataCloudClientId);
      coreTokenFormData.append('client_secret', orgConfig.dataCloudClientSecret);

      console.log('🔐 [INGESTION] STEP 1 REQUEST:');
      console.log('  URL:', `${instanceUrl}/services/oauth2/token`);
      console.log('  Method: POST');
      console.log('  Grant Type: client_credentials');

      const coreTokenResponse = await axios.post(
        `${instanceUrl}/services/oauth2/token`,
        coreTokenFormData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const temporaryCoreToken = coreTokenResponse.data.access_token;

      if (!temporaryCoreToken) {
        throw new Error('Failed to retrieve temporary core access token');
      }

      console.log('✅ [INGESTION] STEP 1 COMPLETE: Temporary core access token retrieved');
      console.log('✅ [INGESTION] Token (first 20 chars):', temporaryCoreToken.substring(0, 20) + '...');

      // Return the temporary token (frontend will use it to get Data Cloud token)
      res.json({
        success: true,
        accessToken: temporaryCoreToken
      });
    } catch (error) {
      console.error('❌ [INGESTION] Authentication error:', error.response?.data || error.message);
      res.status(500).json({
        success: false,
        message: 'Authentication failed: ' + (error.response?.data?.message || error.message)
      });
    }
  }

  /**
   * Get Data Cloud access token
   * STEP 2: Exchange temporary Salesforce token for Data Cloud access token
   */
  async getDataCloudToken(req, res) {
    try {
      const { sfdcToken } = req.body;
      const salesforce = req.session?.salesforce;

      if (!sfdcToken) {
        return res.status(400).json({
          success: false,
          message: 'No Salesforce token provided'
        });
      }

      if (!salesforce || !salesforce.instanceUrl) {
        return res.status(401).json({
          success: false,
          message: 'Not authenticated with Salesforce'
        });
      }

      const instanceUrl = salesforce.instanceUrl;

      console.log('🌥️ [INGESTION] ========== STEP 2: Getting Data Cloud Access Token ==========');
      console.log('🌥️ [INGESTION] Instance URL:', instanceUrl);
      console.log('🌥️ [INGESTION] Using temporary Salesforce token from STEP 1');

      // STEP 2: Use temporary token to get Data Cloud access token
      // Use form-encoded body (not query parameters) for external CDP grant type
      const dcTokenFormData = new URLSearchParams();
      dcTokenFormData.append('grant_type', 'urn:salesforce:grant-type:external:cdp');
      dcTokenFormData.append('subject_token', sfdcToken);
      dcTokenFormData.append('subject_token_type', 'urn:ietf:params:oauth:token-type:access_token');

      console.log('🌥️ [INGESTION] STEP 2 REQUEST:');
      console.log('  URL:', `${instanceUrl}/services/a360/token`);
      console.log('  Method: POST');
      console.log('  Headers:', { 'Content-Type': 'application/x-www-form-urlencoded' });
      console.log('  Body:', {
        grant_type: 'urn:salesforce:grant-type:external:cdp',
        subject_token: sfdcToken.substring(0, 20) + '...',
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

      console.log('🌥️ [INGESTION] STEP 2 RESPONSE:');
      console.log('  Status:', dcTokenResponse.status);
      console.log('  Data:', {
        ...dcTokenResponse.data,
        access_token: dcTokenResponse.data.access_token ? dcTokenResponse.data.access_token.substring(0, 20) + '...' : 'N/A',
        instance_url: dcTokenResponse.data.instance_url || 'N/A'
      });

      if (!dcTokenResponse.data || !dcTokenResponse.data.access_token) {
        throw new Error('Invalid response from Data Cloud token endpoint');
      }

      const dcAccessToken = dcTokenResponse.data.access_token;
      const dcTenantUrl = dcTokenResponse.data.instance_url;

      console.log('✅ [INGESTION] STEP 2 COMPLETE: Data Cloud access token retrieved');
      console.log('✅ [INGESTION] Data Cloud tenant URL:', dcTenantUrl);
      console.log('✅ [INGESTION] ========== 2-STEP AUTHENTICATION SUCCESSFUL ==========');

      res.json({
        success: true,
        accessToken: dcAccessToken,
        instanceUrl: dcTenantUrl,
        expiresIn: dcTokenResponse.data.expires_in
      });
    } catch (error) {
      console.error('❌ [INGESTION] ========== STEP 2 FAILED ==========');
      console.error('❌ [INGESTION] Error:', error.message);
      
      if (error.response) {
        console.error('❌ [INGESTION] Response Status:', error.response.status);
        console.error('❌ [INGESTION] Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      
      res.status(500).json({
        success: false,
        message: 'Failed to get Data Cloud token: ' + (error.response?.data?.error_description || error.response?.data?.message || error.message)
      });
    }
  }

  /**
   * Get Data Cloud access token for ingestion (2-step process handled internally)
   * This method combines both authentication steps into a single call
   */
  async getDataCloudTokenForIngestion(req, res) {
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

      const orgKey = salesforce.orgKey;
      const orgName = orgKey?.replace(/^org_\d+_/, '') || '';
      
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

      console.log('🔐 [INGESTION] ========== STARTING 2-STEP AUTHENTICATION ==========');
      
      // ========== STEP 1: Get temporary Salesforce core access token ==========
      console.log('🔐 [INGESTION] STEP 1: Getting temporary core access token using client credentials...');
      console.log('🔐 [INGESTION] Instance URL:', instanceUrl);
      console.log('🔐 [INGESTION] Client ID:', orgConfig.dataCloudClientId.substring(0, 20) + '...');

      const coreTokenFormData = new URLSearchParams();
      coreTokenFormData.append('grant_type', 'client_credentials');
      coreTokenFormData.append('client_id', orgConfig.dataCloudClientId);
      coreTokenFormData.append('client_secret', orgConfig.dataCloudClientSecret);

      const coreTokenResponse = await axios.post(
        `${instanceUrl}/services/oauth2/token`,
        coreTokenFormData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const temporaryCoreToken = coreTokenResponse.data.access_token;

      if (!temporaryCoreToken) {
        throw new Error('Failed to retrieve temporary core access token');
      }

      console.log('✅ [INGESTION] STEP 1 COMPLETE: Temporary core access token retrieved');
      console.log('✅ [INGESTION] Token (first 20 chars):', temporaryCoreToken.substring(0, 20) + '...');

      // ========== STEP 2: Exchange temporary token for Data Cloud access token ==========
      console.log('🌥️ [INGESTION] STEP 2: Exchanging temporary token for Data Cloud access token...');

      const dcTokenFormData = new URLSearchParams();
      dcTokenFormData.append('grant_type', 'urn:salesforce:grant-type:external:cdp');
      dcTokenFormData.append('subject_token', temporaryCoreToken);
      dcTokenFormData.append('subject_token_type', 'urn:ietf:params:oauth:token-type:access_token');

      console.log('🌥️ [INGESTION] STEP 2 REQUEST:');
      console.log('  URL:', `${instanceUrl}/services/a360/token`);
      console.log('  Method: POST');
      console.log('  Grant Type: urn:salesforce:grant-type:external:cdp');

      const dcTokenResponse = await axios.post(
        `${instanceUrl}/services/a360/token`,
        dcTokenFormData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (!dcTokenResponse.data || !dcTokenResponse.data.access_token) {
        throw new Error('Invalid response from Data Cloud token endpoint');
      }

      const dcAccessToken = dcTokenResponse.data.access_token;
      const dcTenantUrl = dcTokenResponse.data.instance_url;

      console.log('✅ [INGESTION] STEP 2 COMPLETE: Data Cloud access token retrieved');
      console.log('✅ [INGESTION] Data Cloud tenant URL:', dcTenantUrl);
      console.log('✅ [INGESTION] ========== 2-STEP AUTHENTICATION SUCCESSFUL ==========');

      res.json({
        success: true,
        accessToken: dcAccessToken,
        instanceUrl: dcTenantUrl,
        expiresIn: dcTokenResponse.data.expires_in
      });
    } catch (error) {
      console.error('❌ [INGESTION] ========== 2-STEP AUTHENTICATION FAILED ==========');
      console.error('❌ [INGESTION] Error:', error.message);
      
      if (error.response) {
        console.error('❌ [INGESTION] Response Status:', error.response.status);
        console.error('❌ [INGESTION] Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      
      res.status(500).json({
        success: false,
        message: 'Failed to get Data Cloud token: ' + (error.response?.data?.error_description || error.response?.data?.message || error.message)
      });
    }
  }

  /**
   * Create ingestion job
   */
  async createIngestionJob(req, res) {
    try {
      const { tenantUrl, accessToken, object, sourceName, operation } = req.body;

      console.log('📝 [INGESTION] ========== Creating Ingestion Job ==========');
      console.log('📝 [INGESTION] Request body:', {
        tenantUrl: tenantUrl ? tenantUrl.substring(0, 50) + '...' : 'MISSING',
        object: object || 'MISSING',
        sourceName: sourceName || 'MISSING',
        operation: operation || 'upsert',
        accessToken: accessToken ? accessToken.substring(0, 20) + '...' : 'MISSING'
      });

      // Validate required fields
      if (!tenantUrl) {
        return res.status(400).json({
          success: false,
          message: 'tenantUrl is required'
        });
      }
      if (!accessToken) {
        return res.status(400).json({
          success: false,
          message: 'accessToken is required'
        });
      }
      if (!object) {
        return res.status(400).json({
          success: false,
          message: 'object is required'
        });
      }
      if (!sourceName) {
        return res.status(400).json({
          success: false,
          message: 'sourceName is required'
        });
      }

      // CRITICAL: Verify we're using the Data Cloud access token from request body, NOT session token
      // The accessToken in req.body comes from the 2-step authentication process (get-dc-token endpoint)
      // This is the Data Cloud access token, NOT the Salesforce session token
      console.log('🔑 [INGESTION] Using Data Cloud access token from request body (from 2-step auth)');
      console.log('🔑 [INGESTION] Token length:', accessToken ? accessToken.length : 0);
      console.log('🔑 [INGESTION] Token preview (first 30 chars):', accessToken ? accessToken.substring(0, 30) + '...' : 'MISSING');
      
      // Verify we're NOT accidentally using Salesforce session token
      const salesforce = req.session?.salesforce;
      if (salesforce?.accessToken) {
        console.log('⚠️ [INGESTION] Salesforce session token exists (should NOT be used for Data Cloud API)');
        console.log('⚠️ [INGESTION] Salesforce token preview:', salesforce.accessToken.substring(0, 30) + '...');
        console.log('✅ [INGESTION] Confirmed: Using Data Cloud token from request, NOT Salesforce session token');
      }

      // Handle tenantUrl - it might already include https://
      let normalizedTenantUrl = tenantUrl;
      if (normalizedTenantUrl && normalizedTenantUrl.startsWith('https://')) {
        normalizedTenantUrl = normalizedTenantUrl.replace(/^https:\/\//, '');
      }
      
      const jobUrl = `https://${normalizedTenantUrl}/api/v1/ingest/jobs`;
      console.log('📝 [INGESTION] Job URL:', jobUrl);
      console.log('📝 [INGESTION] Payload:', {
        object: object,
        sourceName: sourceName,
        operation: operation || 'upsert'
      });
      console.log('🔑 [INGESTION] Authorization header will use Data Cloud token (Bearer token)');

      const response = await axios.post(jobUrl, {
        object: object,
        sourceName: sourceName,
        operation: operation || 'upsert'
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`, // Using Data Cloud access token from request body
          'Content-Type': 'application/json'
        }
      });

      console.log('📝 [INGESTION] Response Status:', response.status);
      console.log('📝 [INGESTION] Response Data:', JSON.stringify(response.data, null, 2));

      const jobId = response.data.id;
      console.log('✅ [INGESTION] Job created successfully:', jobId);

      res.json({
        success: true,
        jobId: jobId,
        jobData: response.data
      });
    } catch (error) {
      console.error('❌ [INGESTION] ========== Error Creating Job ==========');
      console.error('❌ [INGESTION] Error message:', error.message);
      
      if (error.response) {
        console.error('❌ [INGESTION] Response Status:', error.response.status);
        console.error('❌ [INGESTION] Response Headers:', error.response.headers);
        console.error('❌ [INGESTION] Response Data:', JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        console.error('❌ [INGESTION] Request was made but no response received');
        console.error('❌ [INGESTION] Request details:', {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers
        });
      }
      
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.error_description || 
                          error.response?.data?.error ||
                          error.message;
      
      res.status(error.response?.status || 500).json({
        success: false,
        message: 'Failed to create ingestion job: ' + errorMessage,
        details: error.response?.data || { message: error.message }
      });
    }
  }

  /**
   * Upload file batch
   * Reads file from filesystem and uploads to Data Cloud ingestion API
   */
  async uploadBatch(req, res) {
    try {
      const { tenantUrl, accessToken, jobId, filePath, fileName, baseFolderName, baseDirectory } = req.body;

      if (!filePath && !fileName) {
        return res.status(400).json({
          success: false,
          message: 'No file path or name provided'
        });
      }

      // Get base directory - same logic as processCSVFile
      let baseDir = (baseDirectory && baseDirectory.trim()) || process.env.CSV_BASE_DIR;
      
      if (!baseDir || baseDir.trim() === '') {
        const os = require('os');
        baseDir = path.join(os.homedir(), 'Downloads');
        console.log(`ℹ️ [INGESTION] No base directory specified, defaulting to: ${baseDir}`);
      }

      // Construct full path to file (same logic as processCSVFile)
      let pathToRead;
      if (filePath) {
        pathToRead = path.join(baseDir, filePath);
      } else {
        if (baseFolderName) {
          pathToRead = path.join(baseDir, baseFolderName, fileName);
        } else {
          pathToRead = path.join(baseDir, fileName);
        }
      }
      
      pathToRead = path.normalize(pathToRead);
      
      // Security check
      const resolvedBaseDir = path.resolve(baseDir);
      const resolvedPath = path.resolve(pathToRead);
      if (!resolvedPath.startsWith(resolvedBaseDir)) {
        return res.status(403).json({
          success: false,
          message: 'Invalid file path: Path must be within the configured base directory',
          fileName: fileName
        });
      }

      console.log('📤 [INGESTION] Uploading batch...');
      console.log('   Job ID:', jobId);
      console.log('   File path:', pathToRead);

      // Read file from filesystem
      let fileBuffer;
      try {
        fileBuffer = await fs.readFile(pathToRead);
        console.log(`   File size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);
      } catch (readError) {
        console.error(`❌ [INGESTION] Error reading file:`, readError);
        return res.status(404).json({
          success: false,
          message: `File not found: ${pathToRead}. Error: ${readError.message}`,
          fileName: fileName || path.basename(pathToRead)
        });
      }

      // Upload to Data Cloud
      const uploadUrl = `https://${tenantUrl}/api/v1/ingest/jobs/${jobId}/batches`;
      const response = await axios.put(uploadUrl, fileBuffer, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'text/csv'
        }
      });

      console.log('✅ [INGESTION] Batch uploaded successfully:', response.data.id);

      res.json({
        success: true,
        batchId: response.data.id,
        batchData: response.data
      });
    } catch (error) {
      console.error('❌ [INGESTION] Error uploading batch:', error.response?.data || error.message);
      res.status(500).json({
        success: false,
        message: 'Failed to upload batch: ' + (error.response?.data?.message || error.message)
      });
    }
  }

  /**
   * Get data stream details/schema
   */
  async getStreamDetails(req, res) {
    try {
      const { streamId } = req.params;
      const salesforce = req.session?.salesforce;
      
      if (!salesforce || !salesforce.accessToken || !salesforce.instanceUrl) {
        return res.status(401).json({
          success: false,
          message: 'Not authenticated with Salesforce'
        });
      }

      console.log('🔍 [INGESTION] Fetching stream details for:', streamId);

      const instanceUrl = salesforce.instanceUrl.replace(/\/$/, '');
      const baseUrl = `${instanceUrl}/services/data/v65.0`;
      const detailsUrl = `${baseUrl}/ssot/data-streams/${streamId}`;
      
      console.log('📡 [INGESTION] Fetching stream details from:', detailsUrl);
      
      const response = await axios.get(detailsUrl, {
        headers: {
          'Authorization': `Bearer ${salesforce.accessToken}`,
          'Content-Type': 'application/json'
        },
        validateStatus: function (status) {
          return status < 500;
        }
      });

      if (response.status !== 200) {
        console.error('❌ [INGESTION] Failed to fetch stream details:', response.status, response.data);
        return res.status(response.status).json({
          success: false,
          message: `Failed to fetch stream details: ${response.status} ${response.statusText}`,
          details: response.data
        });
      }

      console.log('✅ [INGESTION] Stream details retrieved');
      console.log('📊 [INGESTION] Details:', JSON.stringify(response.data, null, 2));

      const streamDetails = response.data;
      let sourceName = null;
      let targetObject = null;
      let connectionDetailsData = null;
      let connectionSchemaData = null;

      // Step 1: Extract dataSource from stream details
      const datasource = streamDetails.dataSource;
      console.log('📋 [INGESTION] Extracted dataSource:', datasource);

      if (datasource) {
        try {
          // Step 2: Get dataConnectionId from connections API
          const connectionsUrl = `${baseUrl}/ssot/connections?connectorType=IngestApi&devName=${encodeURIComponent(datasource)}`;
          console.log('📡 [INGESTION] Fetching connections from:', connectionsUrl);
          
          const connectionsResponse = await axios.get(connectionsUrl, {
            headers: {
              'Authorization': `Bearer ${salesforce.accessToken}`,
              'Content-Type': 'application/json'
            }
          });

          console.log('✅ [INGESTION] Connections retrieved:', JSON.stringify(connectionsResponse.data, null, 2));
          
          // Extract dataConnectionId (Id field)
          let dataConnectionId = null;
          if (connectionsResponse.data.connections && Array.isArray(connectionsResponse.data.connections)) {
            // If response is an array
            if (connectionsResponse.data.connections.length > 0) {
              dataConnectionId = connectionsResponse.data.connections[0].Id || connectionsResponse.data.connections[0].id;
            }
          } 

          console.log('🔑 [INGESTION] Extracted dataConnectionId:', dataConnectionId);

          if (dataConnectionId) {
            // Step 3: Get sourceName (label field) from connection details
            const connectionDetailsUrl = `${baseUrl}/ssot/connections/${dataConnectionId}`;
            console.log('📡 [INGESTION] Fetching connection details from:', connectionDetailsUrl);
            
            const connectionDetailsResponse = await axios.get(connectionDetailsUrl, {
              headers: {
                'Authorization': `Bearer ${salesforce.accessToken}`,
                'Content-Type': 'application/json'
              }
            });

            console.log('✅ [INGESTION] Connection details retrieved:', JSON.stringify(connectionDetailsResponse.data, null, 2));
            connectionDetailsData = connectionDetailsResponse.data; // Store full connection details
            sourceName = connectionDetailsResponse.data.label || connectionDetailsResponse.data.Label;
            console.log('📝 [INGESTION] Extracted sourceName (label):', sourceName);

            // Step 4: Get targetObject (name field) from connection schema
            const schemaUrl = `${baseUrl}/ssot/connections/${dataConnectionId}/schema`;
            console.log('📡 [INGESTION] Fetching connection schema from:', schemaUrl);
            
            const schemaResponse = await axios.get(schemaUrl, {
              headers: {
                'Authorization': `Bearer ${salesforce.accessToken}`,
                'Content-Type': 'application/json'
              }
            });

            console.log('✅ [INGESTION] Connection schema retrieved:', JSON.stringify(schemaResponse.data, null, 2));
            connectionSchemaData = schemaResponse.data; // Store full connection schema
            targetObject = schemaResponse.data.schemas[0].name || schemaResponse.data.schemas[0].Name;
            console.log('📦 [INGESTION] Extracted targetObject (name):', targetObject);
          } else {
            console.warn('⚠️ [INGESTION] No dataConnectionId found in connections response');
          }
        } catch (extraError) {
          console.error('⚠️ [INGESTION] Error fetching additional connection details:', extraError.message);
          console.error('⚠️ [INGESTION] Error details:', extraError.response?.data || extraError);
          // Continue even if additional calls fail
        }
      } else {
        console.warn('⚠️ [INGESTION] No dataSource field found in stream details');
      }

      res.json({
        success: true,
        details: streamDetails,
        sourceName: sourceName,
        object: targetObject,
        connectionDetails: connectionDetailsData,
        connectionSchema: connectionSchemaData
      });
    } catch (error) {
      console.error('❌ [INGESTION] Error fetching stream details:', error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        success: false,
        message: 'Failed to fetch stream details: ' + (error.response?.data?.message || error.message),
        details: error.response?.data
      });
    }
  }

  /**
   * Process a single CSV file - parse and count records
   * Reads file directly from filesystem using provided path
   * Note: Browser security prevents full paths, so we use webkitRelativePath or filename
   * and combine with a base directory from environment variable CSV_BASE_DIR
   */
  async processCSVFile(req, res) {
    try {
      const { filePath, fileName, fileSize, expectedHeaders, baseFolderName, baseDirectory } = req.body;
      
      if (!filePath && !fileName) {
        return res.status(400).json({
          success: false,
          message: 'No file path provided'
        });
      }

      // Get base directory - prioritize user-provided baseDirectory, then environment variable, then default to Downloads
      // Handle empty string as "not provided"
      let baseDir = (baseDirectory && baseDirectory.trim()) || process.env.CSV_BASE_DIR;
      
      if (!baseDir || baseDir.trim() === '') {
        // Default to Downloads folder as fallback
        const os = require('os');
        baseDir = path.join(os.homedir(), 'Downloads');
        console.log(`ℹ️ [CSV PROCESSING] No base directory specified, defaulting to: ${baseDir}`);
      }
      
      console.log(`📂 [CSV PROCESSING] Using base directory: ${baseDir}`);
      
      // Construct full path to file
      let pathToRead;
      if (filePath) {
        // filePath is webkitRelativePath (e.g., "csvs-test-0107/networking_part_4.csv")
        // Combine with baseDir to get full path
        // If baseDir is Downloads, result will be: ~/Downloads/csvs-test-0107/networking_part_4.csv
        pathToRead = path.join(baseDir, filePath);
      } else {
        // Individual file selection - only filename available
        // If baseFolderName is provided, use it (e.g., "csvs-test-0107")
        if (baseFolderName) {
          pathToRead = path.join(baseDir, baseFolderName, fileName);
        } else {
          // Try file directly in baseDir
          pathToRead = path.join(baseDir, fileName);
        }
      }
      
      // Normalize path to handle any .. or . segments
      pathToRead = path.normalize(pathToRead);
      
      // Security check: ensure path is within baseDir (prevent directory traversal)
      const resolvedBaseDir = path.resolve(baseDir);
      const resolvedPath = path.resolve(pathToRead);
      if (!resolvedPath.startsWith(resolvedBaseDir)) {
        console.error(`❌ [CSV PROCESSING] Security violation: Path outside base directory`);
        return res.status(403).json({
          success: false,
          message: 'Invalid file path: Path must be within the configured base directory',
          fileName: fileName
        });
      }
      
      console.log(`📄 [CSV PROCESSING] Base directory: ${baseDir}`);
      console.log(`📄 [CSV PROCESSING] File name: ${fileName}`);
      console.log(`📄 [CSV PROCESSING] Relative path from frontend: ${filePath || 'N/A'}`);
      console.log(`📄 [CSV PROCESSING] Full path to read: ${pathToRead}`);

      // Check if file exists before reading
      try {
        await fs.access(pathToRead, fs.constants.F_OK);
      } catch (accessError) {
        console.error(`❌ [CSV PROCESSING] File does not exist: ${pathToRead}`);
        console.error(`   Base directory: ${baseDir}`);
        console.error(`   File path from frontend: ${filePath || 'N/A'}`);
        console.error(`   File name: ${fileName}`);
        
        let errorMessage = `File not found: ${pathToRead}`;
        
        // Provide helpful context
        if (!filePath && !baseFolderName) {
          errorMessage += `. Tip: When selecting individual files, they must be directly in the base directory (${baseDir}). If your files are in subfolders, use "Select Folder" instead or set the base directory to the exact folder containing the files.`;
        }
        
        return res.status(404).json({
          success: false,
          message: errorMessage,
          fileName: fileName,
          attemptedPath: pathToRead,
          baseDirectory: baseDir,
          relativePath: filePath || null
        });
      }

      // Get file size
      let actualFileSize;
      try {
        const stats = await fs.stat(pathToRead);
        actualFileSize = stats.size;
        console.log(`📄 [CSV PROCESSING] Starting to parse: ${pathToRead} (${(actualFileSize / 1024 / 1024).toFixed(2)} MB)`);
      } catch (statError) {
        console.error(`❌ [CSV PROCESSING] Error getting file stats:`, statError);
        return res.status(500).json({
          success: false,
          message: `Error accessing file: ${statError.message}`,
          fileName: fileName,
          attemptedPath: pathToRead
        });
      }
      
      // Parse CSV using streaming parser (10-100x faster for large files!)
      const parseStartTime = Date.now();
      const result = await parseCSVFileStream(pathToRead);
      const parseTime = ((Date.now() - parseStartTime) / 1000).toFixed(2);
      
      // Validate headers match expected headers (if provided)
      if (expectedHeaders) {
        const normalizedExpected = expectedHeaders.map(h => h.trim().toLowerCase());
        const normalizedGot = result.headers.map(h => h.trim().toLowerCase());
        
        if (JSON.stringify(normalizedExpected) !== JSON.stringify(normalizedGot)) {
          return res.status(400).json({
            success: false,
            message: `Header mismatch in file "${fileName || pathToRead}". Expected: ${expectedHeaders.join(', ')}, Got: ${result.headers.join(', ')}`,
            fileName: fileName || pathToRead
          });
        }
      }
      
      console.log(`✅ [CSV PROCESSING] File processed in ${parseTime}s: ${fileName || pathToRead} - ${result.recordCount.toLocaleString()} records, ${result.headers.length} columns`);

      res.json({
        success: true,
        fileName: fileName || path.basename(pathToRead),
        filePath: pathToRead,
        fileSize: actualFileSize,
        recordCount: result.recordCount,
        headers: result.headers,
        headerCount: result.headers.length,
        preview: result.preview
      });
    } catch (error) {
      console.error('❌ [CSV PROCESSING] Error processing CSV:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process CSV file: ' + error.message,
        fileName: req.body?.fileName || req.body?.filePath
      });
    }
  }

  /**
   * Complete ingestion job
   */
  async completeIngestionJob(req, res) {
    try {
      const { tenantUrl, accessToken, jobId } = req.body;

      console.log('✔️ [INGESTION] Completing ingestion job:', jobId);

      const completeUrl = `https://${tenantUrl}/api/v1/ingest/jobs/${jobId}`;
      const response = await axios.patch(completeUrl, {
        state: 'UploadComplete'
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ [INGESTION] Job completed successfully');

      res.json({
        success: true,
        jobData: response.data
      });
    } catch (error) {
      console.error('❌ [INGESTION] Error completing job:', error.response?.data || error.message);
      res.status(500).json({
        success: false,
        message: 'Failed to complete ingestion job: ' + (error.response?.data?.message || error.message)
      });
    }
  }
}

module.exports = DataCloudModule;

