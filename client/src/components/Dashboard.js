import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import PlatformEventsTab from './PlatformEventsTab';
import SObjectsTab from './SObjectsTab';
import OMTab from './OMTab';
import './Dashboard.css';

const Dashboard = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState('platform-events');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  // Platform Events Tab State (lifted up to preserve across tab switches)
  const [platformEventsState, setPlatformEventsState] = useState({
    events: [],
    platformEvents: [],
    selectedEvents: new Set(),
    subscribed: false,
    loading: false,
    error: ''
  });

  // SObjects Tab State (lifted up to preserve across tab switches)
  const [sObjectsState, setSObjectsState] = useState({
    searchQuery: '',
    searchResults: [],
    allSObjects: [],
    selectedSObject: null,
    describe: null,
    showAllSObjects: false,
    loading: false,
    error: ''
  });
  
  const socketRef = useRef(null);
  const eventsContainerRef = useRef(null);

  // Initialize socket connection (shared across tabs)
  useEffect(() => {
    console.log('🔄 Initializing WebSocket connection...');
    
    // Prevent multiple connections
    if (socketRef.current) {
      console.log('⚠️ Socket already exists, cleaning up first...');
      socketRef.current.disconnect();
      socketRef.current.removeAllListeners();
    }
    
    // Use environment-appropriate URL
    const socketUrl = process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:5000';
    
    socketRef.current = io(socketUrl, {
      withCredentials: true,
      transports: ['websocket', 'polling'] // Fallback for production
    });

    console.log('🔌 WebSocket connection created');

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

    console.log('🎧 Event listeners registered');

    // Cleanup on unmount
    return () => {
      console.log('🧹 Cleaning up WebSocket connection...');
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  // Set up platform events socket listener
  useEffect(() => {
    if (socketRef.current && connectionStatus === 'connected') {
      const handlePlatformEvent = (eventData) => {
        console.log('📨 [CLIENT] Received platform event:', eventData.eventName, 'at', eventData.timestamp);
        setPlatformEventsState(prevState => {
          // Add a unique ID to prevent duplicates (using timestamp + random)
          const eventWithId = {
            ...eventData,
            id: `${eventData.timestamp}-${Math.random().toString(36).substr(2, 9)}`
          };
          
          // Check for potential duplicates based on timestamp and event name
          const isDuplicate = prevState.events.some(existingEvent => 
            existingEvent.timestamp === eventData.timestamp && 
            existingEvent.eventName === eventData.eventName &&
            JSON.stringify(existingEvent.message) === JSON.stringify(eventData.message)
          );
          
          if (isDuplicate) {
            console.warn('🚫 Duplicate event detected and ignored:', eventData.eventName, 'at', eventData.timestamp);
            return prevState;
          }
          
          console.log('✅ [CLIENT] Adding event to UI:', eventData.eventName, 'at', eventData.timestamp);
          return {
            ...prevState,
            events: [eventWithId, ...prevState.events.slice(0, 499)] // Keep last 500 events
          };
        });
      };

      console.log('🎧 [CLIENT] Setting up platformEvent listener');
      socketRef.current.on('platformEvent', handlePlatformEvent);

      // Cleanup
      return () => {
        if (socketRef.current) {
          console.log('🧹 [CLIENT] Cleaning up platformEvent listener');
          socketRef.current.off('platformEvent', handlePlatformEvent);
        }
      };
    }
  }, [socketRef, connectionStatus]);

  // Auto-scroll to top when new events arrive (only if platform events tab is active)
  useEffect(() => {
    if (activeTab === 'platform-events' && eventsContainerRef.current) {
      eventsContainerRef.current.scrollTop = 0;
    }
  }, [platformEventsState.events, activeTab]);

  // Platform Events functions (moved from PlatformEventsTab)
  const fetchPlatformEvents = async () => {
    try {
      const response = await axios.get('/api/platform-events', {
        withCredentials: true
      });
      
      if (response.data.success) {
        setPlatformEventsState(prev => ({
          ...prev,
          platformEvents: response.data.platformEvents
        }));
      }
    } catch (error) {
      setPlatformEventsState(prev => ({
        ...prev,
        error: 'Failed to fetch platform events: ' + (error.response?.data?.message || error.message)
      }));
    }
  };

  const handleEventSelection = (eventName, isChecked) => {
    setPlatformEventsState(prev => {
      const newSelected = new Set(prev.selectedEvents);
      if (isChecked) {
        newSelected.add(eventName);
      } else {
        newSelected.delete(eventName);
      }
      return {
        ...prev,
        selectedEvents: newSelected
      };
    });
  };

  const handleSelectAll = (isChecked) => {
    setPlatformEventsState(prev => ({
      ...prev,
      selectedEvents: isChecked ? new Set(prev.platformEvents.map(event => event.QualifiedApiName)) : new Set()
    }));
  };

  const subscribeToPlatformEvents = async () => {
    if (platformEventsState.selectedEvents.size === 0) {
      setPlatformEventsState(prev => ({
        ...prev,
        error: 'Please select at least one platform event to subscribe to.'
      }));
      return;
    }

    setPlatformEventsState(prev => ({
      ...prev,
      loading: true,
      error: ''
    }));
    
    try {
      const response = await axios.post('/api/platform-events/subscribe', {
        selectedEvents: Array.from(platformEventsState.selectedEvents)
      }, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setPlatformEventsState(prev => ({
          ...prev,
          subscribed: true,
          error: '',
          loading: false
        }));
        console.log('Subscribed to platform events:', response.data.subscriptions);
      }
    } catch (error) {
      setPlatformEventsState(prev => ({
        ...prev,
        error: 'Failed to subscribe to platform events: ' + (error.response?.data?.message || error.message),
        loading: false
      }));
    }
  };

  const clearEvents = () => {
    setPlatformEventsState(prev => ({
      ...prev,
      events: []
    }));
  };

  const formatEventData = (data) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch (error) {
      return String(data);
    }
  };

  // Fetch platform events on mount
  useEffect(() => {
    fetchPlatformEvents();
  }, []);

  // SObjects functions (moved from SObjectsTab)
  const searchSObjects = async (query) => {
    if (!query || query.trim().length === 0) {
      setSObjectsState(prev => ({
        ...prev,
        searchQuery: '',
        searchResults: []
      }));
      return;
    }

    setSObjectsState(prev => ({
      ...prev,
      searchQuery: query,
      loading: true,
      error: ''
    }));

    try {
      const response = await axios.get(`/api/sobjects/search?query=${encodeURIComponent(query)}`, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setSObjectsState(prev => ({
          ...prev,
          searchResults: response.data.sobjects,
          loading: false
        }));
      }
    } catch (error) {
      setSObjectsState(prev => ({
        ...prev,
        error: 'Failed to search SObjects: ' + (error.response?.data?.message || error.message),
        loading: false
      }));
    }
  };

  const selectSObject = async (sobject) => {
    setSObjectsState(prev => ({
      ...prev,
      selectedSObject: sobject,
      describe: null,
      loading: true,
      error: ''
    }));

    try {
      const response = await axios.get(`/api/sobjects/${sobject.name}/describe`, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setSObjectsState(prev => ({
          ...prev,
          describe: response.data.describe,
          loading: false
        }));
      } else {
        setSObjectsState(prev => ({
          ...prev,
          error: `API returned success: false for ${sobject.name}`,
          loading: false
        }));
      }
    } catch (error) {
      setSObjectsState(prev => ({
        ...prev,
        error: `Failed to describe ${sobject.name}: ` + (error.response?.data?.message || error.message),
        loading: false
      }));
    }
  };

  const fetchAllSObjects = async () => {
    setSObjectsState(prev => ({
      ...prev,
      loading: true,
      error: ''
    }));

    try {
      const response = await axios.get('/api/sobjects/all', {
        withCredentials: true
      });
      
      if (response.data.success) {
        setSObjectsState(prev => ({
          ...prev,
          allSObjects: response.data.sobjects,
          loading: false
        }));
      }
    } catch (error) {
      setSObjectsState(prev => ({
        ...prev,
        error: 'Failed to fetch all SObjects: ' + (error.response?.data?.message || error.message),
        loading: false
      }));
    }
  };

  const toggleShowAllSObjects = (checked) => {
    setSObjectsState(prev => ({
      ...prev,
      showAllSObjects: checked
    }));

    if (checked && sObjectsState.allSObjects.length === 0) {
      fetchAllSObjects();
    }
  };

  const clearSObjectsState = () => {
    setSObjectsState(prev => ({
      ...prev,
      searchQuery: '',
      searchResults: [],
      selectedSObject: null,
      describe: null,
      error: ''
    }));
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

  // Tab navigation
  const tabs = [
    { id: 'platform-events', label: 'Explore Platform Events', icon: '📨' },
    { id: 'sobjects', label: 'Explore SObjects', icon: '🗃️' },
    { id: 'om', label: 'Explore OM', icon: '⚙️' }
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'platform-events':
        return (
          <PlatformEventsTab 
            socketRef={socketRef}
            connectionStatus={connectionStatus}
            eventsContainerRef={eventsContainerRef}
            // Platform Events State
            events={platformEventsState.events}
            platformEvents={platformEventsState.platformEvents}
            selectedEvents={platformEventsState.selectedEvents}
            subscribed={platformEventsState.subscribed}
            loading={platformEventsState.loading}
            error={platformEventsState.error}
            // Platform Events Functions
            handleEventSelection={handleEventSelection}
            handleSelectAll={handleSelectAll}
            subscribeToPlatformEvents={subscribeToPlatformEvents}
            clearEvents={clearEvents}
            formatEventData={formatEventData}
          />
        );
      case 'sobjects':
        return (
          <SObjectsTab 
            // SObjects State
            searchQuery={sObjectsState.searchQuery}
            searchResults={sObjectsState.searchResults}
            allSObjects={sObjectsState.allSObjects}
            selectedSObject={sObjectsState.selectedSObject}
            describe={sObjectsState.describe}
            showAllSObjects={sObjectsState.showAllSObjects}
            loading={sObjectsState.loading}
            error={sObjectsState.error}
            // SObjects Functions
            searchSObjects={searchSObjects}
            selectSObject={selectSObject}
            toggleShowAllSObjects={toggleShowAllSObjects}
            clearSObjectsState={clearSObjectsState}
          />
        );
      case 'om':
        return <OMTab />;
      default:
        return <div>Tab not found</div>;
    }
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>🔗 Salesforce Explorer</h1>
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

      <div className="tabs-container">
        <div className="tabs-nav">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
        
        <div className="tab-content-container">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;