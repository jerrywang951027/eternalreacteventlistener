import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const PlatformEventsTab = ({ socketRef, connectionStatus }) => {
  const [events, setEvents] = useState([]);
  const [platformEvents, setPlatformEvents] = useState([]);
  const [selectedEvents, setSelectedEvents] = useState(new Set());
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const eventsContainerRef = useRef(null);

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (eventsContainerRef.current) {
      eventsContainerRef.current.scrollTop = 0;
    }
  }, [events]);

  // Fetch platform events on mount
  useEffect(() => {
    fetchPlatformEvents();
  }, []);

  // Set up socket event listener
  useEffect(() => {
    if (socketRef.current) {
      const handlePlatformEvent = (eventData) => {
        console.log('📨 [CLIENT] Received platform event:', eventData.eventName, 'at', eventData.timestamp);
        setEvents(prevEvents => {
          // Add a unique ID to prevent duplicates (using timestamp + random)
          const eventWithId = {
            ...eventData,
            id: `${eventData.timestamp}-${Math.random().toString(36).substr(2, 9)}`
          };
          
          // Check for potential duplicates based on timestamp and event name
          const isDuplicate = prevEvents.some(existingEvent => 
            existingEvent.timestamp === eventData.timestamp && 
            existingEvent.eventName === eventData.eventName &&
            JSON.stringify(existingEvent.message) === JSON.stringify(eventData.message)
          );
          
          if (isDuplicate) {
            console.warn('🚫 Duplicate event detected and ignored:', eventData.eventName, 'at', eventData.timestamp);
            return prevEvents;
          }
          
          console.log('✅ [CLIENT] Adding event to UI:', eventData.eventName, 'at', eventData.timestamp);
          return [eventWithId, ...prevEvents.slice(0, 499)]; // Keep last 500 events
        });
      };

      socketRef.current.on('platformEvent', handlePlatformEvent);

      // Cleanup
      return () => {
        if (socketRef.current) {
          socketRef.current.off('platformEvent', handlePlatformEvent);
        }
      };
    }
  }, [socketRef]);

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

  const formatEventData = (data) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch (error) {
      return String(data);
    }
  };

  return (
    <div className="tab-content">
      <div className="dashboard-content platform-events-content">
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

export default PlatformEventsTab;
