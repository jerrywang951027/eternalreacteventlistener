import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { format } from 'sql-formatter';
import './DataCloudQueryTab.css'; // Reuse the same CSS

const DataCloudV3QueryTab = ({ persistedState, onStateChange }) => {
  // Initialize from persisted state or defaults (no connection state needed)
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
  const [sqlEditorHeight, setSqlEditorHeight] = useState(persistedState?.sqlEditorHeight || 200); // Default height for SQL editor
  const [rowNumberWidth, setRowNumberWidth] = useState(persistedState?.rowNumberWidth || 40); // Default width for row number column
  const [savedQueries, setSavedQueries] = useState([]);
  const [selectedSavedQuery, setSelectedSavedQuery] = useState('');
  const resizingColumn = useRef(null);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const resizingVertical = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Load saved queries from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('dc_v3_saved_queries');
      if (stored) {
        const queries = JSON.parse(stored);
        setSavedQueries(queries);
      }
    } catch (error) {
      console.error('Error loading saved queries:', error);
    }
  }, []);

  // Sync state changes back to parent for persistence
  useEffect(() => {
    if (onStateChange) {
      onStateChange({
        sqlQuery,
        queryResult,
        error,
        sqlEditorHeight,
        rowNumberWidth
      });
    }
  }, [sqlQuery, queryResult, error, sqlEditorHeight, rowNumberWidth, onStateChange]);

  const handleExecuteQuery = async () => {
    if (!sqlQuery.trim()) {
      setError('Please enter a SQL query');
      return;
    }

    setExecuting(true);
    setError('');
    
    try {
      const response = await axios.post('/api/datacloud/v3/query', {
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
        initializeColumnWidths(response.data.result.metadata || response.data.result.columns);
      } else {
        setError(response.data.message || 'Failed to execute query');
        setQueryResult(null);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message;
      const errorDetails = err.response?.data?.details;
      setError(`Failed to execute query: ${errorMsg}${errorDetails ? ' - ' + JSON.stringify(errorDetails) : ''}`);
      setQueryResult(null);
    } finally {
      setExecuting(false);
    }
  };

  const initializeColumnWidths = (metadata) => {
    if (!metadata) return;
    
    const widths = {};
    const columns = Array.isArray(metadata) ? metadata : Object.keys(metadata);
    
    columns.forEach(column => {
      const columnName = typeof column === 'string' ? column : column.name;
      // Set custom widths for specific columns
      if (columnName === 'Prompt') {
        widths[columnName] = 600; // Larger width for Prompt
      } else if (columnName === 'Response Text') {
        widths[columnName] = 200; // Smaller width for Response Text
      } else if (columnName === 'content') {
        widths[columnName] = 400; // Medium width for content
      } else if (columnName === 'hybrid_score' || columnName.toLowerCase().includes('score')) {
        widths[columnName] = 80; // Narrow width for scores/numbers
      } else {
        widths[columnName] = 120; // Smaller default width
      }
    });
    setColumnWidths(widths);
  };

  const handleMouseDown = (e, columnName) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColumn.current = columnName;
    startX.current = e.pageX;
    
    // Handle row number column width separately
    if (columnName === '#') {
      startWidth.current = rowNumberWidth;
    } else {
      startWidth.current = columnWidths[columnName] || 120;
    }
    
    // Add class to body to prevent text selection during resize
    document.body.classList.add('resizing-column');
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!resizingColumn.current) return;
    
    const diff = e.pageX - startX.current;
    let minWidth = 20; // Minimum width of 20px for data columns
    
    // Row number column can be even smaller
    if (resizingColumn.current === '#') {
      minWidth = 20;
    }
    
    const newWidth = Math.max(minWidth, startWidth.current + diff);
    
    // Handle row number column width separately
    if (resizingColumn.current === '#') {
      setRowNumberWidth(newWidth);
    } else {
      setColumnWidths(prev => ({
        ...prev,
        [resizingColumn.current]: newWidth
      }));
    }
  };

  const handleMouseUp = () => {
    resizingColumn.current = null;
    
    // Remove class from body
    document.body.classList.remove('resizing-column');
    
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    return () => {
      document.body.classList.remove('resizing-column');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousemove', handleVerticalMouseMove);
      document.removeEventListener('mouseup', handleVerticalMouseUp);
    };
  }, []);

  // Vertical resize handlers
  const handleVerticalMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    resizingVertical.current = true;
    startY.current = e.pageY;
    startHeight.current = sqlEditorHeight;
    
    document.body.classList.add('resizing-vertical');
    
    document.addEventListener('mousemove', handleVerticalMouseMove);
    document.addEventListener('mouseup', handleVerticalMouseUp);
  };

  const handleVerticalMouseMove = (e) => {
    if (!resizingVertical.current) return;
    
    const diff = e.pageY - startY.current;
    const newHeight = Math.max(100, Math.min(600, startHeight.current + diff)); // Min 100px, Max 600px
    
    setSqlEditorHeight(newHeight);
  };

  const handleVerticalMouseUp = () => {
    resizingVertical.current = false;
    
    document.body.classList.remove('resizing-vertical');
    
    document.removeEventListener('mousemove', handleVerticalMouseMove);
    document.removeEventListener('mouseup', handleVerticalMouseUp);
  };

  const handleSort = (columnName) => {
    let direction = 'asc';
    if (sortConfig.column === columnName && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ column: columnName, direction });
  };

  const getColumns = () => {
    if (!queryResult) return [];
    
    // V3 API returns metadata as an array of objects with 'name' property
    // Example: [{name: "hybrid_score", type: "Numeric"}, {name: "content", type: "Varchar"}]
    if (queryResult.metadata && Array.isArray(queryResult.metadata)) {
      return queryResult.metadata.map(col => col.name);
    }
    
    // Fallback: check if metadata is an object with placeInOrder (V1 format)
    if (queryResult.metadata && typeof queryResult.metadata === 'object' && !Array.isArray(queryResult.metadata)) {
      return Object.entries(queryResult.metadata).sort(([, a], [, b]) => a.placeInOrder - b.placeInOrder).map(([name]) => name);
    }
    
    // Fallback: check for columns array
    if (queryResult.columns) {
      return queryResult.columns.map(col => typeof col === 'string' ? col : col.name);
    }
    
    // Last resort: extract from data keys
    if (queryResult.data && queryResult.data.length > 0) {
      return Object.keys(queryResult.data[0]);
    }
    
    return [];
  };

  const renderTableHeaders = () => {
    const columns = getColumns();
    if (columns.length === 0) return null;

    return (
      <tr>
        <th 
          key="#"
          style={{ 
            width: rowNumberWidth,
            position: 'relative',
            textAlign: 'center'
          }}
          className="row-number-header"
        >
          <div className="th-content">
            <span>#</span>
          </div>
          <div 
            className="column-resizer"
            onMouseDown={(e) => {
              e.stopPropagation();
              handleMouseDown(e, '#');
            }}
          />
        </th>
        {columns.map((columnName) => (
          <th 
            key={columnName}
            style={{ 
              width: columnWidths[columnName] || 120,
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
            </div>
            <div 
              className="column-resizer"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleMouseDown(e, columnName);
              }}
            />
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

  // Save current query to localStorage with auto-generated timestamp name
  const handleSaveQuery = () => {
    if (!sqlQuery.trim()) {
      alert('Please enter a SQL query to save');
      return;
    }

    try {
      const now = new Date();
      const timestamp = now.toLocaleString('en-US', { 
        month: '2-digit',
        day: '2-digit', 
        year: 'numeric',
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
      
      const newQuery = {
        id: Date.now().toString(),
        name: timestamp,
        sql: sqlQuery.trim(),
        createdAt: now.toISOString()
      };

      const updatedQueries = [...savedQueries, newQuery];
      setSavedQueries(updatedQueries);
      localStorage.setItem('dc_v3_saved_queries', JSON.stringify(updatedQueries));
      
      alert(`✅ Query saved as "${timestamp}"!`);
    } catch (error) {
      console.error('Error saving query:', error);
      alert('❌ Failed to save query. Please try again.');
    }
  };

  // Load a saved query
  const handleLoadQuery = (queryId) => {
    if (!queryId) return;
    
    const query = savedQueries.find(q => q.id === queryId);
    if (query) {
      setSqlQuery(query.sql);
      highlightSql(query.sql);
      setSelectedSavedQuery(queryId);
      setError('');
    }
  };

  // Delete a saved query
  const handleDeleteQuery = (queryId, e) => {
    if (e) {
      e.stopPropagation();
    }

    const query = savedQueries.find(q => q.id === queryId);
    if (!query) return;

    const sqlPreview = query.sql.substring(0, 100) + (query.sql.length > 100 ? '...' : '');
    if (!window.confirm(`Delete query from ${query.name}?\n\n${sqlPreview}`)) {
      return;
    }

    try {
      const updatedQueries = savedQueries.filter(q => q.id !== queryId);
      setSavedQueries(updatedQueries);
      localStorage.setItem('dc_v3_saved_queries', JSON.stringify(updatedQueries));
      
      if (selectedSavedQuery === queryId) {
        setSelectedSavedQuery('');
      }
    } catch (error) {
      console.error('Error deleting query:', error);
      alert('❌ Failed to delete query. Please try again.');
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
      } else if (typeof textToCopy === 'object') {
        textToCopy = JSON.stringify(textToCopy, null, 2);
      } else {
        textToCopy = String(textToCopy);
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
      setError('Failed to copy to clipboard: ' + err.message);
    }
  };

  const handleCopyResultAsJSON = async () => {
    try {
      const jsonString = JSON.stringify(queryResult, null, 2);
      await navigator.clipboard.writeText(jsonString);
      
      // Show temporary success message
      const originalError = error;
      setError('✅ Result copied as JSON to clipboard!');
      setTimeout(() => {
        setError(originalError);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy JSON to clipboard:', err);
      setError('Failed to copy JSON: ' + err.message);
    }
  };

  const handleExportToExcel = () => {
    try {
      const columns = getColumns();
      if (!queryResult || !queryResult.data || columns.length === 0) {
        setError('No data to export');
        return;
      }

      // Check if data is array of arrays (V3) or array of objects (V1)
      const isArrayOfArrays = Array.isArray(queryResult.data[0]);

      // Create CSV content
      let csvContent = '';
      
      // Add headers
      csvContent += columns.map(col => `"${col}"`).join(',') + '\n';
      
      // Add data rows
      queryResult.data.forEach(row => {
        const rowData = columns.map((col, index) => {
          const cellValue = isArrayOfArrays ? row[index] : row[col];
          
          // Handle different value types
          if (cellValue === null || cellValue === undefined) {
            return '""';
          }
          
          // Convert to string and escape quotes
          let value = String(cellValue);
          value = value.replace(/"/g, '""'); // Escape double quotes
          
          return `"${value}"`;
        });
        
        csvContent += rowData.join(',') + '\n';
      });

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      link.setAttribute('href', url);
      link.setAttribute('download', `datacloud_query_result_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
      link.style.visibility = 'hidden';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Show success message
      const originalError = error;
      setError('✅ Result exported to CSV file!');
      setTimeout(() => {
        setError(originalError);
      }, 2000);
    } catch (err) {
      console.error('Failed to export to Excel:', err);
      setError('Failed to export: ' + err.message);
    }
  };

  const handleCopySQLQuery = async () => {
    try {
      if (!sqlQuery.trim()) {
        setError('No SQL query to copy');
        return;
      }

      await navigator.clipboard.writeText(sqlQuery);
      
      // Show temporary success message
      const originalError = error;
      setError('✅ SQL query copied to clipboard!');
      setTimeout(() => {
        setError(originalError);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy SQL to clipboard:', err);
      setError('Failed to copy SQL: ' + err.message);
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
    if (!queryResult || !queryResult.data) return null;

    const columns = getColumns();
    if (columns.length === 0) return null;

    // Check if data is array of arrays (V3) or array of objects (V1)
    const isArrayOfArrays = Array.isArray(queryResult.data[0]);

    // Sort the data if sortConfig is set
    let sortedData = [...queryResult.data];
    if (sortConfig.column) {
      const columnIndex = columns.indexOf(sortConfig.column);
      sortedData.sort((a, b) => {
        const aValue = isArrayOfArrays ? a[columnIndex] : a[sortConfig.column];
        const bValue = isArrayOfArrays ? b[columnIndex] : b[sortConfig.column];
        
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
        <td 
          key="row-number"
          className="row-number-cell"
          style={{ 
            width: rowNumberWidth,
            minWidth: rowNumberWidth,
            maxWidth: rowNumberWidth,
            textAlign: 'center',
            fontWeight: '500',
            color: '#666',
            backgroundColor: '#f5f7fa',
            background: '#f5f7fa'
          }}
        >
          {rowIndex + 1}
        </td>
        {columns.map((columnName, columnIndex) => {
          // V3 API: data is array of arrays, access by index
          // V1 API: data is array of objects, access by key
          const cellValue = isArrayOfArrays ? row[columnIndex] : row[columnName];
          const content = renderCellContent(cellValue, columnName);
          const isSpecialContent = typeof content === 'object'; // pre tag or other React element
          const cellId = `${rowIndex}-${columnName}`;
          const isCopied = copiedCell === cellId;
          
          return (
            <td 
              key={columnName} 
              className={`${isSpecialContent ? 'special-cell' : ''} copyable-cell`}
              style={{ 
                width: columnWidths[columnName] || 120,
                maxWidth: columnWidths[columnName] || 120
              }}
            >
              <div className="cell-wrapper">
                {content}
                {cellValue != null && (
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

  const getResultMeta = () => {
    if (!queryResult) return { rowCount: 0, duration: '0ms', retrievedRows: 0, expectedRows: 0, rowsDisplay: '0 rows' };
    
    // Get retrieved rows (actual data returned)
    const retrievedRows = queryResult.returnedRows || queryResult.data?.length || 0;
    
    // Get expected total rows (from status.rowCount)
    const expectedRows = queryResult.status?.rowCount || retrievedRows;
    
    // Legacy rowCount for backward compatibility
    const rowCount = retrievedRows;
    
    // Create display string
    let rowsDisplay = '';
    if (expectedRows > retrievedRows) {
      // Show retrieved/expected if pagination incomplete
      rowsDisplay = `${retrievedRows.toLocaleString()}/${expectedRows.toLocaleString()} rows`;
    } else {
      // Show just the count if all rows retrieved
      rowsDisplay = `${retrievedRows.toLocaleString()} rows`;
    }
    
    let duration = '0ms';
    
    if (queryResult.queryTimeMills !== undefined && queryResult.queryTimeMills !== null) {
      // queryTimeMills is already in milliseconds
      duration = `${Math.round(queryResult.queryTimeMills)}ms`;
    } else if (queryResult.startTime && queryResult.endTime) {
      // Calculate from timestamps
      duration = `${Math.round(queryResult.endTime - queryResult.startTime)}ms`;
    }
    
    return { rowCount, duration, retrievedRows, expectedRows, rowsDisplay };
  };

  return (
    <div className="datacloud-query-tab">
      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      {/* SQL Query Editor Section */}
      <div className="section-container">
        <div className="section-header">
          <div className="section-header-left" onClick={() => setIsQueryEditorCollapsed(!isQueryEditorCollapsed)}>
            <span className="collapse-icon">{isQueryEditorCollapsed ? '▶' : '▼'}</span>
            <h3>SQL Query Editor</h3>
          </div>
          <div className="section-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Saved Queries Controls */}
            <select
              id="saved-queries-dropdown"
              value={selectedSavedQuery}
              onChange={(e) => handleLoadQuery(e.target.value)}
              className="saved-queries-dropdown-compact"
              disabled={savedQueries.length === 0}
              title="Load a saved query"
            >
              <option value="">
                {savedQueries.length === 0 ? '💾 No saved queries' : '💾 Saved queries...'}
              </option>
              {savedQueries.map(query => {
                // Show timestamp and first 60 chars of SQL
                const sqlPreview = query.sql.replace(/\s+/g, ' ').substring(0, 60) + (query.sql.length > 60 ? '...' : '');
                const displayText = `${query.name} - ${sqlPreview}`;
                return (
                  <option key={query.id} value={query.id} title={query.sql}>
                    {displayText}
                  </option>
                );
              })}
            </select>
            {selectedSavedQuery && (
              <button
                className="delete-query-btn-compact"
                onClick={(e) => handleDeleteQuery(selectedSavedQuery, e)}
                title="Delete selected query"
              >
                🗑️
              </button>
            )}
            <button
              className="save-query-btn-compact"
              onClick={handleSaveQuery}
              disabled={!sqlQuery.trim()}
              title="Save current query"
            >
              💾
            </button>
            <button
              className="copy-sql-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleCopySQLQuery();
              }}
              disabled={!sqlQuery.trim()}
              title="Copy SQL to clipboard"
            >
              📋 Copy SQL
            </button>
            <button
              className="format-btn-header"
              onClick={(e) => {
                e.stopPropagation();
                handleFormatSql();
              }}
              disabled={!sqlQuery.trim()}
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
              disabled={executing || !sqlQuery.trim()}
            >
              {executing ? '⏳ Executing...' : '▶️ Execute Query'}
            </button>
          </div>
        </div>
        {!isQueryEditorCollapsed && (
          <div className="section-content" style={{ height: `${sqlEditorHeight}px` }}>
            <div className="sql-editor-container" style={{ height: '100%' }}>
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
                rows={10}
                spellCheck="false"
              />
            </div>
          </div>
        )}
      </div>

      {/* Vertical Resizer - Always show for resizing */}
      <div 
        className="vertical-resizer"
        onMouseDown={handleVerticalMouseDown}
        title="Drag to resize SQL Editor and Query Result sections"
        style={{ display: isQueryEditorCollapsed ? 'none' : 'flex' }}
      >
        <div className="vertical-resizer-line"></div>
      </div>

      {/* Query Result Section */}
      <div 
        className="section-container query-result-section"
      >
        <div className="section-header">
          <div className="section-header-left" onClick={() => setIsQueryResultCollapsed(!isQueryResultCollapsed)}>
            <span className="collapse-icon">{isQueryResultCollapsed ? '▶' : '▼'}</span>
            <h3>Query Result</h3>
            {queryResult && (
              <span className="result-meta">
                ({getResultMeta().rowsDisplay} in {getResultMeta().duration})
              </span>
            )}
          </div>
          {queryResult && (
            <div className="section-header-actions">
              <button
                className="copy-json-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyResultAsJSON();
                }}
                title="Copy entire result as JSON"
              >
                📋 Copy JSON
              </button>
              <button
                className="export-excel-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportToExcel();
                }}
                title="Export result to CSV/Excel file"
              >
                📊 Export CSV
              </button>
              <div className="result-header-info">
                {queryResult.queryId && <span className="result-header-item">Query ID: {queryResult.queryId}</span>}
                <span className="result-header-item">Status: {queryResult.done !== false ? '✅ Complete' : '⏳ In Progress'}</span>
                <span className="result-header-item">Rows: {getResultMeta().rowsDisplay}</span>
                {getResultMeta().expectedRows > getResultMeta().retrievedRows && (
                  <span className="result-header-item" style={{ color: '#ff9800', fontWeight: 'bold' }}>
                    ⚠️ Partial Results
                  </span>
                )}
              </div>
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

export default DataCloudV3QueryTab;



