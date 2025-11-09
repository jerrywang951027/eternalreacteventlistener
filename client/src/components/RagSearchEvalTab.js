import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { format } from 'sql-formatter';
import { JSONPath } from 'jsonpath-plus';
import './DataCloudQueryTab.css'; // Reuse the same CSS

const RagSearchEvalTab = ({ persistedState, onStateChange }) => {
  // Initialize from persisted state or defaults (no connection state needed)
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState(persistedState?.error || '');
  const [sqlQuery, setSqlQuery] = useState(persistedState?.sqlQuery || '');
  const [queryResult, setQueryResult] = useState(persistedState?.queryResult || null);
  const [originalQueryData, setOriginalQueryData] = useState(persistedState?.originalQueryData || null); // Store original data before LLM merge
  const [originalMetadata, setOriginalMetadata] = useState(persistedState?.originalMetadata || null); // Store original metadata before LLM merge
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
  
  // RAG Evaluation specific state
  const [isEvalPanelOpen, setIsEvalPanelOpen] = useState(false);
  const [evalPrompt, setEvalPrompt] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState(null);
  const [evalPanelWidth, setEvalPanelWidth] = useState(400); // Default width for eval panel
  const [promptTab, setPromptTab] = useState('input'); // 'input' or 'parsed'
  const [toast, setToast] = useState(null); // Toast notification state
  const [selectedModel, setSelectedModel] = useState('sfdc_ai__DefaultGPT4Omni'); // LLM model selection
  
  const resizingColumn = useRef(null);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const resizingVertical = useRef(false);
  const resizingEvalPanel = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Check if SQL contains hybrid_search or vector_search
  const isRagQuery = () => {
    return sqlQuery && (
      sqlQuery.toLowerCase().includes('hybrid_search') ||
      sqlQuery.toLowerCase().includes('vector_search')
    );
  };

  // Check if Evaluate button should be enabled
  const canEvaluate = () => {
    return isRagQuery() && queryResult && queryResult.data && queryResult.data.length > 0;
  };

  // Show toast notification
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000); // Auto-dismiss after 3 seconds
  };

  // Parse the prompt with substitutions
  const getParsedPrompt = () => {
    if (!evalPrompt.trim()) {
      return '';
    }

    let parsed = evalPrompt;

    // Use original query data (before LLM merge) for JSONPath, or current data if no merge happened
    const dataForSubstitution = originalQueryData || queryResult?.data;
    
    // If query results exist, substitute placeholders and JSONPath expressions
    if (dataForSubstitution) {
      // First, handle simple placeholder replacements
      const resultsText = JSON.stringify(dataForSubstitution, null, 2);
      parsed = parsed.replace(/\{results\}/g, resultsText)
                     .replace(/\{query_results\}/g, resultsText)
                     .replace(/\{data\}/g, resultsText);

      // Now handle JSONPath expressions
      // Pattern: $ followed by path segments like .property, [index], [*], etc.
      // Match until whitespace, comma, closing paren, or newline
      const jsonPathPattern = /\$(?:\.\.?[\w]+|\[\*?\]|\[\d+\]|\[[^\]]+\])+/g;
      
      parsed = parsed.replace(jsonPathPattern, (match) => {
        try {
          // Create a context object that mimics common structures
          // IMPORTANT: Use original data before LLM merge to preserve array structure!
          const context = {
            queryResult: dataForSubstitution,
            data: dataForSubstitution,
            results: dataForSubstitution
          };
          
          console.log('🔍 [JSONPath] Evaluating:', match);
          
          // Try to evaluate the JSONPath expression
          const result = JSONPath({ path: match, json: context, wrap: false });
          
          console.log('✅ [JSONPath] Result type:', typeof result, 'is array:', Array.isArray(result));
          if (Array.isArray(result) && result.length <= 3) {
            console.log('✅ [JSONPath] Result preview:', result);
          } else if (Array.isArray(result)) {
            console.log('✅ [JSONPath] Result length:', result.length);
          }
          
          // If result is an array or object, stringify it; otherwise return as is
          if (result === undefined || result === null) {
            return `[JSONPath: ${match} - No Match]`;
          } else if (Array.isArray(result)) {
            // For arrays, format as numbered list instead of JSON array
            return '\n' + result.map((item, index) => {
              // Format each item - if it's an object/array, stringify it on same line
              const itemText = typeof item === 'object' ? JSON.stringify(item) : String(item);
              return `${index + 1}. ${itemText}`;
            }).join('\n');
          } else if (typeof result === 'object') {
            return JSON.stringify(result, null, 2);
          } else {
            return String(result);
          }
        } catch (error) {
          console.error('❌ [JSONPath] Evaluation error:', error, 'for expression:', match);
          return `[JSONPath Error: ${match}]`;
        }
      });
    }

    return parsed;
  };

  // Load saved queries from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('rag_eval_saved_queries');
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
        originalQueryData,
        originalMetadata,
        error,
        sqlEditorHeight,
        rowNumberWidth
      });
    }
  }, [sqlQuery, queryResult, originalQueryData, originalMetadata, error, sqlEditorHeight, rowNumberWidth, onStateChange]);

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
        // Save original data and metadata before any LLM merge happens
        setOriginalQueryData(response.data.result.data);
        setOriginalMetadata(response.data.result.metadata);
        setError('');
        // Auto-expand query result section
        setIsQueryResultCollapsed(false);
        // Initialize column widths with custom sizes for specific columns
        initializeColumnWidths(response.data.result.metadata || response.data.result.columns);
      } else {
        setError(response.data.message || 'Failed to execute query');
        setQueryResult(null);
        setOriginalQueryData(null);
        setOriginalMetadata(null);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message;
      const errorDetails = err.response?.data?.details;
      setError(`Failed to execute query: ${errorMsg}${errorDetails ? ' - ' + JSON.stringify(errorDetails) : ''}`);
      setQueryResult(null);
      setOriginalQueryData(null);
      setOriginalMetadata(null);
    } finally {
      setExecuting(false);
    }
  };

  // Handle copying prompt to clipboard
  const handleCopyPrompt = async () => {
    try {
      const textToCopy = promptTab === 'parsed' ? getParsedPrompt() : evalPrompt;
      await navigator.clipboard.writeText(textToCopy);
      showToast(`${promptTab === 'parsed' ? 'Parsed prompt' : 'Prompt'} copied to clipboard!`);
    } catch (error) {
      console.error('Failed to copy prompt:', error);
      showToast('Failed to copy prompt to clipboard', 'error');
    }
  };

  // Handle saving prompt to file
  const handleSavePrompt = () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const textToSave = promptTab === 'parsed' ? getParsedPrompt() : evalPrompt;
      const filenameSuffix = promptTab === 'parsed' ? 'parsed' : 'input';
      const filename = `rag_eval_prompt_${filenameSuffix}_${timestamp}.txt`;
      const blob = new Blob([textToSave], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      showToast('Prompt saved to file!');
    } catch (error) {
      console.error('Failed to save prompt:', error);
      showToast('Failed to save prompt to file', 'error');
    }
  };

  // Handle copying LLM evaluation result to clipboard
  const handleCopyEvalResult = async () => {
    try {
      const resultText = JSON.stringify(evalResult.evaluation, null, 2);
      await navigator.clipboard.writeText(resultText);
      showToast('Evaluation result copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy evaluation result:', error);
      showToast('Failed to copy evaluation result to clipboard', 'error');
    }
  };

  // Handle RAG evaluation
  const handleEvaluateRag = async () => {
    if (!evalPrompt.trim()) {
      setError('Please enter an evaluation prompt');
      return;
    }

    setEvaluating(true);
    setEvalResult(null);
    
    try {
      // Get the fully parsed prompt with all substitutions already done
      const parsedPrompt = getParsedPrompt();
      
      console.log('🚀 [RAG-EVAL] Sending parsed prompt to backend, length:', parsedPrompt.length);
      console.log('🚀 [RAG-EVAL] Using LLM model:', selectedModel);
      
      const response = await axios.post('/api/datacloud/rag-eval', {
        prompt: parsedPrompt,
        model: selectedModel
      }, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setEvalResult(response.data);
        setError('');
        
        // Parse and merge evaluation results with query results
        try {
          const evaluation = response.data.evaluation;
          let evaluationArray = [];
          
          // Extract content from generationDetails.generations[0].content
          if (evaluation?.generationDetails?.generations?.[0]?.content) {
            let content = evaluation.generationDetails.generations[0].content;
            console.log('🔍 [RAG-EVAL] Raw LLM content:', content.substring(0, 200));
            
            // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
            content = content.trim();
            if (content.startsWith('```')) {
              // Remove opening fence
              content = content.replace(/^```(?:json)?\s*\n?/i, '');
              // Remove closing fence
              content = content.replace(/\n?```\s*$/i, '');
              console.log('🔧 [RAG-EVAL] Stripped markdown fences');
            }
            
            console.log('🔍 [RAG-EVAL] Cleaned content:', content.substring(0, 200));
            
            // Parse the JSON content
            evaluationArray = JSON.parse(content);
            console.log('✅ [RAG-EVAL] Parsed evaluation array, length:', evaluationArray.length);
            console.log('✅ [RAG-EVAL] Evaluation array first item:', evaluationArray[0]);
            console.log('✅ [RAG-EVAL] Evaluation array last item:', evaluationArray[evaluationArray.length - 1]);
          } else if (evaluation?.generation?.content) {
            // Alternative path for different response structure
            let content = evaluation.generation.content;
            console.log('🔍 [RAG-EVAL] Raw LLM content (alternative path):', content.substring(0, 200));
            
            // Strip markdown code fences if present
            content = content.trim();
            if (content.startsWith('```')) {
              content = content.replace(/^```(?:json)?\s*\n?/i, '');
              content = content.replace(/\n?```\s*$/i, '');
              console.log('🔧 [RAG-EVAL] Stripped markdown fences');
            }
            
            console.log('🔍 [RAG-EVAL] Cleaned content:', content.substring(0, 200));
            evaluationArray = JSON.parse(content);
            console.log('✅ [RAG-EVAL] Parsed evaluation array, length:', evaluationArray.length);
          }
          
          if (Array.isArray(evaluationArray) && evaluationArray.length > 0) {
            // Get column names from original metadata (before any previous merges)
            const metadata = originalMetadata || queryResult.metadata;
            const columnNames = metadata && Array.isArray(metadata)
              ? metadata.map(col => col.name)
              : [];
            
            // Use original query data (before any previous merges) for transformation
            const dataToMerge = originalQueryData || queryResult.data;
            
            console.log('🔄 [RAG-EVAL] Starting data transformation...');
            console.log('🔄 [RAG-EVAL] Column names from metadata:', columnNames);
            console.log('🔄 [RAG-EVAL] SQL rows count:', dataToMerge.length);
            console.log('🔄 [RAG-EVAL] Evaluation results count:', evaluationArray.length);
            console.log('🔄 [RAG-EVAL] Data to merge sample:', dataToMerge[0]);
            console.log('🔄 [RAG-EVAL] Evaluation sample:', evaluationArray[0]);
            console.log('🔄 [RAG-EVAL] Using originalQueryData:', !!originalQueryData);
            
            // Check for count mismatch
            if (dataToMerge.length !== evaluationArray.length) {
              console.warn(`⚠️ [RAG-EVAL] COUNT MISMATCH! SQL rows: ${dataToMerge.length}, Evaluation results: ${evaluationArray.length}`);
            }
            
            // Transform and merge: Convert array-of-arrays to array-of-objects with evaluation data
            const mergedData = dataToMerge.map((row, rowIndex) => {
              // Start with a new object
              const newRow = { index: rowIndex + 1 }; // Add 1-based index
              
              // Add original query data
              if (Array.isArray(row)) {
                // Convert array to object using column names
                row.forEach((val, colIndex) => {
                  const columnName = columnNames[colIndex] || `col_${colIndex}`;
                  newRow[columnName] = val;
                });
              } else {
                // Row is already an object, merge it
                Object.assign(newRow, row);
              }
              
              // Add evaluation fields if available for this row
              if (rowIndex < evaluationArray.length) {
                const evalData = evaluationArray[rowIndex];
                if (evalData) {
                  Object.assign(newRow, evalData);
                  // Only log first and last row to avoid console spam
                  if (rowIndex === 0 || rowIndex === dataToMerge.length - 1) {
                    console.log(`✅ [RAG-EVAL] Merged row ${rowIndex + 1} with evaluation data`);
                  }
                } else {
                  console.warn(`⚠️ [RAG-EVAL] Row ${rowIndex + 1}: evaluation data is null/undefined`);
                }
              } else {
                console.warn(`⚠️ [RAG-EVAL] Row ${rowIndex + 1}: no evaluation data available (index ${rowIndex} >= ${evaluationArray.length})`);
              }
              
              return newRow;
            });
            
            console.log('✅ [RAG-EVAL] Transformed data sample (first row):', JSON.stringify(mergedData[0], null, 2));
            console.log('✅ [RAG-EVAL] Transformed data sample (last row):', JSON.stringify(mergedData[mergedData.length - 1], null, 2));
            console.log('✅ [RAG-EVAL] Total rows:', mergedData.length);
            
            // Check which rows have evaluation data
            const rowsWithEval = mergedData.filter(row => row.score !== undefined).length;
            const rowsWithoutEval = mergedData.length - rowsWithEval;
            console.log(`✅ [RAG-EVAL] Rows with evaluation: ${rowsWithEval}, without: ${rowsWithoutEval}`);
            
            // Update query result with merged data - completely replace the structure
            const newQueryResult = {
              ...queryResult,
              data: mergedData,
              metadata: null, // Clear metadata since we're now using objects
              _merged: true,
              _transformedToObjects: true
            };
            
            setQueryResult(newQueryResult);
            
            // Get all column names from the merged data
            const allKeys = [];
            if (mergedData.length > 0) {
              Object.keys(mergedData[0]).forEach(key => allKeys.push(key));
            }
            
            console.log('✅ [RAG-EVAL] All columns:', allKeys);
            
            // Create metadata-like structure for column width initialization
            const newMetadata = allKeys.map(key => ({ name: key }));
            initializeColumnWidths(newMetadata);
            
            console.log('✅ [RAG-EVAL] Data transformation complete!');
          } else {
            console.warn('⚠️ [RAG-EVAL] Evaluation content is not an array or is empty');
          }
        } catch (parseError) {
          console.error('❌ [RAG-EVAL] Failed to parse evaluation content:', parseError);
          // Don't fail the whole operation, just log the error
        }
      } else {
        setError(response.data.message || 'Failed to evaluate RAG results');
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message;
      setError(`Failed to evaluate: ${errorMsg}`);
    } finally {
      setEvaluating(false);
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
      } else if (columnName === 'content' || columnName.startsWith('col_')) {
        widths[columnName] = 400; // Medium width for content
      } else if (columnName === 'hybrid_score' || columnName.toLowerCase().includes('score')) {
        widths[columnName] = 100; // Narrow width for scores/numbers
      } else if (columnName === 'Reasoning' || columnName.toLowerCase().includes('reasoning')) {
        widths[columnName] = 500; // Large width for reasoning text
      } else if (columnName === 'Matched Keywords' || columnName.toLowerCase().includes('keywords')) {
        widths[columnName] = 200; // Medium width for keywords
      } else {
        widths[columnName] = 150; // Default width for evaluation columns
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

  // Eval panel resize handlers
  const handleEvalPanelMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    resizingEvalPanel.current = true;
    startX.current = e.pageX;
    startWidth.current = evalPanelWidth;
    
    document.body.classList.add('resizing-column');
    
    document.addEventListener('mousemove', handleEvalPanelMouseMove);
    document.addEventListener('mouseup', handleEvalPanelMouseUp);
  };

  const handleEvalPanelMouseMove = (e) => {
    if (!resizingEvalPanel.current) return;
    
    const diff = startX.current - e.pageX; // Reverse direction for right panel
    const newWidth = Math.max(300, Math.min(800, startWidth.current + diff)); // Min 300px, Max 800px
    
    setEvalPanelWidth(newWidth);
  };

  const handleEvalPanelMouseUp = () => {
    resizingEvalPanel.current = false;
    
    document.body.classList.remove('resizing-column');
    
    document.removeEventListener('mousemove', handleEvalPanelMouseMove);
    document.removeEventListener('mouseup', handleEvalPanelMouseUp);
  };

  useEffect(() => {
    return () => {
      document.body.classList.remove('resizing-column');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousemove', handleVerticalMouseMove);
      document.removeEventListener('mouseup', handleVerticalMouseUp);
      document.removeEventListener('mousemove', handleEvalPanelMouseMove);
      document.removeEventListener('mouseup', handleEvalPanelMouseUp);
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
    
    // If data has been merged (converted to objects), extract keys from first row
    if (queryResult._merged && queryResult.data && queryResult.data.length > 0) {
      const firstRow = queryResult.data[0];
      if (typeof firstRow === 'object' && !Array.isArray(firstRow)) {
        return Object.keys(firstRow);
      }
    }
    
    // V3 API returns metadata as an array of objects with 'name' property
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
      const firstRow = queryResult.data[0];
      if (typeof firstRow === 'object' && !Array.isArray(firstRow)) {
        return Object.keys(firstRow);
      }
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
        {columns.map((columnName) => {
          // Check if this is an evaluation column (not an original query column)
          // Original query columns: index, hybrid_score, content, sourcerecordid, title, url, or col_X
          const originalColumns = ['index', 'hybrid_score', 'content', 'sourcerecordid', 'title', 'url'];
          const isEvalColumn = !originalColumns.includes(columnName) && !columnName.startsWith('col_');
          
          return (
            <th 
              key={columnName}
              style={{ 
                width: columnWidths[columnName] || 120,
                position: 'relative',
                backgroundColor: isEvalColumn && !columnName.startsWith('col_') ? '#f0f9ff' : undefined
              }}
              onClick={() => handleSort(columnName)}
              className={`sortable-header ${isEvalColumn ? 'eval-column' : ''}`}
            >
              <div className="th-content">
                <span>{isEvalColumn && !columnName.startsWith('col_') ? '🤖 ' : ''}{columnName}</span>
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
          );
        })}
      </tr>
    );
  };

  const handleFormatSql = () => {
    if (!sqlQuery) return;
    
    try {
      const formatted = format(sqlQuery, {
        language: 'sql',
        indent: '  ',
        uppercase: true,
        linesBetweenQueries: 2,
      });
      
      setSqlQuery(formatted);
      highlightSql(formatted);
    } catch (error) {
      console.error('Failed to format SQL:', error);
      setError('Failed to format SQL: ' + error.message);
    }
  };

  const handleSaveQuery = () => {
    if (!sqlQuery.trim()) {
      showToast('Please enter a SQL query to save', 'error');
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
      localStorage.setItem('rag_eval_saved_queries', JSON.stringify(updatedQueries));
      
      showToast(`Query saved as "${timestamp}"!`);
    } catch (error) {
      console.error('Error saving query:', error);
      showToast('Failed to save query. Please try again.', 'error');
    }
  };

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
      localStorage.setItem('rag_eval_saved_queries', JSON.stringify(updatedQueries));
      
      if (selectedSavedQuery === queryId) {
        setSelectedSavedQuery('');
      }
    } catch (error) {
      console.error('Error deleting query:', error);
      showToast('Failed to delete query. Please try again.', 'error');
    }
  };

  const highlightSql = (sql) => {
    if (!sql) {
      setHighlightedSql('');
      return;
    }

    const keywords = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|AS|ORDER BY|GROUP BY|HAVING|LIMIT|OFFSET|DISTINCT|COUNT|SUM|AVG|MAX|MIN|CASE|WHEN|THEN|ELSE|END|IN|NOT|NULL|IS|BETWEEN|LIKE|EXISTS|HYBRID_SEARCH|VECTOR_SEARCH)\b/gi;
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
      let textToCopy = content;
      if (typeof textToCopy === 'string') {
        textToCopy = textToCopy.replace(/^"(.*)"$/s, '$1');
      } else if (typeof textToCopy === 'object') {
        textToCopy = JSON.stringify(textToCopy, null, 2);
      } else {
        textToCopy = String(textToCopy);
      }
      
      await navigator.clipboard.writeText(textToCopy);
      
      const cellId = `${rowIndex}-${columnName}`;
      setCopiedCell(cellId);
      
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

      const isArrayOfArrays = Array.isArray(queryResult.data[0]);

      let csvContent = '';
      
      csvContent += columns.map(col => `"${col}"`).join(',') + '\n';
      
      queryResult.data.forEach(row => {
        const rowData = columns.map((col, index) => {
          const cellValue = isArrayOfArrays ? row[index] : row[col];
          
          if (cellValue === null || cellValue === undefined) {
            return '""';
          }
          
          let value = String(cellValue);
          value = value.replace(/"/g, '""');
          
          return `"${value}"`;
        });
        
        csvContent += rowData.join(',') + '\n';
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      link.setAttribute('href', url);
      link.setAttribute('download', `rag_eval_result_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
      link.style.visibility = 'hidden';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
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
    
    let processedValue = cellValue;
    if (typeof processedValue === 'string') {
      processedValue = processedValue.replace(/^"(.*)"$/s, '$1');
    }
    
    const isJson = isJsonString(processedValue);
    
    if (isJson) {
      try {
        const parsed = JSON.parse(processedValue);
        const beautified = JSON.stringify(parsed, null, 2);
        return (
          <pre className="cell-content json-content">{beautified}</pre>
        );
      } catch (e) {
        return <pre className="cell-content">{processedValue}</pre>;
      }
    }
    
    const hasNewlines = typeof processedValue === 'string' && processedValue.includes('\n');
    
    if (hasNewlines) {
      return <pre className="cell-content">{processedValue}</pre>;
    }
    
    return String(processedValue);
  };

  const renderTableRows = () => {
    if (!queryResult || !queryResult.data) return null;

    const columns = getColumns();
    if (columns.length === 0) return null;

    // Check if data is array of arrays or array of objects
    const isArrayOfArrays = Array.isArray(queryResult.data[0]) && !queryResult._transformedToObjects;

    let sortedData = [...queryResult.data];
    if (sortConfig.column) {
      const columnIndex = columns.indexOf(sortConfig.column);
      sortedData.sort((a, b) => {
        const aValue = isArrayOfArrays ? a[columnIndex] : a[sortConfig.column];
        const bValue = isArrayOfArrays ? b[columnIndex] : b[sortConfig.column];
        
        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        
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
          const cellValue = isArrayOfArrays ? row[columnIndex] : row[columnName];
          const content = renderCellContent(cellValue, columnName);
          const isSpecialContent = typeof content === 'object';
          const cellId = `${rowIndex}-${columnName}`;
          const isCopied = copiedCell === cellId;
          // Check if this is an evaluation column
          const originalColumns = ['index', 'hybrid_score', 'content', 'sourcerecordid', 'title', 'url'];
          const isEvalColumn = !originalColumns.includes(columnName) && !columnName.startsWith('col_');
          
          return (
            <td 
              key={columnName} 
              className={`${isSpecialContent ? 'special-cell' : ''} ${isEvalColumn ? 'eval-cell' : ''} copyable-cell`}
              style={{ 
                width: columnWidths[columnName] || 120,
                maxWidth: columnWidths[columnName] || 120,
                backgroundColor: isEvalColumn ? '#f0f9ff' : undefined
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
    
    const retrievedRows = queryResult.returnedRows || queryResult.data?.length || 0;
    const expectedRows = queryResult.status?.rowCount || retrievedRows;
    const rowCount = retrievedRows;
    
    let rowsDisplay = '';
    if (expectedRows > retrievedRows) {
      rowsDisplay = `${retrievedRows.toLocaleString()}/${expectedRows.toLocaleString()} rows`;
    } else {
      rowsDisplay = `${retrievedRows.toLocaleString()} rows`;
    }
    
    let duration = '0ms';
    
    if (queryResult.queryTimeMills !== undefined && queryResult.queryTimeMills !== null) {
      duration = `${Math.round(queryResult.queryTimeMills)}ms`;
    } else if (queryResult.startTime && queryResult.endTime) {
      duration = `${Math.round(queryResult.endTime - queryResult.startTime)}ms`;
    }
    
    return { rowCount, duration, retrievedRows, expectedRows, rowsDisplay };
  };

  return (
    <div className="datacloud-query-tab">
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 20px',
          background: toast.type === 'success' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          color: 'white',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '14px',
          fontWeight: '500',
          animation: 'slideInRight 0.3s ease-out'
        }}>
          <span>{toast.type === 'success' ? '✅' : '❌'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      {/* Main content area with SQL Editor and optional Eval Panel */}
      <div style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden' }}>
        {/* Left side: SQL Editor */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          flex: 1, 
          minWidth: 0,
          overflow: 'hidden' 
        }}>
          {/* SQL Query Editor Section */}
          <div className="section-container">
            <div className="section-header">
              <div className="section-header-left" onClick={() => setIsQueryEditorCollapsed(!isQueryEditorCollapsed)}>
                <span className="collapse-icon">{isQueryEditorCollapsed ? '▶' : '▼'}</span>
                <h3>SQL Query Editor</h3>
              </div>
              <div className="section-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                {/* Evaluate Rag Result Button */}
                <button
                  className="execute-btn-header"
                  style={{ 
                    background: canEvaluate() ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #ccc 0%, #999 100%)',
                    borderColor: canEvaluate() ? '#10b981' : '#ccc'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEvalPanelOpen(!isEvalPanelOpen);
                  }}
                  disabled={!canEvaluate()}
                  title={canEvaluate() ? 'Evaluate RAG search results' : 'Execute a hybrid_search or vector_search query first'}
                >
                  🤖 Evaluate Rag Result
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

          {/* Vertical Resizer */}
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

        {/* Right side: Evaluation Panel */}
        {isEvalPanelOpen && (
          <>
            {/* Vertical resizer for eval panel */}
            <div 
              style={{
                width: '8px',
                background: '#e8ebf0',
                cursor: 'ew-resize',
                flexShrink: 0,
                position: 'relative',
                zIndex: 10
              }}
              onMouseDown={handleEvalPanelMouseDown}
            >
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '3px',
                height: '50px',
                background: 'rgba(102, 126, 234, 0.5)',
                borderRadius: '2px'
              }}></div>
            </div>

            {/* Evaluation Panel */}
            <div 
              style={{ 
                width: `${evalPanelWidth}px`,
                display: 'flex',
                flexDirection: 'column',
                background: '#1a202c',
                borderLeft: '1px solid #4a5568',
                flexShrink: 0,
                overflow: 'hidden'
              }}
            >
              {/* Header */}
              <div style={{
                padding: '12px 15px',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: 'white',
                fontWeight: '600',
                fontSize: '14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0
              }}>
                <span>🤖 Please enter prompt for evaluation</span>
                <button
                  onClick={() => setIsEvalPanelOpen(false)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: 'none',
                    color: 'white',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '16px'
                  }}
                  title="Close evaluation panel"
                >
                  ✕
                </button>
              </div>

              {/* LLM Model Selection */}
              <div style={{
                padding: '10px 12px',
                background: '#2d3748',
                borderBottom: '1px solid #4a5568',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexShrink: 0
              }}>
                <label style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  color: '#e5e7eb',
                  whiteSpace: 'nowrap'
                }}>
                  🧠 LLM Model:
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: '12px',
                    border: '1px solid #4a5568',
                    borderRadius: '4px',
                    background: '#1a202c',
                    color: '#e5e7eb',
                    cursor: 'pointer',
                    fontFamily: 'Monaco, Menlo, Courier New, monospace'
                  }}
                >
                  <option value="sfdc_ai__DefaultGPT4Omni">GPT-4 Omni (Default)</option>
                  <option value="sfdc_ai__DefaultOpenAIGPT4OmniMini">GPT-4 Omni Mini</option>
                  <option value="sfdc_ai__DefaultVertexAIGemini25Flash001">Vertex AI Gemini 2.5 Flash</option>
                </select>
              </div>

              {/* Prompt Input */}
              <div style={{ 
                flex: 1, 
                display: 'flex', 
                flexDirection: 'column', 
                padding: '12px',
                overflow: 'hidden',
                gap: '8px'
              }}>
                {/* Tab Header */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  borderBottom: '1px solid #4a5568',
                  marginBottom: '8px'
                }}>
                  <div style={{ display: 'flex', gap: '0' }}>
                    <button
                      onClick={() => setPromptTab('input')}
                      style={{
                        padding: '8px 16px',
                        background: promptTab === 'input' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
                        color: promptTab === 'input' ? 'white' : '#666',
                        border: 'none',
                        borderBottom: promptTab === 'input' ? '2px solid #667eea' : '2px solid transparent',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: '600',
                        transition: 'all 0.2s ease',
                        borderRadius: '4px 4px 0 0'
                      }}
                    >
                      📝 Input Prompt
                    </button>
                    <button
                      onClick={() => setPromptTab('parsed')}
                      style={{
                        padding: '8px 16px',
                        background: promptTab === 'parsed' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
                        color: promptTab === 'parsed' ? 'white' : '#666',
                        border: 'none',
                        borderBottom: promptTab === 'parsed' ? '2px solid #667eea' : '2px solid transparent',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: '600',
                        transition: 'all 0.2s ease',
                        borderRadius: '4px 4px 0 0'
                      }}
                    >
                      🔍 Parsed Prompt
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={handleCopyPrompt}
                      disabled={!evalPrompt.trim()}
                      style={{
                        padding: '5px 12px',
                        background: evalPrompt.trim() ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '#e0e0e0',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: evalPrompt.trim() ? 'pointer' : 'not-allowed',
                        fontSize: '12px',
                        fontWeight: '600',
                        transition: 'all 0.2s ease'
                      }}
                      title="Copy prompt to clipboard"
                    >
                      📋 Copy
                    </button>
                    <button
                      onClick={handleSavePrompt}
                      disabled={!evalPrompt.trim()}
                      style={{
                        padding: '5px 12px',
                        background: evalPrompt.trim() ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' : '#e0e0e0',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: evalPrompt.trim() ? 'pointer' : 'not-allowed',
                        fontSize: '12px',
                        fontWeight: '600',
                        transition: 'all 0.2s ease'
                      }}
                      title="Save prompt to file"
                    >
                      💾 Save
                    </button>
                  </div>
                </div>

                {/* Input Tab */}
                {promptTab === 'input' && (
                  <>
                    <div style={{ 
                      fontSize: '13px', 
                      color: '#9ca3af', 
                      marginBottom: '5px', 
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span style={{ fontSize: '12px', color: '#9ca3af' }}>💡 Prompt supports placeholders and JSONPath</span>
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <span 
                          className="info-icon"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '18px',
                            height: '18px',
                            borderRadius: '50%',
                            background: '#667eea',
                            color: 'white',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'help',
                            fontFamily: 'serif'
                          }}
                        >
                          i
                        </span>
                        <div 
                          className="info-tooltip"
                          style={{
                            position: 'absolute',
                            left: '25px',
                            top: '-10px',
                            background: '#2d3748',
                            color: 'white',
                            padding: '12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            lineHeight: '1.6',
                            whiteSpace: 'nowrap',
                            zIndex: 1000,
                            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                            opacity: 0,
                            visibility: 'hidden',
                            transition: 'opacity 0.2s, visibility 0.2s',
                            pointerEvents: 'none'
                          }}
                        >
                          <div><strong>💡 Placeholders:</strong> <code style={{ background: '#4a5568', padding: '2px 4px', borderRadius: '3px' }}>{'{results}'}</code>, <code style={{ background: '#4a5568', padding: '2px 4px', borderRadius: '3px' }}>{'{query_results}'}</code>, <code style={{ background: '#4a5568', padding: '2px 4px', borderRadius: '3px' }}>{'{data}'}</code></div>
                          <div style={{ marginTop: '8px' }}><strong>🔍 JSONPath Examples:</strong></div>
                          <div style={{ marginLeft: '10px', marginTop: '4px' }}>
                            • <code style={{ background: '#4a5568', padding: '2px 4px', borderRadius: '3px' }}>$.queryResult[*][1]</code> - 2nd element from each row<br/>
                            • <code style={{ background: '#4a5568', padding: '2px 4px', borderRadius: '3px' }}>$.data[0][1]</code> - 2nd element from first row<br/>
                            • <code style={{ background: '#4a5568', padding: '2px 4px', borderRadius: '3px' }}>$.queryResult[*][0]</code> - 1st element from all rows
                          </div>
                        </div>
                      </div>
                    </div>
                    <textarea
                      value={evalPrompt}
                      onChange={(e) => setEvalPrompt(e.target.value)}
                      placeholder="Enter your evaluation prompt here...&#10;&#10;Example:&#10;Analyze the following search results: {results}&#10;&#10;Evaluate the relevance and accuracy of these results."
                      style={{
                        flex: 1,
                        padding: '12px',
                        border: '1px solid #4a5568',
                        borderRadius: '4px',
                        fontSize: '13px',
                        fontFamily: 'Monaco, Menlo, Courier New, monospace',
                        resize: 'none',
                        minHeight: '150px',
                        background: '#2d3748',
                        color: '#e5e7eb'
                      }}
                    />
                  </>
                )}

                {/* Parsed Tab */}
                {promptTab === 'parsed' && (
                  <>
                    <div style={{ 
                      fontSize: '13px', 
                      color: '#666', 
                      marginBottom: '5px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span>🔍 Preview of the prompt with substituted values (readonly)</span>
                      {queryResult && queryResult.data && (
                        <span style={{ fontSize: '11px', color: '#10b981', fontWeight: '600' }}>
                          ✅ Query results available ({queryResult.data.length} rows)
                        </span>
                      )}
                      {(!queryResult || !queryResult.data) && (
                        <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: '600' }}>
                          ⚠️ No query results - execute SQL first
                        </span>
                      )}
                    </div>
                    <textarea
                      value={getParsedPrompt()}
                      readOnly
                      placeholder="Enter a prompt in the 'Input Prompt' tab and execute a query to see the parsed result here..."
                      style={{
                        flex: 1,
                        padding: '12px',
                        border: '1px solid #4a5568',
                        borderRadius: '4px',
                        fontSize: '13px',
                        fontFamily: 'Monaco, Menlo, Courier New, monospace',
                        resize: 'none',
                        minHeight: '150px',
                        background: '#2d3748',
                        color: '#e5e7eb',
                        cursor: 'default'
                      }}
                    />
                  </>
                )}
                
                <button
                  onClick={handleEvaluateRag}
                  disabled={!evalPrompt.trim() || evaluating}
                  style={{
                    padding: '10px 20px',
                    background: evalPrompt.trim() ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#ccc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: evalPrompt.trim() ? 'pointer' : 'not-allowed',
                    fontWeight: '600',
                    fontSize: '14px',
                    flexShrink: 0
                  }}
                >
                  {evaluating ? '⏳ Evaluating...' : '🚀 Start LLM Evaluation'}
                </button>

                {/* Evaluation Result */}
                {evalResult && (
                  <div style={{
                    marginTop: '8px',
                    padding: '0',
                    background: 'transparent',
                    borderRadius: '0',
                    border: 'none',
                    overflow: 'auto',
                    maxHeight: '400px',
                    flexShrink: 0
                  }}>
                    <div style={{ 
                      fontWeight: '600', 
                      marginBottom: '10px', 
                      color: '#10b981',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span>✅ Evaluation Result</span>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: '#666', fontWeight: 'normal' }}>
                          ⏱️ {evalResult.evaluationTime}ms
                        </span>
                        <button
                          onClick={handleCopyEvalResult}
                          style={{
                            padding: '4px 10px',
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: '600',
                            transition: 'all 0.2s ease'
                          }}
                          title="Copy evaluation result to clipboard"
                        >
                          📋 Copy
                        </button>
                      </div>
                    </div>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      wordWrap: 'break-word',
                      fontSize: '13px',
                      margin: 0,
                      fontFamily: 'Monaco, Menlo, Courier New, monospace'
                    }}>
                      {JSON.stringify(evalResult.evaluation, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default RagSearchEvalTab;

