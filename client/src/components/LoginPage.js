import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './LoginPage.css';

const LoginPage = ({ onLoginSuccess }) => {
  const [availableOrgs, setAvailableOrgs] = useState({});
  const [selectedOrgKey, setSelectedOrgKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [error, setError] = useState('');

  // Fetch available orgs on component mount
  useEffect(() => {
    fetchAvailableOrgs();
  }, []);

  const fetchAvailableOrgs = async () => {
    setLoadingOrgs(true);
    try {
      const response = await axios.get('/api/auth/orgs');
      if (response.data.success) {
        setAvailableOrgs(response.data.orgs);
        // Auto-select first org if available
        const orgKeys = Object.keys(response.data.orgs);
        if (orgKeys.length > 0) {
          setSelectedOrgKey(orgKeys[0]);
        }
      }
    } catch (error) {
      setError('Failed to load organization list: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoadingOrgs(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (!selectedOrgKey) {
      setError('Please select an organization');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await axios.post('/api/auth/salesforce/login', {
        orgKey: selectedOrgKey
      }, {
        withCredentials: true
      });

      if (response.data.success) {
        // Check if this is client credential flow (direct login)
        if (response.data.authType === 'clientCredential') {
          console.log('✅ [LOGIN] Client credential authentication successful');
          // Direct login successful - no popup needed
          onLoginSuccess(response.data.user);
        } else {
          // Authorization code flow - open Salesforce login in a popup window
          const popup = window.open(
            response.data.authUrl, 
            'salesforce-login',
            'width=600,height=700,scrollbars=yes,resizable=yes'
          );

          // Poll for popup closure
          const pollTimer = setInterval(() => {
            try {
              if (popup.closed) {
                clearInterval(pollTimer);
                // Check if authentication was successful
                checkAuthStatus();
              }
            } catch (error) {
              // Popup might be cross-origin, ignore errors
            }
          }, 1000);
        }
      } else {
        setError('Failed to initiate Salesforce login');
      }
    } catch (error) {
      setError(error.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const checkAuthStatus = async () => {
    try {
      const response = await axios.get('/api/auth/user', {
        withCredentials: true
      });
      
      if (response.data.success) {
        onLoginSuccess(response.data.user);
      }
    } catch (error) {
      setError('Authentication failed. Please try again.');
    }
  };

  // Listen for auth success from callback
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth') === 'success') {
      checkAuthStatus();
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('error')) {
      setError('Authentication failed. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return (
    <div className="login-container">
      {/* Cute Agentforce Robot Decorations */}
      <div className="agentforce-decoration robot-1">🤖</div>
      <div className="agentforce-decoration robot-2">🧠</div>
      <div className="agentforce-decoration robot-3">⚡</div>
      <div className="agentforce-decoration robot-4">✨</div>
      
      <div className="login-card">
        <h1>🤖 Salesforce Explorer</h1>
        <p>Connect to your Salesforce org and unleash the power of Agentforce</p>
        
        {loadingOrgs ? (
          <div className="loading-orgs">
            <div className="loading-spinner">🔄</div>
            <p>Loading available organizations...</p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label htmlFor="orgSelection">Select Salesforce Organization:</label>
              {Object.keys(availableOrgs).length > 0 ? (
                <select
                  id="orgSelection"
                  value={selectedOrgKey}
                  onChange={(e) => setSelectedOrgKey(e.target.value)}
                  className="form-select"
                >
                  <option value="">-- Select Organization --</option>
                  {Object.entries(availableOrgs).map(([orgKey, org]) => (
                    <option key={orgKey} value={orgKey}>
                      {org.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="no-orgs-message">
                  <p>⚠️ No organizations are configured.</p>
                  <p>Please check your server configuration.</p>
                </div>
              )}
            </div>

            {selectedOrgKey && availableOrgs[selectedOrgKey] && (
              <div className="org-info">
                <h4>Selected Organization:</h4>
                <div className="org-details">
                  <p><strong>Name:</strong> {availableOrgs[selectedOrgKey].name}</p>
                  <p><strong>URL:</strong> {availableOrgs[selectedOrgKey].url}</p>
                </div>
              </div>
            )}

            {error && (
              <div className="error-message">
                ⚠️ {error}
              </div>
            )}

            <button 
              type="submit" 
              className="login-button"
              disabled={loading || !selectedOrgKey || Object.keys(availableOrgs).length === 0}
            >
              {loading ? 'Connecting...' : '🚀 Connect to Salesforce'}
            </button>
          </form>
        )}

        <div className="info-section">
          <h3>ℹ️ Multi-Org Setup</h3>
          <ul>
            <li>Organizations are pre-configured on the server</li>
            <li>Each org has its own Connected App credentials</li>
            <li>Select your target org from the dropdown above</li>
            <li>Contact your administrator to add new organizations</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
