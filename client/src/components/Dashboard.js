import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import PlatformEventsTab from './PlatformEventsTab';
import SObjectsTab from './SObjectsTab';
import OMTab from './OMTab';
import OmnistudioTab from './OmnistudioTab';
import AdminConsoleTab from './AdminConsoleTab';
import SwaggerTab from './SwaggerTab';
import TalkToSFDCAgentTab from './TalkToSFDCAgentTab';
import DataCloudQueryTab from './DataCloudQueryTab';
import DataCloudObjectsTab from './DataCloudObjectsTab';
import DataCloudV3QueryTab from './DataCloudV3QueryTab';
import DataCloudObjectsV3Tab from './DataCloudObjectsV3Tab';
import RagSearchEvalTab from './RagSearchEvalTab';
import EmbeddedSiteTab from './EmbeddedSiteTab';
import IngestionAPITab from './IngestionAPITab';
import UserInfoPopup from './UserInfoPopup';
import './Dashboard.css';

const Dashboard = ({ user, onLogout }) => {
  // Initialize mainTab and subTab from localStorage or defaults
  const [mainTab, setMainTab] = useState(() => {
    const savedMainTab = localStorage.getItem('dashboard-main-tab');
    return savedMainTab || 'core-platform';
  });
  
  const [subTab, setSubTab] = useState(() => {
    const savedSubTab = localStorage.getItem('dashboard-sub-tab');
    return savedSubTab || 'platform-events';
  });
  
  // Helper to get activeTab for backward compatibility with renderTabContent
  const activeTab = subTab;
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  // Dark mode state - initialize from localStorage or default to false
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedDarkMode = localStorage.getItem('dashboard-dark-mode');
    return savedDarkMode === 'true';
  });

  // Toggle dark mode
  const toggleDarkMode = () => {
    const newDarkMode = !isDarkMode;
    setIsDarkMode(newDarkMode);
    localStorage.setItem('dashboard-dark-mode', newDarkMode.toString());
  };
  
  // Tab visibility state - initialize from localStorage or default to all visible
  const [tabVisibility, setTabVisibility] = useState(() => {
    const savedVisibility = localStorage.getItem('dashboard-tab-visibility');
    return savedVisibility ? JSON.parse(savedVisibility) : {
      'datacloud-query': true,
      'datacloud-objects': true
    };
  });

  // Update tab visibility
  const updateTabVisibility = (tabId, isVisible) => {
    const newVisibility = { ...tabVisibility, [tabId]: isVisible };
    setTabVisibility(newVisibility);
    localStorage.setItem('dashboard-tab-visibility', JSON.stringify(newVisibility));
  };
  
  // User info popup state
  const [showUserPopup, setShowUserPopup] = useState(false);
  const [userPopupPosition, setUserPopupPosition] = useState({ x: 0, y: 0 });
  const [userPopupTimeout, setUserPopupTimeout] = useState(null);
  
  // Global data loading state
  const [globalDataLoaded, setGlobalDataLoaded] = useState(false);
  
  // Agentforce configuration state
  const [agentforceConfig, setAgentforceConfig] = useState({
    hasAgentId: false,
    loading: true,
    error: null
  });
  
  // Data Cloud configuration state
  const [dataCloudConfig, setDataCloudConfig] = useState({
    hasDataCloud: false,
    loading: true,
    error: null
  });
  
  // Data Cloud Query tab state - persisted across tab switches
  const [dataCloudQueryState, setDataCloudQueryState] = useState({
    isConnected: false,
    sqlQuery: '',
    queryResult: null,
    error: ''
  });
  
  // Data Cloud Objects tab state - persisted across tab switches
  const [dataCloudObjectsState, setDataCloudObjectsState] = useState({
    isConnected: false,
    entityType: '',
    objects: [],
    selectedObject: null,
    searchTerm: '',
    error: ''
  });

  // Data Cloud V3 Query tab state - persisted across tab switches
  const [dataCloudV3QueryState, setDataCloudV3QueryState] = useState({
    sqlQuery: '',
    queryResult: null,
    error: ''
  });

  // RAG Search Eval tab state - persisted across tab switches
  const [ragSearchEvalState, setRagSearchEvalState] = useState({
    sqlQuery: '',
    queryResult: null,
    error: ''
  });

  // Data Cloud Objects V3 tab state - persisted across tab switches
  const [dataCloudObjectsV3State, setDataCloudObjectsV3State] = useState({
    entityType: '',
    objects: [],
    selectedObject: null,
    searchTerm: '',
    error: ''
  });
  
  console.log('🔍 [DASHBOARD] Initial agentforceConfig state:', agentforceConfig);

  // Load OmniStudio global data (only once per session)
  const loadOmnistudioGlobalData = async () => {
    if (globalDataLoaded) return; // Already loaded
    
    try {
      console.log('🔄 Loading OmniStudio global data (first time per session)...');
      const response = await fetch('/api/omnistudio/global-data', {
        method: 'GET',
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ OmniStudio global data loaded:', data);
        setGlobalDataLoaded(true);
      } else {
        console.warn('⚠️ Failed to load OmniStudio global data:', response.statusText);
      }
    } catch (error) {
      console.error('❌ Error loading OmniStudio global data:', error);
    }
  };

  // Check Agentforce configuration for current org
  const checkAgentforceConfig = useCallback(async () => {
    try {
      console.log('🔍 Checking Agentforce configuration for current org...');
      console.log('👤 Current user orgKey:', user?.orgKey);
      
      const response = await axios.get('/api/salesforce/agentforce/config-status');
      
      if (response.data.success) {
        console.log('📋 Available orgs from backend:', response.data.data.orgStatus);
        
        // Extract org name from orgKey (format: org_0_8x8jinwang -> 8x8jinwang)
        const orgNameFromKey = user?.orgKey?.replace(/^org_\d+_/, '') || '';
        console.log('🔑 Extracted org name from orgKey:', orgNameFromKey);
        
        // Try exact match first (case-insensitive)
        let currentOrg = response.data.data.orgStatus.find(org => 
          org.orgId.toLowerCase() === orgNameFromKey.toLowerCase()
        );
        
        // If no exact match, try normalized matching (removing all special chars and case-insensitive)
        if (!currentOrg) {
          const normalizedOrgNameFromKey = orgNameFromKey.replace(/[^a-z0-9]/gi, '').toLowerCase();
          console.log('🔍 Trying normalized match:', normalizedOrgNameFromKey);
          
          currentOrg = response.data.data.orgStatus.find(org => 
            org.orgId.replace(/[^a-z0-9]/gi, '').toLowerCase() === normalizedOrgNameFromKey
          );
        }
        
        console.log('🎯 Found matching org:', currentOrg);
        
        if (currentOrg) {
          console.log('✅ Matched org:', currentOrg.orgName, 'hasAgentId:', currentOrg.hasAgentId, 'agentId:', currentOrg.agentId);
          
          // Check for Data Cloud configuration
          if (currentOrg.dataCloud) {
            console.log('✅ Org has Data Cloud enabled');
            setDataCloudConfig({
              hasDataCloud: true,
              loading: false,
              error: null
            });
          } else {
            console.log('❌ Org does not have Data Cloud enabled');
            setDataCloudConfig({
              hasDataCloud: false,
              loading: false,
              error: null
            });
          }
        } else {
          console.log('❌ No matching org found for orgKey:', user?.orgKey);
          console.log('📋 Available org IDs:', response.data.data.orgStatus.map(o => o.orgId));
          setDataCloudConfig({
            hasDataCloud: false,
            loading: false,
            error: null
          });
        }
        
        setAgentforceConfig({
          hasAgentId: currentOrg ? currentOrg.hasAgentId : false,
          loading: false,
          error: null
        });
        
        console.log('✅ Agentforce config set:', { hasAgentId: currentOrg ? currentOrg.hasAgentId : false });
      } else {
        setAgentforceConfig({
          hasAgentId: false,
          loading: false,
          error: response.data.message
        });
        setDataCloudConfig({
          hasDataCloud: false,
          loading: false,
          error: response.data.message
        });
      }
    } catch (error) {
      console.error('❌ Error checking Agentforce configuration:', error);
      setAgentforceConfig({
        hasAgentId: false,
        loading: false,
        error: error.message
      });
      setDataCloudConfig({
        hasDataCloud: false,
        loading: false,
        error: error.message
      });
    }
  }, [user?.orgKey]);

  // Monitor user object changes
  useEffect(() => {
    console.log('🔄 [DASHBOARD] User object changed:', user);
    console.log('🔄 [DASHBOARD] User orgKey changed:', user?.orgKey);
  }, [user]);

  // Check Agentforce configuration when user changes
  useEffect(() => {
    console.log('🔍 [DASHBOARD] User object structure:', user);
    console.log('🔍 [DASHBOARD] User orgKey:', user?.orgKey);
    
    if (user?.orgKey) {
      console.log('🔄 [DASHBOARD] User orgKey changed, calling checkAgentforceConfig...');
      checkAgentforceConfig();
    } else {
      console.log('⚠️ [DASHBOARD] No orgKey found in user object:', user);
    }
  }, [user?.orgKey, checkAgentforceConfig]);

  // Switch away from Agentforce tab if it gets hidden
  useEffect(() => {
    if (!agentforceConfig.hasAgentId && subTab === 'talk-to-sfdc-agent') {
      console.log('🔄 Agentforce tab hidden, switching to platform-events tab');
      setSubTab('platform-events');
      localStorage.setItem('dashboard-sub-tab', 'platform-events');
    }
  }, [agentforceConfig.hasAgentId, subTab]);
  
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

  // OM Tab State (lifted up to preserve across tab switches)
  const [omState, setOMState] = useState({
    searchQuery: '',
    searchResults: [],
    activatingOrders: new Set(),
    pollingOrders: new Set(),
    refreshingOrders: new Set(),
    orchestrationStatus: {},
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
    const socketUrl = process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:15000';
    
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

  // Note: Omnistudio components are now loaded on-demand per search, no global loading needed

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

  // OM functions (moved from OMTab)
  const searchOrders = async (query) => {
    if (!query || query.trim().length === 0) {
      setOMState(prev => ({
        ...prev,
        searchQuery: '',
        searchResults: []
      }));
      return;
    }

    setOMState(prev => ({
      ...prev,
      searchQuery: query,
      loading: true,
      error: ''
    }));

    try {
      const response = await axios.get(`/api/orders/search?query=${encodeURIComponent(query)}`, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setOMState(prev => ({
          ...prev,
          searchResults: response.data.orders,
          loading: false
        }));
      }
    } catch (error) {
      setOMState(prev => ({
        ...prev,
        error: 'Failed to search orders: ' + (error.response?.data?.message || error.message),
        loading: false
      }));
    }
  };

  // Refresh specific order data after orchestration completion
  const refreshOrderStatus = async (orderId) => {
    try {
      console.log(`🔄 Refreshing order status for order ${orderId}...`);
      
      // Add to refreshing set
      setOMState(prev => ({
        ...prev,
        refreshingOrders: new Set([...prev.refreshingOrders, orderId])
      }));
      
      // Use current search query to get updated order information
      const currentQuery = omState.searchQuery;
      if (!currentQuery) {
        // Remove from refreshing set
        setOMState(prev => ({
          ...prev,
          refreshingOrders: new Set([...prev.refreshingOrders].filter(id => id !== orderId))
        }));
        return;
      }
      
      const response = await axios.get(`/api/orders/search?query=${encodeURIComponent(currentQuery)}`, {
        withCredentials: true
      });
      
      if (response.data.success) {
        // Find the updated order in the new results
        const updatedOrder = response.data.orders.find(order => order.id === orderId);
        
        if (updatedOrder) {
          setOMState(prev => ({
            ...prev,
            searchResults: prev.searchResults.map(order => 
              order.id === orderId ? updatedOrder : order
            ),
            refreshingOrders: new Set([...prev.refreshingOrders].filter(id => id !== orderId))
          }));
          
          console.log(`✅ Order ${orderId} status refreshed to: ${updatedOrder.status}`);
        } else {
          console.log(`⚠️ Order ${orderId} not found in search results during refresh`);
          // Remove from refreshing set even if not found
          setOMState(prev => ({
            ...prev,
            refreshingOrders: new Set([...prev.refreshingOrders].filter(id => id !== orderId))
          }));
        }
      } else {
        // Remove from refreshing set on failure
        setOMState(prev => ({
          ...prev,
          refreshingOrders: new Set([...prev.refreshingOrders].filter(id => id !== orderId))
        }));
      }
    } catch (error) {
      console.error(`❌ Failed to refresh order status for ${orderId}:`, error);
      // Remove from refreshing set on error
      setOMState(prev => ({
        ...prev,
        refreshingOrders: new Set([...prev.refreshingOrders].filter(id => id !== orderId))
      }));
    }
  };

  const activateOrder = async (orderId) => {
    setOMState(prev => ({
      ...prev,
      activatingOrders: new Set([...prev.activatingOrders, orderId]),
      error: ''
    }));

    try {
      const response = await axios.post(`/api/orders/${orderId}/activate`, {}, {
        withCredentials: true
      });
      
      if (response.data.success) {
        // Start polling for orchestration status
        setOMState(prev => ({
          ...prev,
          activatingOrders: new Set([...prev.activatingOrders].filter(id => id !== orderId)),
          pollingOrders: new Set([...prev.pollingOrders, orderId])
        }));
        
        // Begin polling
        startPollingOrchestration(orderId);
      }
    } catch (error) {
      setOMState(prev => ({
        ...prev,
        activatingOrders: new Set([...prev.activatingOrders].filter(id => id !== orderId)),
        error: `Failed to activate order: ${error.response?.data?.message || error.message}`
      }));
    }
  };

  const startPollingOrchestration = (orderId) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await axios.get(`/api/orders/${orderId}/orchestration-status`, {
          withCredentials: true
        });
        
        if (response.data.success) {
          setOMState(prev => ({
            ...prev,
            orchestrationStatus: {
              ...prev.orchestrationStatus,
              [orderId]: response.data
            }
          }));

          // If all orchestration items are completed, stop polling and refresh order status
          if (response.data.allCompleted) {
            clearInterval(pollInterval);
            setOMState(prev => ({
              ...prev,
              pollingOrders: new Set([...prev.pollingOrders].filter(id => id !== orderId))
            }));
            console.log(`✅ All orchestration items completed for order ${orderId}`);
            
            // Refresh the order status to get the latest data from Salesforce
            setTimeout(() => {
              refreshOrderStatus(orderId);
            }, 2000); // Wait 2 seconds to allow Salesforce to process status changes
          }
        }
      } catch (error) {
        console.error(`Error polling orchestration for order ${orderId}:`, error);
        clearInterval(pollInterval);
        setOMState(prev => ({
          ...prev,
          pollingOrders: new Set([...prev.pollingOrders].filter(id => id !== orderId))
        }));
      }
    }, 10000); // Poll every 10 seconds

    // Set a maximum polling time (5 minutes)
    setTimeout(() => {
      clearInterval(pollInterval);
      setOMState(prev => ({
        ...prev,
        pollingOrders: new Set([...prev.pollingOrders].filter(id => id !== orderId))
      }));
    }, 5 * 60 * 1000);
  };

  const clearOMState = () => {
    setOMState(prev => ({
      ...prev,
      searchQuery: '',
      searchResults: [],
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

  // User popup handlers
  const handleLogoutMouseEnter = (event) => {
    if (userPopupTimeout) {
      clearTimeout(userPopupTimeout);
      setUserPopupTimeout(null);
    }

    const rect = event.target.getBoundingClientRect();
    setUserPopupPosition({
      x: window.innerWidth - rect.left,
      y: rect.top + rect.height + 10
    });
    
    setShowUserPopup(true);
  };

  const handleLogoutMouseLeave = () => {
    const timeout = setTimeout(() => {
      setShowUserPopup(false);
    }, 200); // Small delay to allow moving to popup
    setUserPopupTimeout(timeout);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (userPopupTimeout) {
        clearTimeout(userPopupTimeout);
      }
    };
  }, [userPopupTimeout]);

  // Hierarchical tab structure
  const mainTabs = [
    {
      id: 'core-platform',
      label: 'Core Platform',
      icon: '⚙️',
      subTabs: [
        { id: 'platform-events', label: 'Platform Events', icon: '📨' },
        { id: 'sobjects', label: 'Core Objects', icon: '🗃️' },
        ...(agentforceConfig.hasAgentId ? [{ id: 'talk-to-sfdc-agent', label: 'AgentChat', icon: '🤖' }] : [])
      ]
    },
    {
      id: 'data-cloud',
      label: 'Data Cloud',
      icon: '☁️',
      subTabs: (() => {
        if (!dataCloudConfig.hasDataCloud) return [];
        const subTabs = [];
        // These tabs are always visible (not controlled by tab visibility yet)
        subTabs.push({ id: 'datacloud-objects-v3', label: 'DC Objects', icon: '📦' });
        subTabs.push({ id: 'datacloud-v3-query', label: 'DC V3 Query', icon: '☁️' });
        subTabs.push({ id: 'rag-search-eval', label: 'RagSearch Eval', icon: '🤖' });
        subTabs.push({ id: 'ingestion-api', label: 'Ingestion API', icon: '📥' });
        // Only add V1 tabs if they're visible (default true if not in tabVisibility)
        if (tabVisibility['datacloud-objects'] !== false) {
          subTabs.push({ id: 'datacloud-objects', label: 'DC V1 Objects', icon: '🗂️' });
        }
        if (tabVisibility['datacloud-query'] !== false) {
          subTabs.push({ id: 'datacloud-query', label: 'DC V1 Query', icon: '🌥️' });
        }
        return subTabs;
      })()
    },
    {
      id: 'admin-console',
      label: 'Admin Console',
      icon: '🛠️',
      subTabs: [
        { id: 'admin-console', label: 'Admin Console', icon: '🛠️' }
      ]
    }
  ];

  // Get current main tab's sub tabs
  const currentMainTab = mainTabs.find(tab => tab.id === mainTab) || mainTabs[0];
  const subTabs = currentMainTab?.subTabs || [];

  // Ensure subTab is valid for current mainTab
  useEffect(() => {
    if (subTabs.length > 0 && !subTabs.find(tab => tab.id === subTab)) {
      const defaultSubTab = subTabs[0].id;
      setSubTab(defaultSubTab);
      localStorage.setItem('dashboard-sub-tab', defaultSubTab);
    }
  }, [mainTab, subTabs, subTab]);

  // Handle main tab change
  const handleMainTabChange = (newMainTab) => {
    setMainTab(newMainTab);
    localStorage.setItem('dashboard-main-tab', newMainTab);
    
    // Set first sub-tab of new main tab
    const newMainTabData = mainTabs.find(tab => tab.id === newMainTab);
    if (newMainTabData && newMainTabData.subTabs.length > 0) {
      const firstSubTab = newMainTabData.subTabs[0].id;
      setSubTab(firstSubTab);
      localStorage.setItem('dashboard-sub-tab', firstSubTab);
    }
  };

  // Handle sub tab change
  const handleSubTabChange = (newSubTab) => {
    setSubTab(newSubTab);
    localStorage.setItem('dashboard-sub-tab', newSubTab);
  };

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
        return (
          <OMTab 
            // OM State
            searchQuery={omState.searchQuery}
            searchResults={omState.searchResults}
            activatingOrders={omState.activatingOrders}
            pollingOrders={omState.pollingOrders}
            refreshingOrders={omState.refreshingOrders}
            orchestrationStatus={omState.orchestrationStatus}
            loading={omState.loading}
            error={omState.error}
            // OM Functions
            searchOrders={searchOrders}
            activateOrder={activateOrder}
            clearOMState={clearOMState}
          />
        );
      case 'omnistudio':
        return <OmnistudioTab onTabLoad={loadOmnistudioGlobalData} />;
      case 'talk-to-sfdc-agent':
        return <TalkToSFDCAgentTab />;
      case 'datacloud-query':
        return (
          <DataCloudQueryTab 
            persistedState={dataCloudQueryState}
            onStateChange={setDataCloudQueryState}
          />
        );
      case 'datacloud-objects':
        return (
          <DataCloudObjectsTab 
            persistedState={dataCloudObjectsState}
            onStateChange={setDataCloudObjectsState}
          />
        );
      case 'datacloud-v3-query':
        return (
          <DataCloudV3QueryTab 
            persistedState={dataCloudV3QueryState}
            onStateChange={setDataCloudV3QueryState}
          />
        );
      case 'rag-search-eval':
        return (
          <RagSearchEvalTab 
            persistedState={ragSearchEvalState}
            onStateChange={setRagSearchEvalState}
          />
        );
      case 'datacloud-objects-v3':
        return (
          <DataCloudObjectsV3Tab 
            persistedState={dataCloudObjectsV3State}
            onStateChange={setDataCloudObjectsV3State}
          />
        );
      case 'ingestion-api':
        return <IngestionAPITab />;
      case 'embedded-site':
        return <EmbeddedSiteTab />;
      case 'admin-console':
        return (
          <AdminConsoleTab 
            onTabLoad={loadOmnistudioGlobalData}
            tabVisibility={tabVisibility}
            updateTabVisibility={updateTabVisibility}
          />
        );
      case 'swagger':
        return <SwaggerTab />;
      default:
        return <div>Tab not found</div>;
    }
  };

  return (
    <div className={`dashboard ${isDarkMode ? 'dark-mode' : ''}`}>
      <header className="dashboard-header">
        <div className="header-content">
          <h1>🔗 Salesforce Explorer</h1>
          <div className="header-right">
            <div className="connection-status">
              <span className={`status-indicator ${connectionStatus}`}>
                {connectionStatus === 'connected' ? '🟢' : '🔴'}
              </span>
              <span className="status-text">{connectionStatus}</span>
            </div>
            <button className="theme-toggle" onClick={toggleDarkMode}>
              {isDarkMode ? '☀️' : '🌙'}
            </button>
            <button 
              className="logout-btn" 
              onClick={handleLogout}
              onMouseEnter={handleLogoutMouseEnter}
              onMouseLeave={handleLogoutMouseLeave}
            >
              🚪 Logout
            </button>
          </div>
        </div>
      </header>

      <div className="tabs-container">
        <div className="main-tabs-nav">
          {mainTabs.map(tab => (
            <button
              key={tab.id}
              className={`main-tab-btn ${mainTab === tab.id ? 'active' : ''}`}
              onClick={() => handleMainTabChange(tab.id)}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
        
        {subTabs.length > 0 && (
          <div className="sub-tabs-nav">
            {subTabs.map(tab => (
              <button
                key={tab.id}
                className={`sub-tab-btn ${subTab === tab.id ? 'active' : ''}`}
                onClick={() => handleSubTabChange(tab.id)}
              >
                <span className="tab-icon">{tab.icon}</span>
                <span className="tab-label">{tab.label}</span>
              </button>
            ))}
          </div>
        )}
        
        <div className="tab-content-container">
          {renderTabContent()}
        </div>
      </div>

      {/* User Info Popup */}
      <UserInfoPopup 
        user={user}
        visible={showUserPopup}
        position={userPopupPosition}
      />
    </div>
  );
};

export default Dashboard;