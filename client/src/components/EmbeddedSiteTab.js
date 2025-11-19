import React, { useEffect, useRef } from 'react';
import './EmbeddedSiteTab.css';

const EmbeddedSiteTab = () => {
  const initRef = useRef(false);

  useEffect(() => {
    // Prevent double initialization
    if (initRef.current) return;
    initRef.current = true;

    console.log('🚀 [EMBEDDED-SITE] Initializing embedded messaging...');

    // Clean up any existing embedded messaging instances
    if (window.embeddedservice_bootstrap) {
      console.log('⚠️ [EMBEDDED-SITE] Cleaning up existing embedded messaging instance');
      // Remove any existing embedded messaging elements
      const existingElements = document.querySelectorAll('[id^="esw"]');
      existingElements.forEach(el => el.remove());
    }

    // Load the bootstrap script
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://orgfarm-80191db225.my.site.com/ESWFDE011763545810631/assets/js/bootstrap.min.js';
    script.async = true;
    
    script.onload = () => {
      console.log('✅ [EMBEDDED-SITE] Bootstrap script loaded successfully');
      
      // Initialize embedded messaging after script loads
      try {
        if (window.embeddedservice_bootstrap) {
          window.embeddedservice_bootstrap.settings.language = 'en_US'; // For example, enter 'en' or 'en-US'

          window.embeddedservice_bootstrap.init(
            '00DgL00000EuD9X',
            'FDE01',
            'https://orgfarm-80191db225.my.site.com/ESWFDE011763545810631',
            {
              scrt2URL: 'https://orgfarm-80191db225.my.salesforce-scrt.com'
            }
          );
          
          console.log('✅ [EMBEDDED-SITE] Embedded messaging initialized successfully');
        } else {
          console.error('❌ [EMBEDDED-SITE] embeddedservice_bootstrap not available after script load');
        }
      } catch (err) {
        console.error('❌ [EMBEDDED-SITE] Error loading Embedded Messaging:', err);
      }
    };

    script.onerror = (error) => {
      console.error('❌ [EMBEDDED-SITE] Failed to load bootstrap script:', error);
    };

    document.body.appendChild(script);

    // Cleanup function
    return () => {
      console.log('🧹 [EMBEDDED-SITE] Cleaning up embedded messaging...');
      
      // Remove the script tag
      const scripts = document.querySelectorAll('script[src*="bootstrap.min.js"]');
      scripts.forEach(s => s.remove());
      
      // Remove any embedded messaging elements
      const embeddedElements = document.querySelectorAll('[id^="esw"]');
      embeddedElements.forEach(el => el.remove());
      
      // Clear window references
      if (window.embeddedservice_bootstrap) {
        delete window.embeddedservice_bootstrap;
      }
      
      initRef.current = false;
    };
  }, []);

  return (
    <div className="embedded-site-container">
      <div className="embedded-site-header">
        <h2>🌐 Embedded Messaging Site</h2>
        <p className="embedded-site-description">
          This page demonstrates Salesforce Embedded Messaging integration. 
          The chat widget should appear in the bottom right corner of the screen.
        </p>
      </div>

      <div className="embedded-site-content">
        <div className="info-card">
          <h3>📋 Configuration Details</h3>
          <div className="config-grid">
            <div className="config-row">
              <div className="config-label">Org ID:</div>
              <div className="config-value">00DgL00000EuD9X</div>
            </div>
            <div className="config-row">
              <div className="config-label">Deployment ID:</div>
              <div className="config-value">FDE01</div>
            </div>
            <div className="config-row">
              <div className="config-label">Site URL:</div>
              <div className="config-value">https://orgfarm-80191db225.my.site.com/ESWFDE011763545810631</div>
            </div>
            <div className="config-row">
              <div className="config-label">SCRT2 URL:</div>
              <div className="config-value">https://orgfarm-80191db225.my.salesforce-scrt.com</div>
            </div>
          </div>
        </div>

        <div className="info-card">
          <h3>💡 How to Use</h3>
          <ul className="usage-list">
            <li>Look for the chat widget in the bottom right corner</li>
            <li>Click the widget to start a conversation</li>
            <li>The widget connects to your Salesforce Embedded Service deployment</li>
            <li>You can interact with the agent configured for this deployment</li>
          </ul>
        </div>

        <div className="info-card status-card">
          <h3>⚠️ Setup Required</h3>
          <p style={{ color: '#f59e0b', fontWeight: '600', marginBottom: '15px' }}>
            If you see CORS or CSP errors in the console, you need to configure allowed domains.
          </p>
          <div style={{ textAlign: 'left', background: '#111827', padding: '15px', borderRadius: '6px', marginTop: '15px' }}>
            <p style={{ color: '#e5e7eb', fontWeight: '600', marginBottom: '10px' }}>📋 Setup Steps:</p>
            <ol style={{ color: '#9ca3af', lineHeight: '1.8', paddingLeft: '20px' }}>
              <li>Go to Salesforce Setup → "Embedded Service Deployments"</li>
              <li>Find deployment: <code style={{ color: '#60a5fa' }}>FDE01</code></li>
              <li>Add these domains to "Allowed Domains":
                <ul style={{ marginTop: '8px' }}>
                  <li><code style={{ color: '#10b981' }}>http://localhost:3000</code></li>
                  <li><code style={{ color: '#10b981' }}>http://127.0.0.1:3000</code></li>
                  <li><code style={{ color: '#10b981' }}>http://localhost:5001</code></li>
                </ul>
              </li>
              <li>Save and wait 2-3 minutes for changes to propagate</li>
              <li>Refresh this page</li>
            </ol>
          </div>
          <p className="status-hint" style={{ marginTop: '15px' }}>
            Check the browser console for detailed initialization logs.
          </p>
        </div>
      </div>
    </div>
  );
};

export default EmbeddedSiteTab;

