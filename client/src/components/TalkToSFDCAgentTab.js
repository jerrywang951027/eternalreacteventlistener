import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './TalkToSFDCAgentTab.css';

const TalkToSFDCAgentTab = () => {
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState('');

  // Load available agents when component mounts
  useEffect(() => {
    loadAvailableAgents();
  }, []);

  // Load available Agentforce agents from Salesforce
  const loadAvailableAgents = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const response = await axios.get('/api/salesforce/agentforce/agents');
      
      if (response.data.success) {
        setAgents(response.data.agents);
        console.log('📋 [AGENTFORCE] Loaded agents:', response.data.agents);
      } else {
        setError('Failed to load agents: ' + response.data.message);
      }
    } catch (err) {
      console.error('❌ [AGENTFORCE] Error loading agents:', err);
      setError('Error loading agents: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsLoading(false);
    }
  };

  // Send message to selected agent
  const sendMessage = async (e) => {
    e.preventDefault();
    
    if (!selectedAgent || !inputMessage.trim()) {
      return;
    }

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: inputMessage.trim(),
      timestamp: new Date().toISOString(),
      agentId: selectedAgent
    };

    // Add user message to chat
    setMessages(prev => [...prev, userMessage]);
    
    // Clear input
    setInputMessage('');
    
    // Send to Salesforce Agentforce API
    try {
      setIsLoading(true);
      setError('');
      
      const response = await axios.post('/api/salesforce/agentforce/chat', {
        agentId: selectedAgent,
        message: userMessage.content,
        sessionId: currentSessionId
      });
      
      if (response.data.success) {
        const agentResponse = {
          id: Date.now() + 1,
          type: 'agent',
          content: response.data.response,
          timestamp: new Date().toISOString(),
          agentId: selectedAgent,
          agentName: response.data.agentName
        };
        
        setMessages(prev => [...prev, agentResponse]);
        console.log('💬 [AGENTFORCE] Agent response received:', agentResponse);
      } else {
        setError('Failed to get agent response: ' + response.data.message);
      }
    } catch (err) {
      console.error('❌ [AGENTFORCE] Error sending message:', err);
      setError('Error communicating with agent: ' + (err.response?.data?.message || err.message));
      
      // Add error message to chat
      const errorMessage = {
        id: Date.now() + 1,
        type: 'error',
        content: 'Failed to get response from agent. Please try again.',
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Get agent name by ID
  const getAgentName = (agentId) => {
    const agent = agents.find(a => a.id === agentId);
    return agent ? agent.name : 'Unknown Agent';
  };

  // Clear chat history
  const clearChat = () => {
    setMessages([]);
    setError('');
  };

  return (
    <div className="talk-to-sfdc-agent-tab">
      <div className="tab-header">
        <h2>🤖 Talk to SFDC Agent</h2>
        <p>Chat with Salesforce Agentforce agents for real-time assistance</p>
      </div>

      {/* Agent Selection */}
      <div className="agent-selection">
        <label htmlFor="agent-select">Select Agent:</label>
        <select
          id="agent-select"
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          disabled={isLoading}
        >
          <option value="">-- Choose an agent --</option>
          {agents.map(agent => (
            <option key={agent.id} value={agent.id}>
              {agent.name} ({agent.type || 'Agent'})
            </option>
          ))}
        </select>
        
        <button 
          onClick={loadAvailableAgents}
          disabled={isLoading}
          className="refresh-agents-btn"
        >
          🔄 Refresh Agents
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-message">
          <span>⚠️ {error}</span>
          <button onClick={() => setError('')} className="clear-error-btn">×</button>
        </div>
      )}

      {/* Chat Window */}
      <div className="chat-container">
        <div className="chat-header">
          <h3>
            {selectedAgent ? `Chat with ${getAgentName(selectedAgent)}` : 'Select an agent to start chatting'}
          </h3>
          {messages.length > 0 && (
            <button onClick={clearChat} className="clear-chat-btn">
              🗑️ Clear Chat
            </button>
          )}
        </div>

        <div className="chat-messages">
          {messages.length === 0 ? (
            <div className="no-messages">
              <p>No messages yet. Select an agent and start chatting!</p>
            </div>
          ) : (
            messages.map(message => (
              <div key={message.id} className={`message ${message.type}`}>
                <div className="message-header">
                  <span className="message-sender">
                    {message.type === 'user' ? 'You' : 
                     message.type === 'agent' ? getAgentName(message.agentId) : 'System'}
                  </span>
                  <span className="message-time">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="message-content">
                  {message.content}
                </div>
              </div>
            ))
          )}
          
          {isLoading && (
            <div className="message loading">
              <div className="message-content">
                <span className="typing-indicator">Agent is typing...</span>
              </div>
            </div>
          )}
        </div>

        {/* Message Input */}
        <form onSubmit={sendMessage} className="message-input-form">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={selectedAgent ? "Type your message..." : "Select an agent first"}
            disabled={!selectedAgent || isLoading}
            className="message-input"
          />
          <button 
            type="submit" 
            disabled={!selectedAgent || !inputMessage.trim() || isLoading}
            className="send-button"
          >
            {isLoading ? '⏳' : '📤'}
          </button>
        </form>
      </div>

      {/* Status Information */}
      <div className="status-info">
        <p>
          <strong>Status:</strong> {selectedAgent ? 'Connected to ' + getAgentName(selectedAgent) : 'No agent selected'}
        </p>
        <p>
          <strong>Messages:</strong> {messages.length} | 
          <strong>Agent:</strong> {selectedAgent ? getAgentName(selectedAgent) : 'None'}
        </p>
      </div>
    </div>
  );
};

export default TalkToSFDCAgentTab;
