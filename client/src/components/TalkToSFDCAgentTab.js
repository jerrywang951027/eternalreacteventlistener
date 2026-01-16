import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState(null);
  const [autoSendVoice, setAutoSendVoice] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [availableAgents, setAvailableAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [loadingAgents, setLoadingAgents] = useState(false);
  const autoSendVoiceRef = useRef(autoSendVoice);
  const isCreatingRecognition = useRef(false);
  const recordingTimeoutRef = useRef(null);

  // Keep ref in sync with state
  useEffect(() => {
    console.log('🎤 Ref updated to:', autoSendVoice);
    autoSendVoiceRef.current = autoSendVoice;
  }, [autoSendVoice]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
    };
  }, []);

  // Format timestamp as HH:MM:SS.mmm
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  };

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
    "create quote on account Demo101 with default settings.",
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

  // Handle voice input
  const startVoiceInput = async () => {
    console.log('🎤 ===== START VOICE INPUT CALLED =====');
    console.log('🎤 Starting voice input, auto-send enabled:', autoSendVoiceRef.current);
    console.log('🎤 Is recording:', isRecording);
    console.log('🎤 Is stopped:', isStopped);
    console.log('🎤 Session started:', sessionStarted);
    console.log('🎤 ======================================');
    
    // Early exit if session not started
    if (!sessionStarted) {
      console.log('🎤 ❌ Cannot start voice input - session not started');
      return;
    }
    
    // Check microphone permissions first
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('🎤 Microphone access granted');
      stream.getTracks().forEach(track => track.stop()); // Stop the test stream
    } catch (error) {
      console.error('🎤 Microphone access denied:', error);
      setError('Microphone access is required for voice input. Please allow microphone access and try again.');
      return;
    }
    
    if (!isRecording && !isCreatingRecognition.current) {
      setError('');
      // If recording was stopped, automatically reset it when user clicks to start
      if (isStopped) {
        console.log('🎤 Recording was stopped, automatically resetting to allow new recording');
        setIsStopped(false);
      }
      isCreatingRecognition.current = true; // Prevent multiple simultaneous creations
      
      // Create a fresh recognition instance each time
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const freshRecognition = new SpeechRecognition();
        
        freshRecognition.continuous = true;  // Keep recording until manually stopped
        freshRecognition.interimResults = true;  // Get partial results as you speak
        freshRecognition.lang = 'en-US';
        
        console.log('🎤 Created fresh recognition instance:', freshRecognition);
        
        // Set up event handlers
        freshRecognition.onstart = () => {
          console.log('🎤 Fresh recognition started');
          setIsRecording(true);
          setIsStopped(false);
          isCreatingRecognition.current = false; // Reset creation flag
          
          // Set a timeout to automatically stop recording after 30 seconds of silence
          recordingTimeoutRef.current = setTimeout(() => {
            console.log('🎤 Auto-stopping recording due to timeout');
            if (isRecording && !isStopped) {
              stopVoiceInput();
            }
          }, 30000); // 30 seconds
        };
        
        freshRecognition.onresult = (event) => {
          console.log('🎤 Fresh recognition result event fired');
          console.log('🎤 Event results:', event.results);
          
          // Get the latest result (most recent)
          const result = event.results[event.results.length - 1];
          const transcript = result[0].transcript;
          const isFinal = result.isFinal;
          
          console.log('🎤 Transcript:', transcript, 'Is final:', isFinal);
          
          // Reset the timeout when we get any result (speech detected)
          if (recordingTimeoutRef.current) {
            clearTimeout(recordingTimeoutRef.current);
            recordingTimeoutRef.current = null;
          }
          
          // Only process final results to avoid sending partial text
          if (isFinal) {
            handleVoiceResult(transcript);
          } else {
            // Set a new timeout for the next period of silence
            recordingTimeoutRef.current = setTimeout(() => {
              console.log('🎤 Auto-stopping recording due to silence timeout');
              if (isRecording && !isStopped) {
                stopVoiceInput();
              }
            }, 10000); // 10 seconds of silence
          }
        };
        
        freshRecognition.onerror = (event) => {
          console.error('🎤 Fresh recognition error:', event.error);
          setIsRecording(false);
          setIsStopped(true);
          isCreatingRecognition.current = false; // Reset creation flag
          
          // Clear timeout on error
          if (recordingTimeoutRef.current) {
            clearTimeout(recordingTimeoutRef.current);
            recordingTimeoutRef.current = null;
          }
          
          // Only show error for certain types of errors, not "no-speech"
          if (event.error !== 'no-speech' && event.error !== 'aborted') {
            setError('Voice recognition failed: ' + event.error);
          } else {
            // Clear any existing error for no-speech or aborted errors
            setError('');
          }
        };
        
        freshRecognition.onend = () => {
          console.log('🎤 Fresh recognition ended');
          setIsRecording(false);
          // Don't reset isStopped here - let user control when to allow recording again
          isCreatingRecognition.current = false; // Reset creation flag
          
          // Clear timeout when recognition ends
          if (recordingTimeoutRef.current) {
            clearTimeout(recordingTimeoutRef.current);
            recordingTimeoutRef.current = null;
          }
        };
        
        try {
          console.log('🎤 Starting fresh recognition...');
          freshRecognition.start();
          console.log('🎤 Fresh recognition.start() called successfully');
        } catch (error) {
          console.error('🎤 Error starting fresh recognition:', error);
          setError('Failed to start voice recognition: ' + error.message);
          isCreatingRecognition.current = false; // Reset creation flag
        }
      } else {
        setError('Speech recognition not supported in this browser');
      }
    } else {
      console.log('🎤 Cannot start - already recording:', isRecording, 'or creating recognition:', isCreatingRecognition.current);
    }
  };

  const stopVoiceInput = () => {
    console.log('🎤 Stopping voice input');
    if (isRecording) {
      console.log('🎤 Setting isRecording to false and isStopped to true');
      setIsRecording(false);
      setIsStopped(true);
    }
    
    // Clear any active timeout
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
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

  // Send voice message directly
  const sendVoiceMessage = async (transcript) => {
    console.log('🎤 sendVoiceMessage called with transcript:', transcript);
    console.log('🎤 Session started:', sessionStarted);
    console.log('🎤 Current session ID:', currentSessionId);
    console.log('🎤 Transcript trimmed:', transcript.trim());
    
    if (!sessionStarted || !currentSessionId || !transcript.trim()) {
      console.log('🎤 ❌ Cannot send voice message - session:', sessionStarted, 'sessionId:', currentSessionId, 'transcript:', transcript);
      return;
    }
    
    console.log('🎤 ✅ All conditions met, proceeding to send voice message');
    
    // Ensure recording is stopped before sending
    setIsRecording(false);
    setIsStopped(true);

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: transcript.trim(),
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
      
      console.log('🎤 Sending voice message to API:', transcript);
      console.log('🎤 API payload:', {
        message: userMessage.content,
        sessionId: currentSessionId
      });
      
      const response = await axios.post('/api/salesforce/agentforce/chat', {
        message: userMessage.content,
        sessionId: currentSessionId
      });
      
      console.log('🎤 API response received:', response.data);
      
      if (response.data.success) {
        const agentResponse = {
          id: Date.now() + 1,
          type: 'agent',
          content: response.data.response,
          timestamp: new Date().toISOString(),
          agentName: response.data.agentName
        };
        
        setMessages(prev => [...prev, agentResponse]);
        
        // Fetch updated API logs if the panel is open (with small delay to ensure backend has logged)
        if (showApiLogs) {
          setTimeout(() => fetchApiLogs(), 300);
        }
        
        console.log('🎤 Voice message sent successfully, agent response received:', agentResponse);
      } else {
        setError('Failed to get agent response: ' + response.data.message);
      }
    } catch (err) {
      console.error('🎤 Error sending voice message:', err);
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

  // Handle voice recognition result
  const handleVoiceResult = (transcript) => {
    console.log('🎤 Voice result received:', transcript);
    console.log('🎤 Auto-send enabled:', autoSendVoiceRef.current);
    console.log('🎤 Transcript length:', transcript.trim().length);
    setInputMessage(transcript);
    setIsRecording(false);
    
    // Auto-send if checkbox is enabled (using ref to get current value)
    console.log('🎤 Checking auto-send conditions:');
    console.log('🎤 - autoSendVoiceRef.current:', autoSendVoiceRef.current);
    console.log('🎤 - transcript.trim():', transcript.trim());
    console.log('🎤 - transcript.trim().length:', transcript.trim().length);
    
    if (autoSendVoiceRef.current && transcript.trim()) {
      console.log('🎤 ✅ Auto-send conditions met, proceeding with auto-send');
      console.log('🎤 Auto-sending voice input:', transcript);
      
      // Immediately stop recording and set stopped state to prevent restart
      setIsRecording(false);
      setIsStopped(true);
      
      // Send the message directly with the transcript
      setTimeout(() => {
        console.log('🎤 About to call sendVoiceMessage with transcript:', transcript);
        sendVoiceMessage(transcript);
      }, 500);
    } else {
      console.log('🎤 ❌ Auto-send conditions not met:');
      console.log('🎤 - Auto-send ref value:', autoSendVoiceRef.current);
      console.log('🎤 - Transcript trimmed:', transcript.trim());
      console.log('🎤 - Transcript length:', transcript.trim().length);
    }
  };

  // Initialize speech recognition
  useEffect(() => {
    console.log('🎤 Initializing speech recognition...');
    console.log('🎤 Is HTTPS:', window.location.protocol === 'https:');
    console.log('🎤 User agent:', navigator.userAgent);
    console.log('🎤 SpeechRecognition available:', 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
    
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognitionInstance = new SpeechRecognition();
      console.log('🎤 Speech recognition instance created:', recognitionInstance);
      
      recognitionInstance.continuous = false;
      recognitionInstance.interimResults = false;
      recognitionInstance.lang = 'en-US';
      
      // Add additional debugging
      console.log('🎤 Recognition config:', {
        continuous: recognitionInstance.continuous,
        interimResults: recognitionInstance.interimResults,
        lang: recognitionInstance.lang
      });
      
      recognitionInstance.onstart = () => {
        console.log('🎤 Speech recognition started');
        setIsRecording(true);
        
        // Set a timeout to detect if recognition hangs
        setTimeout(() => {
          if (isRecording) {
            console.warn('🎤 Speech recognition timeout - no result after 10 seconds');
            recognitionInstance.stop();
          }
        }, 10000);
      };
      
      recognitionInstance.onresult = (event) => {
        console.log('🎤 Speech recognition result event fired');
        console.log('🎤 Event results:', event.results);
        const transcript = event.results[0][0].transcript;
        handleVoiceResult(transcript);
      };
      
      recognitionInstance.onerror = (event) => {
        console.error('🎤 Speech recognition error:', event.error);
        setIsRecording(false);
        setError('Voice recognition failed. Please try again.');
      };
      
      recognitionInstance.onend = () => {
        console.log('🎤 Speech recognition ended');
        setIsRecording(false);
      };
      
      setRecognition(recognitionInstance);
    } else {
      console.warn('Speech recognition not supported in this browser');
    }
  }, []);

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

  // Fetch available agents on component mount
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        setLoadingAgents(true);
        const response = await axios.get('/api/salesforce/agentforce/agents');
        if (response.data.success && response.data.agents) {
          setAvailableAgents(response.data.agents);
          // Auto-select first agent if available
          if (response.data.agents.length > 0 && !selectedAgentId) {
            setSelectedAgentId(response.data.agents[0].id);
          }
        } else {
          console.error('Failed to fetch agents:', response.data.message);
          setError('Failed to load available agents: ' + (response.data.message || 'Unknown error'));
        }
      } catch (error) {
        console.error('Error fetching agents:', error);
        setError('Error loading agents: ' + (error.response?.data?.message || error.message));
      } finally {
        setLoadingAgents(false);
      }
    };

    fetchAgents();
  }, []);



  // Start a new agent session
  const startSession = async () => {
    if (!selectedAgentId) {
      setError('Please select an agent from the dropdown');
      return;
    }

    try {
      setIsLoading(true);
      setError('');
      setIsStopped(false); // Reset stopped state when starting new session
      

      
      const response = await axios.post('/api/salesforce/agentforce/start-session', {
        agentId: selectedAgentId
      });
      

      
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
        
        // Fetch updated API logs if the panel is open (with small delay to ensure backend has logged)
        if (showApiLogs) {
          setTimeout(() => fetchApiLogs(), 300);
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
      setIsStopped(false);
    }
  };

  return (
    <div className="talk-to-sfdc-agent-tab">
      <div className="tab-content">
        <div className="tab-header">
          <h2>Chat with Agentforce Agent for real time assistance</h2>
          {/* Agent Selection Dropdown */}
          <div className="agent-selection">
            <label htmlFor="agent-select">Select Agent:</label>
            <select
              id="agent-select"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              disabled={sessionStarted || loadingAgents}
              className="agent-dropdown"
            >
              {loadingAgents ? (
                <option value="">Loading agents...</option>
              ) : availableAgents.length === 0 ? (
                <option value="">No agents available</option>
              ) : (
                <>
                  <option value="">-- Select an agent --</option>
                  {availableAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.type})
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
        </div>

      {/* Session Controls */}
      <div className="session-controls">
        {!sessionStarted ? (
          <button 
            onClick={startSession}
            disabled={isLoading || !selectedAgentId || loadingAgents}
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
          <div className="chat-header-left">
            <h3>
              {sessionStarted 
                ? `Chat with ${agentName} (Session Active)`
                : 'Start a session to begin chatting'
              }
              {isRecording && (
                <span className="recording-indicator">
                  🔴 Recording...
                </span>
              )}
            </h3>
            {sessionStarted && (
              <label className="auto-send-checkbox">
                <input
                  type="checkbox"
                  checked={autoSendVoice}
                  onChange={(e) => {
                    console.log('🎤 Checkbox changed to:', e.target.checked);
                    setAutoSendVoice(e.target.checked);
                  }}
                />
                <span>Send text from voice upon completion</span>
              </label>
            )}
          </div>
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
                      {formatTimestamp(message.timestamp)}
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
          
          {/* Voice Input Button */}
          {sessionStarted && recognition && (
            <button
              type="button"
              onClick={isRecording ? stopVoiceInput : startVoiceInput}
              disabled={isLoading}
              className={`voice-button ${isRecording ? 'recording' : ''}`}
              title={isRecording ? 'Stop recording' : 'Start voice input'}
            >
              {isRecording ? '🔴' : '🎤'}
            </button>
          )}
          
          
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
                    <span className="log-timestamp">{formatTimestamp(log.timestamp)}</span>
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
