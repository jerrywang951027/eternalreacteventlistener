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
          <div className="config-item">
            <span className="config-label">Org ID:</span>
            <span className="config-value">00DgL00000EuD9X</span>
          </div>
          <div className="config-item">
            <span className="config-label">Deployment ID:</span>
            <span className="config-value">FDE01</span>
          </div>
          <div className="config-item">
            <span className="config-label">Site URL:</span>
            <span className="config-value">https://orgfarm-80191db225.my.site.com/ESWFDE011763545810631</span>
          </div>
          <div className="config-item">
            <span className="config-label">SCRT2 URL:</span>
            <span className="config-value">https://orgfarm-80191db225.my.salesforce-scrt.com</span>
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
          <h3>✅ Status</h3>
          <p>Embedded messaging is initializing...</p>
          <p className="status-hint">Check the browser console for detailed initialization logs.</p>
        </div>
      </div>
    </div>
  );
};

export default EmbeddedSiteTab;

