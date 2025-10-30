const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class AgentforceModule {
  constructor() {
    this.moduleName = 'AgentforceModule';
    this.description = 'Salesforce Agentforce API integration using official Agent API';
    this.version = '3.0.0';
    
    // Store active agentforce sessions
    this.activeAgentSessions = new Map();
    
    // Store API logs for all sessions (including ended ones)
    this.apiLogs = new Map();
    
    console.log(`🔗 [${this.moduleName}] Initialized - ${this.description} v${this.version}`);
    console.log(`🤖 [AGENTFORCE] Agent ID will be retrieved from org configuration`);
  }

  /**
   * Get the configured Agentforce agent from current org configuration
   * @param {Object} req - Express request object
   * @returns {Object} Response with agent info
   */
  async getAvailableAgents(req) {
    try {
      console.log('🔍 [AGENTFORCE] Getting configured agent from current org...');
      
      // Get the current org's configuration using orgKey from session
      const orgKey = req.session.salesforce?.orgKey;
      if (!orgKey) {
        return {
          success: false,
          message: 'No organization selected. Please login first.',
          agents: []
        };
      }

      // Get org configuration from login module
      const loginModule = req.app.locals.loginModule;
      if (!loginModule) {
        return {
          success: false,
          message: 'Login module not available.',
          agents: []
        };
      }

      const orgConfig = loginModule.getOrgConfiguration(orgKey);
      if (!orgConfig) {
        return {
          success: false,
          message: 'Organization configuration not found.',
          agents: []
        };
      }

      // Get agent ID from org configuration
      const agentId = orgConfig.agentId;
      if (!agentId) {
        return {
          success: false,
          message: 'No agent ID configured for this organization. Please add agentId to org configuration.',
          agents: []
        };
      }

      // Return the single configured agent for this org
      const agent = {
        id: agentId,
        name: 'AI Service Assistant',
        type: 'Agentforce Agent',
        description: `AI-powered service assistant for ${orgConfig.name || 'this Salesforce org'}`
      };
      
      console.log(`✅ [AGENTFORCE] Found configured agent for org ${orgConfig.name}: ${agent.name} (${agent.id})`);
      
      return {
        success: true,
        message: 'Agent configuration loaded successfully',
        agents: [agent]
      };
      
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error getting agent configuration:', error);
      return {
        success: false,
        message: 'Failed to load agent configuration: ' + error.message,
        agents: []
      };
    }
  }

    /**
   * Send chat message to Agentforce agent using official Agent API
   * @param {Object} req - Express request object
   * @returns {Object} Response with agent reply
   */
  async sendChatMessage(req) {
    try {
      const { message, sessionId } = req.body;
      
      if (!message || !sessionId) {
        return {
          success: false,
          message: 'Missing required parameters: message and sessionId'
        };
      }

      console.log(`💬 [AGENTFORCE] Sending message via Agent API, agentforce session ${sessionId}`);
      
      // Check if agentforce session exists and is active
      const agentSessionInfo = this.activeAgentSessions.get(sessionId);
      if (!agentSessionInfo) {
        return {
          success: false,
          message: 'Invalid or expired agentforce session. Please start a new session.'
        };
      }

      // Send message using Salesforce Agent API
      const response = await this.sendMessageViaAgentAPI(sessionId, message);
      
      console.log(`✅ [AGENTFORCE] Agent response received via Agent API`);
      
      return {
        success: true,
        message: 'Message sent successfully via Agent API',
        response: response.message,
        agentName: response.agentName,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error sending chat message via Agent API:', error);
      // Throw error to let endpoint handler deal with it and return full error details
      throw error;
    }
  }

  /**
   * Query Salesforce for Agentforce agents using SOQL
   * @param {Object} orgConfig - Organization configuration
   * @returns {Array} Array of agent objects
   */
  async queryAgentforceAgents(orgConfig) {
    try {
      const accessToken = orgConfig.accessToken;
      const instanceUrl = orgConfig.instanceUrl;
      
      // SOQL query to get Agentforce agents
      // Note: This is a generic query - adjust based on your specific Agentforce setup
      const soqlQuery = `
        SELECT Id, Name, Email, Phone, vlocity_cmt__AgentType__c, 
               vlocity_cmt__Status__c, vlocity_cmt__IsActive__c,
               vlocity_cmt__AgentCode__c, vlocity_cmt__Skills__c
        FROM vlocity_cmt__Agent__c 
        WHERE vlocity_cmt__IsActive__c = true 
        AND vlocity_cmt__Status__c = 'Active'
        ORDER BY Name
      `;
      
      const response = await axios.get(`${instanceUrl}/services/data/v58.0/query`, {
        params: { q: soqlQuery },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.records && response.data.records.length > 0) {
        return response.data.records.map(record => ({
          id: record.Id,
          name: record.Name || 'Unknown Agent',
          email: record.Email,
          phone: record.Phone,
          type: record.vlocity_cmt__AgentType__c || 'Agent',
          status: record.vlocity_cmt__Status__c,
          isActive: record.vlocity_cmt__IsActive__c,
          agentCode: record.vlocity_cmt__AgentCode__c,
          skills: record.vlocity_cmt__Skills__c ? record.vlocity_cmt__Skills__c.split(';') : []
        }));
      }
      
      return [];
      
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error querying agents:', error);
      
      // If the specific Agentforce objects don't exist, try alternative queries
      if (error.response?.status === 400) {
        console.log('🔄 [AGENTFORCE] Trying alternative agent query...');
        return await this.queryAlternativeAgents(orgConfig);
      }
      
      throw error;
    }
  }

  /**
   * Alternative query for agents if Agentforce objects don't exist
   * @param {Object} orgConfig - Organization configuration
   * @returns {Array} Array of agent objects
   */
  async queryAlternativeAgents(orgConfig) {
    try {
      const accessToken = orgConfig.accessToken;
      const instanceUrl = orgConfig.instanceUrl;
      
      // Try to find users or contacts that might be agents
      const soqlQuery = `
        SELECT Id, Name, Email, Phone, Profile.Name, UserRole.Name,
               IsActive, UserType
        FROM User 
        WHERE IsActive = true 
        AND (Profile.Name LIKE '%Agent%' OR UserRole.Name LIKE '%Agent%' OR UserRole.Name LIKE '%Support%')
        ORDER BY Name
        LIMIT 50
      `;
      
      const response = await axios.get(`${instanceUrl}/services/data/v58.0/query`, {
        params: { q: soqlQuery },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.records && response.data.records.length > 0) {
        return response.data.records.map(record => ({
          id: record.Id,
          name: record.Name || 'Unknown Agent',
          email: record.Email,
          phone: record.Phone,
          type: record.UserRole?.Name || record.Profile?.Name || 'Agent',
          status: record.IsActive ? 'Active' : 'Inactive',
          isActive: record.IsActive,
          agentCode: record.Id,
          skills: []
        }));
      }
      
      // If no users found, return mock agents for testing
      console.log('🔄 [AGENTFORCE] No agents found, returning mock data for testing');
      return this.getMockAgents();
      
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error querying alternative agents:', error);
      console.log('🔄 [AGENTFORCE] Returning mock agents for testing');
      return this.getMockAgents();
    }
  }

  /**
   * Get mock agents for testing purposes
   * @returns {Array} Array of mock agent objects
   */
  getMockAgents() {
    return [
      {
        id: 'mock-agent-1',
        name: 'Sarah Johnson',
        email: 'sarah.johnson@company.com',
        phone: '+1-555-0101',
        type: 'Customer Service Agent',
        status: 'Active',
        isActive: true,
        agentCode: 'CS001',
        skills: ['Customer Service', 'Billing', 'Technical Support']
      },
      {
        id: 'mock-agent-2',
        name: 'Mike Chen',
        email: 'mike.chen@company.com',
        phone: '+1-555-0102',
        type: 'Technical Support Agent',
        status: 'Active',
        isActive: true,
        agentCode: 'TS001',
        skills: ['Technical Support', 'Product Knowledge', 'Troubleshooting']
      },
      {
        id: 'mock-agent-3',
        name: 'Lisa Rodriguez',
        email: 'lisa.rodriguez@company.com',
        phone: '+1-555-0103',
        type: 'Sales Agent',
        status: 'Active',
        isActive: true,
        agentCode: 'SA001',
        skills: ['Sales', 'Product Knowledge', 'Customer Relations']
      }
    ];
  }

  /**
   * Start a new agentforce session using Salesforce Agent API
   * @param {Object} req - Express request object
   * @returns {Object} Response with agentforce session details
   */
  async startAgentSession(req) {
    try {
      console.log('🔗 [AGENTFORCE] Starting new agentforce session...');
      
      // Get the current org's configuration using orgKey from web session
      const orgKey = req.session.salesforce?.orgKey;
      if (!orgKey) {
        return {
          success: false,
          message: 'No organization selected. Please login first.'
        };
      }

      // Get org configuration from login module
      const loginModule = req.app.locals.loginModule;
      if (!loginModule) {
        return {
          success: false,
          message: 'Login module not available.'
        };
      }

      const orgConfig = loginModule.getOrgConfiguration(orgKey);
      if (!orgConfig) {
        return {
          success: false,
          message: 'Organization configuration not found.'
        };
      }

      // Get agent ID from org configuration
      const agentId = orgConfig.agentId;
      if (!agentId) {
        return {
          success: false,
          message: 'No agent ID configured for this organization. Please add agentId to org configuration.'
        };
      }

      // Get agent type from org configuration (AEA or ASA)
      const agentType = orgConfig.agentType || 'ASA'; // Default to ASA if not specified
      
      // Determine bypassUser based on agent type
      // AEA (Agent Embedded Automation) = false
      // ASA (Agent Service Agent) = true
      const bypassUser = agentType.toUpperCase() === 'AEA' ? false : true;
      
      console.log(`🤖 [AGENTFORCE] Agent Type: ${agentType}, bypassUser: ${bypassUser}`);

      // Get the current org's access token from web session
      if (!req.session.salesforce || !req.session.salesforce.accessToken) {
        return {
          success: false,
          message: 'No Salesforce access token found. Please login first.'
        };
      }

      const accessToken = req.session.salesforce.accessToken;
      const myDomainUrl = req.session.salesforce.instanceUrl || 'https://login.salesforce.com';
      
      // Generate a random UUID for external session key
      const externalSessionKey = uuidv4();
      
      // Prepare request payload for Salesforce Agent API
      const requestPayload = {
        externalSessionKey: externalSessionKey,
        instanceConfig: {
          endpoint: myDomainUrl
        },
        streamingCapabilities: {
          chunkTypes: ["Text"]
        },
        bypassUser: bypassUser
      };

      // Get orgId for x-sfdc-tenant-id header
      const orgId = orgConfig.orgId || '00DRL00000BrEq32AF'; // Default if not configured
      const tenantId = `core/prod/${orgId}`;
      
      console.log(`📤 [AGENTFORCE] Starting agentforce session with agent ${agentId} for org ${orgConfig.name}`);
      console.log(`🌐 [AGENTFORCE] Using endpoint: ${myDomainUrl}`);
      console.log(`🔑 [AGENTFORCE] Using tenant ID: ${tenantId}`);
      console.log(`⚙️  [AGENTFORCE] Request payload:`, JSON.stringify(requestPayload, null, 2));
      
      // Generate a temporary session ID for logging (will be replaced with actual sessionId after response)
      const tempSessionId = `temp_${externalSessionKey}`;
      
      // Log the outbound request to start session
      const startSessionRequestLog = {
        url: `https://api.salesforce.com/einstein/ai-agent/v1/agents/${agentId}/sessions`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.substring(0, 20)}...`,
          'x-salesforce-region': 'us-east-1',
          'x-sfdc-tenant-id': tenantId
        },
        payload: requestPayload
      };
      
      console.log(`📤 [AGENTFORCE-SALESFORCE-API] START SESSION REQUEST:`, JSON.stringify(startSessionRequestLog, null, 2));
      
      // Call Salesforce Agent API to start agentforce session
      const response = await axios.post(
        `https://api.salesforce.com/einstein/ai-agent/v1/agents/${agentId}/sessions`,
        requestPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'x-salesforce-region': 'us-east-1',
            'x-sfdc-tenant-id': tenantId
          }
        }
      );
      
      if (response.data && response.data.sessionId) {
        const sessionId = response.data.sessionId;
        const welcomeMessage = response.data.messages?.[0]?.message || 'Hi, I\'m an AI service assistant. How can I help you?';
        
        console.log(`✅ [AGENTFORCE] Agentforce session started successfully: ${sessionId}`);
        
        // Log the inbound response from Salesforce Agent API
        const startSessionResponseLog = {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data
        };
        
        console.log(`📥 [AGENTFORCE-SALESFORCE-API] START SESSION RESPONSE:`, JSON.stringify(startSessionResponseLog, null, 2));
        
        // Store agentforce session info
        this.activeAgentSessions.set(sessionId, {
          agentId: agentId,
          externalSessionKey,
          startTime: new Date(),
          messageCount: 0,
          myDomainUrl,
          accessToken,
          orgKey: orgKey,
          orgName: orgConfig.name,
          apiLogs: [] // Store API communication logs
        });
        
        // Now log both request and response with the actual sessionId
        this.logAgentApiCommunication(sessionId, 'request', startSessionRequestLog);
        this.logAgentApiCommunication(sessionId, 'response', startSessionResponseLog);
        
        return {
          success: true,
          message: 'Agentforce session started successfully',
          sessionId: sessionId,
          welcomeMessage: welcomeMessage,
          links: response.data._links
        };
      } else {
        throw new Error('Invalid response from Salesforce Agent API');
      }
      
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error starting agentforce session:', error);
      
      // Try to log the error response if we have a session ID or can create one
      const errorSessionId = error.config?.data ? `error_${Date.now()}` : null;
      
      if (errorSessionId) {
        const startSessionErrorLog = {
          status: error.response?.status || 'ERROR',
          statusText: error.response?.statusText || 'Request Failed',
          headers: error.response?.headers || {},
          data: {
            error: error.message,
            details: error.response?.data || 'No response data',
            stack: error.response ? undefined : error.stack
          }
        };
        
        console.log(`📥 [AGENTFORCE-SALESFORCE-API] START SESSION ERROR RESPONSE:`, JSON.stringify(startSessionErrorLog, null, 2));
        
        // Create a temporary session entry for error logging
        this.activeAgentSessions.set(errorSessionId, {
          agentId: '',
          externalSessionKey: '',
          startTime: new Date(),
          messageCount: 0,
          myDomainUrl: '',
          accessToken: '',
          orgKey: '',
          orgName: 'Error Session',
          apiLogs: []
        });
        
        this.logAgentApiCommunication(errorSessionId, 'response', startSessionErrorLog);
      }
      
      // Check if it's an authentication error
      if (error.response?.status === 401) {
        return {
          success: false,
          message: 'Authentication failed. Please check your Salesforce credentials and try again.'
        };
      }
      
      // Check if it's a configuration error
      if (error.response?.status === 404) {
        return {
          success: false,
          message: 'Agent not found. Please check the agentId configuration for this organization.'
        };
      }
      
      return {
        success: false,
        message: 'Failed to start agentforce session: ' + error.message
      };
    }
  }

  /**
   * Clean Salesforce data by removing "_link" nodes and other metadata
   * @param {Object} data - Data to clean
   * @returns {Object} Cleaned data
   */
  cleanSalesforceData(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }
    
    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
      // Skip "_link" nodes and other Salesforce metadata
      if (key.startsWith('_') || key === 'attributes') {
        continue;
      }
      
      // Recursively clean nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        cleaned[key] = this.cleanSalesforceData(value);
      } else if (Array.isArray(value)) {
        // Clean array elements
        cleaned[key] = value.map(item => 
          typeof item === 'object' ? this.cleanSalesforceData(item) : item
        );
      } else {
        cleaned[key] = value;
      }
    }
    
    return cleaned;
  }

  /**
   * Log API communication for an agentforce session
   * @param {string} agentSessionId - Agentforce session ID
   * @param {string} type - Type of log (request/response)
   * @param {Object} data - Log data
   */
  logAgentApiCommunication(agentSessionId, type, data) {
    // Create log entry with cleaned data
    const logEntry = {
      id: Date.now() + Math.random(),
      type,
      timestamp: new Date().toISOString(),
      data: this.cleanSalesforceData(data)
    };
    
    console.log(`🔍 [AGENTFORCE] About to log ${type} for session ${agentSessionId}`);
    console.log(`🔍 [AGENTFORCE] this.apiLogs exists:`, !!this.apiLogs);
    console.log(`🔍 [AGENTFORCE] this.apiLogs is Map:`, this.apiLogs instanceof Map);
    console.log(`🔍 [AGENTFORCE] this.apiLogs size:`, this.apiLogs ? this.apiLogs.size : 'N/A');
    
    // Store in both session-specific logs and global logs
    const agentSessionInfo = this.activeAgentSessions.get(agentSessionId);
    if (agentSessionInfo && agentSessionInfo.apiLogs) {
      agentSessionInfo.apiLogs.push(logEntry);
      
      // Keep only last 100 logs to prevent memory issues
      if (agentSessionInfo.apiLogs.length > 100) {
        agentSessionInfo.apiLogs = agentSessionInfo.apiLogs.slice(-100);
      }
      console.log(`📋 [AGENTFORCE] Stored in session-specific logs, count: ${agentSessionInfo.apiLogs.length}`);
    } else {
      console.log(`⚠️ [AGENTFORCE] No session info or apiLogs for session ${agentSessionId}`);
    }
    
    // Also store in global logs for cross-session access
    if (!this.apiLogs.has(agentSessionId)) {
      this.apiLogs.set(agentSessionId, []);
      console.log(`📋 [AGENTFORCE] Created new log array for session ${agentSessionId} in global apiLogs`);
    }
    
    const globalLogs = this.apiLogs.get(agentSessionId);
    globalLogs.push(logEntry);
    console.log(`📋 [AGENTFORCE] Stored in global apiLogs, session ${agentSessionId} now has ${globalLogs.length} logs`);
    
    console.log(`📋 [AGENTFORCE] Successfully logged ${type} for session ${agentSessionId}`);
  }

  /**
   * Get API communication logs for an agentforce session
   * @param {string} agentSessionId - Agentforce session ID
   * @returns {Array} Array of API communication logs
   */
  getAgentApiLogs(agentSessionId) {
    try {
      console.log(`🔍 [AGENTFORCE] getAgentApiLogs called for session: ${agentSessionId}`);
      console.log(`🔍 [AGENTFORCE] this.apiLogs exists:`, !!this.apiLogs);
      console.log(`🔍 [AGENTFORCE] this.apiLogs is Map:`, this.apiLogs instanceof Map);
      console.log(`🔍 [AGENTFORCE] this.apiLogs size:`, this.apiLogs ? this.apiLogs.size : 'N/A');
      console.log(`🔍 [AGENTFORCE] this.apiLogs keys:`, this.apiLogs ? Array.from(this.apiLogs.keys()) : 'N/A');
      
      // First try to get logs from the global apiLogs Map (includes ended sessions)
      if (this.apiLogs && this.apiLogs.has(agentSessionId)) {
        const globalLogs = this.apiLogs.get(agentSessionId);
        if (globalLogs && Array.isArray(globalLogs)) {
          console.log(`📋 [AGENTFORCE] Found ${globalLogs.length} logs in global apiLogs for session ${agentSessionId}`);
          // Sort by timestamp (newest first) for consistent behavior
          return globalLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } else {
          console.log(`⚠️ [AGENTFORCE] Global logs for session ${agentSessionId} is not an array:`, typeof globalLogs);
        }
      } else {
        console.log(`⚠️ [AGENTFORCE] Session ${agentSessionId} not found in global apiLogs`);
      }
      
      // Fallback to session-specific logs (for active sessions)
      const agentSessionInfo = this.activeAgentSessions.get(agentSessionId);
      if (agentSessionInfo && agentSessionInfo.apiLogs) {
        console.log(`📋 [AGENTFORCE] Found ${agentSessionInfo.apiLogs.length} logs in session-specific logs for session ${agentSessionId}`);
        // Sort by timestamp (newest first) for consistent behavior
        return agentSessionInfo.apiLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      } else {
        console.log(`⚠️ [AGENTFORCE] No session info or apiLogs for session ${agentSessionId} in activeAgentSessions`);
      }
      
      console.log(`📋 [AGENTFORCE] No logs found for session ${agentSessionId}`);
      return [];
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error in getAgentApiLogs:', error);
      return [];
    }
  }

  /**
   * Get all API logs across all sessions (including ended sessions)
   * @returns {Array} Array of all API log entries
   */
  getAllAgentApiLogs() {
    // Ensure this.apiLogs exists and is a Map
    if (!this.apiLogs || !(this.apiLogs instanceof Map)) {
      console.warn('⚠️ [AGENTFORCE] this.apiLogs is not properly initialized, returning empty array');
      return [];
    }
    
    const allLogs = [];
    try {
      for (const [sessionId, logs] of this.apiLogs) {
        if (logs && Array.isArray(logs)) {
          allLogs.push(...logs);
        }
      }
      // Sort by timestamp (newest first)
      return allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error iterating over apiLogs:', error);
      return [];
    }
  }

  /**
   * Get API logs filtered by session ID or all logs
   * @param {string} sessionId - Optional session ID to filter by
   * @returns {Array} Array of filtered API log entries
   */
  getFilteredAgentApiLogs(sessionId = null) {
    try {
      if (sessionId) {
        return this.getAgentApiLogs(sessionId);
      } else {
        return this.getAllAgentApiLogs();
      }
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error in getFilteredAgentApiLogs:', error);
      return [];
    }
  }

  /**
   * End an active agentforce session using Salesforce Agent API
   * @param {string} agentSessionId - Agentforce session ID to end
   * @returns {Object} Response indicating agentforce session end status
   */
  async endAgentSession(agentSessionId) {
    try {
      console.log(`🛑 [AGENTFORCE] Ending agentforce session: ${agentSessionId}`);
      
      // Get agentforce session info
      const agentSessionInfo = this.activeAgentSessions.get(agentSessionId);
      if (!agentSessionInfo) {
        throw new Error('Invalid agentforce session ID');
      }
      
      // Log the outbound request to end agentforce session
      const endSessionRequestLog = {
        url: `https://api.salesforce.com/einstein/ai-agent/v1/sessions/${agentSessionId}`,
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${agentSessionInfo.accessToken.substring(0, 20)}...`,
          'x-salesforce-region': 'us-east-1',
          'x-sfdc-tenant-id': 'core/prod/00DRL00000BrEq32AF',
          'x-session-end-reason': 'UserRequest',
        }
      };
      
      console.log(`📤 [AGENTFORCE-SALESFORCE-API] END SESSION REQUEST:`, JSON.stringify(endSessionRequestLog, null, 2));
      this.logAgentApiCommunication(agentSessionId, 'request', endSessionRequestLog);
      
      // Call Salesforce Agent API to end agentforce session
      // Call Salesforce Agent API to end agentforce session
      // Use simple DELETE without payload as per Salesforce API requirements
      const response = await axios.delete(
        `https://api.salesforce.com/einstein/ai-agent/v1/sessions/${agentSessionId}`,
        {
          headers: {
            'Authorization': `Bearer ${agentSessionInfo.accessToken}`,
            'x-salesforce-region': 'us-east-1',
            'x-sfdc-tenant-id': 'core/prod/00DRL00000BrEq32AF',
            'x-session-end-reason': 'UserRequest',
          }
        }
      );
      
      // Log the response from Salesforce Agent API
      const endSessionResponseLog = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data
      };
      
      console.log(`📥 [AGENTFORCE-SALESFORCE-API] END SESSION RESPONSE:`, JSON.stringify(endSessionResponseLog, null, 2));
      this.logAgentApiCommunication(agentSessionId, 'response', endSessionResponseLog);
      
      console.log(`✅ [AGENTFORCE] Agentforce session ${agentSessionId} ended successfully via Salesforce Agent API`);
      
      // Create the response with API logs
      const endSessionResponse = {
        success: true,
        message: 'Agentforce session ended successfully',
        sessionId: agentSessionId,
        timestamp: new Date().toISOString(),
        // Include Salesforce API communication details for frontend display
        salesforceApi: {
          request: endSessionRequestLog,
          response: endSessionResponseLog
        },
        // Include the API logs directly in the response
        apiLogs: [
          {
            id: Date.now(),
            type: 'request',
            timestamp: new Date().toISOString(),
            data: endSessionRequestLog
          },
          {
            id: Date.now() + 1,
            type: 'response',
            timestamp: new Date().toISOString(),
            data: endSessionResponseLog
          }
        ]
      };

      // Remove agentforce session from active sessions but KEEP the logs for audit trail
      this.activeAgentSessions.delete(agentSessionId);
      
      return endSessionResponse;
      
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error ending agentforce session via Salesforce Agent API:', error);
      
      // Get agentforce session info before deleting it
      const agentSessionInfo = this.activeAgentSessions.get(agentSessionId);
      
      // Prepare error response data for logging
      const endSessionErrorResponseLog = {
        status: error.response?.status || 'ERROR',
        statusText: error.response?.statusText || 'Request Failed',
        headers: error.response?.headers || {},
        data: {
          error: error.message,
          details: error.response?.data || 'No response data'
        }
      };
      
      // Log the error response so it appears in the API logs
      console.log(`📥 [AGENTFORCE-SALESFORCE-API] END SESSION ERROR RESPONSE:`, JSON.stringify(endSessionErrorResponseLog, null, 2));
      this.logAgentApiCommunication(agentSessionId, 'response', endSessionErrorResponseLog);
      
      // If the Salesforce API call fails, still remove the session locally
      this.activeAgentSessions.delete(agentSessionId);
      console.log(`⚠️ [AGENTFORCE] Salesforce API call failed, but agentforce session removed locally`);
      
      return {
        success: false,
        message: 'Failed to end agentforce session via Salesforce Agent API: ' + error.message,
        sessionId: agentSessionId,
        timestamp: new Date().toISOString(),
        // Include Salesforce API request details even on failure
        salesforceApi: {
          request: {
            url: `https://api.salesforce.com/einstein/ai-agent/v1/sessions/${agentSessionId}`,
            method: 'DELETE',
            headers: {
              'Authorization': agentSessionInfo ? `Bearer ${agentSessionInfo.accessToken.substring(0, 20)}...` : 'Bearer [No Token]',
              'x-salesforce-region': 'us-east-1',
              'x-sfdc-tenant-id': 'core/prod/00DRL00000BrEq32AF'
            }
          },
          response: endSessionErrorResponseLog
        },
        // Include the API logs directly in the response even on failure
        apiLogs: [
          {
            id: Date.now(),
            type: 'request',
            timestamp: new Date().toISOString(),
            data: {
              url: `https://api.salesforce.com/einstein/ai-agent/v1/sessions/${agentSessionId}`,
              method: 'DELETE',
              headers: {
                'Authorization': agentSessionInfo ? `Bearer ${agentSessionInfo.accessToken.substring(0, 20)}...` : 'Bearer [No Token]',
                'x-salesforce-region': 'us-east-1',
                'x-sfdc-tenant-id': 'core/prod/00DRL00000BrEq32AF'
              }
            }
          },
          {
            id: Date.now() + 1,
            type: 'response',
            timestamp: new Date().toISOString(),
            data: endSessionErrorResponseLog
          }
        ]
      };
    }
  }

  /**
   * Send message via Salesforce Agent API
   * @param {string} agentSessionId - Agentforce session ID
   * @param {string} message - Message content
   * @returns {Object} Agent response
   */
  async sendMessageViaAgentAPI(agentSessionId, message) {
    try {
      console.log(`📤 [AGENTFORCE] Sending message via Salesforce Agent API, agentforce session ${agentSessionId}`);
      
      // Get agentforce session info
      const agentSessionInfo = this.activeAgentSessions.get(agentSessionId);
      if (!agentSessionInfo) {
        throw new Error('Invalid agentforce session ID');
      }
      
      // Update message count
      agentSessionInfo.messageCount++;
      
      // Generate sequence ID (timestamp-based for uniqueness)
      const sequenceId = Date.now();
      
      // Prepare message payload according to Salesforce Agent API specification
      const messagePayload = {
        message: {
          sequenceId: sequenceId,
          type: "Text",
          text: message
        },
        variables: []
      };
      
      console.log(`📤 [AGENTFORCE] Sending message with sequence ID ${sequenceId} to Salesforce Agent API`);
      
      const apiUrl = `https://api.salesforce.com/einstein/ai-agent/v1/sessions/${agentSessionId}/messages`;
      const apiHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agentSessionInfo.accessToken}`
      };
      
      // Log EXACT request being sent
      console.log('\n========== AGENT MESSAGE REQUEST - START ==========');
      console.log('📤 [AGENTFORCE] REQUEST URL:', apiUrl);
      console.log('📤 [AGENTFORCE] REQUEST METHOD:', 'POST');
      console.log('📤 [AGENTFORCE] REQUEST HEADERS:', JSON.stringify(apiHeaders, null, 2));
      console.log('📤 [AGENTFORCE] REQUEST BODY:', JSON.stringify(messagePayload, null, 2));
      console.log('========== AGENT MESSAGE REQUEST - END ==========\n');
      
      // Also log with truncated token for storage
      const requestLog = {
        url: apiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${agentSessionInfo.accessToken.substring(0, 20)}...`
        },
        payload: messagePayload
      };
      this.logAgentApiCommunication(agentSessionId, 'request', requestLog);
      
      // Call Salesforce Agent API messages endpoint
      const response = await axios.post(apiUrl, messagePayload, {
        headers: apiHeaders,
        timeout: 30000, // 30 second timeout
        validateStatus: function (status) {
          // Accept any status code so we can log the full response
          return true;
        }
      });
      
      // Log EXACT response received
      console.log('\n========== AGENT MESSAGE RESPONSE - START ==========');
      console.log('📥 [AGENTFORCE] RESPONSE STATUS:', response.status, response.statusText);
      console.log('📥 [AGENTFORCE] RESPONSE HEADERS:', JSON.stringify(response.headers, null, 2));
      console.log('📥 [AGENTFORCE] RESPONSE BODY:', JSON.stringify(response.data, null, 2));
      console.log('========== AGENT MESSAGE RESPONSE - END ==========\n');
      
      // Log for storage
      const responseLog = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data
      };
      this.logAgentApiCommunication(agentSessionId, 'response', responseLog);
      
      // Check if response status is not successful (not 2xx)
      if (response.status < 200 || response.status >= 300) {
        const error = new Error(`Salesforce Agent API returned status ${response.status}: ${response.statusText}`);
        error.response = response;
        throw error;
      }
      
      if (response.data) {
        console.log(`✅ [AGENTFORCE] Message sent successfully via Salesforce Agent API`);
        
        // Parse the response from Salesforce Agent API
        // Check response.data.messages array as specified
        let agentMessage = "Message received by agent";
        let rawMessages = [];
  
        if (response.data.messages && Array.isArray(response.data.messages)) {
          rawMessages = response.data.messages;
          // Get the first message text if available
          if (rawMessages.length > 0) {
            agentMessage = rawMessages[0].message || rawMessages[0].text || agentMessage;
          }
          console.log(`📋 [AGENTFORCE] Found ${rawMessages.length} messages in response`);
        } else {
          console.log(`⚠️ [AGENTFORCE] No messages array in response, using fallback`);
        }
        
        const agentResponse = {
          message: agentMessage,
          agentName: "AI Agent",
          timestamp: new Date().toISOString(),
          sequenceId: sequenceId,
          rawResponse: response.data,
          messages: rawMessages
        };
        
        return agentResponse;
      } else {
        throw new Error('Invalid response from Salesforce Agent API');
      }
      
    } catch (error) {
      console.error('\n========== AGENT MESSAGE ERROR - START ==========');
      console.error('❌ [AGENTFORCE] Error sending message via Salesforce Agent API');
      console.error('❌ [AGENTFORCE] Error Message:', error.message);
      console.error('❌ [AGENTFORCE] Error Code:', error.code);
      
      // Check for timeout
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        console.error('❌ [AGENTFORCE] REQUEST TIMEOUT - Salesforce API did not respond within 30 seconds');
      }
      
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.error('❌ [AGENTFORCE] ERROR RESPONSE STATUS:', error.response.status, error.response.statusText);
        console.error('❌ [AGENTFORCE] ERROR RESPONSE HEADERS:', JSON.stringify(error.response.headers, null, 2));
        console.error('❌ [AGENTFORCE] ERROR RESPONSE BODY:', JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        // The request was made but no response was received
        console.error('❌ [AGENTFORCE] NO RESPONSE RECEIVED FROM SERVER');
        console.error('❌ [AGENTFORCE] This usually means:');
        console.error('   - Network timeout (request took > 30 seconds)');
        console.error('   - Network connectivity issue');
        console.error('   - Salesforce API endpoint is down or unreachable');
      } else {
        // Something happened in setting up the request that triggered an Error
        console.error('❌ [AGENTFORCE] REQUEST SETUP ERROR');
      }
      
      console.error('❌ [AGENTFORCE] Error Stack:', error.stack);
      console.error('========== AGENT MESSAGE ERROR - END ==========\n');
      
      // Throw error to propagate to endpoint handler
      throw error;
    }
  }

  /**
   * Generate mock agent response for testing
   * @param {string} message - User message
   * @param {string} agentId - Agent ID
   * @returns {Object} Mock response
   */
  async generateMockAgentResponse(message, agentId) {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    
    const lowerMessage = message.toLowerCase();
    
    // Common response patterns
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
      return {
        message: "Hello! I'm your AI agent powered by Salesforce Agentforce. How can I assist you today?",
        agentName: "AI Agent",
        timestamp: new Date().toISOString()
      };
    }
    
    if (lowerMessage.includes('help') || lowerMessage.includes('support')) {
      return {
        message: "I'm here to help! I can assist with customer inquiries, order processing, technical support, and more. What specific help do you need?",
        agentName: "AI Agent",
        timestamp: new Date().toISOString()
      };
    }
    
    if (lowerMessage.includes('billing') || lowerMessage.includes('payment')) {
      return {
        message: "I can help you with billing and payment questions. I have access to your account information and can assist with invoices, payment methods, and billing inquiries. What would you like to know?",
        agentName: "AI Agent",
        timestamp: new Date().toISOString()
      };
    }
    
    if (lowerMessage.includes('technical') || lowerMessage.includes('problem') || lowerMessage.includes('issue')) {
      return {
        message: "I understand you're experiencing a technical issue. I can help troubleshoot this. Please describe what's happening and I'll guide you through the solution.",
        agentName: "AI Agent",
        timestamp: new Date().toISOString()
      };
    }
    
    if (lowerMessage.includes('order') || lowerMessage.includes('purchase')) {
      return {
        message: "I can help you with order-related questions. I can check order status, process new orders, modify existing orders, and assist with order confirmations. What do you need help with?",
        agentName: "AI Agent",
        timestamp: new Date().toISOString()
      };
    }
    
    if (lowerMessage.includes('thank') || lowerMessage.includes('thanks')) {
      return {
        message: "You're welcome! I'm here to help. Is there anything else I can assist you with today?",
        agentName: "AI Agent",
        timestamp: new Date().toISOString()
      };
    }
    
    if (lowerMessage.includes('goodbye') || lowerMessage.includes('bye')) {
      return {
        message: "Thank you for chatting with me today! I'm here whenever you need assistance. Have a great day!",
        agentName: "AI Agent",
        timestamp: new Date().toISOString()
      };
    }
    
    // Default response
    return {
      message: "Thank you for your message. I'm processing your request and will provide you with the best possible assistance. I can help with customer service, technical support, order management, and more. Could you please provide more context so I can better understand your needs?",
      agentName: "AI Agent",
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate a contextual agent response
   * @param {string} message - User message
   * @param {string} agentId - Agent ID
   * @returns {string} Generated response
   */
  generateAgentResponse(message, agentId) {
    const lowerMessage = message.toLowerCase();
    
    // Common response patterns
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
      return "Hello! Thank you for reaching out. How can I assist you today?";
    }
    
    if (lowerMessage.includes('help') || lowerMessage.includes('support')) {
      return "I'm here to help! Could you please provide more details about what you need assistance with?";
    }
    
    if (lowerMessage.includes('billing') || lowerMessage.includes('payment')) {
      return "I can help you with billing and payment questions. What specific billing issue are you experiencing?";
    }
    
    if (lowerMessage.includes('technical') || lowerMessage.includes('problem') || lowerMessage.includes('issue')) {
      return "I understand you're experiencing a technical issue. Let me help you troubleshoot this. Can you describe what's happening?";
    }
    
    if (lowerMessage.includes('thank') || lowerMessage.includes('thanks')) {
      return "You're welcome! Is there anything else I can help you with?";
    }
    
    if (lowerMessage.includes('goodbye') || lowerMessage.includes('bye')) {
      return "Thank you for chatting with us today. Have a great day!";
    }
    
    // Default response
    return "Thank you for your message. I'm processing your request and will provide you with the best possible assistance. Could you please provide more context so I can better understand your needs?";
  }

  /**
   * Get agent name by ID
   * @param {string} agentId - Agent ID
   * @returns {string} Agent name
   */
  getAgentNameById(agentId) {
    // This would typically come from a cache or database
    // For now, return a generic name
    return "Salesforce Agent";
  }

  /**
   * Get agent configuration status for all orgs
   * @param {Object} req - Express request object
   * @returns {Object} Response with org agent configuration status
   */
  async getAgentConfigurationStatus(req) {
    try {
      console.log('🔍 [AGENTFORCE] Getting agent configuration status for all orgs...');
      
      // Get org configurations from login module
      const loginModule = req.app.locals.loginModule;
      if (!loginModule) {
        return {
          success: false,
          message: 'Login module not available.'
        };
      }
      
      const orgConfigs = loginModule.orgConfigurations || [];
      console.log(`🔍 [AGENTFORCE] Loaded ${orgConfigs.length} org configurations:`, orgConfigs.map(org => ({ name: org.name, agentId: org.agentId })));
      const status = [];
      
      for (const org of orgConfigs) {
        const hasAgentId = !!org.agentId;
        const hasDataCloud = !!org.dataCloud;
        console.log(`🔍 [AGENTFORCE] Processing org: name="${org.name}", agentId="${org.agentId}", hasAgentId=${hasAgentId}, dataCloud=${hasDataCloud}`);
        status.push({
          orgName: org.name,
          orgId: org.name, // Use org name for matching
          hasAgentId: hasAgentId,
          agentId: org.agentId || 'Not configured',
          dataCloud: hasDataCloud,
          status: hasAgentId ? '✅ Configured' : '❌ Missing agentId'
        });
      }
      
      return {
        success: true,
        message: `Found ${orgConfigs.length} organizations`,
        data: {
          totalOrgs: orgConfigs.length,
          configuredOrgs: status.filter(s => s.hasAgentId).length,
          missingOrgs: status.filter(s => !s.hasAgentId).length,
          orgStatus: status
        }
      };
      
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error getting agent configuration status:', error);
      return {
        success: false,
        message: 'Failed to get agent configuration status: ' + error.message
      };
    }
  }

  /**
   * Get module information
   * @returns {Object} Module information
   */
  getModuleInfo() {
    return {
      name: this.moduleName,
      description: this.description,
      version: this.version,
      activeAgentSessions: this.activeAgentSessions.size,
      configuration: 'Agent IDs configured per organization in SALESFORCE_ORGS',
      endpoints: [
        {
          method: 'GET',
          path: '/api/salesforce/agentforce/agents',
          description: 'Get available Agentforce agents for current org'
        },
        {
          method: 'POST',
          path: '/api/salesforce/agentforce/start-session',
          description: 'Start new agentforce session'
        },
        {
          method: 'POST',
          path: '/api/salesforce/agentforce/chat',
          description: 'Send chat message to agent (requires active agentforce session)'
        },
        {
          method: 'GET',
          path: '/api/salesforce/agentforce/filtered-logs',
          description: 'Get filtered logs (current session or all logs across sessions)'
        }
      ]
    };
  }
}

module.exports = AgentforceModule;
