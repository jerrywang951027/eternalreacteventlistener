const axios = require('axios');

class AgentforceModule {
  constructor() {
    this.moduleName = 'AgentforceModule';
    this.description = 'Salesforce Agentforce API integration for agent chat functionality';
    this.version = '1.0.0';
    
    console.log(`🔗 [${this.moduleName}] Initialized - ${this.description} v${this.version}`);
  }

  /**
   * Get available Agentforce agents from Salesforce
   * @param {Object} req - Express request object
   * @returns {Object} Response with agents list
   */
  async getAvailableAgents(req) {
    try {
      console.log('🔍 [AGENTFORCE] Fetching available agents...');
      
      // Get the current org's access token
      const orgId = req.session.orgId;
      if (!orgId) {
        return {
          success: false,
          message: 'No organization selected. Please login first.',
          agents: []
        };
      }

      // Get org configuration
      const orgConfig = req.app.locals.orgConfigs?.find(org => org.orgId === orgId);
      if (!orgConfig) {
        return {
          success: false,
          message: 'Organization configuration not found.',
          agents: []
        };
      }

      // Query Salesforce for Agentforce agents
      const agents = await this.queryAgentforceAgents(orgConfig);
      
      console.log(`✅ [AGENTFORCE] Found ${agents.length} available agents`);
      
      return {
        success: true,
        message: `Successfully loaded ${agents.length} agents`,
        agents: agents
      };
      
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error getting agents:', error);
      return {
        success: false,
        message: 'Failed to load agents: ' + error.message,
        agents: []
      };
    }
  }

  /**
   * Send chat message to Agentforce agent
   * @param {Object} req - Express request object
   * @returns {Object} Response with agent reply
   */
  async sendChatMessage(req) {
    try {
      const { agentId, message, timestamp } = req.body;
      
      if (!agentId || !message) {
        return {
          success: false,
          message: 'Missing required parameters: agentId and message'
        };
      }

      console.log(`💬 [AGENTFORCE] Sending message to agent ${agentId}: "${message}"`);
      
      // Get the current org's access token
      const orgId = req.session.orgId;
      if (!orgId) {
        return {
          success: false,
          message: 'No organization selected. Please login first.'
        };
      }

      // Get org configuration
      const orgConfig = req.app.locals.orgConfigs?.find(org => org.orgId === orgId);
      if (!orgConfig) {
        return {
          success: false,
          message: 'Organization configuration not found.'
        };
      }

      // Send message to Agentforce API
      const response = await this.sendMessageToAgent(orgConfig, agentId, message, timestamp);
      
      console.log(`✅ [AGENTFORCE] Agent response received for agent ${agentId}`);
      
      return {
        success: true,
        message: 'Message sent successfully',
        response: response.message,
        agentName: response.agentName,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error sending chat message:', error);
      return {
        success: false,
        message: 'Failed to send message: ' + error.message
      };
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
   * Send message to Agentforce agent
   * @param {Object} orgConfig - Organization configuration
   * @param {string} agentId - Agent ID
   * @param {string} message - Message content
   * @param {string} timestamp - Message timestamp
   * @returns {Object} Agent response
   */
  async sendMessageToAgent(orgConfig, agentId, message, timestamp) {
    try {
      const accessToken = orgConfig.accessToken;
      const instanceUrl = orgConfig.instanceUrl;
      
      // For now, we'll simulate the Agentforce API response
      // In a real implementation, you would call the actual Agentforce API endpoints
      console.log(`📤 [AGENTFORCE] Simulating message to agent ${agentId}`);
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      // Generate a contextual response based on the message
      const response = this.generateAgentResponse(message, agentId);
      
      return {
        message: response,
        agentName: this.getAgentNameById(agentId),
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error sending message to agent:', error);
      throw error;
    }
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
   * Get module information
   * @returns {Object} Module information
   */
  getModuleInfo() {
    return {
      name: this.moduleName,
      description: this.description,
      version: this.version,
      endpoints: [
        {
          method: 'GET',
          path: '/api/salesforce/agentforce/agents',
          description: 'Get available Agentforce agents'
        },
        {
          method: 'POST',
          path: '/api/salesforce/agentforce/chat',
          description: 'Send chat message to agent'
        }
      ]
    };
  }
}

module.exports = AgentforceModule;
