import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './TalkToSFDCAgentTab.css';

const TalkToSFDCAgentTab = () => {

  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [sessionStarted, setSessionStarted] = useState(false);
  const [apiLogs, setApiLogs] = useState([]);
  const [showApiLogs, setShowApiLogs] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [showPresetMessages, setShowPresetMessages] = useState(false);

  // Utility function to clean Salesforce data by removing "_link" nodes and optionally headers
  const cleanSalesforceData = (data) => {
    if (!data || typeof data !== 'object') {
      return data;
    }
    
    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
      // Skip "_link" nodes and other Salesforce metadata
      if (key.startsWith('_') || key === 'attributes') {
        continue;
      }
      
      // Skip headers if showHeaders is false
      if (!showHeaders && key === 'headers') {
        continue;
      }
      
      // Recursively clean nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        cleaned[key] = cleanSalesforceData(value);
      } else if (Array.isArray(value)) {
        // Clean array elements
        cleaned[key] = value.map(item => 
          typeof item === 'object' ? cleanSalesforceData(item) : item
        );
      } else {
        cleaned[key] = value;
      }
    }
    
    return cleaned;
  };

  // Preset messages for quick access
  const presetMessages = [
    "Show my Customers.",
    "create quote on account Commercial-Demo-Acct-106-RootBusiness with default settings.",
    "Give me the pricing for UC Calling Plan - Unlimited Mins.",
    "Canada Nationwide.",
    "Add that product to the above quote.",
    "Delete UC Calling Plan - Unlimited Mins from the quote",
    "add product UC Calling Plan - Unlimited Mins with country group as Canada Nationwide.",
    "add product UC Base Platform.",
    "add product Local Number with country as United Kingdom.",
    "Order it."
  ];

  // Handle preset message selection
  const handlePresetMessageSelect = (message) => {
    setInputMessage(message);
    setShowPresetMessages(false);
    // Auto-send the message
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} };
      sendMessage(fakeEvent);
    }, 100);
  };

  // Fetch API communication logs from the backend
  const fetchApiLogs = useCallback(async () => {
    if (!sessionStarted) {
      setApiLogs([]);
      return;
    }
    
    try {
      // Use the new filtered logs endpoint
      const params = new URLSearchParams();
      if (showAllLogs) {
        params.append('showAll', 'true');
      } else if (currentSessionId) {
        params.append('sessionId', currentSessionId);
      }
      
      const response = await axios.get(`/api/salesforce/agentforce/filtered-logs?${params.toString()}`);
      if (response.data.success) {
        setApiLogs(response.data.logs);
        console.log('📋 [AGENTFORCE] Fetched filtered logs:', response.data.filter, 'Count:', response.data.logs.length);
      } else {
        setApiLogs([]);
      }
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error fetching API logs:', error);
      setApiLogs([]);
    }
  }, [sessionStarted, currentSessionId, showAllLogs]);



  // Fetch API logs if session is active and logs panel is open
  useEffect(() => {
    if (sessionStarted && currentSessionId && showApiLogs) {
      fetchApiLogs();
    }
  }, [sessionStarted, currentSessionId, showApiLogs, fetchApiLogs]);

  // Auto-scroll to latest message
  useEffect(() => {
    const chatMessages = document.querySelector('.chat-messages');
    if (chatMessages && messages.length > 0) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }, [messages]);

  // Close preset messages dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.preset-messages-container')) {
        setShowPresetMessages(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);



  // Start a new agent session
  const startSession = async () => {
    try {
      setIsLoading(true);
      setError('');
      

      
      const response = await axios.post('/api/salesforce/agentforce/start-session');
      

      
              if (response.data.success) {
          setCurrentSessionId(response.data.sessionId);
          setSessionStarted(true);
          
          // Extract agent name from welcome message
          const welcomeText = response.data.welcomeMessage;
          const agentNameMatch = welcomeText.match(/I am your (.+?) Agent/);
          const extractedAgentName = agentNameMatch ? `${agentNameMatch[1]} Agent` : 'AI Service Assistant Agent';
          setAgentName(extractedAgentName);
          
          // Add welcome message from agent
          const welcomeMessage = {
            id: Date.now(),
            type: 'agent',
            content: response.data.welcomeMessage,
            timestamp: new Date().toISOString()
          };
          setMessages([welcomeMessage]);
          
          // Always fetch initial API logs after session starts
          fetchApiLogs();
          
          console.log('✅ [AGENTFORCE] Session started successfully:', response.data.sessionId);
        } else {
        setError(response.data.message || 'Failed to start session');
      }
    } catch (err) {
      console.error('❌ [AGENTFORCE] Error starting session:', err);
      setError('Failed to start session: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsLoading(false);
    }
  };

  // Send message to selected agent
  const sendMessage = async (e) => {
    e.preventDefault();
    
    if (!sessionStarted || !currentSessionId || !inputMessage.trim()) {
      if (!sessionStarted) {
        setError('Please start a session first');
      }
      return;
    }

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: inputMessage.trim(),
      timestamp: new Date().toISOString()
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
        message: userMessage.content,
        sessionId: currentSessionId
      });
      
      if (response.data.success) {
        const agentResponse = {
          id: Date.now() + 1,
          type: 'agent',
          content: response.data.response,
          timestamp: new Date().toISOString(),
          agentName: response.data.agentName
        };
        
        setMessages(prev => [...prev, agentResponse]);
        
        // Fetch updated API logs if the panel is open
        if (showApiLogs) {
          fetchApiLogs();
        }
        
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
  }



  // Clear chat history and reset session
  const clearChat = async () => {
    try {
      if (sessionStarted && currentSessionId) {
        // End the session via Salesforce Agent API
        const response = await axios.delete('/api/salesforce/agentforce/end-session', {
          data: { sessionId: currentSessionId }
        });
        
        if (response.data.success) {
          console.log('✅ [AGENTFORCE] Session ended successfully');
          
          // Log the Salesforce API communication details
          if (response.data.salesforceApi) {
            console.log('📤 [AGENTFORCE] Salesforce API Request:', response.data.salesforceApi.request);
            console.log('📥 [AGENTFORCE] Salesforce API Response:', response.data.salesforceApi.response);
          }
          
          // Update API logs with the end session communication
          if (response.data.apiLogs) {
            setApiLogs(response.data.apiLogs);
            console.log('📋 [AGENTFORCE] API logs updated with end session communication');
          }
        } else {
          console.warn('⚠️ [AGENTFORCE] Session end response:', response.data.message);
        }
      }
    } catch (error) {
      console.error('❌ [AGENTFORCE] Error ending session:', error);
    } finally {
      // Always clear local state
      setMessages([]);
      setError('');
      setSessionStarted(false);
      setCurrentSessionId('');
    }
  };

  return (
    <div className="talk-to-sfdc-agent-tab">
      <div className="tab-content">
        <div className="tab-header">
        <h2>🤖 Talk to SFDC Agent</h2>
        <p>Chat with Salesforce Agentforce agents for real-time assistance</p>
      </div>

      {/* Session Controls */}
      <div className="session-controls">
        {!sessionStarted ? (
          <button 
            onClick={startSession}
            disabled={isLoading}
            className="start-session-btn"
          >
            🚀 Start Session
          </button>
        ) : (
          <button 
            onClick={clearChat}
            className="end-session-btn"
          >
            🛑 End Session
          </button>
        )}
        <button 
          onClick={() => {
            if (!showApiLogs) {
              fetchApiLogs();
            }
            setShowApiLogs(!showApiLogs);
          }}
          className="logs-toggle-btn"
        >
          {showApiLogs ? '📋 Hide API Logs' : '📋 Show API Logs'}
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
            {sessionStarted 
              ? `Chat with ${agentName} (Session Active)`
              : 'Start a session to begin chatting'
            }
          </h3>
          {sessionStarted && (
            <button onClick={clearChat} className="clear-chat-btn">
              🗑️ Clear Chat
            </button>
          )}
        </div>

        <div className="chat-messages">
          {messages.length === 0 ? (
            <div className="no-messages">
              <p>
                {sessionStarted 
                  ? 'No messages yet. Start chatting with your agent!'
                  : 'Start a session to begin chatting!'
                }
              </p>
            </div>
          ) : (
            messages.map(message => (
                              <div key={message.id} className={`message ${message.type}`}>
                  <div className="message-header">
                    <span className="message-sender">
                      {message.type === 'user' ? 'You' : 
                       message.type === 'agent' ? agentName : 'System'}
                    </span>
                    <span className="message-time">
                      {new Date(message.timestamp).toLocaleDateString()} {new Date(message.timestamp).toLocaleTimeString()}
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
            placeholder={sessionStarted ? "Type your message..." : "Start a session to chat"}
            disabled={!sessionStarted || isLoading}
            className="message-input"
          />
          <button 
            type="submit" 
            disabled={!sessionStarted || !inputMessage.trim() || isLoading}
            className="send-button"
          >
            {isLoading ? '⏳' : '📤'}
          </button>
          
          {/* Preset Messages Arrow Button - Only visible during active session */}
          {sessionStarted && (
            <div className="preset-messages-container">
              <button
                type="button"
                onClick={() => setShowPresetMessages(!showPresetMessages)}
                className="preset-toggle-btn"
                title="Quick preset messages"
              >
                ⬇️
              </button>
              
              {/* Preset Messages Dropdown */}
              <div className={`preset-dropdown ${showPresetMessages ? 'show' : ''}`}>
                {presetMessages.map((message, index) => (
                  <div
                    key={index}
                    className="preset-message-item"
                    onClick={() => handlePresetMessageSelect(message)}
                  >
                    {message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>


      </div>

      {/* API Communication Logs - Right Side Panel */}
      {showApiLogs && (
        <div className="api-logs-panel">
          <div className="logs-header">
            <h3>📋 Salesforce Agent API Logs</h3>
            <div className="logs-controls">
              <button 
                onClick={fetchApiLogs}
                className="refresh-logs-btn"
              >
                🔄 Refresh
              </button>
              <button 
                onClick={() => setShowApiLogs(false)}
                className="close-logs-btn"
              >
                ✕ Close
              </button>
            </div>
          </div>
          
          {/* Log Filter Controls */}
                      <div className="logs-filter">
              <label className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={showAllLogs}
                  onChange={(e) => {
                    setShowAllLogs(e.target.checked);
                    // Fetch logs with new filter immediately
                    setTimeout(() => fetchApiLogs(), 100);
                  }}
                />
                <span>Show All Logs</span>
              </label>
              <label className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={showHeaders}
                  onChange={(e) => {
                    setShowHeaders(e.target.checked);
                  }}
                />
                <span>Show Headers</span>
              </label>
              {/* Removed static text display */}
            </div>
          <div className="logs-content">
            {apiLogs.length === 0 ? (
              <div className="no-logs">
                <p>No API communication logs yet.</p>
                <p>Start a session and send messages to see the actual Salesforce Agent API calls.</p>
              </div>
            ) : (
              apiLogs.map(log => (
                <div key={log.id} className={`log-entry log-${log.type}`}>
                  <div className="log-header">
                    <span className="log-type">{log.type.toUpperCase()}</span>
                    <span className="log-timestamp">{new Date(log.timestamp).toLocaleDateString()} {new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="log-data">
                    <pre>{JSON.stringify(cleanSalesforceData(log.data), null, 2)}</pre>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TalkToSFDCAgentTab;
