import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './AdminConsoleTab.css';

const AdminConsoleTab = ({ onTabLoad }) => {
  // State management
  const [selectedSection, setSelectedSection] = useState('system-overview');
  const [sectionData, setSectionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      id: 'component-data-status',
      name: 'Component Data Cache',
      description: 'Omnistudio component data cache per organization',
      icon: '💾',
      endpoint: '/api/admin/component-data-status'
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
      id: 'server-logs',
      name: 'Server Logs',
      description: 'Recent server log entries',
      icon: '📋',
      endpoint: '/api/admin/server-logs'
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

  const loadSectionData = async (sectionId) => {
    const section = adminSections.find(s => s.id === sectionId);
    if (!section) return;

    try {
      setLoading(true);
      setError('');
      
      const response = await axios.get(section.endpoint, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setSectionData(response.data.data);
        console.log(`✅ [ADMIN] Loaded ${sectionId}:`, response.data.data);
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
                <button 
                  onClick={() => clearOrgCache(orgId)}
                  className="clear-cache-btn"
                  disabled={loading}
                >
                  🗑️ Clear Cache
                </button>
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

  const renderServerLogs = (data) => (
    <div className="admin-section-content">
      <h3>📋 Server Logs</h3>
      
      <div className="logs-summary">
        <div className="summary-stat">
          <span className="stat-label">Log File:</span>
          <span className="stat-value">{data.logFile}</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Total Files:</span>
          <span className="stat-value">{data.totalLogFiles}</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Total Lines:</span>
          <span className="stat-value">{data.totalLines}</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Showing:</span>
          <span className="stat-value">{data.recentLines} recent lines</span>
        </div>
        
        <button 
          onClick={() => loadSectionData('server-logs')}
          className="refresh-logs-btn"
          disabled={loading}
        >
          🔄 Refresh Logs
        </button>
      </div>

      <div className="logs-container">
        {data.logs.length > 0 ? (
          data.logs.map((logLine, index) => (
            <div key={index} className="log-line">
              {logLine}
            </div>
          ))
        ) : (
          <div className="empty-state">
            <p>No log entries found.</p>
          </div>
        )}
      </div>
    </div>
  );

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
      case 'component-data-status':
        return renderComponentDataStatus(sectionData);
      case 'session-info':
        return renderSessionInfo(sectionData);
      case 'environment-info':
        return renderEnvironmentInfo(sectionData);
      case 'server-logs':
        return renderServerLogs(sectionData);
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
    </div>
  );
};

export default AdminConsoleTab;
