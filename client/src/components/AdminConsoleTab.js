import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as Diff from 'diff';
import './AdminConsoleTab.css';

const AdminConsoleTab = ({ onTabLoad, tabVisibility, updateTabVisibility }) => {
  // State management
  const [selectedSection, setSelectedSection] = useState('system-overview');
  const [sectionData, setSectionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [redisEnabled, setRedisEnabled] = useState(true);
  const [isTogglingRedis, setIsTogglingRedis] = useState(false);
  const [liveTailEnabled, setLiveTailEnabled] = useState(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  
  // Org management state
  const [orgManagementSubTab, setOrgManagementSubTab] = useState('current-org'); // 'current-org' or 'manage-all'
  const [licenseSubTab, setLicenseSubTab] = useState('user-licenses'); // 'user-licenses', 'psl', 'permission-sets', or 'permission-set-groups'
  const [userLicenseFilter, setUserLicenseFilter] = useState('');
  const [pslFilter, setPslFilter] = useState('');
  const [permissionSetFilter, setPermissionSetFilter] = useState('');
  const [permissionSetGroupFilter, setPermissionSetGroupFilter] = useState('');
  const [currentOrgInfo, setCurrentOrgInfo] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [backups, setBackups] = useState([]);
  const [selectedBackups, setSelectedBackups] = useState([]);
  const [backupDiff, setBackupDiff] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [isEditingOrg, setIsEditingOrg] = useState(false);
  const [isAddingOrg, setIsAddingOrg] = useState(false);
  const [editMode, setEditMode] = useState('form'); // 'form' or 'json'
  const [orgJsonText, setOrgJsonText] = useState('');
  
  // Ref for logs container
  const logsContainerRef = useRef(null);
  const liveTailIntervalRef = useRef(null);
  const lastLogCountRef = useRef(0);
  const lastLogContentRef = useRef('');
  const wasAtBottomRef = useRef(true);
  const userScrolledManuallyRef = useRef(false);

  // Admin sections configuration
  const adminSections = [
    {
      id: 'system-overview',
      name: 'System Overview',
      description: 'Server status, uptime, and system information',
      icon: '🖥️',
      endpoint: '/api/admin/system-overview'
    },
    {
      id: 'org-management',
      name: 'Org Management',
      description: 'Manage Salesforce org configurations',
      icon: '🏢',
      endpoint: '/api/admin/env/orgs'
    },
    {
      id: 'component-data-status',
      name: 'Component Data Cache',
      description: 'Omnistudio component data cache per organization',
      icon: '💾',
      endpoint: '/api/admin/component-data-status'
    },
    {
      id: 'sobject-field-cache',
      name: 'SObject Field Cache',
      description: 'Cached SObject field metadata for field search',
      icon: '🔍',
      endpoint: '/api/sobjects/field-search/cache-data'
    },
    {
      id: 'session-info',
      name: 'Session Information',
      description: 'Current user session and authentication details',
      icon: '👤',
      endpoint: '/api/admin/session-info'
    },
    {
      id: 'environment-info',
      name: 'Environment Variables',
      description: 'Server environment configuration (sanitized)',
      icon: '⚙️',
      endpoint: '/api/admin/environment-info'
    },
    {
      id: 'redis-management',
      name: 'Redis Management',
      description: 'Manage Redis caching functionality',
      icon: '🗄️',
      endpoint: '/api/omnistudio/redis/status'
    },
    {
      id: 'server-logs',
      name: 'Server Logs',
      description: 'Recent server log entries',
      icon: '📋',
      endpoint: '/api/admin/server-logs'
    },
    {
      id: 'tab-visibility',
      name: 'Tab Visibility',
      description: 'Control which tabs are visible in the dashboard',
      icon: '👁️',
      endpoint: null // Client-side only, no backend endpoint
    }
  ];

  // Load selected section data
  useEffect(() => {
    if (selectedSection) {
      loadSectionData(selectedSection);
    }
  }, [selectedSection]);

  // Load global data on mount
  useEffect(() => {
    if (onTabLoad) {
      onTabLoad();
    }
  }, [onTabLoad]);

  // Update Redis enabled state when section data changes
  useEffect(() => {
    if (sectionData?.redisStatus?.enabled !== undefined) {
      setRedisEnabled(sectionData.redisStatus.enabled);
    }
  }, [sectionData?.redisStatus?.enabled]);

  // Detect manual scroll by user
  useEffect(() => {
    const container = logsContainerRef.current;
    if (!container || selectedSection !== 'server-logs') return;
    
    let scrollTimeout;
    
    const handleScroll = () => {
      // Mark that user scrolled manually
      userScrolledManuallyRef.current = true;
      
      // Clear any pending timeout
      clearTimeout(scrollTimeout);
      
      // After scroll ends, check position
      scrollTimeout = setTimeout(() => {
        const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
        wasAtBottomRef.current = isAtBottom;
        
        // Only show warning if user manually scrolled up
        setIsScrolledUp(userScrolledManuallyRef.current && !isAtBottom);
      }, 100);
    };
    
    container.addEventListener('scroll', handleScroll);
    
    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [selectedSection]);

  // Smart auto-scroll logs - only scroll to bottom if new logs arrived and user was at bottom
  useEffect(() => {
    if (selectedSection === 'server-logs' && logsContainerRef.current && sectionData?.logs) {
      const container = logsContainerRef.current;
      const currentLogCount = sectionData.logs.length;
      const currentLogContent = JSON.stringify(sectionData.logs);
      
      // Check if logs actually changed (not just re-rendered)
      const logsChanged = currentLogContent !== lastLogContentRef.current;
      
      if (!logsChanged) {
        // No new logs, don't do anything
        return;
      }
      
      // Update last log content
      lastLogContentRef.current = currentLogContent;
      
      // Only auto-scroll if:
      // 1. New logs were added (count increased)
      // 2. User was at the bottom OR this is the first load
      const hasNewLogs = currentLogCount > lastLogCountRef.current;
      const shouldScroll = hasNewLogs && (wasAtBottomRef.current || lastLogCountRef.current === 0);
      
      if (shouldScroll) {
        // Mark this as programmatic scroll, not user scroll
        userScrolledManuallyRef.current = false;
        
        // Smooth scroll to bottom
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
        
        // Reset manual scroll flag after scroll completes
        setTimeout(() => {
          userScrolledManuallyRef.current = false;
        }, 500);
      }
      
      // Update last log count
      lastLogCountRef.current = currentLogCount;
    }
  }, [selectedSection, sectionData?.logs]);

  // Live tail logs functionality
  useEffect(() => {
    // Clear any existing interval
    if (liveTailIntervalRef.current) {
      clearInterval(liveTailIntervalRef.current);
      liveTailIntervalRef.current = null;
    }

    // Start live tail if enabled and on server-logs section
    if (liveTailEnabled && selectedSection === 'server-logs') {
      console.log('🔄 [ADMIN] Starting live tail for server logs');
      
      // Set up interval to refresh logs every 2 seconds
      liveTailIntervalRef.current = setInterval(() => {
        loadSectionData('server-logs');
      }, 2000);
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (liveTailIntervalRef.current) {
        console.log('⏹️ [ADMIN] Stopping live tail');
        clearInterval(liveTailIntervalRef.current);
        liveTailIntervalRef.current = null;
      }
    };
  }, [liveTailEnabled, selectedSection]);

  // Turn off live tail when switching away from server-logs and reset tracking refs
  useEffect(() => {
    if (selectedSection !== 'server-logs' && liveTailEnabled) {
      setLiveTailEnabled(false);
    }
    
    // Reset log tracking when entering server-logs section
    if (selectedSection === 'server-logs') {
      lastLogCountRef.current = 0;
      lastLogContentRef.current = '';
      wasAtBottomRef.current = true;
      userScrolledManuallyRef.current = false;
      setIsScrolledUp(false);
    }
  }, [selectedSection, liveTailEnabled]);

  const loadSectionData = async (sectionId) => {
    const section = adminSections.find(s => s.id === sectionId);
    if (!section) return;

    // Skip loading for client-side only sections
    if (sectionId === 'tab-visibility') {
      setLoading(false);
      setSectionData({ clientSideOnly: true });
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      // Special handling for org management
      if (sectionId === 'org-management') {
        const [orgsResponse, backupsResponse, currentOrgResponse] = await Promise.all([
          axios.get('/api/admin/env/orgs', { withCredentials: true }),
          axios.get('/api/admin/env/backups', { withCredentials: true }),
          axios.get('/api/admin/current-org-info', { withCredentials: true }).catch(() => ({ data: { success: false, data: null } }))
        ]);
        
        if (orgsResponse.data.success) {
          setOrgs(orgsResponse.data.orgs || []);
        }
        
        if (backupsResponse.data.success) {
          setBackups(backupsResponse.data.backups || []);
        }
        
        if (currentOrgResponse.data.success) {
          setCurrentOrgInfo(currentOrgResponse.data.data);
        } else {
          setCurrentOrgInfo(null);
        }
        
        setSectionData({ 
          orgs: orgsResponse.data.orgs || [], 
          backups: backupsResponse.data.backups || [],
          currentOrg: currentOrgResponse.data.data || null
        });
        setLoading(false);
        return;
      }
      
      const response = await axios.get(section.endpoint, {
        withCredentials: true
      });
      
      if (response.data.success) {
        const newData = response.data.data;
        
        // For server logs, check if data actually changed before updating state
        if (sectionId === 'server-logs' && sectionData?.logs) {
          const newLogContent = JSON.stringify(newData.logs);
          const oldLogContent = JSON.stringify(sectionData.logs);
          
          if (newLogContent === oldLogContent) {
            // Logs haven't changed, skip update to prevent flashing
            console.log('ℹ️ [ADMIN] No new logs, skipping update');
            setLoading(false);
            return;
          }
        }
        
        setSectionData(newData);
        console.log(`✅ [ADMIN] Loaded ${sectionId}:`, newData);
      } else {
        setError('Failed to load data: ' + response.data.message);
      }
    } catch (error) {
      setError('Error loading data: ' + (error.response?.data?.message || error.message));
      console.error(`❌ [ADMIN] Error loading ${sectionId}:`, error);
    } finally {
      setLoading(false);
    }
  };

  const clearOrgCache = async (orgId) => {
    try {
      setLoading(true);
      const response = await axios.delete(`/api/admin/cache/${orgId}`, {
        withCredentials: true
      });
      
      if (response.data.success) {
        console.log(`✅ [ADMIN] Cleared cache for ${orgId}:`, response.data.data);
        // Reload component data status
        loadSectionData('component-data-status');
      } else {
        setError('Failed to clear cache: ' + response.data.message);
      }
    } catch (error) {
      setError('Error clearing cache: ' + (error.response?.data?.message || error.message));
      console.error(`❌ [ADMIN] Error clearing cache for ${orgId}:`, error);
    } finally {
      setLoading(false);
    }
  };

  const clearAllCaches = async () => {
    if (!window.confirm('Are you sure you want to clear ALL organization caches? This action cannot be undone.')) {
      return;
    }

    try {
      setLoading(true);
      const response = await axios.delete('/api/admin/cache-all', {
        withCredentials: true
      });
      
      if (response.data.success) {
        console.log('✅ [ADMIN] Cleared all caches:', response.data.data);
        // Reload component data status
        loadSectionData('component-data-status');
      } else {
        setError('Failed to clear all caches: ' + response.data.message);
      }
    } catch (error) {
      setError('Error clearing all caches: ' + (error.response?.data?.message || error.message));
      console.error('❌ [ADMIN] Error clearing all caches:', error);
    } finally {
      setLoading(false);
    }
  };

  const regenerateAllCaches = async () => {
    if (!window.confirm('Are you sure you want to regenerate ALL organization caches? This will reload all component data and rebuild hierarchies. This action may take several minutes.')) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Get all org IDs from the current cache status
      const response = await axios.get('/api/admin/component-data-status', {
        withCredentials: true
      });
      
      if (response.data.success && response.data.data.cacheStatus) {
        const orgIds = Object.keys(response.data.data.cacheStatus);
        
        if (orgIds.length === 0) {
          setError('No organizations found to regenerate. Please load component data first.');
          return;
        }

        console.log(`🔄 [ADMIN] Starting regeneration for ${orgIds.length} organizations...`);
        
        // Step 1: Clear ALL existing caches first
        console.log('🗑️ [ADMIN] Step 1: Clearing all existing caches...');
        try {
          const clearResponse = await axios.delete('/api/admin/cache-all', {
            withCredentials: true
          });
          
          if (clearResponse.data.success) {
            console.log('✅ [ADMIN] Successfully cleared all existing caches');
          } else {
            console.warn('⚠️ [ADMIN] Warning: Failed to clear some caches, but continuing with regeneration...');
          }
        } catch (clearError) {
          console.warn('⚠️ [ADMIN] Warning: Error clearing caches, but continuing with regeneration:', clearError.message);
        }
        
        // Step 2: Regenerate each organization's cache
        console.log('🔄 [ADMIN] Step 2: Regenerating caches for all organizations...');
        for (const orgId of orgIds) {
          try {
            console.log(`🔄 [ADMIN] Regenerating cache for organization ${orgId}...`);
            
            // Trigger a fresh load of component data
            const loadResponse = await axios.post('/api/omnistudio/load-all-components', {}, {
              withCredentials: true
            });
            
            if (loadResponse.data.success) {
              console.log(`✅ [ADMIN] Successfully regenerated cache for organization ${orgId}`);
            } else {
              console.warn(`⚠️ [ADMIN] Failed to regenerate cache for organization ${orgId}: ${loadResponse.data.message}`);
            }
          } catch (orgError) {
            console.error(`❌ [ADMIN] Error regenerating cache for organization ${orgId}:`, orgError);
          }
        }
        
        // Step 3: Reload component data status to show updated information
        console.log('📊 [ADMIN] Step 3: Reloading component data status...');
        await loadSectionData('component-data-status');
        setError(null);
        console.log('✅ [ADMIN] Cache regeneration completed for all organizations');
      } else {
        setError('Failed to get organization list for regeneration');
      }
    } catch (error) {
      setError('Error regenerating caches: ' + (error.response?.data?.message || error.message));
      console.error('❌ [ADMIN] Error regenerating all caches:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearPersistedCache = async (orgId) => {
    if (!window.confirm(`Are you sure you want to clear the persisted Redis cache for organization ${orgId}? This will remove all global component data from Redis and cannot be undone.`)) {
      return;
    }

    try {
      setLoading(true);
      const response = await axios.delete(`/api/redis/component-data/${orgId}`, {
        withCredentials: true
      });
      
      if (response.data.success) {
        console.log(`✅ [ADMIN] Cleared persisted Redis cache for ${orgId}:`, response.data.data);
        // Reload component data status
        loadSectionData('component-data-status');
      } else {
        setError('Failed to clear persisted cache: ' + response.data.message);
      }
    } catch (error) {
      setError('Error clearing persisted cache: ' + (error.response?.data?.message || error.message));
      console.error(`❌ [ADMIN] Error clearing persisted Redis cache for ${orgId}:`, error);
    } finally {
      setLoading(false);
    }
  };

  const handleRedisToggle = async (enabled) => {
    setIsTogglingRedis(true);
    try {
      const response = await axios.post('/api/omnistudio/redis/toggle', {
        enabled: enabled
      }, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setRedisEnabled(enabled);
        // Reload the section data to get updated status
        loadSectionData('redis-management');
      }
    } catch (error) {
      console.error('Error toggling Redis:', error);
      setError('Error toggling Redis: ' + (error.response?.data?.message || error.message));
    } finally {
      setIsTogglingRedis(false);
    }
  };

  // Org Management Functions
  const handleStartAddOrg = () => {
    // Get the last org to use as a template
    const lastOrg = orgs.length > 0 ? orgs[orgs.length - 1] : null;
    
    const templateFields = lastOrg ? { ...lastOrg.fields } : {
      ORG_NAME: '',
      CLIENT_ID: '',
      CLIENT_SECRET: '',
      REDIRECT_URI: '',
      LOGIN_URL: ''
    };
    
    setSelectedOrg({ index: -1, fields: templateFields });
    setIsAddingOrg(true);
    setIsEditingOrg(true); // Enable editing in modal
    setEditMode('form');
  };

  const handleCloseAddOrgModal = () => {
    setIsAddingOrg(false);
    setIsEditingOrg(false);
    setSelectedOrg(null);
    setOrgJsonText('');
  };

  const handleSelectOrg = (org) => {
    setSelectedOrg(org);
    setIsEditingOrg(false);
    setIsAddingOrg(false);
    setEditMode('form');
  };

  const handleEditOrg = () => {
    setIsEditingOrg(true);
    setOrgJsonText(JSON.stringify(selectedOrg.fields, null, 2));
  };

  const handleCancelEdit = () => {
    setIsEditingOrg(false);
    setIsAddingOrg(false);
    setSelectedOrg(null);
    setEditMode('form');
  };

  const handleFieldChange = (fieldName, value) => {
    setSelectedOrg(prev => ({
      ...prev,
      fields: {
        ...prev.fields,
        [fieldName]: value
      }
    }));
  };

  const handleAddField = () => {
    const fieldName = prompt('Enter new field name (e.g., CUSTOM_FIELD):');
    if (fieldName && fieldName.trim()) {
      handleFieldChange(fieldName.trim().toUpperCase(), '');
    }
  };

  const handleDeleteField = (fieldName) => {
    if (window.confirm(`Are you sure you want to delete field "${fieldName}"?`)) {
      setSelectedOrg(prev => {
        const newFields = { ...prev.fields };
        delete newFields[fieldName];
        return { ...prev, fields: newFields };
      });
    }
  };

  const handleSaveOrg = async () => {
    try {
      setLoading(true);
      setError('');
      
      let orgToSave = selectedOrg;
      
      // If in JSON mode, parse the JSON
      if (editMode === 'json') {
        try {
          const parsedFields = JSON.parse(orgJsonText);
          orgToSave = { ...selectedOrg, fields: parsedFields };
        } catch (e) {
          setError('Invalid JSON: ' + e.message);
          return;
        }
      }
      
      if (isAddingOrg) {
        // Add new org
        const response = await axios.post('/api/admin/env/orgs', {
          org: orgToSave
        }, {
          withCredentials: true
        });
        
        if (response.data.success) {
          console.log('✅ [ADMIN] Org added successfully');
          await loadSectionData('org-management');
          handleCancelEdit();
        } else {
          setError('Failed to add org: ' + response.data.message);
        }
      } else {
        // Update existing org
        const updatedOrgs = orgs.map(o => 
          o.index === orgToSave.index ? orgToSave : o
        );
        
        const response = await axios.put('/api/admin/env/orgs', {
          orgs: updatedOrgs
        }, {
          withCredentials: true
        });
        
        if (response.data.success) {
          console.log('✅ [ADMIN] Org updated successfully');
          await loadSectionData('org-management');
          handleCancelEdit();
        } else {
          setError('Failed to update org: ' + response.data.message);
        }
      }
    } catch (error) {
      setError('Error saving org: ' + (error.response?.data?.message || error.message));
      console.error('❌ [ADMIN] Error saving org:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrg = async (org) => {
    if (!window.confirm(`Are you sure you want to delete org "${org.fields.ORG_NAME}"? A backup will be created.`)) {
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      
      const response = await axios.delete(`/api/admin/env/orgs/${org.index}`, {
        withCredentials: true
      });
      
      if (response.data.success) {
        console.log('✅ [ADMIN] Org deleted successfully');
        await loadSectionData('org-management');
        if (selectedOrg && selectedOrg.index === org.index) {
          setSelectedOrg(null);
        }
      } else {
        setError('Failed to delete org: ' + response.data.message);
      }
    } catch (error) {
      setError('Error deleting org: ' + (error.response?.data?.message || error.message));
      console.error('❌ [ADMIN] Error deleting org:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMoveOrgUp = async (e, index) => {
    e.stopPropagation(); // Prevent selecting the org when clicking arrow
    
    const currentIndex = orgs.findIndex(o => o.index === index);
    if (currentIndex <= 0) return; // Already at the top
    
    try {
      setLoading(true);
      setError('');
      
      // Swap with previous org
      const newOrgs = [...orgs];
      [newOrgs[currentIndex - 1], newOrgs[currentIndex]] = [newOrgs[currentIndex], newOrgs[currentIndex - 1]];
      
      // Update the backend
      const response = await axios.put('/api/admin/env/orgs', {
        orgs: newOrgs
      }, {
        withCredentials: true
      });
      
      if (response.data.success) {
        console.log('✅ [ADMIN] Org order updated successfully');
        await loadSectionData('org-management');
      } else {
        setError('Failed to update org order: ' + response.data.message);
      }
    } catch (error) {
      setError('Error updating org order: ' + (error.response?.data?.message || error.message));
      console.error('❌ [ADMIN] Error updating org order:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMoveOrgDown = async (e, index) => {
    e.stopPropagation(); // Prevent selecting the org when clicking arrow
    
    const currentIndex = orgs.findIndex(o => o.index === index);
    if (currentIndex < 0 || currentIndex >= orgs.length - 1) return; // Already at the bottom
    
    try {
      setLoading(true);
      setError('');
      
      // Swap with next org
      const newOrgs = [...orgs];
      [newOrgs[currentIndex], newOrgs[currentIndex + 1]] = [newOrgs[currentIndex + 1], newOrgs[currentIndex]];
      
      // Update the backend
      const response = await axios.put('/api/admin/env/orgs', {
        orgs: newOrgs
      }, {
        withCredentials: true
      });
      
      if (response.data.success) {
        console.log('✅ [ADMIN] Org order updated successfully');
        await loadSectionData('org-management');
      } else {
        setError('Failed to update org order: ' + response.data.message);
      }
    } catch (error) {
      setError('Error updating org order: ' + (error.response?.data?.message || error.message));
      console.error('❌ [ADMIN] Error updating org order:', error);
    } finally {
      setLoading(false);
    }
  };

  // Backup handlers
  const handleBackupSelect = (filename) => {
    setSelectedBackups(prev => {
      if (prev.includes(filename)) {
        return prev.filter(f => f !== filename);
      } else {
        return [...prev, filename];
      }
    });
  };

  const handleSelectAllBackups = () => {
    if (selectedBackups.length === backups.length) {
      setSelectedBackups([]);
    } else {
      setSelectedBackups(backups.map(b => b.filename));
    }
  };

  const handleDeleteBackups = async () => {
    if (selectedBackups.length === 0) return;
    
    if (!window.confirm(`Delete ${selectedBackups.length} backup file(s)?`)) {
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      
      const response = await axios.delete('/api/admin/env/backups', {
        data: { filenames: selectedBackups },
        withCredentials: true
      });
      
      if (response.data.success) {
        console.log(`✅ [ADMIN] Deleted ${selectedBackups.length} backup(s)`);
        setBackups(response.data.backups);
        setSelectedBackups([]);
        setBackupDiff(null);
      } else {
        setError('Failed to delete backups: ' + response.data.message);
      }
    } catch (error) {
      setError('Error deleting backups: ' + (error.response?.data?.message || error.message));
      console.error('❌ [ADMIN] Error deleting backups:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewBackupDiff = async (filename) => {
    try {
      setLoading(true);
      setError('');
      
      // Fetch both backup and current .env content
      const [backupResponse, currentResponse] = await Promise.all([
        axios.get(`/api/admin/env/backups/${filename}`, { withCredentials: true }),
        axios.get('/api/admin/env/current', { withCredentials: true })
      ]);
      
      if (backupResponse.data.success && currentResponse.data.success) {
        setBackupDiff({
          filename,
          backupContent: backupResponse.data.content,
          currentContent: currentResponse.data.content
        });
      }
    } catch (error) {
      setError('Error loading diff: ' + (error.response?.data?.message || error.message));
      console.error('❌ [ADMIN] Error loading diff:', error);
    } finally {
      setLoading(false);
    }
  };

  // No auto-trigger for diff - user must click filename

  // Add ESC key support for modal
  useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key === 'Escape' && backupDiff) {
        setSelectedBackups([]);
        setBackupDiff(null);
      }
    };

    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [backupDiff]);

  // Extract SALESFORCE_ORGS JSON from .env content
  const extractSalesforceOrgs = (envContent) => {
    try {
      const match = envContent.match(/SALESFORCE_ORGS=(.+)/);
      if (match && match[1]) {
        const orgsJson = JSON.parse(match[1]);
        return JSON.stringify(orgsJson, null, 2);
      }
    } catch (error) {
      console.error('Error parsing SALESFORCE_ORGS:', error);
    }
    return null;
  };

  // Render diff viewer as full-screen modal
  const renderDiffViewer = () => {
    if (!backupDiff) return null;

    // Extract and format SALESFORCE_ORGS JSON from both files
    const backupOrgsJson = extractSalesforceOrgs(backupDiff.backupContent);
    const currentOrgsJson = extractSalesforceOrgs(backupDiff.currentContent);

    if (!backupOrgsJson || !currentOrgsJson) {
      return (
        <div 
          style={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px'
          }}
          onClick={() => {
            setSelectedBackups([]);
            setBackupDiff(null);
          }}
        >
          <div style={{ 
            background: '#1f2937', 
            padding: '40px', 
            borderRadius: '16px',
            color: '#e5e7eb',
            textAlign: 'center'
          }}>
            <h3>❌ Unable to parse SALESFORCE_ORGS JSON</h3>
            <p>The .env file format may be invalid</p>
          </div>
        </div>
      );
    }

    const diffResult = Diff.diffLines(backupOrgsJson, currentOrgsJson);

    return (
      <div 
        style={{ 
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(8px)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          animation: 'fadeIn 0.3s ease-in-out'
        }}
        onClick={(e) => {
          // Close when clicking backdrop
          if (e.target === e.currentTarget) {
            setSelectedBackups([]);
            setBackupDiff(null);
          }
        }}
      >
        <div 
          style={{ 
            width: '100%',
            maxWidth: '1400px',
            height: '90vh',
            background: '#1f2937',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            border: '3px solid #4b5563'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ 
            padding: '20px 30px', 
            background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)', 
            borderBottom: '3px solid #60a5fa',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0
          }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'white', marginBottom: '8px' }}>
                📊 SALESFORCE_ORGS JSON Comparison
              </div>
              <div style={{ fontSize: '14px', color: '#dbeafe' }}>
                <span style={{ fontWeight: '600' }}>Backup:</span> {backupDiff.filename}
              </div>
              <div style={{ fontSize: '13px', color: '#bfdbfe', marginTop: '8px', display: 'flex', gap: '20px' }}>
                <span style={{ 
                  padding: '4px 12px', 
                  background: 'rgba(239, 68, 68, 0.2)', 
                  border: '2px solid #ef4444',
                  borderRadius: '6px',
                  fontWeight: '600'
                }}>
                  🔴 Removed (in backup)
                </span>
                <span style={{ 
                  padding: '4px 12px', 
                  background: 'rgba(16, 185, 129, 0.2)', 
                  border: '2px solid #10b981',
                  borderRadius: '6px',
                  fontWeight: '600'
                }}>
                  🟢 Added (in current)
                </span>
                <span style={{ 
                  padding: '4px 12px', 
                  background: 'rgba(107, 114, 128, 0.2)', 
                  border: '2px solid #6b7280',
                  borderRadius: '6px',
                  fontWeight: '600'
                }}>
                  ⚪ Unchanged
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                setSelectedBackups([]);
                setBackupDiff(null);
              }}
              style={{
                padding: '12px 20px',
                background: '#ef4444',
                color: 'white',
                border: '2px solid #dc2626',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '700',
                transition: 'all 0.2s',
                boxShadow: '0 4px 6px rgba(239, 68, 68, 0.3)'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#dc2626';
                e.target.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#ef4444';
                e.target.style.transform = 'scale(1)';
              }}
            >
              ✕ Close
            </button>
          </div>

          {/* Diff Content */}
          <div style={{ 
            flex: 1,
            overflowY: 'auto', 
            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace', 
            fontSize: '14px',
            lineHeight: '1.8',
            background: '#111827'
          }}>
            {diffResult.map((part, index) => {
              const bgColor = part.added ? '#064e3b' : part.removed ? '#7f1d1d' : '#1f2937';
              const textColor = part.added ? '#a7f3d0' : part.removed ? '#fca5a5' : '#d1d5db';
              const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
              const borderLeft = part.added ? '4px solid #10b981' : part.removed ? '4px solid #ef4444' : '4px solid transparent';
              
              return (
                <div 
                  key={index} 
                  style={{ 
                    background: bgColor, 
                    color: textColor,
                    padding: '6px 20px',
                    borderLeft,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    transition: 'background 0.2s'
                  }}
                >
                  {part.value.split('\n').map((line, lineIndex) => {
                    if (!line && lineIndex === part.value.split('\n').length - 1) return null;
                    return (
                      <div 
                        key={lineIndex}
                        style={{ 
                          display: 'flex',
                          minHeight: '22px',
                          alignItems: 'center'
                        }}
                      >
                        <span style={{ 
                          opacity: 0.4, 
                          marginRight: '12px', 
                          userSelect: 'none',
                          fontWeight: '700',
                          minWidth: '20px'
                        }}>
                          {prefix}
                        </span>
                        <span>{line}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ 
            padding: '16px 30px', 
            background: '#374151',
            borderTop: '2px solid #4b5563',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '13px',
            color: '#9ca3af',
            flexShrink: 0
          }}>
            <div>
              💡 <strong>Tip:</strong> Click outside the modal or press the Close button to dismiss
            </div>
            <div>
              Press <kbd style={{ 
                padding: '2px 6px', 
                background: '#1f2937', 
                border: '1px solid #6b7280',
                borderRadius: '4px',
                fontFamily: 'monospace'
              }}>ESC</kbd> to close
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render Add Org Modal
  const renderAddOrgModal = () => {
    if (!isAddingOrg || !selectedOrg) return null;

    return (
      <div 
        style={{ 
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(8px)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          animation: 'fadeIn 0.3s ease-in-out'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            handleCloseAddOrgModal();
          }
        }}
      >
        <div 
          style={{ 
            width: '100%',
            maxWidth: '900px',
            maxHeight: '85vh',
            background: '#1f2937',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            border: '3px solid #4b5563'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ 
            padding: '20px 30px', 
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
            borderBottom: '3px solid #34d399',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0
          }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: 'white', marginBottom: '4px' }}>
                ➕ Add New Organization
              </div>
              <div style={{ fontSize: '13px', color: '#d1fae5' }}>
                Configure Salesforce org connection details
              </div>
            </div>
            <button
              onClick={handleCloseAddOrgModal}
              style={{
                padding: '10px 18px',
                background: '#ef4444',
                color: 'white',
                border: '2px solid #dc2626',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '700',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#dc2626';
                e.target.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#ef4444';
                e.target.style.transform = 'scale(1)';
              }}
            >
              ✕ Cancel
            </button>
          </div>

          {/* Mode Toggle */}
          <div style={{ 
            padding: '15px 30px',
            background: '#374151',
            borderBottom: '2px solid #4b5563',
            display: 'flex',
            gap: '10px'
          }}>
            <button
              onClick={() => setEditMode('form')}
              style={{
                padding: '8px 16px',
                background: editMode === 'form' ? '#3b82f6' : '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                transition: 'all 0.2s'
              }}
            >
              📝 Form Edit
            </button>
            <button
              onClick={() => {
                setEditMode('json');
                setOrgJsonText(JSON.stringify(selectedOrg.fields, null, 2));
              }}
              style={{
                padding: '8px 16px',
                background: editMode === 'json' ? '#3b82f6' : '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                transition: 'all 0.2s'
              }}
            >
              {} JSON Edit
            </button>
          </div>

          {/* Content */}
          <div style={{ 
            flex: 1,
            overflowY: 'auto', 
            padding: '30px',
            background: '#111827'
          }}>
            {editMode === 'form' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {Object.entries(selectedOrg.fields)
                  .filter(([key]) => key !== 'username' && key !== 'password')
                  .map(([key, value]) => (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontWeight: '600', fontSize: '14px', color: '#e5e7eb' }}>{key}</label>
                      <button
                        onClick={() => handleDeleteField(key)}
                        style={{
                          background: '#ef4444',
                          color: 'white',
                          border: 'none',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: '600'
                        }}
                      >
                        🗑️ Remove
                      </button>
                    </div>
                    <input
                      type="text"
                      className="org-field-input"
                      value={value || ''}
                      onChange={(e) => handleFieldChange(key, e.target.value)}
                      style={{
                        padding: '10px',
                        borderRadius: '6px',
                        border: '2px solid #4b5563',
                        fontSize: '14px',
                        fontFamily: 'monospace',
                        background: '#1f2937',
                        color: '#e5e7eb'
                      }}
                    />
                  </div>
                ))}
                
                <button
                  onClick={handleAddField}
                  style={{
                    background: '#6b7280',
                    color: 'white',
                    border: 'none',
                    padding: '10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '600',
                    marginTop: '10px'
                  }}
                >
                  ➕ Add Field
                </button>
              </div>
            ) : (
              <textarea
                value={orgJsonText}
                onChange={(e) => setOrgJsonText(e.target.value)}
                style={{
                  width: '100%',
                  height: '100%',
                  minHeight: '400px',
                  padding: '15px',
                  fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  background: '#1f2937',
                  color: '#e5e7eb',
                  border: '2px solid #4b5563',
                  borderRadius: '8px',
                  resize: 'vertical'
                }}
                placeholder="Enter JSON configuration..."
              />
            )}
          </div>

          {/* Footer */}
          <div style={{ 
            padding: '20px 30px', 
            background: '#374151',
            borderTop: '2px solid #4b5563',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
            flexShrink: 0
          }}>
            <button
              onClick={handleCloseAddOrgModal}
              style={{
                padding: '10px 20px',
                background: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                transition: 'all 0.2s'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSaveOrg}
              style={{
                padding: '10px 24px',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: 'white',
                border: '2px solid #34d399',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '700',
                transition: 'all 0.2s',
                boxShadow: '0 4px 6px rgba(16, 185, 129, 0.3)'
              }}
              onMouseEnter={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 6px 12px rgba(16, 185, 129, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 4px 6px rgba(16, 185, 129, 0.3)';
              }}
            >
              💾 Save Organization
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSystemOverview = (data) => (
    <div className="admin-section-content">
      <h3>🖥️ System Overview</h3>
      
      <div className="info-grid">
        <div className="info-card">
          <h4>Server Status</h4>
          <div className="info-item">
            <label>Status:</label>
            <span className={`status ${data.serverStatus}`}>{data.serverStatus}</span>
          </div>
          <div className="info-item">
            <label>Started:</label>
            <span>{new Date(data.startTime).toLocaleString()}</span>
          </div>
          <div className="info-item">
            <label>Uptime:</label>
            <span>{data.uptime.hours}h {data.uptime.minutes % 60}m {data.uptime.seconds % 60}s</span>
          </div>
        </div>

        <div className="info-card">
          <h4>System Information</h4>
          <div className="info-item">
            <label>Node.js:</label>
            <span>{data.nodeVersion}</span>
          </div>
          <div className="info-item">
            <label>Platform:</label>
            <span>{data.platform} ({data.architecture})</span>
          </div>
          <div className="info-item">
            <label>Environment:</label>
            <span>{data.environment}</span>
          </div>
        </div>

        <div className="info-card">
          <h4>Memory Usage</h4>
          <div className="info-item">
            <label>RSS:</label>
            <span>{data.memoryUsage.rss}</span>
          </div>
          <div className="info-item">
            <label>Heap Total:</label>
            <span>{data.memoryUsage.heapTotal}</span>
          </div>
          <div className="info-item">
            <label>Heap Used:</label>
            <span>{data.memoryUsage.heapUsed}</span>
          </div>
          <div className="info-item">
            <label>External:</label>
            <span>{data.memoryUsage.external}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCurrentOrgDetails = () => {
    if (!currentOrgInfo) {
      return (
        <div style={{ 
          padding: '40px', 
          textAlign: 'center', 
          color: '#9ca3af',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '400px'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔌</div>
          <h3 style={{ color: '#e5e7eb', marginBottom: '10px' }}>Not Connected to Salesforce</h3>
          <p style={{ marginBottom: '20px' }}>Please connect to a Salesforce org to view organization details.</p>
          <p style={{ fontSize: '14px', color: '#6b7280' }}>
            You can still manage org configurations in the "Manage All Orgs" tab.
          </p>
        </div>
      );
    }

    const formatStorage = (storageData) => {
      if (!storageData || !storageData.Max) return 'N/A';
      const used = storageData.Remaining !== undefined ? storageData.Max - storageData.Remaining : 0;
      const percentage = ((used / storageData.Max) * 100).toFixed(1);
      return `${used.toLocaleString()} MB (${percentage}%)`;
    };

    const formatAddress = () => {
      if (!currentOrgInfo.address) return 'N/A';
      const addr = currentOrgInfo.address;
      const parts = [addr.street, addr.city, addr.state, addr.postalCode, addr.country].filter(Boolean);
      return parts.join(', ') || 'N/A';
    };

    return (
      <div style={{ padding: '20px', maxWidth: '1400px' }}>
        <h4 style={{ 
          fontSize: '20px', 
          marginBottom: '20px',
          color: '#e5e7eb',
          borderBottom: '2px solid #4b5563',
          paddingBottom: '10px'
        }}>
          📋 Organization Detail
        </h4>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '10px 40px',
          fontSize: '14px'
        }}>
          {/* Left Column */}
          <div className="info-item">
            <label>Organization Name:</label>
            <span>{currentOrgInfo.organizationName || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Phone:</label>
            <span>{currentOrgInfo.phone || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Primary Contact:</label>
            <span>{currentOrgInfo.primaryContact || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Fax:</label>
            <span>{currentOrgInfo.fax || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Division:</label>
            <span>{currentOrgInfo.division || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Default Locale:</label>
            <span>{currentOrgInfo.defaultLocale || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Address:</label>
            <span>{formatAddress()}</span>
          </div>
          
          <div className="info-item">
            <label>Default Language:</label>
            <span>{currentOrgInfo.defaultLanguage || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Fiscal Year Starts In:</label>
            <span>{currentOrgInfo.fiscalYearStart ? new Date(2000, currentOrgInfo.fiscalYearStart - 1).toLocaleString('default', { month: 'long' }) : 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Default Time Zone:</label>
            <span>{currentOrgInfo.defaultTimeZone || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Corporate Currency:</label>
            <span>{currentOrgInfo.defaultCurrency || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Used Data Space:</label>
            <span>{currentOrgInfo.limits?.dataStorage ? formatStorage(currentOrgInfo.limits.dataStorage) : 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Used File Space:</label>
            <span>{currentOrgInfo.limits?.fileStorage ? formatStorage(currentOrgInfo.limits.fileStorage) : 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>API Requests, Last 24 Hours:</label>
            <span>
              {currentOrgInfo.limits?.dailyApiRequests ? 
                `${(currentOrgInfo.limits.dailyApiRequests.Max - currentOrgInfo.limits.dailyApiRequests.Remaining).toLocaleString()} (${currentOrgInfo.limits.dailyApiRequests.Max.toLocaleString()} max)` : 
                'N/A'}
            </span>
          </div>
          
          <div className="info-item">
            <label>Streaming API Events, Last 24 Hours:</label>
            <span>
              {currentOrgInfo.limits?.dailyStreamingApiEvents ? 
                `${(currentOrgInfo.limits.dailyStreamingApiEvents.Max - currentOrgInfo.limits.dailyStreamingApiEvents.Remaining).toLocaleString()} (${currentOrgInfo.limits.dailyStreamingApiEvents.Max.toLocaleString()} max)` : 
                'N/A'}
            </span>
          </div>
          
          <div className="info-item">
            <label>Salesforce.com Organization ID:</label>
            <span className="org-id">{currentOrgInfo.organizationId || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Organization Edition:</label>
            <span>{currentOrgInfo.organizationType || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Instance:</label>
            <span>{currentOrgInfo.instanceName || 'N/A'}</span>
          </div>
          
          <div className="info-item">
            <label>Environment:</label>
            <span style={{ 
              fontWeight: '600',
              color: currentOrgInfo.isSandbox ? '#f59e0b' : '#10b981'
            }}>
              {currentOrgInfo.isSandbox ? '🧪 Sandbox' : '🏭 Production'}
            </span>
          </div>
        </div>
        
        {/* Created By / Modified By */}
        {(currentOrgInfo.createdBy || currentOrgInfo.lastModifiedBy) && (
          <div style={{ 
            marginTop: '30px',
            paddingTop: '20px',
            borderTop: '1px solid #4b5563',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '10px'
          }}>
            {currentOrgInfo.createdBy && (
              <div className="info-item">
                <label>Created By:</label>
                <span>
                  {currentOrgInfo.createdBy.name}, {currentOrgInfo.createdBy.date ? new Date(currentOrgInfo.createdBy.date).toLocaleString() : 'N/A'}
                </span>
              </div>
            )}
            
            {currentOrgInfo.lastModifiedBy && (
              <div className="info-item">
                <label>Modified By:</label>
                <span>
                  {currentOrgInfo.lastModifiedBy.name}, {currentOrgInfo.lastModifiedBy.date ? new Date(currentOrgInfo.lastModifiedBy.date).toLocaleString() : 'N/A'}
                </span>
              </div>
            )}
          </div>
        )}
        
        {/* License Information Sub-Tabs */}
        <div style={{ 
          marginTop: '40px',
          paddingTop: '30px',
          borderTop: '2px solid #4b5563'
        }}>
          <h4 style={{ 
            fontSize: '18px', 
            marginBottom: '20px',
            color: '#e5e7eb'
          }}>
            📊 License Information
          </h4>
          
          {/* License Sub-tabs */}
          <div style={{ 
            display: 'flex', 
            gap: '12px', 
            marginBottom: '20px',
            borderBottom: '2px solid #4b5563',
            paddingBottom: '12px',
            background: 'linear-gradient(90deg, rgba(55, 65, 81, 0.2) 0%, rgba(31, 41, 55, 0.2) 100%)',
            padding: '12px',
            borderRadius: '10px'
          }}>
            <button
              onClick={() => setLicenseSubTab('user-licenses')}
              style={{
                padding: '14px 28px',
                background: licenseSubTab === 'user-licenses' 
                  ? 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #5b21b6 100%)' 
                  : 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
                color: 'white',
                border: licenseSubTab === 'user-licenses' ? '4px solid #a78bfa' : '2px solid #6b7280',
                borderRadius: '10px',
                cursor: 'pointer',
                fontSize: '15px',
                fontWeight: licenseSubTab === 'user-licenses' ? '800' : '600',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: licenseSubTab === 'user-licenses' 
                  ? '0 10px 20px rgba(139, 92, 246, 0.6), 0 0 0 5px rgba(139, 92, 246, 0.15), inset 0 -2px 6px rgba(0, 0, 0, 0.3)' 
                  : '0 3px 6px rgba(0, 0, 0, 0.3), inset 0 -1px 3px rgba(0, 0, 0, 0.2)',
                transform: licenseSubTab === 'user-licenses' ? 'translateY(-4px) scale(1.06)' : 'translateY(0) scale(1)',
                textShadow: licenseSubTab === 'user-licenses' ? '0 2px 4px rgba(0, 0, 0, 0.5)' : 'none',
                letterSpacing: licenseSubTab === 'user-licenses' ? '0.4px' : 'normal'
              }}
              onMouseEnter={(e) => {
                if (licenseSubTab !== 'user-licenses') {
                  e.target.style.background = 'linear-gradient(135deg, #4b5563 0%, #374151 100%)';
                  e.target.style.transform = 'translateY(-2px) scale(1.03)';
                  e.target.style.borderColor = '#9ca3af';
                  e.target.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.4)';
                }
              }}
              onMouseLeave={(e) => {
                if (licenseSubTab !== 'user-licenses') {
                  e.target.style.background = 'linear-gradient(135deg, #374151 0%, #1f2937 100%)';
                  e.target.style.transform = 'translateY(0) scale(1)';
                  e.target.style.borderColor = '#6b7280';
                  e.target.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3), inset 0 -1px 3px rgba(0, 0, 0, 0.2)';
                }
              }}
            >
              👤 User Licenses
            </button>
            <button
              onClick={() => setLicenseSubTab('psl')}
              style={{
                padding: '14px 28px',
                background: licenseSubTab === 'psl' 
                  ? 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #5b21b6 100%)' 
                  : 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
                color: 'white',
                border: licenseSubTab === 'psl' ? '4px solid #a78bfa' : '2px solid #6b7280',
                borderRadius: '10px',
                cursor: 'pointer',
                fontSize: '15px',
                fontWeight: licenseSubTab === 'psl' ? '800' : '600',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: licenseSubTab === 'psl' 
                  ? '0 10px 20px rgba(139, 92, 246, 0.6), 0 0 0 5px rgba(139, 92, 246, 0.15), inset 0 -2px 6px rgba(0, 0, 0, 0.3)' 
                  : '0 3px 6px rgba(0, 0, 0, 0.3), inset 0 -1px 3px rgba(0, 0, 0, 0.2)',
                transform: licenseSubTab === 'psl' ? 'translateY(-4px) scale(1.06)' : 'translateY(0) scale(1)',
                textShadow: licenseSubTab === 'psl' ? '0 2px 4px rgba(0, 0, 0, 0.5)' : 'none',
                letterSpacing: licenseSubTab === 'psl' ? '0.4px' : 'normal'
              }}
              onMouseEnter={(e) => {
                if (licenseSubTab !== 'psl') {
                  e.target.style.background = 'linear-gradient(135deg, #4b5563 0%, #374151 100%)';
                  e.target.style.transform = 'translateY(-2px) scale(1.03)';
                  e.target.style.borderColor = '#9ca3af';
                  e.target.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.4)';
                }
              }}
              onMouseLeave={(e) => {
                if (licenseSubTab !== 'psl') {
                  e.target.style.background = 'linear-gradient(135deg, #374151 0%, #1f2937 100%)';
                  e.target.style.transform = 'translateY(0) scale(1)';
                  e.target.style.borderColor = '#6b7280';
                  e.target.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3), inset 0 -1px 3px rgba(0, 0, 0, 0.2)';
                }
              }}
            >
              🔐 Permission Set Licenses
            </button>
            <button
              onClick={() => setLicenseSubTab('permission-sets')}
              style={{
                padding: '14px 28px',
                background: licenseSubTab === 'permission-sets' 
                  ? 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #5b21b6 100%)' 
                  : 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
                color: 'white',
                border: licenseSubTab === 'permission-sets' ? '4px solid #a78bfa' : '2px solid #6b7280',
                borderRadius: '10px',
                cursor: 'pointer',
                fontSize: '15px',
                fontWeight: licenseSubTab === 'permission-sets' ? '800' : '600',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: licenseSubTab === 'permission-sets' 
                  ? '0 10px 20px rgba(139, 92, 246, 0.6), 0 0 0 5px rgba(139, 92, 246, 0.15), inset 0 -2px 6px rgba(0, 0, 0, 0.3)' 
                  : '0 3px 6px rgba(0, 0, 0, 0.3), inset 0 -1px 3px rgba(0, 0, 0, 0.2)',
                transform: licenseSubTab === 'permission-sets' ? 'translateY(-4px) scale(1.06)' : 'translateY(0) scale(1)',
                textShadow: licenseSubTab === 'permission-sets' ? '0 2px 4px rgba(0, 0, 0, 0.5)' : 'none',
                letterSpacing: licenseSubTab === 'permission-sets' ? '0.4px' : 'normal'
              }}
              onMouseEnter={(e) => {
                if (licenseSubTab !== 'permission-sets') {
                  e.target.style.background = 'linear-gradient(135deg, #4b5563 0%, #374151 100%)';
                  e.target.style.transform = 'translateY(-2px) scale(1.03)';
                  e.target.style.borderColor = '#9ca3af';
                  e.target.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.4)';
                }
              }}
              onMouseLeave={(e) => {
                if (licenseSubTab !== 'permission-sets') {
                  e.target.style.background = 'linear-gradient(135deg, #374151 0%, #1f2937 100%)';
                  e.target.style.transform = 'translateY(0) scale(1)';
                  e.target.style.borderColor = '#6b7280';
                  e.target.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3), inset 0 -1px 3px rgba(0, 0, 0, 0.2)';
                }
              }}
            >
              🔧 Permission Sets
            </button>
            <button
              onClick={() => setLicenseSubTab('permission-set-groups')}
              style={{
                padding: '14px 28px',
                background: licenseSubTab === 'permission-set-groups' 
                  ? 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #5b21b6 100%)' 
                  : 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
                color: 'white',
                border: licenseSubTab === 'permission-set-groups' ? '4px solid #a78bfa' : '2px solid #6b7280',
                borderRadius: '10px',
                cursor: 'pointer',
                fontSize: '15px',
                fontWeight: licenseSubTab === 'permission-set-groups' ? '800' : '600',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: licenseSubTab === 'permission-set-groups' 
                  ? '0 10px 20px rgba(139, 92, 246, 0.6), 0 0 0 5px rgba(139, 92, 246, 0.15), inset 0 -2px 6px rgba(0, 0, 0, 0.3)' 
                  : '0 3px 6px rgba(0, 0, 0, 0.3), inset 0 -1px 3px rgba(0, 0, 0, 0.2)',
                transform: licenseSubTab === 'permission-set-groups' ? 'translateY(-4px) scale(1.06)' : 'translateY(0) scale(1)',
                textShadow: licenseSubTab === 'permission-set-groups' ? '0 2px 4px rgba(0, 0, 0, 0.5)' : 'none',
                letterSpacing: licenseSubTab === 'permission-set-groups' ? '0.4px' : 'normal'
              }}
              onMouseEnter={(e) => {
                if (licenseSubTab !== 'permission-set-groups') {
                  e.target.style.background = 'linear-gradient(135deg, #4b5563 0%, #374151 100%)';
                  e.target.style.transform = 'translateY(-2px) scale(1.03)';
                  e.target.style.borderColor = '#9ca3af';
                  e.target.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.4)';
                }
              }}
              onMouseLeave={(e) => {
                if (licenseSubTab !== 'permission-set-groups') {
                  e.target.style.background = 'linear-gradient(135deg, #374151 0%, #1f2937 100%)';
                  e.target.style.transform = 'translateY(0) scale(1)';
                  e.target.style.borderColor = '#6b7280';
                  e.target.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3), inset 0 -1px 3px rgba(0, 0, 0, 0.2)';
                }
              }}
            >
              📦 Permission Set Groups
            </button>
          </div>
          
          {/* User Licenses Tab */}
          {licenseSubTab === 'user-licenses' && (
            <div>
              {/* Filter Box */}
              <div style={{ marginBottom: '15px' }}>
                <input
                  type="text"
                  placeholder="🔍 Filter by license name..."
                  value={userLicenseFilter}
                  onChange={(e) => setUserLicenseFilter(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: '400px',
                    padding: '10px 15px',
                    border: '1px solid #4b5563',
                    borderRadius: '6px',
                    fontSize: '14px',
                    backgroundColor: '#374151',
                    color: '#e5e7eb',
                    outline: 'none'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.target.style.borderColor = '#4b5563'}
                />
              </div>
              
              {/* License Table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #4b5563' }}>
                      <th style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>License Name</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Total</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Used</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Remaining</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Usage %</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentOrgInfo.userLicenses && currentOrgInfo.userLicenses
                      .filter(license => license.Name.toLowerCase().includes(userLicenseFilter.toLowerCase()))
                      .map((license, idx) => {
                        const remaining = (license.TotalLicenses || 0) - (license.UsedLicenses || 0);
                        const usagePercent = license.TotalLicenses > 0 ? ((license.UsedLicenses / license.TotalLicenses) * 100).toFixed(1) : 0;
                        return (
                          <tr key={license.Id || idx} style={{ borderBottom: '1px solid #374151' }}>
                            <td style={{ padding: '12px', color: '#e5e7eb' }}>{license.Name}</td>
                            <td style={{ padding: '12px', textAlign: 'center', color: '#e5e7eb' }}>{license.TotalLicenses || 0}</td>
                            <td style={{ padding: '12px', textAlign: 'center', color: '#e5e7eb' }}>{license.UsedLicenses || 0}</td>
                            <td style={{ padding: '12px', textAlign: 'center', color: '#e5e7eb' }}>{remaining}</td>
                            <td style={{ padding: '12px', textAlign: 'center', color: usagePercent >= 90 ? '#ef4444' : usagePercent >= 75 ? '#f59e0b' : '#10b981' }}>
                              {usagePercent}%
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>
                              <span style={{ 
                                padding: '4px 8px', 
                                borderRadius: '4px', 
                                fontSize: '12px',
                                fontWeight: '600',
                                backgroundColor: license.Status === 'Active' ? '#065f46' : '#7c2d12',
                                color: license.Status === 'Active' ? '#6ee7b7' : '#fca5a5'
                              }}>
                                {license.Status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {(!currentOrgInfo.userLicenses || currentOrgInfo.userLicenses.filter(l => l.Name.toLowerCase().includes(userLicenseFilter.toLowerCase())).length === 0) && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                    No user licenses found
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Permission Set Licenses Tab */}
          {licenseSubTab === 'psl' && (
            <div>
              {/* Filter Box */}
              <div style={{ marginBottom: '15px' }}>
                <input
                  type="text"
                  placeholder="🔍 Filter by permission set license name..."
                  value={pslFilter}
                  onChange={(e) => setPslFilter(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: '400px',
                    padding: '10px 15px',
                    border: '1px solid #4b5563',
                    borderRadius: '6px',
                    fontSize: '14px',
                    backgroundColor: '#374151',
                    color: '#e5e7eb',
                    outline: 'none'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.target.style.borderColor = '#4b5563'}
                />
              </div>
              
              {/* PSL Table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #4b5563' }}>
                      <th style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', fontWeight: '600', width: '25%' }}>License Name</th>
                      <th style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', fontWeight: '600', width: '15%' }}>Developer Name</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600', width: '10%' }}>Total</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600', width: '10%' }}>Used</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600', width: '10%' }}>Remaining</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600', width: '10%' }}>Usage %</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600', width: '10%' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentOrgInfo.permissionSetLicenses && currentOrgInfo.permissionSetLicenses
                      .filter(psl => 
                        psl.MasterLabel.toLowerCase().includes(pslFilter.toLowerCase()) ||
                        psl.DeveloperName.toLowerCase().includes(pslFilter.toLowerCase())
                      )
                      .map((psl, idx) => {
                        const remaining = (psl.TotalLicenses || 0) - (psl.UsedLicenses || 0);
                        const usagePercent = psl.TotalLicenses > 0 ? ((psl.UsedLicenses / psl.TotalLicenses) * 100).toFixed(1) : 0;
                        return (
                          <tr key={psl.Id || idx} style={{ borderBottom: '1px solid #374151' }}>
                            <td style={{ 
                              padding: '12px', 
                              color: '#e5e7eb',
                              wordWrap: 'break-word',
                              overflowWrap: 'break-word'
                            }}>
                              {psl.MasterLabel}
                            </td>
                            <td style={{ 
                              padding: '12px', 
                              color: '#9ca3af', 
                              fontFamily: 'monospace', 
                              fontSize: '11px',
                              wordWrap: 'break-word',
                              overflowWrap: 'break-word',
                              wordBreak: 'break-all',
                              lineHeight: '1.4'
                            }}>
                              {psl.DeveloperName}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center', color: '#e5e7eb' }}>{psl.TotalLicenses || 0}</td>
                            <td style={{ padding: '12px', textAlign: 'center', color: '#e5e7eb' }}>{psl.UsedLicenses || 0}</td>
                            <td style={{ padding: '12px', textAlign: 'center', color: '#e5e7eb' }}>{remaining}</td>
                            <td style={{ padding: '12px', textAlign: 'center', color: usagePercent >= 90 ? '#ef4444' : usagePercent >= 75 ? '#f59e0b' : '#10b981' }}>
                              {usagePercent}%
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>
                              <span style={{ 
                                padding: '4px 8px', 
                                borderRadius: '4px', 
                                fontSize: '12px',
                                fontWeight: '600',
                                backgroundColor: psl.Status === 'Active' ? '#065f46' : '#7c2d12',
                                color: psl.Status === 'Active' ? '#6ee7b7' : '#fca5a5'
                              }}>
                                {psl.Status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {(!currentOrgInfo.permissionSetLicenses || currentOrgInfo.permissionSetLicenses.filter(p => 
                  p.MasterLabel.toLowerCase().includes(pslFilter.toLowerCase()) ||
                  p.DeveloperName.toLowerCase().includes(pslFilter.toLowerCase())
                ).length === 0) && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                    No permission set licenses found
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Permission Sets Tab */}
          {licenseSubTab === 'permission-sets' && (
            <div>
              {/* Filter Box */}
              <div style={{ marginBottom: '15px' }}>
                <input
                  type="text"
                  placeholder="🔍 Filter by permission set name or label..."
                  value={permissionSetFilter}
                  onChange={(e) => setPermissionSetFilter(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: '400px',
                    padding: '10px 15px',
                    border: '1px solid #4b5563',
                    borderRadius: '6px',
                    fontSize: '14px',
                    backgroundColor: '#374151',
                    color: '#e5e7eb',
                    outline: 'none'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.target.style.borderColor = '#4b5563'}
                />
              </div>
              
              {/* Permission Sets Table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #4b5563' }}>
                      <th style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Label</th>
                      <th style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>API Name</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Custom</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Type</th>
                      <th style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Description</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Namespace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentOrgInfo.permissionSets && currentOrgInfo.permissionSets
                      .filter(ps => 
                        ps.Label.toLowerCase().includes(permissionSetFilter.toLowerCase()) ||
                        ps.Name.toLowerCase().includes(permissionSetFilter.toLowerCase())
                      )
                      .map((ps, idx) => (
                        <tr key={ps.Id || idx} style={{ borderBottom: '1px solid #374151' }}>
                          <td style={{ padding: '12px', color: '#e5e7eb' }}>{ps.Label}</td>
                          <td style={{ padding: '12px', color: '#9ca3af', fontFamily: 'monospace', fontSize: '13px' }}>
                            {ps.Name}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <span style={{ 
                              padding: '4px 8px', 
                              borderRadius: '4px', 
                              fontSize: '12px',
                              fontWeight: '600',
                              backgroundColor: ps.IsCustom ? '#065f46' : '#1e40af',
                              color: ps.IsCustom ? '#6ee7b7' : '#93c5fd'
                            }}>
                              {ps.IsCustom ? 'Yes' : 'No'}
                            </span>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center', color: '#e5e7eb', fontSize: '12px' }}>
                            {ps.Type || 'N/A'}
                          </td>
                          <td style={{ 
                            padding: '12px', 
                            color: '#9ca3af', 
                            fontSize: '12px',
                            maxWidth: '300px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {ps.Description || '-'}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
                            {ps.NamespacePrefix || '-'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {(!currentOrgInfo.permissionSets || currentOrgInfo.permissionSets.filter(ps => 
                  ps.Label.toLowerCase().includes(permissionSetFilter.toLowerCase()) ||
                  ps.Name.toLowerCase().includes(permissionSetFilter.toLowerCase())
                ).length === 0) && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                    No permission sets found
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Permission Set Groups Tab */}
          {licenseSubTab === 'permission-set-groups' && (
            <div>
              {/* Filter Box */}
              <div style={{ marginBottom: '15px' }}>
                <input
                  type="text"
                  placeholder="🔍 Filter by permission set group name..."
                  value={permissionSetGroupFilter}
                  onChange={(e) => setPermissionSetGroupFilter(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: '400px',
                    padding: '10px 15px',
                    border: '1px solid #4b5563',
                    borderRadius: '6px',
                    fontSize: '14px',
                    backgroundColor: '#374151',
                    color: '#e5e7eb',
                    outline: 'none'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.target.style.borderColor = '#4b5563'}
                />
              </div>
              
              {/* Permission Set Groups Table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #4b5563' }}>
                      <th style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Label</th>
                      <th style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Developer Name</th>
                      <th style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '12px', color: '#9ca3af', fontWeight: '600' }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentOrgInfo.permissionSetGroups && currentOrgInfo.permissionSetGroups
                      .filter(psg => 
                        psg.MasterLabel.toLowerCase().includes(permissionSetGroupFilter.toLowerCase()) ||
                        psg.DeveloperName.toLowerCase().includes(permissionSetGroupFilter.toLowerCase())
                      )
                      .map((psg, idx) => (
                        <tr key={psg.Id || idx} style={{ borderBottom: '1px solid #374151' }}>
                          <td style={{ padding: '12px', color: '#e5e7eb' }}>{psg.MasterLabel}</td>
                          <td style={{ padding: '12px', color: '#9ca3af', fontFamily: 'monospace', fontSize: '13px' }}>
                            {psg.DeveloperName}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <span style={{ 
                              padding: '4px 8px', 
                              borderRadius: '4px', 
                              fontSize: '12px',
                              fontWeight: '600',
                              backgroundColor: psg.Status === 'Updated' ? '#065f46' : '#7c2d12',
                              color: psg.Status === 'Updated' ? '#6ee7b7' : '#fca5a5'
                            }}>
                              {psg.Status}
                            </span>
                          </td>
                          <td style={{ 
                            padding: '12px', 
                            color: '#9ca3af', 
                            fontSize: '12px',
                            maxWidth: '400px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {psg.Description || '-'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {(!currentOrgInfo.permissionSetGroups || currentOrgInfo.permissionSetGroups.filter(psg => 
                  psg.MasterLabel.toLowerCase().includes(permissionSetGroupFilter.toLowerCase()) ||
                  psg.DeveloperName.toLowerCase().includes(permissionSetGroupFilter.toLowerCase())
                ).length === 0) && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                    No permission set groups found
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderOrgManagement = () => (
    <div className="admin-section-content">
      <h3>🏢 Organization Management</h3>
      
      {/* Sub-tabs */}
      <div style={{ 
        display: 'flex', 
        gap: '15px', 
        marginBottom: '25px',
        borderBottom: '3px solid #4b5563',
        paddingBottom: '15px',
        background: 'linear-gradient(90deg, rgba(55, 65, 81, 0.3) 0%, rgba(31, 41, 55, 0.3) 100%)',
        padding: '15px',
        borderRadius: '12px'
      }}>
        <button
          onClick={() => setOrgManagementSubTab('current-org')}
          style={{
            padding: '16px 32px',
            background: orgManagementSubTab === 'current-org' 
              ? 'linear-gradient(135deg, #3b82f6 0%, #1e40af 50%, #1e3a8a 100%)' 
              : 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
            color: 'white',
            border: orgManagementSubTab === 'current-org' ? '4px solid #60a5fa' : '2px solid #6b7280',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: orgManagementSubTab === 'current-org' ? '800' : '600',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: orgManagementSubTab === 'current-org' 
              ? '0 12px 24px rgba(59, 130, 246, 0.6), 0 0 0 6px rgba(59, 130, 246, 0.15), inset 0 -2px 8px rgba(0, 0, 0, 0.3)' 
              : '0 4px 8px rgba(0, 0, 0, 0.3), inset 0 -1px 4px rgba(0, 0, 0, 0.2)',
            transform: orgManagementSubTab === 'current-org' ? 'translateY(-5px) scale(1.08)' : 'translateY(0) scale(1)',
            position: 'relative',
            overflow: 'hidden',
            textShadow: orgManagementSubTab === 'current-org' ? '0 2px 4px rgba(0, 0, 0, 0.5)' : 'none',
            letterSpacing: orgManagementSubTab === 'current-org' ? '0.5px' : 'normal'
          }}
          onMouseEnter={(e) => {
            if (orgManagementSubTab !== 'current-org') {
              e.target.style.background = 'linear-gradient(135deg, #4b5563 0%, #374151 100%)';
              e.target.style.transform = 'translateY(-2px) scale(1.03)';
              e.target.style.borderColor = '#9ca3af';
              e.target.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (orgManagementSubTab !== 'current-org') {
              e.target.style.background = 'linear-gradient(135deg, #374151 0%, #1f2937 100%)';
              e.target.style.transform = 'translateY(0) scale(1)';
              e.target.style.borderColor = '#6b7280';
              e.target.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3), inset 0 -1px 4px rgba(0, 0, 0, 0.2)';
            }
          }}
        >
          🔍 Current Org Details
        </button>
        <button
          onClick={() => setOrgManagementSubTab('manage-all')}
          style={{
            padding: '16px 32px',
            background: orgManagementSubTab === 'manage-all' 
              ? 'linear-gradient(135deg, #3b82f6 0%, #1e40af 50%, #1e3a8a 100%)' 
              : 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
            color: 'white',
            border: orgManagementSubTab === 'manage-all' ? '4px solid #60a5fa' : '2px solid #6b7280',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: orgManagementSubTab === 'manage-all' ? '800' : '600',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: orgManagementSubTab === 'manage-all' 
              ? '0 12px 24px rgba(59, 130, 246, 0.6), 0 0 0 6px rgba(59, 130, 246, 0.15), inset 0 -2px 8px rgba(0, 0, 0, 0.3)' 
              : '0 4px 8px rgba(0, 0, 0, 0.3), inset 0 -1px 4px rgba(0, 0, 0, 0.2)',
            transform: orgManagementSubTab === 'manage-all' ? 'translateY(-5px) scale(1.08)' : 'translateY(0) scale(1)',
            position: 'relative',
            overflow: 'hidden',
            textShadow: orgManagementSubTab === 'manage-all' ? '0 2px 4px rgba(0, 0, 0, 0.5)' : 'none',
            letterSpacing: orgManagementSubTab === 'manage-all' ? '0.5px' : 'normal'
          }}
          onMouseEnter={(e) => {
            if (orgManagementSubTab !== 'manage-all') {
              e.target.style.background = 'linear-gradient(135deg, #4b5563 0%, #374151 100%)';
              e.target.style.transform = 'translateY(-2px) scale(1.03)';
              e.target.style.borderColor = '#9ca3af';
              e.target.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (orgManagementSubTab !== 'manage-all') {
              e.target.style.background = 'linear-gradient(135deg, #374151 0%, #1f2937 100%)';
              e.target.style.transform = 'translateY(0) scale(1)';
              e.target.style.borderColor = '#6b7280';
              e.target.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3), inset 0 -1px 4px rgba(0, 0, 0, 0.2)';
            }
          }}
        >
          ⚙️ Manage All Orgs
        </button>
      </div>

      {/* Content based on selected sub-tab */}
      {orgManagementSubTab === 'current-org' ? (
        renderCurrentOrgDetails()
      ) : (
        <div style={{ display: 'flex', gap: '20px', minHeight: '500px' }}>
        {/* Left: Org List */}
        <div style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '15px' 
          }}>
            <h4 style={{ margin: 0 }}>Organizations ({orgs.length})</h4>
            <button
              onClick={handleStartAddOrg}
              style={{
                background: '#38a169',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600'
              }}
            >
              ➕ Add Org
            </button>
          </div>
          
          <div className="org-list-container" style={{ 
            display: 'flex',
            flexDirection: 'column'
          }}>
            {orgs.map((org, idx) => (
              <div
                key={org.index}
                onClick={() => handleSelectOrg(org)}
                className="org-list-item"
                style={{
                  padding: '12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #e2e8f0',
                  background: selectedOrg && selectedOrg.index === org.index ? '#3b82f6' : 'white',
                  color: selectedOrg && selectedOrg.index === org.index ? 'white' : '#1e293b',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                    {org.fields.name || `Org ${org.index}`}
                  </div>
                  <div style={{ fontSize: '12px', opacity: 0.8 }}>
                    Index: {org.index}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button
                    onClick={(e) => handleMoveOrgUp(e, org.index)}
                    disabled={idx === 0}
                    className="org-reorder-button"
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                      fontWeight: 'bold',
                      background: idx === 0 ? '#6b7280' : '#10b981',
                      color: 'white',
                      cursor: idx === 0 ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                      opacity: idx === 0 ? 0.4 : 1,
                      boxShadow: idx === 0 ? 'none' : '0 2px 8px rgba(16, 185, 129, 0.3)'
                    }}
                    onMouseEnter={(e) => {
                      if (idx !== 0) {
                        e.target.style.transform = 'scale(1.1) translateY(-2px)';
                        e.target.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (idx !== 0) {
                        e.target.style.transform = 'scale(1)';
                        e.target.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
                      }
                    }}
                    title="Move up"
                  >
                    ▲
                  </button>
                  <button
                    onClick={(e) => handleMoveOrgDown(e, org.index)}
                    disabled={idx === orgs.length - 1}
                    className="org-reorder-button"
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                      fontWeight: 'bold',
                      background: idx === orgs.length - 1 ? '#6b7280' : '#ef4444',
                      color: 'white',
                      cursor: idx === orgs.length - 1 ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                      opacity: idx === orgs.length - 1 ? 0.4 : 1,
                      boxShadow: idx === orgs.length - 1 ? 'none' : '0 2px 8px rgba(239, 68, 68, 0.3)'
                    }}
                    onMouseEnter={(e) => {
                      if (idx !== orgs.length - 1) {
                        e.target.style.transform = 'scale(1.1) translateY(2px)';
                        e.target.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.4)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (idx !== orgs.length - 1) {
                        e.target.style.transform = 'scale(1)';
                        e.target.style.boxShadow = '0 2px 8px rgba(239, 68, 68, 0.3)';
                      }
                    }}
                    title="Move down"
                  >
                    ▼
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          {/* Backup Section */}
          <div style={{ marginTop: '20px' }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '10px' 
            }}>
              <h4 style={{ margin: 0 }}>📦 Backups ({backups.length})</h4>
              {backups.length > 0 && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={handleSelectAllBackups}
                    style={{
                      padding: '4px 8px',
                      background: '#6b7280',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: '600'
                    }}
                  >
                    {selectedBackups.length === backups.length ? '☐ Deselect All' : '☑ Select All'}
                  </button>
                  {selectedBackups.length > 0 && (
                    <button
                      onClick={handleDeleteBackups}
                      style={{
                        padding: '4px 8px',
                        background: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: '600'
                      }}
                    >
                      🗑️ Delete ({selectedBackups.length})
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="backup-list-container" style={{
              maxHeight: '200px',
              overflowY: 'auto',
              padding: '8px'
            }}>
              {backups.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
                  No backups yet
                </div>
              ) : (
                backups.map((backup, idx) => (
                  <div 
                    key={idx} 
                    className="backup-item" 
                    style={{
                      padding: '8px',
                      fontSize: '12px',
                      borderBottom: idx < backups.length - 1 ? '1px solid #e2e8f0' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      background: selectedBackups.includes(backup.filename) ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                      transition: 'all 0.2s'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedBackups.includes(backup.filename)}
                      onChange={() => handleBackupSelect(backup.filename)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <div 
                      style={{ 
                        flex: 1,
                        cursor: 'pointer'
                      }}
                      onClick={() => handleViewBackupDiff(backup.filename)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '0.7';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '1';
                      }}
                    >
                      <div style={{ 
                        fontWeight: '600', 
                        color: '#e5e7eb',
                        textDecoration: 'underline',
                        textDecorationStyle: 'dotted'
                      }}>
                        {backup.date}
                      </div>
                      <div className="backup-item-filename" style={{ fontSize: '11px', color: '#9ca3af' }}>{backup.filename}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {backups.length > 0 && (
              <div style={{ 
                marginTop: '10px', 
                padding: '8px', 
                background: '#4b5563', 
                borderRadius: '6px',
                fontSize: '11px',
                textAlign: 'center',
                color: '#e5e7eb',
                fontWeight: '500'
              }}>
                💡 Click filename to view comparison
              </div>
            )}
          </div>
        </div>
        
        {/* Right: Org Details/Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {(!selectedOrg && !isAddingOrg) || isAddingOrg ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#6b7280'
            }}>
              <div style={{ textAlign: 'center' }}>
                <h4>Select an organization to view/edit</h4>
                <p>Or click "Add Org" to create a new one</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="org-header-container" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '15px',
                padding: '15px'
              }}>
                <h4 style={{ margin: 0 }}>
                  {isAddingOrg ? '➕ Add New Organization' : 
                   isEditingOrg ? '✏️ Edit Organization' : '📄 Organization Details'}
                </h4>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {!isEditingOrg && !isAddingOrg && (
                    <>
                      <button
                        onClick={handleEditOrg}
                        style={{
                          background: '#3b82f6',
                          color: 'white',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: '600'
                        }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDeleteOrg(selectedOrg)}
                        style={{
                          background: '#ef4444',
                          color: 'white',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: '600'
                        }}
                      >
                        🗑️ Delete
                      </button>
                    </>
                  )}
                  
                  {(isEditingOrg || isAddingOrg) && (
                    <>
                      <button
                        onClick={() => setEditMode(editMode === 'form' ? 'json' : 'form')}
                        style={{
                          background: '#6b7280',
                          color: 'white',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: '600'
                        }}
                      >
                        {editMode === 'form' ? '{ } JSON' : '📝 Form'}
                      </button>
                      <button
                        onClick={handleSaveOrg}
                        disabled={loading}
                        style={{
                          background: '#38a169',
                          color: 'white',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: '6px',
                          cursor: loading ? 'not-allowed' : 'pointer',
                          fontSize: '14px',
                          fontWeight: '600',
                          opacity: loading ? 0.6 : 1
                        }}
                      >
                        💾 Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        style={{
                          background: '#6b7280',
                          color: 'white',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: '600'
                        }}
                      >
                        ✕ Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
              
              <div className="org-details-container" style={{ 
                flex: 1, 
                overflowY: 'auto',
                padding: '15px'
              }}>
                {editMode === 'form' ? (
                  <div>
                    {Object.entries(selectedOrg.fields)
                      .filter(([key]) => key !== 'username' && key !== 'password')
                      .map(([key, value]) => (
                      <div key={key} style={{ marginBottom: '15px' }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '5px'
                        }}>
                          <label style={{ fontWeight: '600', fontSize: '14px', color: '#374151' }}>
                            {key}
                          </label>
                          {(isEditingOrg || isAddingOrg) && (
                            <button
                              onClick={() => handleDeleteField(key)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#ef4444',
                                cursor: 'pointer',
                                fontSize: '12px',
                                padding: '4px 8px'
                              }}
                              title="Delete field"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          value={value}
                          onChange={(e) => handleFieldChange(key, e.target.value)}
                          disabled={!isEditingOrg && !isAddingOrg}
                          className="org-field-input"
                          style={{
                            width: '100%',
                            padding: '10px',
                            borderRadius: '6px',
                            fontSize: '14px',
                            fontFamily: key.includes('SECRET') ? 'monospace' : 'inherit'
                          }}
                        />
                      </div>
                    ))}
                    
                    {(isEditingOrg || isAddingOrg) && (
                      <button
                        onClick={handleAddField}
                        style={{
                          background: '#3b82f6',
                          color: 'white',
                          border: 'none',
                          padding: '10px 16px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: '600',
                          marginTop: '10px'
                        }}
                      >
                        ➕ Add Field
                      </button>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ marginBottom: '10px', fontSize: '14px', color: '#6b7280' }}>
                      Edit the organization fields as JSON:
                    </div>
                    <textarea
                      value={orgJsonText}
                      onChange={(e) => setOrgJsonText(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: '400px',
                        padding: '12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontFamily: 'Monaco, Menlo, monospace',
                        background: '#1a202c',
                        color: '#e5e7eb',
                        resize: 'vertical'
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );

  const renderComponentDataStatus = (data) => (
    <div className="admin-section-content">
      <h3>💾 Component Data Cache Status</h3>
      
      <div className="cache-summary">
        <div className="summary-stat">
          <span className="stat-label">Organizations with cached data:</span>
          <span className="stat-value">{data.totalOrgsWithData}</span>
        </div>
        
        {data.totalOrgsWithData > 0 && (
          <div className="cache-actions">
            <button 
              onClick={clearAllCaches}
              className="clear-all-btn"
              disabled={loading}
            >
              🗑️ Clear All Caches
            </button>
            <button 
              onClick={() => {
                const orgIds = Object.keys(data.cacheStatus);
                if (orgIds.length > 0) {
                  clearPersistedCache(orgIds[0]);
                }
              }}
              className="clear-persisted-btn"
              disabled={loading}
              title="Clear persisted Redis cache for the first organization"
            >
              🗄️ Clear Persisted Cache
            </button>
            <button 
              onClick={regenerateAllCaches}
              className="regenerate-btn"
              disabled={loading}
              title="Regenerate all cached component data and hierarchies"
            >
              🔄 Regenerate All Caches
            </button>
          </div>
        )}
      </div>

      {data.totalOrgsWithData > 0 ? (
        <div className="cache-details">
          {Object.entries(data.cacheStatus).map(([orgId, cacheInfo]) => (
            <div key={orgId} className="cache-org-card">
              <div className="cache-org-header">
                <h4>Organization: {cacheInfo.orgName || orgId}</h4>
                {cacheInfo.orgName && (
                  <div className="org-id-subtitle">ID: {orgId}</div>
                )}
                <div className="cache-buttons">
                  <button 
                    onClick={() => clearOrgCache(orgId)}
                    className="clear-cache-btn"
                    disabled={loading}
                  >
                    🗑️ Clear Cache
                  </button>
                  <button 
                    onClick={() => clearPersistedCache(orgId)}
                    className="clear-persisted-btn"
                    disabled={loading}
                    title="Clear persisted Redis cache for this organization"
                  >
                    🗄️ Clear Persisted
                  </button>
                </div>
              </div>
              
              <div className="cache-org-details">
                <div className="info-item">
                  <label>Loaded:</label>
                  <span>{new Date(cacheInfo.loadedAt).toLocaleString()}</span>
                </div>
                <div className="info-item">
                  <label>Total Components:</label>
                  <span>{cacheInfo.totalComponents}</span>
                </div>
                <div className="info-item">
                  <label>Integration Procedures:</label>
                  <span>{cacheInfo.integrationProcedures}</span>
                </div>
                <div className="info-item">
                  <label>Omniscripts:</label>
                  <span>{cacheInfo.omniscripts}</span>
                </div>
                <div className="info-item">
                  <label>Data Mappers:</label>
                  <span>{cacheInfo.dataMappers}</span>
                </div>
                <div className="info-item">
                  <label>Hierarchy Items:</label>
                  <span>{cacheInfo.hierarchySize}</span>
                </div>
                <div className="info-item">
                  <label>Cache Size:</label>
                  <span>{cacheInfo.cacheSize?.formatted || 'Unknown'}</span>
                </div>
                {cacheInfo.timing && (
                  <div className="info-item">
                    <label>Load Time:</label>
                    <span>{cacheInfo.timing.durationMs}ms ({cacheInfo.timing.durationSeconds}s)</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No component data cached for any organizations.</p>
          <p>Data is cached when users access the Omnistudio tab.</p>
        </div>
      )}
    </div>
  );

  const renderSessionInfo = (data) => (
    <div className="admin-section-content">
      <h3>👤 Session Information</h3>
      
      <div className="info-grid">
        <div className="info-card">
          <h4>Session Status</h4>
          <div className="info-item">
            <label>Session Exists:</label>
            <span className={`status ${data.sessionExists ? 'connected' : 'disconnected'}`}>
              {data.sessionExists ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="info-item">
            <label>Session ID:</label>
            <span className="session-id">{data.sessionId}</span>
          </div>
          <div className="info-item">
            <label>Salesforce Connected:</label>
            <span className={`status ${data.salesforceConnected ? 'connected' : 'disconnected'}`}>
              {data.salesforceConnected ? 'Yes' : 'No'}
            </span>
          </div>
        </div>

        {data.userInfo && (
          <div className="info-card">
            <h4>User Information</h4>
            <div className="info-item">
              <label>Display Name:</label>
              <span>{data.userInfo.displayName}</span>
            </div>
            <div className="info-item">
              <label>Username:</label>
              <span>{data.userInfo.username}</span>
            </div>
            <div className="info-item">
              <label>Email:</label>
              <span>{data.userInfo.email}</span>
            </div>
            <div className="info-item">
              <label>User ID:</label>
              <span className="user-id">{data.userInfo.userId}</span>
            </div>
            <div className="info-item">
              <label>Organization ID:</label>
              <span className="org-id">{data.userInfo.organizationId}</span>
            </div>
          </div>
        )}

        {data.orgInfo && (
          <div className="info-card">
            <h4>Organization Information</h4>
            <div className="info-item">
              <label>Org Name:</label>
              <span>{data.orgInfo.orgName}</span>
            </div>
            <div className="info-item">
              <label>Org Type:</label>
              <span>{data.orgInfo.orgType}</span>
            </div>
            <div className="info-item">
              <label>Org Key:</label>
              <span>{data.orgInfo.orgKey}</span>
            </div>
            <div className="info-item">
              <label>Instance URL:</label>
              <span className="instance-url">{data.orgInfo.instanceUrl}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderEnvironmentInfo = (data) => (
    <div className="admin-section-content">
      <h3>⚙️ Environment Variables</h3>
      
      <div className="env-summary">
        <div className="summary-stat">
          <span className="stat-label">Total Environment Variables:</span>
          <span className="stat-value">{data?.totalEnvVars || 0}</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Relevant Variables Shown:</span>
          <span className="stat-value">{data?.relevantEnvVars ? Object.keys(data.relevantEnvVars).length : 0}</span>
        </div>
      </div>

      <div className="env-variables">
        {data?.relevantEnvVars ? Object.entries(data.relevantEnvVars).map(([key, value]) => (
          <div key={key} className="env-item">
            <label>{key}:</label>
            <span className={value === '***HIDDEN***' ? 'hidden-value' : 'env-value'}>
              {value}
            </span>
          </div>
        )) : (
          <div className="empty-state">
            <p>No environment variables found.</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderRedisManagement = (data) => {
    // Use the state from the parent component
    const currentRedisEnabled = data?.redisStatus?.enabled ?? redisEnabled;

    return (
      <div className="admin-section-content">
        <h3>🗄️ Redis Management</h3>
        
        <div className="redis-status-section">
          <h4>Redis Status</h4>
          
          <div className="redis-info-grid">
            <div className="redis-info-card">
              <h5>Functionality Status</h5>
              <div className="redis-status-item">
                <span className="status-label">Enabled:</span>
                <span className={`status-value ${currentRedisEnabled ? 'enabled' : 'disabled'}`}>
                  {currentRedisEnabled ? '✅ Enabled' : '❌ Disabled'}
                </span>
              </div>
              <div className="redis-toggle-section">
                <button
                  onClick={() => handleRedisToggle(!currentRedisEnabled)}
                  className={`toggle-button ${currentRedisEnabled ? 'disable' : 'enable'}`}
                  disabled={isTogglingRedis}
                >
                  {isTogglingRedis ? '⏳ Toggling...' : (currentRedisEnabled ? '🚫 Disable Redis' : '✅ Enable Redis')}
                </button>
              </div>
            </div>
            
            <div className="redis-info-card">
              <h5>System Status</h5>
              <div className="redis-status-item">
                <span className="status-label">Module Available:</span>
                <span className={`status-value ${data?.redisStatus?.moduleExists ? 'available' : 'unavailable'}`}>
                  {data?.redisStatus?.moduleExists ? '✅ Available' : '❌ Unavailable'}
                </span>
              </div>
              <div className="redis-status-item">
                <span className="status-label">Connection:</span>
                <span className={`status-value ${data?.redisStatus?.available ? 'connected' : 'disconnected'}`}>
                  {data?.redisStatus?.available ? '✅ Connected' : '❌ Disconnected'}
                </span>
              </div>
            </div>
          </div>
          
          <div className="redis-description">
            <h5>What this does:</h5>
            <ul>
              <li><strong>Enable Redis:</strong> OmniStudio components will be cached in Redis for persistent storage across server restarts</li>
              <li><strong>Disable Redis:</strong> Components will only be cached in memory and will be lost on server restart</li>
              <li><strong>Note:</strong> This setting only affects new component loads, existing cached data remains unaffected</li>
            </ul>
          </div>
        </div>
      </div>
    );
  };

  const exportCacheToJSON = () => {
    if (!sectionData || !sectionData.fullCache) {
      alert('No cache data available to export');
      return;
    }

    try {
      // Generate default filename
      const defaultFilename = `sobject-field-cache-${sectionData.orgId}-${new Date().toISOString().split('T')[0]}.json`;
      
      // Prompt user for custom filename
      const customFilename = prompt(
        'Enter filename for the export:\n\n(Note: Your browser\'s download dialog will let you choose the folder)',
        defaultFilename
      );
      
      // If user cancels, don't export
      if (customFilename === null) {
        console.log('ℹ️ [ADMIN] Export cancelled by user');
        return;
      }
      
      // Make sure filename ends with .json
      let finalFilename = customFilename.trim();
      if (!finalFilename) {
        finalFilename = defaultFilename;
      }
      if (!finalFilename.toLowerCase().endsWith('.json')) {
        finalFilename += '.json';
      }
      
      const jsonString = JSON.stringify(sectionData.fullCache, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = finalFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      console.log(`✅ [ADMIN] Cache exported successfully as: ${finalFilename}`);
    } catch (error) {
      console.error('❌ [ADMIN] Error exporting cache:', error);
      alert('Failed to export cache: ' + error.message);
    }
  };

  const rebuildSObjectCache = async () => {
    if (!window.confirm('Are you sure you want to rebuild the SObject field cache? This will take 1-2 minutes.')) {
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      console.log('🔄 [ADMIN] Starting SObject field cache rebuild...');
      
      const response = await axios.post('/api/sobjects/field-search/build-cache', {}, {
        withCredentials: true
      });
      
      if (response.data.success) {
        console.log('✅ [ADMIN] Cache rebuilt successfully:', response.data);
        alert(`Cache rebuilt successfully!\n\n${response.data.sobjectCount} SObjects cached\nErrors: ${response.data.errorCount}`);
        
        // Reload the cache data
        await loadSectionData('sobject-field-cache');
      } else {
        setError('Failed to rebuild cache: ' + response.data.message);
      }
    } catch (error) {
      console.error('❌ [ADMIN] Error rebuilding cache:', error);
      setError('Error rebuilding cache: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const renderSObjectFieldCache = (data) => {
    if (!data.cached) {
      return (
        <div className="admin-section-content">
          <h3>🔍 SObject Field Cache</h3>
          <div className="empty-state">
            <p>{data.message || 'No SObject field cache found for this organization.'}</p>
            <p>Click the button below to build the cache (takes 1-2 minutes):</p>
            <button 
              onClick={rebuildSObjectCache}
              className="regenerate-btn"
              style={{ 
                background: '#3b82f6',
                marginTop: '16px',
                padding: '12px 24px',
                fontSize: '16px'
              }}
              disabled={loading}
            >
              {loading ? '🔄 Building Cache...' : '🔧 Build Cache Now'}
            </button>
          </div>
        </div>
      );
    }

    const stats = data.statistics;
    const fieldTypes = Object.entries(stats.fieldTypeDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return (
      <div className="admin-section-content">
        <h3>🔍 SObject Field Cache</h3>
        
        <div className="cache-summary">
          <div className="summary-stat">
            <span className="stat-label">Organization ID:</span>
            <span className="stat-value">{data.orgId}</span>
          </div>
          <div className="summary-stat">
            <span className="stat-label">Cached At:</span>
            <span className="stat-value">{new Date(data.cachedAt).toLocaleString()}</span>
          </div>
          <div className="summary-stat">
            <span className="stat-label">Cache Size:</span>
            <span className="stat-value">{stats.cacheSize.formatted}</span>
          </div>
          {data.fullCache?.optimized && (
            <div className="summary-stat">
              <span className="stat-label">Optimized:</span>
              <span className="stat-value" style={{ background: '#38a169' }}>✓ Yes</span>
            </div>
          )}
          
          <div className="cache-actions">
            <button 
              onClick={rebuildSObjectCache}
              className="regenerate-btn"
              style={{ background: '#f59e0b' }}
              disabled={loading}
            >
              {loading ? '⏳ Rebuilding...' : '🔄 Rebuild Cache'}
            </button>
            <button 
              onClick={exportCacheToJSON}
              className="regenerate-btn"
              style={{ background: '#38a169' }}
            >
              📥 Export to JSON
            </button>
            <button 
              onClick={() => loadSectionData('sobject-field-cache')}
              className="refresh-logs-btn"
            >
              🔄 Refresh View
            </button>
          </div>
        </div>

        {/* Statistics Grid */}
        <div className="info-grid">
          <div className="info-card">
            <h4>SObject Statistics</h4>
            <div className="info-item">
              <label>Total SObjects:</label>
              <span>{stats.totalSObjects}</span>
            </div>
            <div className="info-item">
              <label>Custom SObjects:</label>
              <span>{stats.customSObjects}</span>
            </div>
            <div className="info-item">
              <label>Standard SObjects:</label>
              <span>{stats.standardSObjects}</span>
            </div>
          </div>

          <div className="info-card">
            <h4>Field Statistics</h4>
            <div className="info-item">
              <label>Total Fields:</label>
              <span>{stats.totalFields.toLocaleString()}</span>
            </div>
            <div className="info-item">
              <label>Avg Fields/Object:</label>
              <span>{stats.averageFieldsPerObject}</span>
            </div>
            <div className="info-item">
              <label>Unique Field Types:</label>
              <span>{Object.keys(stats.fieldTypeDistribution).length}</span>
            </div>
          </div>

          <div className="info-card">
            <h4>Cache Information</h4>
            <div className="info-item">
              <label>Size (Bytes):</label>
              <span>{stats.cacheSize.bytes.toLocaleString()}</span>
            </div>
            <div className="info-item">
              <label>Size (KB):</label>
              <span>{stats.cacheSize.kb} KB</span>
            </div>
            <div className="info-item">
              <label>Size (MB):</label>
              <span>{stats.cacheSize.mb} MB</span>
            </div>
          </div>
        </div>

        {/* Field Type Distribution */}
        <div className="cache-org-card" style={{ marginTop: '24px' }}>
          <h4>📊 Top 10 Field Types Distribution</h4>
          <div style={{ marginTop: '16px' }}>
            {fieldTypes.map(([type, count]) => (
              <div key={type} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px',
                marginBottom: '8px',
                background: '#f7fafc',
                borderRadius: '6px',
                border: '1px solid #e2e8f0'
              }}>
                <span style={{ fontWeight: '600', color: '#2d3748' }}>{type}</span>
                <span style={{
                  background: '#667eea',
                  color: 'white',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontSize: '14px',
                  fontWeight: '600'
                }}>
                  {count.toLocaleString()} fields
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Optimization Info */}
        {data.fullCache?.optimized && data.fullCache?.excludedSystemFields && (
          <div className="cache-org-card" style={{ marginTop: '24px' }}>
            <h4>⚡ Cache Optimization</h4>
            <div style={{ marginTop: '12px', padding: '12px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #86efac' }}>
              <p style={{ color: '#166534', fontWeight: '600', marginBottom: '8px' }}>
                The following system fields are excluded from cache:
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {data.fullCache.excludedSystemFields.map(field => (
                  <span key={field} style={{
                    padding: '4px 10px',
                    background: '#dcfce7',
                    border: '1px solid #86efac',
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: '#166534',
                    fontFamily: 'Monaco, monospace'
                  }}>
                    {field}
                  </span>
                ))}
              </div>
              <p style={{ color: '#166534', fontSize: '12px', marginTop: '12px', marginBottom: '0' }}>
                Additionally, default values (custom: false, length: 0, precision: 0, scale: 0) are omitted from fields.
              </p>
            </div>
          </div>
        )}

        {/* SObject Preview */}
        <div className="cache-org-card" style={{ marginTop: '24px' }}>
          <h4>📝 Sample SObjects (First 5)</h4>
          <div style={{ marginTop: '16px' }}>
            {Object.values(data.metadata).slice(0, 5).map((sobject) => (
              <div key={sobject.name} style={{
                padding: '12px',
                marginBottom: '12px',
                background: '#f7fafc',
                borderRadius: '6px',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <strong style={{ color: '#2d3748' }}>{sobject.name}</strong>
                  <span style={{
                    background: sobject.custom ? '#fbbf24' : '#3b82f6',
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}>
                    {sobject.custom ? 'Custom' : 'Standard'}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#718096' }}>
                  {sobject.label} • {sobject.fields.length} fields
                </div>
              </div>
            ))}
          </div>
          {Object.keys(data.metadata).length > 5 && (
            <div style={{ 
              marginTop: '12px', 
              padding: '10px', 
              textAlign: 'center',
              color: '#718096',
              fontSize: '14px'
            }}>
              ...and {Object.keys(data.metadata).length - 5} more SObjects
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderServerLogs = (data) => (
    <div className="admin-section-content">
      <h3>📋 Server Logs</h3>
      
      <div className="logs-summary">
        <div className="summary-stat">
          <span className="stat-label">Log File:</span>
          <span className="stat-value">{data?.logFile || 'N/A'}</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Total Files:</span>
          <span className="stat-value">{data?.totalLogFiles || 'N/A'}</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Total Lines:</span>
          <span className="stat-value">{data?.totalLines || 'N/A'}</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Showing:</span>
          <span className="stat-value">{data?.recentLines || 'N/A'} recent lines</span>
        </div>
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            padding: '8px 12px',
            background: liveTailEnabled ? '#1e3a5f' : '#374151',
            border: liveTailEnabled ? '2px solid #3b82f6' : '2px solid #4b5563',
            borderRadius: '6px',
            color: liveTailEnabled ? '#93c5fd' : '#e5e7eb',
            transition: 'all 0.2s'
          }}>
            <input
              type="checkbox"
              checked={liveTailEnabled}
              onChange={(e) => setLiveTailEnabled(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>{liveTailEnabled ? '🔴 Live Tail (tail -f)' : '⚪ Live Tail (tail -f)'}</span>
          </label>
          
          <button 
            onClick={() => loadSectionData('server-logs')}
            className="refresh-logs-btn"
            disabled={loading || liveTailEnabled}
          >
            🔄 Refresh Logs
          </button>
        </div>
      </div>

      <div className="logs-container" ref={logsContainerRef}>
        {data?.logs && data.logs.length > 0 ? (
          <>
            {data.logs.map((logLine, index) => (
              <div key={index} className="log-line">
                {logLine}
              </div>
            ))}
          </>
        ) : (
          <div className="empty-state">
            <p>No log entries found.</p>
          </div>
        )}
      </div>
      
      {liveTailEnabled && isScrolledUp && (
        <div style={{
          position: 'sticky',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'fit-content',
          background: '#f59e0b',
          color: '#1f2937',
          padding: '8px 16px',
          borderRadius: '20px',
          fontSize: '13px',
          fontWeight: '600',
          boxShadow: '0 4px 12px rgba(245, 158, 11, 0.4)',
          border: '2px solid #fbbf24',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          zIndex: 100
        }}
        onClick={() => {
          if (logsContainerRef.current) {
            // Mark as programmatic scroll
            userScrolledManuallyRef.current = false;
            
            logsContainerRef.current.scrollTo({
              top: logsContainerRef.current.scrollHeight,
              behavior: 'smooth'
            });
            
            // Hide the warning badge
            setIsScrolledUp(false);
            wasAtBottomRef.current = true;
            
            // Reset flag after scroll completes
            setTimeout(() => {
              userScrolledManuallyRef.current = false;
            }, 500);
          }
        }}
        >
          ⚠️ Auto-scroll paused • Click to jump to bottom
        </div>
      )}
    </div>
  );

  const renderTabVisibility = () => {
    // Define tabs that can be controlled
    const controllableTabs = [
      { id: 'datacloud-query', label: 'DC V1 Query', icon: '🌥️', description: 'Data Cloud V1 Query Tab' },
      { id: 'datacloud-objects', label: 'DC V1 Objects', icon: '🗂️', description: 'Data Cloud V1 Objects Tab' }
    ];

    return (
      <div className="admin-section-content">
        <h3>👁️ Tab Visibility Control</h3>
        <p style={{ color: '#9ca3af', marginBottom: '30px' }}>
          Control which tabs are visible in the main dashboard navigation. 
          Changes are saved automatically and applied immediately.
        </p>

        <div style={{ display: 'grid', gap: '20px' }}>
          {controllableTabs.map(tab => {
            const isVisible = tabVisibility?.[tab.id] !== false;
            
            return (
              <div 
                key={tab.id}
                style={{
                  background: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  padding: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '24px' }}>{tab.icon}</span>
                    <h4 style={{ margin: 0, color: '#f3f4f6', fontSize: '18px' }}>{tab.label}</h4>
                  </div>
                  <p style={{ color: '#9ca3af', margin: 0, fontSize: '14px' }}>{tab.description}</p>
                </div>
                
                <button
                  onClick={() => updateTabVisibility(tab.id, !isVisible)}
                  style={{
                    padding: '10px 24px',
                    fontSize: '14px',
                    fontWeight: '600',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: isVisible ? '#10b981' : '#6b7280',
                    color: 'white',
                    minWidth: '100px'
                  }}
                  onMouseOver={(e) => {
                    e.target.style.opacity = '0.8';
                  }}
                  onMouseOut={(e) => {
                    e.target.style.opacity = '1';
                  }}
                >
                  {isVisible ? '✅ Visible' : '👁️‍🗨️ Hidden'}
                </button>
              </div>
            );
          })}
        </div>

        <div 
          style={{
            marginTop: '30px',
            padding: '20px',
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: '8px'
          }}
        >
          <h4 style={{ color: '#f3f4f6', marginBottom: '10px' }}>💡 How It Works</h4>
          <ul style={{ color: '#9ca3af', lineHeight: '1.8', paddingLeft: '20px' }}>
            <li>Toggle tabs on/off to control their visibility in the main navigation</li>
            <li>Hidden tabs will not appear in the tab bar but their data is preserved</li>
            <li>Changes are saved to browser localStorage and persist across sessions</li>
            <li>This helps reduce clutter if you have many tabs enabled</li>
          </ul>
        </div>

        <div 
          style={{
            marginTop: '20px',
            padding: '15px',
            background: '#374151',
            border: '1px solid #4b5563',
            borderRadius: '6px',
            color: '#d1d5db',
            fontSize: '13px',
            fontFamily: 'Monaco, Courier New, monospace'
          }}
        >
          <strong>Current State:</strong> {JSON.stringify(tabVisibility, null, 2)}
        </div>
      </div>
    );
  };

  const renderSectionContent = () => {
    if (loading) {
      return (
        <div className="loading-spinner">
          Loading {adminSections.find(s => s.id === selectedSection)?.name}...
        </div>
      );
    }

    if (error) {
      return (
        <div className="error-message">
          <span>⚠️ {error}</span>
          <button onClick={() => loadSectionData(selectedSection)}>
            🔄 Retry
          </button>
        </div>
      );
    }

    if (!sectionData) {
      return (
        <div className="empty-state">
          <p>Select a section to view admin information.</p>
        </div>
      );
    }

    switch (selectedSection) {
      case 'system-overview':
        return renderSystemOverview(sectionData);
      case 'org-management':
        return renderOrgManagement();
      case 'component-data-status':
        return renderComponentDataStatus(sectionData);
      case 'sobject-field-cache':
        return renderSObjectFieldCache(sectionData);
      case 'session-info':
        return renderSessionInfo(sectionData);
      case 'environment-info':
        return renderEnvironmentInfo(sectionData);
      case 'redis-management':
        return renderRedisManagement(sectionData);
      case 'server-logs':
        return renderServerLogs(sectionData);
      case 'tab-visibility':
        return renderTabVisibility();
      default:
        return <div className="empty-state"><p>Unknown section selected.</p></div>;
    }
  };

  return (
    <div className="admin-console-container">
      <div className="admin-console-layout">
        {/* Left Panel - Admin Sections */}
        <div className="admin-left-panel">
          <div className="admin-panel-header">
            <h3>🛠️ Admin Console</h3>
            <p>System monitoring and management tools</p>
          </div>

          <div className="admin-sections-list">
            {adminSections.map((section) => (
              <div
                key={section.id}
                className={`admin-section-item ${selectedSection === section.id ? 'selected' : ''}`}
                onClick={() => setSelectedSection(section.id)}
              >
                <div className="section-icon">{section.icon}</div>
                <div className="section-info">
                  <div className="section-name">{section.name}</div>
                  <div className="section-description">{section.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel - Section Details */}
        <div className="admin-right-panel">
          {renderSectionContent()}
        </div>
      </div>

      {/* Full-Screen Modal Diff Viewer */}
      {renderDiffViewer()}
      
      {/* Add Org Modal */}
      {renderAddOrgModal()}
    </div>
  );
};

export default AdminConsoleTab;
