import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import './Dashboard.css';

const Dashboard = ({ user, onLogout }) => {
  const [events, setEvents] = useState([]);
  const [platformEvents, setPlatformEvents] = useState([]);
  const [selectedEvents, setSelectedEvents] = useState(new Set());
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [error, setError] = useState('');
  
  const socketRef = useRef(null);
  const eventsContainerRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    // Use environment-appropriate URL
    const socketUrl = process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:5000';
    
    socketRef.current = io(socketUrl, {
      withCredentials: true,
      transports: ['websocket', 'polling'] // Fallback for production
    });

    socketRef.current.on('connect', () => {
      console.log('✅ Connected to server at:', socketUrl);
      setConnectionStatus('connected');
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('❌ Disconnected from server. Reason:', reason);
      setConnectionStatus('disconnected');
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('🚫 Connection error:', error);
      setConnectionStatus('disconnected');
    });

    socketRef.current.on('platformEvent', (eventData) => {
      console.log('📨 Received platform event:', eventData);
      setEvents(prevEvents => [eventData, ...prevEvents.slice(0, 499)]); // Keep last 500 events
    });

    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (eventsContainerRef.current) {
      eventsContainerRef.current.scrollTop = 0;
    }
  }, [events]);

  // Fetch available platform events
  useEffect(() => {
    fetchPlatformEvents();
  }, []);

  const fetchPlatformEvents = async () => {
    try {
      const response = await axios.get('/api/platform-events', {
        withCredentials: true
      });
      
      if (response.data.success) {
        setPlatformEvents(response.data.platformEvents);
      }
    } catch (error) {
      setError('Failed to fetch platform events: ' + (error.response?.data?.message || error.message));
    }
  };

  // Handle checkbox selection
  const handleEventSelection = (eventName, isChecked) => {
    setSelectedEvents(prev => {
      const newSelected = new Set(prev);
      if (isChecked) {
        newSelected.add(eventName);
      } else {
        newSelected.delete(eventName);
      }
      return newSelected;
    });
  };

  const handleSelectAll = (isChecked) => {
    if (isChecked) {
      setSelectedEvents(new Set(platformEvents.map(event => event.QualifiedApiName)));
    } else {
      setSelectedEvents(new Set());
    }
  };

  const subscribeToPlatformEvents = async () => {
    if (selectedEvents.size === 0) {
      setError('Please select at least one platform event to subscribe to.');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const response = await axios.post('/api/platform-events/subscribe', {
        selectedEvents: Array.from(selectedEvents)
      }, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setSubscribed(true);
        setError('');
        console.log('Subscribed to platform events:', response.data.subscriptions);
      }
    } catch (error) {
      setError('Failed to subscribe to platform events: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout', {}, {
        withCredentials: true
      });
      onLogout();
    } catch (error) {
      console.error('Logout error:', error);
      onLogout(); // Logout anyway
    }
  };

  const formatEventData = (data) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch (error) {
      return String(data);
    }
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>🔗 Platform Event Listener</h1>
          <div className="header-info">
            <span className={`connection-status ${connectionStatus}`}>
              {connectionStatus === 'connected' ? '🟢' : '🔴'} {connectionStatus}
            </span>
            <span className="org-info">
              📊 {user.orgType} ({user.organizationId})
            </span>
            <button onClick={handleLogout} className="logout-btn">
              🚪 Logout
            </button>
          </div>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="control-panel">
          <div className="platform-events-info">
            <h3>📋 Available Platform Events ({platformEvents.length})</h3>
            {platformEvents.length > 0 ? (
              <div className="events-selection">
                <div className="select-all-container">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedEvents.size === platformEvents.length && platformEvents.length > 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="checkbox-input"
                    />
                    <span className="select-all-text">
                      Select All ({selectedEvents.size} of {platformEvents.length} selected)
                    </span>
                  </label>
                </div>
                <div className="events-list">
                  {platformEvents.map((event, index) => (
                    <div key={index} className="event-item">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={selectedEvents.has(event.QualifiedApiName)}
                          onChange={(e) => handleEventSelection(event.QualifiedApiName, e.target.checked)}
                          className="checkbox-input"
                        />
                        <span className="event-details">
                          <strong>{event.QualifiedApiName}</strong>
                          {event.Label && <span className="event-label"> - {event.Label}</span>}
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="no-events">No platform events found in this org.</p>
            )}
          </div>

          {!subscribed ? (
            <button
              onClick={subscribeToPlatformEvents}
              disabled={loading || platformEvents.length === 0 || selectedEvents.size === 0}
              className="subscribe-btn"
            >
              {loading ? '🔄 Subscribing...' : 
               selectedEvents.size === 0 ? '📋 Select events to listen' :
               `🎧 Start Listening (${selectedEvents.size} events)`}
            </button>
          ) : (
            <div className="listening-indicator">
              <div className="pulse-dot"></div>
              <span>🎧 Listening to {selectedEvents.size} selected events</span>
            </div>
          )}

          {error && (
            <div className="error-message">
              ⚠️ {error}
            </div>
          )}
        </div>

        <div className="events-section">
          <div className="events-header">
            <h3>📨 Received Events ({events.length})</h3>
            {events.length > 0 && (
              <button 
                onClick={() => setEvents([])}
                className="clear-btn"
              >
                🗑️ Clear
              </button>
            )}
          </div>

          <div className="events-container" ref={eventsContainerRef}>
            {events.length === 0 ? (
              <div className="no-events-placeholder">
                {subscribed ? (
                  <div>
                    <p>👂 Listening for platform events...</p>
                    <p className="help-text">
                      Trigger platform events in your Salesforce org to see them here in real-time.
                    </p>
                  </div>
                ) : (
                  <p>Click "Start Listening" to begin receiving platform events.</p>
                )}
              </div>
            ) : (
              events.map((event, index) => (
                <div key={index} className="event-card">
                  <div className="event-header">
                    <div className="event-title">
                      <strong>{event.eventLabel || event.eventName}</strong>
                      <span className="event-name">{event.eventName}</span>
                    </div>
                    <div className="event-timestamp">
                      {new Date(event.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div className="event-data">
                    <pre>{formatEventData(event.message)}</pre>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
