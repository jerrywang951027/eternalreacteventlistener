import React, { useState } from 'react';
import axios from 'axios';

const FreeSOQLEditorTab = () => {
  const [soqlQuery, setSoqlQuery] = useState('');
  const [queryResults, setQueryResults] = useState(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState(null);
  const [executedQuery, setExecutedQuery] = useState('');

  const executeSOQLQuery = async () => {
    if (!soqlQuery.trim()) {
      setQueryError('Please enter a SOQL query');
      return;
    }

    setQueryLoading(true);
    setQueryError(null);
    setQueryResults(null);
    setExecutedQuery(soqlQuery.trim());

    try {
      const response = await axios.post('/api/sobjects/execute-soql', {
        query: soqlQuery.trim()
      }, {
        withCredentials: true
      });

      if (response.data.success) {
        setQueryResults(response.data);
      } else {
        setQueryError(response.data.message || 'Failed to execute query');
      }
    } catch (error) {
      console.error('Error executing SOQL query:', error);
      setQueryError(error.response?.data?.message || 'Failed to execute query');
    } finally {
      setQueryLoading(false);
    }
  };

  const handleQueryChange = (e) => {
    setSoqlQuery(e.target.value);
  };

  const handleClearQuery = () => {
    setSoqlQuery('');
    setQueryResults(null);
    setQueryError(null);
    setExecutedQuery('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      executeSOQLQuery();
    }
  };

  const formatFieldValue = (value) => {
    if (value === null || value === undefined) {
      return '';
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    
    return String(value);
  };

  return (
    <div className="free-soql-editor-content">
      {/* SOQL Editor Section */}
      <div className="soql-editor-section">
        <h4>✏️ Free SOQL Editor</h4>
        <div className="editor-container">
          <textarea
            value={soqlQuery}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Enter your SOQL query here...&#10;&#10;Examples:&#10;SELECT Id, Name, CreatedDate FROM Account LIMIT 10&#10;SELECT Id, Name, Email FROM Contact WHERE Name LIKE '%Test%'&#10;SELECT Id, Name, Amount FROM Opportunity WHERE StageName = 'Closed Won'"
            className="soql-editor"
            rows={8}
            disabled={queryLoading}
          />
          <div className="editor-help">
            <small>
              💡 <strong>Tips:</strong> Press Ctrl+Enter (or Cmd+Enter on Mac) to execute the query
            </small>
          </div>
        </div>
        
        <div className="editor-actions">
          <button 
            onClick={executeSOQLQuery}
            className="execute-button"
            disabled={queryLoading || !soqlQuery.trim()}
          >
            {queryLoading ? '⏳ Executing...' : '▶️ Execute Query'}
          </button>
          <button 
            onClick={handleClearQuery}
            className="clear-button"
            disabled={queryLoading}
          >
            🗑️ Clear
          </button>
        </div>
      </div>

      {/* Query Results Section */}
      <div className="query-results-section">
        {queryLoading && (
          <div className="loading-query">
            ⏳ Executing SOQL query...
            <div className="loading-note">
              <small>Large queries may take time as we retrieve all records in batches</small>
            </div>
            <div className="loading-progress">
              <div className="progress-bar">
                <div className="progress-fill"></div>
              </div>
              <small>Retrieving records in batches...</small>
            </div>
          </div>
        )}

        {queryError && (
          <div className="error-query">
            <p>⚠️ Query Error:</p>
            <p>{queryError}</p>
          </div>
        )}

        {executedQuery && !queryLoading && (
          <div className="executed-query-info">
            <h5>📋 Executed Query:</h5>
            <div className="query-display">
              <code>{executedQuery}</code>
            </div>
          </div>
        )}

        {queryResults && !queryLoading && (
          <div className="query-results">
            <div className="results-header">
              <h5>📊 Query Results</h5>
              <div className="results-meta">
                <span className="results-count">
                  {queryResults.records?.length || 0} records
                  {queryResults.totalSize > 20 && ` (of ${queryResults.totalSize} total)`}
                </span>
                {queryResults.batchesRetrieved > 1 && (
                  <span className="batches-info">
                    📦 {queryResults.batchesRetrieved} batches retrieved
                  </span>
                )}
                {queryResults.isComplete !== undefined && (
                  <span className="query-complete">
                    {queryResults.isComplete ? '✅ Complete' : '⏳ Partial Results'}
                  </span>
                )}
              </div>
            </div>
            
            {queryResults.records && queryResults.records.length > 0 ? (
              <div className="results-table-container">
                <table className="results-table">
                  <thead>
                    <tr>
                      {Object.keys(queryResults.records[0]).map(field => (
                        <th key={field}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResults.records.map((record, index) => (
                      <tr key={record.Id || index}>
                        {Object.keys(queryResults.records[0]).map(field => (
                          <td key={field} className="field-value">
                            {formatFieldValue(record[field])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="no-results">
                <p>No records found matching the query criteria.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FreeSOQLEditorTab;
