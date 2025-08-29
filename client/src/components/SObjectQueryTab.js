import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const SObjectQueryTab = ({ selectedSObject }) => {
  const [queryCondition, setQueryCondition] = useState('');
  const [queryResults, setQueryResults] = useState(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState(null);

  // SOQL Query Functions - Use useCallback to prevent unnecessary re-renders
  const executeSOQLQuery = useCallback(async (condition = '') => {
    if (!selectedSObject) return;
    
    setQueryLoading(true);
    setQueryError(null);
    
    try {
      const response = await axios.get(`/api/sobjects/${selectedSObject.name}/query`, {
        params: condition.trim() ? { condition: condition.trim() } : {}
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
  }, [selectedSObject]);

  const handleQueryConditionChange = (e) => {
    setQueryCondition(e.target.value);
  };

  const handleQuerySubmit = (e) => {
    e.preventDefault();
    executeSOQLQuery(queryCondition);
  };

  // Load default records when component mounts or selectedSObject changes
  useEffect(() => {
    if (selectedSObject) {
      setQueryResults(null);
      setQueryCondition('');
      setQueryError(null);
      executeSOQLQuery(); // Load default records without condition
    }
  }, [selectedSObject, executeSOQLQuery]);

  if (!selectedSObject) {
    return (
      <div className="no-selection-placeholder">
        <p>Select an SObject to query records</p>
      </div>
    );
  }

  return (
    <div className="soql-query-content">
      {/* Query Condition Input */}
      <div className="query-section">
        <h4>🔍 Query Records</h4>
        <form onSubmit={handleQuerySubmit} className="query-form">
          <div className="condition-input-group">
            <label htmlFor="queryCondition">Condition (optional):</label>
            <input
              id="queryCondition"
              type="text"
              value={queryCondition}
              onChange={handleQueryConditionChange}
              placeholder="e.g., Name = 'Account Name' or Name LIKE '%Test%'"
              className="condition-input"
              disabled={queryLoading}
            />
            <div className="condition-help">
              <small>
                💡 Examples: <code>Name = 'Test Account'</code>, <code>CreatedDate = TODAY</code>, <code>Name LIKE '%Corp%'</code>
              </small>
            </div>
          </div>
          <div className="query-actions">
            <button 
              type="submit" 
              className="query-button"
              disabled={queryLoading}
            >
              {queryLoading ? '⏳ Querying...' : '🔍 Query Records'}
            </button>
            {queryCondition && (
              <button 
                type="button" 
                className="clear-condition-button"
                onClick={() => {
                  setQueryCondition('');
                  executeSOQLQuery();
                }}
                disabled={queryLoading}
              >
                🗑️ Clear & Show All
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Query Results */}
      <div className="query-results-section">
        {queryLoading && (
          <div className="loading-query">
            ⏳ Executing query...
          </div>
        )}

        {queryError && (
          <div className="error-query">
            <p>⚠️ Query Error:</p>
            <p>{queryError}</p>
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
                  <span className="executed-soql">
                    <strong>SOQL:</strong> <code>{queryResults.soql}</code>
                  </span>
                </div>
            </div>
            
            {queryResults.records && queryResults.records.length > 0 ? (
              <div className="results-table-container">
                <table className="results-table">
                  <thead>
                    <tr>
                      {queryResults.fields?.map(field => (
                        <th key={field}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResults.records.map((record, index) => (
                      <tr key={record.Id || index}>
                        {queryResults.fields?.map(field => (
                          <td key={field}>
                            {record[field] !== undefined && record[field] !== null 
                              ? (typeof record[field] === 'object' 
                                  ? JSON.stringify(record[field]) 
                                  : String(record[field]))
                              : ''
                            }
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="no-results">
                <p>No records found matching the criteria.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SObjectQueryTab;
