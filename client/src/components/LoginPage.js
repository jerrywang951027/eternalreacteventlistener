import React, { useState } from 'react';
import axios from 'axios';
import './LoginPage.css';

const LoginPage = ({ onLoginSuccess }) => {
  const [orgType, setOrgType] = useState('production');
  const [customUrl, setCustomUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (orgType === 'custom' && !customUrl) {
      setError('Please enter a custom URL');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await axios.post('/api/auth/salesforce/login', {
        orgType,
        customUrl: orgType === 'custom' ? customUrl : undefined
      }, {
        withCredentials: true
      });

      if (response.data.success) {
        // Open Salesforce login in a popup window
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
      <div className="login-card">
        <h1>🔗 Eternal React Event Listener</h1>
        <p>Connect to your Salesforce org to listen for platform events</p>
        
        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label htmlFor="orgType">Salesforce Org Type:</label>
            <select
              id="orgType"
              value={orgType}
              onChange={(e) => setOrgType(e.target.value)}
              className="form-select"
            >
              <option value="production">Production</option>
              <option value="sandbox">Sandbox</option>
              <option value="custom">Custom URL</option>
            </select>
          </div>

          {orgType === 'custom' && (
            <div className="form-group">
              <label htmlFor="customUrl">Custom Salesforce URL:</label>
              <input
                id="customUrl"
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://your-domain.my.salesforce.com"
                className="form-input"
                required={orgType === 'custom'}
              />
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
            disabled={loading}
          >
            {loading ? 'Connecting...' : '🚀 Connect to Salesforce'}
          </button>
        </form>

        <div className="info-section">
          <h3>ℹ️ Setup Requirements</h3>
          <ul>
            <li>Create a Connected App in Salesforce Setup</li>
            <li>Enable OAuth Settings with callback URL: <code>http://localhost:5000/api/auth/salesforce/callback</code></li>
            <li>Grant API permissions</li>
            <li>Add your Client ID and Secret to server environment variables</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
