import React, { useState, useMemo } from 'react';

const PlatformEventsTab = ({ 
  socketRef, 
  connectionStatus,
  eventsContainerRef,
  // State props
  events,
  platformEvents,
  selectedEvents,
  subscribed,
  loading,
  error,
  // Function props
  handleEventSelection,
  handleSelectAll,
  subscribeToPlatformEvents,
  clearEvents,
  formatEventData
}) => {
  // Search state for filtering platform events
  const [searchTerm, setSearchTerm] = useState('');

  // Filter platform events based on search term
  const filteredPlatformEvents = useMemo(() => {
    if (!searchTerm.trim()) return platformEvents;
    
    const term = searchTerm.toLowerCase();
    return platformEvents.filter(event => 
      event.QualifiedApiName.toLowerCase().includes(term) ||
      (event.Label && event.Label.toLowerCase().includes(term))
    );
  }, [platformEvents, searchTerm]);

  return (
    <div className="tab-content">
      <div className="dashboard-content platform-events-content">
        <div className="control-panel">
          <div className="platform-events-info">
            <h3>📋 Available Platform Events ({platformEvents.length})</h3>
            
            {/* Search box for filtering platform events */}
            {platformEvents.length > 0 && (
              <div className="search-container">
                <div className="search-input-wrapper">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    placeholder="Search platform events..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="clear-search-btn"
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {searchTerm && (
                  <div className="search-results-info">
                    Showing {filteredPlatformEvents.length} of {platformEvents.length} events
                  </div>
                )}
              </div>
            )}

            {filteredPlatformEvents.length > 0 ? (
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
                  {filteredPlatformEvents.map((event, index) => (
                    <div key={event.QualifiedApiName || index} className="event-item">
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
            ) : searchTerm ? (
              <p className="no-events">No platform events match "{searchTerm}". Try a different search term.</p>
            ) : (
              <p className="no-events">No platform events found in this org.</p>
            )}
          </div>

          {!subscribed ? (
            <button
              onClick={subscribeToPlatformEvents}
              disabled={loading || filteredPlatformEvents.length === 0 || selectedEvents.size === 0}
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
                onClick={clearEvents}
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
                <div key={event.id || index} className="event-card">
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
