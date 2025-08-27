import React, { useEffect, useRef } from 'react';
import './SwaggerTab.css';

const SwaggerTab = () => {
  const iframeRef = useRef(null);

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
          src="http://localhost:5000/api-docs"
          title="API Documentation"
          className="swagger-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    </div>
  );
};

export default SwaggerTab;
