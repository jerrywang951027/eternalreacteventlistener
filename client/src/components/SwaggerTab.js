import React, { useEffect, useRef } from 'react';
import './SwaggerTab.css';

const SwaggerTab = () => {
  const iframeRef = useRef(null);

  // Dynamically determine the API docs URL based on environment
  const getApiDocsUrl = () => {
    // In production, use the current domain
    if (process.env.NODE_ENV === 'production') {
      return `${window.location.origin}/api-docs`;
    }
    // In development, use the server port
    return 'http://localhost:15000/api-docs';
  };

  useEffect(() => {
    // Focus the iframe when the tab loads
    if (iframeRef.current) {
      iframeRef.current.focus();
    }
  }, []);

  return (
    <div className="swagger-tab">
      <div className="swagger-content">
        <iframe
          ref={iframeRef}
          src={getApiDocsUrl()}
          title="API Documentation"
          className="swagger-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    </div>
  );
};

export default SwaggerTab;
