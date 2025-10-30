import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { format } from 'sql-formatter';
import './DataCloudQueryTab.css';

const DataCloudQueryTab = ({ persistedState, onStateChange }) => {
  // Initialize from persisted state or defaults
  const [isConnected, setIsConnected] = useState(persistedState?.isConnected || false);
  const [connecting, setConnecting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState(persistedState?.error || '');
  const [sqlQuery, setSqlQuery] = useState(persistedState?.sqlQuery || '');
  const [queryResult, setQueryResult] = useState(persistedState?.queryResult || null);
  const [isQueryEditorCollapsed, setIsQueryEditorCollapsed] = useState(false);
  const [isQueryResultCollapsed, setIsQueryResultCollapsed] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [copiedCell, setCopiedCell] = useState(null);
  const [highlightedSql, setHighlightedSql] = useState('');
  const [sortConfig, setSortConfig] = useState({ column: null, direction: 'asc' });
  const resizingColumn = useRef(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Sync state changes back to parent for persistence
  useEffect(() => {
    if (onStateChange) {
      onStateChange({
        isConnected,
        sqlQuery,
        queryResult,
        error
      });
    }
  }, [isConnected, sqlQuery, queryResult, error, onStateChange]);

  // Check if already connected to Data Cloud on mount
  useEffect(() => {
    checkConnectionStatus();
  }, []);

  const checkConnectionStatus = async () => {
    try {
      const response = await axios.get('/api/datacloud/status', {
        withCredentials: true
      });
      
      if (response.data.success && response.data.connected) {
        setIsConnected(true);
      }
    } catch (err) {
      console.error('Failed to check connection status:', err);
    }
  };

  const handleConnectDataCloud = async () => {
    setConnecting(true);
    setError('');
    
    try {
      const response = await axios.post('/api/datacloud/connect', {}, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setIsConnected(true);
        setError('');
      } else {
        setError(response.data.message || 'Failed to connect to Data Cloud');
      }
    } catch (err) {
      setError('Failed to connect to Data Cloud: ' + (err.response?.data?.message || err.message));
    } finally {
      setConnecting(false);
    }
  };

  const handleExecuteQuery = async () => {
    if (!sqlQuery.trim()) {
      setError('Please enter a SQL query');
      return;
    }

    setExecuting(true);
    setError('');
    
    try {
      const response = await axios.post('/api/datacloud/query', {
        sql: sqlQuery
      }, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setQueryResult(response.data.result);
        setError('');
        // Auto-expand query result section
        setIsQueryResultCollapsed(false);
        // Initialize column widths with custom sizes for specific columns
        initializeColumnWidths(response.data.result.metadata);
      } else {
        setError(response.data.message || 'Failed to execute query');
        setQueryResult(null);
      }
    } catch (err) {
      setError('Failed to execute query: ' + (err.response?.data?.message || err.message));
      setQueryResult(null);
    } finally {
      setExecuting(false);
    }
  };

  const initializeColumnWidths = (metadata) => {
    const widths = {};
    Object.keys(metadata).forEach(columnName => {
      // Set custom widths for specific columns
      if (columnName === 'Prompt') {
        widths[columnName] = 600; // Larger width for Prompt
      } else if (columnName === 'Response Text') {
        widths[columnName] = 200; // Smaller width for Response Text
      } else {
        widths[columnName] = 150; // Default width
      }
    });
    setColumnWidths(widths);
  };

  const handleMouseDown = (e, columnName) => {
    e.preventDefault();
    resizingColumn.current = columnName;
    startX.current = e.pageX;
    startWidth.current = columnWidths[columnName] || 150;
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!resizingColumn.current) return;
    
    const diff = e.pageX - startX.current;
    const newWidth = Math.max(50, startWidth.current + diff); // Minimum width of 50px
    
    setColumnWidths(prev => ({
      ...prev,
      [resizingColumn.current]: newWidth
    }));
  };

  const handleMouseUp = () => {
    resizingColumn.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleSort = (columnName) => {
    let direction = 'asc';
    if (sortConfig.column === columnName && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ column: columnName, direction });
  };

  const renderTableHeaders = () => {
    if (!queryResult || !queryResult.metadata) return null;

    // Sort metadata by placeInOrder
    const sortedMetadata = Object.entries(queryResult.metadata).sort(
      ([, a], [, b]) => a.placeInOrder - b.placeInOrder
    );

    return (
      <tr>
        {sortedMetadata.map(([columnName]) => (
          <th 
            key={columnName}
            style={{ 
              width: columnWidths[columnName] || 150,
              position: 'relative'
            }}
            onClick={() => handleSort(columnName)}
            className="sortable-header"
          >
            <div className="th-content">
              <span>{columnName}</span>
              {sortConfig.column === columnName && (
                <span className="sort-indicator">
                  {sortConfig.direction === 'asc' ? ' ▲' : ' ▼'}
                </span>
              )}
              <div 
                className="column-resizer"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleMouseDown(e, columnName);
                }}
              />
            </div>
          </th>
        ))}
      </tr>
    );
  };

  const handleFormatSql = () => {
    if (!sqlQuery) return;
    
    try {
      // Use sql-formatter library for professional formatting
      const formatted = format(sqlQuery, {
        language: 'sql',
        indent: '  ', // 2 spaces
        uppercase: true, // Keywords in uppercase
        linesBetweenQueries: 2,
      });
      
      setSqlQuery(formatted);
      highlightSql(formatted);
    } catch (error) {
      console.error('Failed to format SQL:', error);
      // If formatting fails, just keep the original query
      setError('Failed to format SQL: ' + error.message);
    }
  };

  const highlightSql = (sql) => {
    if (!sql) {
      setHighlightedSql('');
      return;
    }

    const keywords = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|AS|ORDER BY|GROUP BY|HAVING|LIMIT|OFFSET|DISTINCT|COUNT|SUM|AVG|MAX|MIN|CASE|WHEN|THEN|ELSE|END|IN|NOT|NULL|IS|BETWEEN|LIKE|EXISTS)\b/gi;
    const strings = /('[^']*'|"[^"]*")/g;
    const numbers = /\b\d+\b/g;
    const comments = /(--[^\n]*)/g;
    
    let highlighted = sql
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(keywords, '<span class="sql-keyword">$1</span>')
      .replace(strings, '<span class="sql-string">$1</span>')
      .replace(numbers, '<span class="sql-number">$1</span>')
      .replace(comments, '<span class="sql-comment">$1</span>');
    
    setHighlightedSql(highlighted);
  };

  useEffect(() => {
    highlightSql(sqlQuery);
  }, [sqlQuery]);

  const handleCopyToClipboard = async (content, rowIndex, columnName) => {
    try {
      // Get the raw text content (remove surrounding quotes if present)
      let textToCopy = content;
      if (typeof textToCopy === 'string') {
        textToCopy = textToCopy.replace(/^"(.*)"$/s, '$1');
      }
      
      await navigator.clipboard.writeText(textToCopy);
      
      // Show feedback
      const cellId = `${rowIndex}-${columnName}`;
      setCopiedCell(cellId);
      
      // Clear feedback after 2 seconds
      setTimeout(() => {
        setCopiedCell(null);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const isJsonString = (str) => {
    if (typeof str !== 'string') return false;
    try {
      const parsed = JSON.parse(str);
      return typeof parsed === 'object' && parsed !== null;
    } catch (e) {
      return false;
    }
  };

  const renderCellContent = (cellValue, columnName) => {
    if (cellValue === null || cellValue === undefined) return '';
    
    // Remove surrounding quotes if present
    let processedValue = cellValue;
    if (typeof processedValue === 'string') {
      processedValue = processedValue.replace(/^"(.*)"$/s, '$1');
    }
    
    // Check if the value is JSON
    const isJson = isJsonString(processedValue);
    
    if (isJson) {
      try {
        const parsed = JSON.parse(processedValue);
        const beautified = JSON.stringify(parsed, null, 2);
        return (
          <pre className="cell-content json-content">{beautified}</pre>
        );
      } catch (e) {
        // If beautification fails, show as-is
        return <pre className="cell-content">{processedValue}</pre>;
      }
    }
    
    // Check if the value contains newlines (multiline text)
    const hasNewlines = typeof processedValue === 'string' && processedValue.includes('\n');
    
    if (hasNewlines) {
      return <pre className="cell-content">{processedValue}</pre>;
    }
    
    // Regular text
    return String(processedValue);
  };

  const renderTableRows = () => {
    if (!queryResult || !queryResult.data || !queryResult.metadata) return null;

    // Sort metadata by placeInOrder to get column order
    const sortedColumns = Object.entries(queryResult.metadata)
      .sort(([, a], [, b]) => a.placeInOrder - b.placeInOrder)
      .map(([columnName]) => columnName);

    // Sort the data if sortConfig is set
    let sortedData = [...queryResult.data];
    if (sortConfig.column) {
      sortedData.sort((a, b) => {
        const aValue = a[sortConfig.column];
        const bValue = b[sortConfig.column];
        
        // Handle null/undefined
        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        
        // Compare values
        let comparison = 0;
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          comparison = aValue.localeCompare(bValue);
        } else if (typeof aValue === 'number' && typeof bValue === 'number') {
          comparison = aValue - bValue;
        } else {
          comparison = String(aValue).localeCompare(String(bValue));
        }
        
        return sortConfig.direction === 'asc' ? comparison : -comparison;
      });
    }

    return sortedData.map((row, rowIndex) => (
      <tr key={rowIndex}>
        {sortedColumns.map((columnName) => {
          const cellValue = row[columnName];
          const content = renderCellContent(cellValue, columnName);
          const isSpecialContent = typeof content === 'object'; // pre tag or other React element
          const needsCopyButton = columnName === 'Prompt' || columnName === 'Response Text';
          const cellId = `${rowIndex}-${columnName}`;
          const isCopied = copiedCell === cellId;
          
          return (
            <td 
              key={columnName} 
              className={`${isSpecialContent ? 'special-cell' : ''} ${needsCopyButton ? 'copyable-cell' : ''}`}
              style={{ 
                width: columnWidths[columnName] || 150,
                maxWidth: columnWidths[columnName] || 150
              }}
            >
              <div className="cell-wrapper">
                {content}
                {needsCopyButton && cellValue && (
                  <button
                    className={`copy-btn ${isCopied ? 'copied' : ''}`}
                    onClick={() => handleCopyToClipboard(cellValue, rowIndex, columnName)}
                    title="Copy to clipboard"
                  >
                    {isCopied ? '✓' : '📋'}
                  </button>
                )}
              </div>
            </td>
          );
        })}
      </tr>
    ));
  };

  return (
    <div className="datacloud-query-tab">
      <div className="tab-header">
        <h2>🌥️ Data Cloud Query</h2>
        <button
          className={`connect-btn ${isConnected ? 'connected' : ''}`}
          onClick={handleConnectDataCloud}
          disabled={connecting || isConnected}
        >
          {connecting ? '⏳ Connecting...' : isConnected ? '✅ Connected' : '🔌 Connect DataCloud'}
        </button>
      </div>

      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      {/* SQL Query Editor Section */}
      <div className={`section-container ${!isConnected ? 'disabled' : ''}`}>
        <div className="section-header">
          <div className="section-header-left" onClick={() => setIsQueryEditorCollapsed(!isQueryEditorCollapsed)}>
            <span className="collapse-icon">{isQueryEditorCollapsed ? '▶' : '▼'}</span>
            <h3>SQL Query Editor</h3>
          </div>
          <div className="section-header-actions">
            <button
              className="format-btn-header"
              onClick={(e) => {
                e.stopPropagation();
                handleFormatSql();
              }}
              disabled={!isConnected || !sqlQuery.trim()}
              title="Format SQL"
            >
              ✨ Format SQL
            </button>
            <button
              className="execute-btn-header"
              onClick={(e) => {
                e.stopPropagation();
                handleExecuteQuery();
              }}
              disabled={!isConnected || executing || !sqlQuery.trim()}
            >
              {executing ? '⏳ Executing...' : '▶️ Execute Query'}
            </button>
          </div>
        </div>
        {!isQueryEditorCollapsed && (
          <div className="section-content">
            <div className="sql-editor-container">
              <div 
                className="sql-highlighted" 
                dangerouslySetInnerHTML={{ __html: highlightedSql || '<span class="sql-placeholder">Enter your SQL query here...</span>' }}
                style={{ display: sqlQuery ? 'block' : 'block' }}
              />
              <textarea
                className="sql-editor"
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                placeholder="Enter your SQL query here..."
                disabled={!isConnected}
                rows={10}
                spellCheck="false"
              />
            </div>
          </div>
        )}
      </div>

      {/* Query Result Section */}
      <div className={`section-container query-result-section ${!isConnected ? 'disabled' : ''}`}>
        <div className="section-header">
          <div className="section-header-left" onClick={() => setIsQueryResultCollapsed(!isQueryResultCollapsed)}>
            <span className="collapse-icon">{isQueryResultCollapsed ? '▶' : '▼'}</span>
            <h3>Query Result</h3>
            {queryResult && (
              <span className="result-meta">
                ({queryResult.rowCount || 0} rows in {
                  queryResult.startTime && queryResult.endTime
                    ? `${((new Date(queryResult.endTime) - new Date(queryResult.startTime)) / 1000).toFixed(2)}s`
                    : '0s'
                })
              </span>
            )}
          </div>
          {queryResult && (
            <div className="result-header-info">
              <span className="result-header-item">Query ID: {queryResult.queryId}</span>
              <span className="result-header-item">Status: {queryResult.done ? '✅ Complete' : '⏳ In Progress'}</span>
              <span className="result-header-item">Rows: {queryResult.rowCount || 0}</span>
            </div>
          )}
        </div>
        {!isQueryResultCollapsed && (
          <div className="section-content">
            {queryResult ? (
              <div className="query-result-container">
                
                {queryResult.data && queryResult.data.length > 0 ? (
                  <div className="table-wrapper">
                    <table className="result-table">
                      <thead>
                        {renderTableHeaders()}
                      </thead>
                      <tbody>
                        {renderTableRows()}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="no-results">
                    No results found
                  </div>
                )}
              </div>
            ) : (
              <div className="no-results">
                Execute a query to see results
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DataCloudQueryTab;

