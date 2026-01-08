import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './IngestionAPITab.css';

const IngestionAPITab = () => {
  const [dataStreams, setDataStreams] = useState([]);
  const [selectedDataStream, setSelectedDataStream] = useState(null);
  const [streamDetails, setStreamDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [streamSourceName, setStreamSourceName] = useState(null); // sourceName from connection details
  const [streamTargetObject, setStreamTargetObject] = useState(null); // object from connection schema
  const [connectionDetails, setConnectionDetails] = useState(null); // Full connection details
  const [connectionSchema, setConnectionSchema] = useState(null); // Full connection schema
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fileDetails, setFileDetails] = useState([]); // Store file details with record counts
  const [filteredOutFiles, setFilteredOutFiles] = useState([]); // Track files filtered out
  const [fileFormat, setFileFormat] = useState('csv');
  const [baseDirectory, setBaseDirectory] = useState(''); // Base directory for file paths
  const [selectedFolderPath, setSelectedFolderPath] = useState(''); // Track selected folder path
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [currentProcessingFile, setCurrentProcessingFile] = useState(null);
  const [processStartTime, setProcessStartTime] = useState(null);
  const [currentFileStartTime, setCurrentFileStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // Right panel sub-tabs
  const [activeRightTab, setActiveRightTab] = useState('data-stream'); // 'data-stream', 'processing', 'ingestion'
  
  // Ingestion progress tracking
  const [ingestionJobId, setIngestionJobId] = useState(null);
  const [ingestedFiles, setIngestedFiles] = useState([]); // Array of { fileName, timestamp, status, size }
  const [ingestionStartTime, setIngestionStartTime] = useState(null);
  const [ingestionElapsedTime, setIngestionElapsedTime] = useState(0);

  // Fetch data streams on mount
  useEffect(() => {
    fetchDataStreams();
  }, []);

  // Update elapsed time every second when processing
  useEffect(() => {
    let interval = null;
    if (isProcessingFiles && processStartTime) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - processStartTime) / 1000);
        setElapsedTime(elapsed);
      }, 1000);
    } else {
      setElapsedTime(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isProcessingFiles, processStartTime]);

  // Update ingestion elapsed time every second when uploading
  useEffect(() => {
    let interval = null;
    if (isUploading && ingestionStartTime) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - ingestionStartTime) / 1000);
        setIngestionElapsedTime(elapsed);
      }, 1000);
    } else {
      setIngestionElapsedTime(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isUploading, ingestionStartTime]);

  const fetchDataStreams = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/datacloud/ingestion/streams', {
        withCredentials: true
      });
      
      console.log('📥 [INGESTION UI] Response received:', response.data);
      
      if (response.data.success) {
        const streams = response.data.streams || [];
        console.log(`📥 [INGESTION UI] Received ${streams.length} streams`);
        console.log('📥 [INGESTION UI] Streams:', streams);
        
        // Backend already filters for ingestion API type, so use all streams returned
        setDataStreams(streams);
        
        if (streams.length === 0) {
          console.warn('⚠️ [INGESTION UI] No ingestion API streams found');
          setError('No ingestion API data streams found. Please check server logs for details.');
        }
      } else {
        const errorMsg = response.data.message || 'Failed to fetch data streams';
        console.error('❌ [INGESTION UI] Error:', errorMsg);
        setError(errorMsg);
      }
    } catch (err) {
      const errorMsg = 'Failed to fetch data streams: ' + (err.response?.data?.message || err.message);
      console.error('❌ [INGESTION UI] Exception:', err);
      console.error('❌ [INGESTION UI] Error response:', err.response?.data);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Process files via backend API
  const processFilesViaBackend = async (files) => {
    // Filter by selected format
    const filteredFiles = files.filter(file => {
      if (!file || !file.name) {
        console.warn('⚠️ [CSV Processing] Skipping file with no name:', file);
        return false;
      }
      const nameParts = file.name.split('.');
      if (nameParts.length < 2) {
        // No extension
        return false;
      }
      const extension = nameParts.pop().toLowerCase();
      return extension === fileFormat;
    });

    // Track filtered out files
    const filtered = files.filter(file => {
      if (!file || !file.name) {
        return false;
      }
      const nameParts = file.name.split('.');
      if (nameParts.length < 2) {
        return true; // No extension, filter it out
      }
      const extension = nameParts.pop().toLowerCase();
      return extension !== fileFormat;
    });
    
    if (filtered.length > 0) {
      setFilteredOutFiles(prev => [...prev, ...filtered]);
      const filteredCount = filtered.length;
      console.log(`Filtered out ${filteredCount} non-${fileFormat.toUpperCase()} files`);
    }

    if (filteredFiles.length === 0) {
      return [];
    }

    setIsProcessingFiles(true);
    setProcessingProgress({ current: 0, total: filteredFiles.length });
    setProcessStartTime(Date.now());
    setElapsedTime(0);
    setError('');
    setActiveRightTab('processing'); // Activate Processing tab

    try {
      // Get expected headers from already processed files (if any)
      let expectedHeaders = null;
      if (fileDetails.length > 0 && fileDetails[0].headers) {
        expectedHeaders = fileDetails[0].headers;
      }

      const processedFiles = [];
      
      // Process files one by one
      for (let i = 0; i < filteredFiles.length; i++) {
        const file = filteredFiles[i];
        const fileStartTime = Date.now();
        const fileIndex = i + 1;
        
        // Update progress and current file BEFORE processing starts
        console.log(`🔄 [CSV Processing] UI: Setting current file to ${fileIndex}/${filteredFiles.length}: ${file.name}`);
        setProcessingProgress({ current: fileIndex, total: filteredFiles.length });
        setCurrentFileStartTime(fileStartTime);
        setCurrentProcessingFile({
          name: file.name,
          size: file.size,
          index: fileIndex,
          total: filteredFiles.length,
          startTime: fileStartTime
        });

        // Small delay to ensure React updates the UI before starting the API call
        await new Promise(resolve => setTimeout(resolve, 100));

        try {
          // Get file path information
          // webkitRelativePath is available when folder is selected (e.g., "csvs-test-0107/networking_part_4.csv")
          // For individual file selection, we only have the filename
          const filePath = file.webkitRelativePath || null;
          const fileName = file.name;
          
          // Extract base folder name if available (for Downloads folder detection)
          let baseFolderName = null;
          if (filePath) {
            const parts = filePath.split('/');
            baseFolderName = parts[0]; // e.g., "csvs-test-0107" or folder name in Downloads
          }
          
          console.log(`🔄 [CSV Processing] API: Processing file ${fileIndex}/${filteredFiles.length}:`);
          console.log(`   File name: ${fileName}`);
          console.log(`   Relative path: ${filePath || 'N/A (individual file selection)'}`);
          console.log(`   Base folder: ${baseFolderName || 'N/A'}`);
          console.log(`   File size: ${formatFileSize(file.size)}`);

          const response = await axios.post('/api/datacloud/ingestion/process-csv', {
            filePath: filePath, // null if individual file, or relative path if from folder (e.g., "csvs-test-0107/networking_part_4.csv")
            fileName: fileName,
            fileSize: file.size,
            baseFolderName: baseFolderName, // e.g., "csvs-test-0107" - folder name from selected folder
            baseDirectory: baseDirectory || null, // User-specified base directory, or null to use server default
            expectedHeaders: expectedHeaders
          }, {
            withCredentials: true,
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 600000 // 10 minute timeout for large files
          });

          const fileEndTime = Date.now();
          const processingTime = Math.floor((fileEndTime - fileStartTime) / 1000); // in seconds

          if (response.data.success) {
            const detail = {
              fileName: response.data.fileName,
              fileSize: response.data.fileSize,
              recordCount: response.data.recordCount,
              headers: response.data.headers,
              headerCount: response.data.headerCount,
              preview: response.data.preview,
              processingTime: processingTime,
              // Store file path info for ingestion
              filePath: filePath, // Relative path from folder selection
              baseFolderName: baseFolderName, // Base folder name
              baseDirectory: baseDirectory || null // User-specified base directory
            };

            // Set expected headers from first file
            if (i === 0 && !expectedHeaders) {
              expectedHeaders = detail.headers;
            }

            // Update file details - use functional update to ensure we have latest state
            setFileDetails(prev => {
              const updated = [...prev, detail];
              console.log(`✅ [CSV Processing] File ${i + 1}/${filteredFiles.length} completed. Total processed: ${updated.length}`);
              return updated;
            });
            processedFiles.push(file);

            // Log details
            const fileSizeFormatted = detail.fileSize >= 1024 
              ? `${(detail.fileSize / 1024).toFixed(2)} KB` 
              : `${detail.fileSize} Bytes`;
            
            console.log(`✅ [CSV Processing] File ${i + 1}/${filteredFiles.length} processed:`, {
              fileName: detail.fileName,
              fileSize: detail.fileSize,
              fileSizeFormatted: fileSizeFormatted,
              recordCount: detail.recordCount,
              headers: detail.headers,
              headerCount: detail.headers.length,
              processingTime: processingTime
            });
            
            console.log(`   📄 ${detail.fileName} | ${detail.recordCount.toLocaleString()} records | ${fileSizeFormatted} | ${detail.headers.length} columns | ${processingTime}s`);
            
            // Clear current file if this was the last file
            if (i === filteredFiles.length - 1) {
              setCurrentProcessingFile(null);
              setCurrentFileStartTime(null);
            }
          } else {
            throw new Error(response.data.message || 'Failed to process file');
          }
        } catch (err) {
          const errorMessage = err.response?.data?.message || err.message;
          console.error(`❌ [CSV Processing] Error processing file "${file.name}":`, err);
          setError(`Error in file "${file.name}": ${errorMessage}`);
          setCurrentProcessingFile(null);
          setCurrentFileStartTime(null);
          setIsProcessingFiles(false);
          setProcessStartTime(null);
          return processedFiles; // Return files processed so far
        }
      }

      setIsProcessingFiles(false);
      setCurrentProcessingFile(null);
      setProcessStartTime(null);
      setCurrentFileStartTime(null);
      return processedFiles;
    } catch (err) {
      console.error('Error processing files:', err);
      setError(err.message || 'Error processing files');
      setIsProcessingFiles(false);
      setCurrentProcessingFile(null);
      setProcessStartTime(null);
      setCurrentFileStartTime(null);
      return [];
    }
  };

  const formatTime = (seconds) => {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}m ${secs}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      return `${hours}h ${mins}m ${secs}s`;
    }
  };

  const getCurrentFileElapsedTime = () => {
    if (currentFileStartTime) {
      const elapsed = Math.floor((Date.now() - currentFileStartTime) / 1000);
      return formatTime(elapsed);
    }
    return '0s';
  };

  const handleFileSelect = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
    // Add files to selected list first (use files directly, don't modify File objects)
    setSelectedFiles(prev => [...prev, ...files]);
    
    // Process files via backend
    await processFilesViaBackend(files);
    
    // Reset input to allow selecting same files again
    event.target.value = '';
  };

  const handleFolderSelect = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
    console.log(`📂 [Folder Selection] Selected folder with ${files.length} total files (recursive)`);
    
    // Extract the base folder name from webkitRelativePath
    // e.g., if webkitRelativePath is "csvs-test-0107/file.csv", base folder is "csvs-test-0107"
    let baseFolderName = null;
    if (files.length > 0 && files[0].webkitRelativePath) {
      const firstPath = files[0].webkitRelativePath;
      baseFolderName = firstPath.split('/')[0];
      console.log(`📂 [Folder Selection] Detected base folder: ${baseFolderName}`);
      
      // Store the folder path - this will be used to construct full paths
      // Note: Browser doesn't give us the full path, so we'll use the folder name
      // and combine with baseDirectory
      setSelectedFolderPath(baseFolderName);
    }
    
    // Add files to selected list first
    setSelectedFiles(prev => [...prev, ...files]);
    
    // Process files via backend
    await processFilesViaBackend(files);
    
    // Reset input to allow selecting same folder again
    event.target.value = '';
  };

  const removeFile = (index) => {
    // Remove file and its details by matching file name
    const fileNameToRemove = selectedFiles[index]?.name;
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setFileDetails(prev => prev.filter(detail => detail.fileName !== fileNameToRemove));
  };

  const clearAllFiles = () => {
    setSelectedFiles([]);
    setFileDetails([]);
    setFilteredOutFiles([]);
    setUploadProgress([]);
  };

  const isFileFilteredOut = (fileName) => {
    return filteredOutFiles.some(f => f.name === fileName);
  };

  const startIngestion = async () => {
    if (!selectedDataStream) {
      setError('Please select a data stream');
      return;
    }

    if (selectedFiles.length === 0) {
      setError('Please select at least one file');
      return;
    }

    setIsUploading(true);
    setError('');
    setUploadProgress([]);
    setActiveRightTab('ingestion'); // Activate Ingestion tab
    setIngestionStartTime(Date.now());
    setIngestionJobId(null);
    setIngestedFiles([]);

    try {
      // Get Data Cloud access token (handles 2-step authentication internally)
      updateProgress('Authenticating with Data Cloud (2-step process)...', 'pending');
      const dcTokenResponse = await axios.post('/api/datacloud/ingestion/get-dc-token', {}, {
        withCredentials: true
      });

      if (!dcTokenResponse.data.success) {
        throw new Error('Failed to get Data Cloud token: ' + dcTokenResponse.data.message);
      }
      const dcTenantUrl = dcTokenResponse.data.instanceUrl;
      const dcAccessToken = dcTokenResponse.data.accessToken;
      updateProgress(`Data Cloud authenticated - Tenant: ${dcTenantUrl}`, 'completed');

      // Step 3: Create ingestion job
      updateProgress('Creating ingestion job...', 'pending');
      
      // Use extracted sourceName and object from stream details, fallback to stream properties
      const jobSourceName = streamSourceName || selectedDataStream.name || selectedDataStream.apiName || 'DefaultSource';
      const jobObject = streamTargetObject || selectedDataStream.object || 'WebData';
      
      console.log('🚀 [INGESTION UI] Creating job with sourceName:', jobSourceName, 'object:', jobObject);
      
      const jobResponse = await axios.post('/api/datacloud/ingestion/create-job', {
        tenantUrl: dcTenantUrl,
        accessToken: dcAccessToken,
        object: jobObject,
        sourceName: jobSourceName,
        operation: 'upsert'
      }, {
        withCredentials: true
      });

      if (!jobResponse.data.success) {
        throw new Error('Failed to create ingestion job: ' + jobResponse.data.message);
      }
      const jobId = jobResponse.data.jobId;
      setIngestionJobId(jobId);
      updateProgress(`Ingestion job created: ${jobId}`, 'completed');

      // Step 4: Upload files in batches (use processed fileDetails, not selectedFiles)
      // Only upload files that were successfully processed
      const filesToUpload = fileDetails.filter(detail => detail.fileName);
      
      if (filesToUpload.length === 0) {
        throw new Error('No processed files to upload. Please process files first.');
      }

      updateProgress(`Preparing to upload ${filesToUpload.length} file(s)...`, 'pending');

      for (let i = 0; i < filesToUpload.length; i++) {
        const fileDetail = filesToUpload[i];
        updateProgress(`Uploading file ${i + 1}/${filesToUpload.length}: ${fileDetail.fileName}...`, 'pending');

        // Send file path info to backend - backend will read file from filesystem
        const uploadResponse = await axios.post('/api/datacloud/ingestion/upload-batch', {
          tenantUrl: dcTenantUrl,
          accessToken: dcAccessToken,
          jobId: jobId,
          filePath: fileDetail.filePath || null,
          fileName: fileDetail.fileName,
          baseFolderName: fileDetail.baseFolderName || null,
          baseDirectory: fileDetail.baseDirectory || null
        }, {
          withCredentials: true,
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 600000 // 10 minute timeout for large files
        });

        if (!uploadResponse.data.success) {
          throw new Error(`Failed to upload ${fileDetail.fileName}: ` + uploadResponse.data.message);
        }
        const uploadTimestamp = new Date().toLocaleTimeString();
        setIngestedFiles(prev => [...prev, {
          fileName: fileDetail.fileName,
          timestamp: uploadTimestamp,
          status: 'completed',
          size: fileDetail.fileSize
        }]);
        updateProgress(`Uploaded: ${fileDetail.fileName} (${formatFileSize(fileDetail.fileSize)})`, 'completed');
      }

      // Step 5: Complete the ingestion job
      updateProgress('Completing ingestion job...', 'pending');
      const completeResponse = await axios.post('/api/datacloud/ingestion/complete-job', {
        tenantUrl: dcTenantUrl,
        accessToken: dcAccessToken,
        jobId: jobId
      }, {
        withCredentials: true
      });

      if (!completeResponse.data.success) {
        throw new Error('Failed to complete ingestion job: ' + completeResponse.data.message);
      }
      updateProgress('✅ Ingestion completed successfully!', 'completed');

    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message;
      setError('Ingestion failed: ' + errorMessage);
      updateProgress('❌ Error: ' + errorMessage, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const updateProgress = (message, status) => {
    setUploadProgress(prev => [...prev, {
      message,
      status,
      timestamp: new Date().toLocaleTimeString()
    }]);
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const handleStreamSelect = async (stream) => {
    setSelectedDataStream(stream);
    setStreamDetails(null);
    setStreamSourceName(null);
    setStreamTargetObject(null);
    setConnectionDetails(null);
    setConnectionSchema(null);
    setActiveRightTab('data-stream'); // Activate Data Stream tab
    
    // Fetch stream details
    if (stream.id || stream.apiName) {
      setLoadingDetails(true);
      try {
        const response = await axios.get(`/api/datacloud/ingestion/streams/${stream.id || stream.apiName}/details`, {
          withCredentials: true
        });
        
        if (response.data.success) {
          setStreamDetails(response.data.details);
          
          // Extract sourceName and object from response
          if (response.data.sourceName) {
            console.log('📝 [INGESTION UI] Extracted sourceName:', response.data.sourceName);
            setStreamSourceName(response.data.sourceName);
          }
          if (response.data.object) {
            console.log('📦 [INGESTION UI] Extracted targetObject:', response.data.object);
            setStreamTargetObject(response.data.object);
          }
          // Extract connection details and schema
          if (response.data.connectionDetails) {
            console.log('🔗 [INGESTION UI] Extracted connectionDetails:', response.data.connectionDetails);
            setConnectionDetails(response.data.connectionDetails);
          }
          if (response.data.connectionSchema) {
            console.log('📐 [INGESTION UI] Extracted connectionSchema:', response.data.connectionSchema);
            setConnectionSchema(response.data.connectionSchema);
          }
        } else {
          console.error('Failed to fetch stream details:', response.data.message);
        }
      } catch (err) {
        console.error('Error fetching stream details:', err);
      } finally {
        setLoadingDetails(false);
      }
    }
  };

  return (
    <div className="ingestion-api-content">
      <div className="ingestion-api-layout">
        {/* Left Panel */}
        <div className="ingestion-left-panel">
          <div className="panel-section">
            <h3>🎯 Target Data Stream {!selectedDataStream && fileDetails.length > 0 && <span className="required-indicator">(Required to start ingestion)</span>}</h3>
            
            {loading ? (
              <div className="loading-state">Loading data streams...</div>
            ) : dataStreams.length === 0 ? (
              <div className="empty-state">
                <p>No ingestion API data streams found</p>
                <button className="refresh-btn" onClick={fetchDataStreams}>
                  🔄 Refresh
                </button>
              </div>
            ) : (
              <div className="data-stream-selector">
                {dataStreams.map((stream) => (
                  <div
                    key={stream.id || stream.apiName}
                    className={`stream-option ${selectedDataStream?.id === stream.id ? 'selected' : ''}`}
                    onClick={() => handleStreamSelect(stream)}
                  >
                    <div className="stream-name">{stream.name || stream.apiName}</div>
                    <div className="stream-meta">
                      {stream.object && <span className="stream-object">Object: {stream.object}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel-section">
            <h3>📄 File Selection</h3>
            
            <div className="format-selector">
              <label>File Format:</label>
              <select
                value={fileFormat}
                onChange={(e) => setFileFormat(e.target.value)}
                disabled={isUploading || isProcessingFiles}
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="txt">TXT</option>
              </select>
            </div>

            <div className="base-directory-selector">
              <label>Base Directory:</label>
              <input
                type="text"
                value={baseDirectory}
                onChange={(e) => setBaseDirectory(e.target.value)}
                placeholder="e.g., /Users/jinwang/Downloads/your-folder (leave empty for Downloads)"
                disabled={isUploading || isProcessingFiles}
                className="base-directory-input"
              />
              <div className="help-text-small">
                {selectedFolderPath 
                  ? `📁 Selected folder: ${selectedFolderPath} (will be combined with base directory)` 
                  : '💡 Tip: Use "Select Folder" for files in subfolders. "Select Files" only works for files directly in base directory.'}
              </div>
            </div>

            <div className="file-input-wrapper">
              <input
                type="file"
                id="file-input"
                multiple
                accept={`.${fileFormat}`}
                onChange={handleFileSelect}
                disabled={isUploading}
              />
              <label htmlFor="file-input" className="file-input-label">
                📄 Select Files
              </label>
              <input
                type="file"
                id="folder-input"
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleFolderSelect}
                disabled={isUploading || isProcessingFiles}
                style={{ display: 'none' }}
              />
              <label htmlFor="folder-input" className="file-input-label folder-label">
                📂 Select Folder (Recommended)
              </label>
            </div>

            {selectedFiles.length > 0 && (
              <div className="selected-files">
                <div className="files-header">
                  <span>Selected Files ({selectedFiles.length})</span>
                  {filteredOutFiles.length > 0 && (
                    <span className="filtered-count-badge">
                      {filteredOutFiles.length} filtered out
                    </span>
                  )}
                  {!isUploading && (
                    <button className="clear-files-btn" onClick={clearAllFiles}>
                      Clear All
                    </button>
                  )}
                </div>
                <div className="files-list">
                  {selectedFiles.map((file, index) => {
                    const isFiltered = isFileFilteredOut(file.name);
                    return (
                      <div key={index} className={`file-item ${isFiltered ? 'filtered-out' : ''}`}>
                        <div className="file-info">
                          <span className="file-number">{index + 1}.</span>
                          <span className={`file-name ${isFiltered ? 'filtered-text' : ''}`}>{file.name}</span>
                          <span className="file-size">{formatFileSize(file.size)}</span>
                          {isFiltered && (
                            <span className="filtered-badge">Filtered</span>
                          )}
                        </div>
                        {!isUploading && (
                          <button
                            className="remove-file-btn"
                            onClick={() => removeFile(index)}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="panel-section">
            <button
              className="start-ingestion-btn"
              onClick={startIngestion}
              disabled={isUploading || isProcessingFiles || !selectedDataStream || selectedFiles.length === 0 || fileDetails.length === 0}
            >
              {isUploading ? '⏳ Uploading...' : isProcessingFiles ? '⏳ Processing Files...' : '🚀 Start Ingestion'}
            </button>
          </div>

          {error && (
            <div className="error-message">
              <span className="error-icon">⚠️</span>
              {error}
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div className="ingestion-right-panel">
          {/* Sub-tab Navigation */}
          <div className="right-panel-tabs">
            <button
              className={`right-panel-tab ${activeRightTab === 'data-stream' ? 'active' : ''}`}
              onClick={() => setActiveRightTab('data-stream')}
            >
              📋 Data Stream
            </button>
            <button
              className={`right-panel-tab ${activeRightTab === 'processing' ? 'active' : ''}`}
              onClick={() => setActiveRightTab('processing')}
              disabled={!isProcessingFiles && fileDetails.length === 0}
            >
              📊 Processing Selected Files
            </button>
            <button
              className={`right-panel-tab ${activeRightTab === 'ingestion' ? 'active' : ''}`}
              onClick={() => setActiveRightTab('ingestion')}
              disabled={!isUploading && uploadProgress.length === 0}
            >
              🚀 Ingestion
            </button>
          </div>

          {/* Tab Content */}
          <div className="right-panel-content">
            {activeRightTab === 'data-stream' && (
              <div className="tab-pane">
                {selectedDataStream ? (
                  <>
                    {loadingDetails ? (
                      <div className="loading-state">Loading stream details...</div>
                    ) : streamDetails ? (
                      <div className="stream-details">
                        <div className="detail-section">
                          <h4>Basic Information</h4>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <label>Name:</label>
                              <span>{streamDetails.name || streamDetails.label || selectedDataStream.name}</span>
                            </div>
                            <div className="detail-item">
                              <label>API Name:</label>
                              <span>{streamDetails.apiName || streamDetails.developerName || streamDetails.name || selectedDataStream.apiName}</span>
                            </div>
                            {streamDetails.object && (
                              <div className="detail-item">
                                <label>Target Object:</label>
                                <span>{streamDetails.object}</span>
                              </div>
                            )}
                            {streamDetails.dataStreamType && (
                              <div className="detail-item">
                                <label>Type:</label>
                                <span>{streamDetails.dataStreamType}</span>
                              </div>
                            )}
                            {streamDetails.id && (
                              <div className="detail-item">
                                <label>ID:</label>
                                <span className="detail-id">{streamDetails.id}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {streamDetails.schema && (
                          <div className="detail-section">
                            <h4>Schema</h4>
                            <div className="schema-container">
                              <pre className="schema-json">{JSON.stringify(streamDetails.schema, null, 2)}</pre>
                            </div>
                          </div>
                        )}

                        {streamDetails.fields && streamDetails.fields.length > 0 && (
                          <div className="detail-section">
                            <h4>Fields ({streamDetails.fields.length})</h4>
                            <div className="fields-table-container">
                              <table className="fields-table">
                                <thead>
                                  <tr>
                                    <th>Field Name</th>
                                    <th>Label</th>
                                    <th>Type</th>
                                    <th>Required</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {streamDetails.fields.map((field, index) => (
                                    <tr key={index}>
                                      <td className="field-name">{field.name || field.apiName}</td>
                                      <td>{field.label || field.name}</td>
                                      <td className="field-type">{field.type || field.dataType}</td>
                                      <td>{field.required ? '✓' : ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {streamDetails.description && (
                          <div className="detail-section">
                            <h4>Description</h4>
                            <p className="description-text">{streamDetails.description}</p>
                          </div>
                        )}

                        {connectionDetails && (
                          <div className="detail-section">
                            <h4>Connection Details</h4>
                            <div className="schema-container">
                              <pre className="schema-json">{JSON.stringify(connectionDetails, null, 2)}</pre>
                            </div>
                          </div>
                        )}

                        {connectionSchema && (
                          <div className="detail-section">
                            <h4>Connection Schema</h4>
                            <div className="schema-container">
                              <pre className="schema-json">{JSON.stringify(connectionSchema, null, 2)}</pre>
                            </div>
                          </div>
                        )}

                        {!streamDetails.schema && !streamDetails.fields && (
                          <div className="detail-section">
                            <h4>Data Stream Details</h4>
                            <div className="schema-container">
                              <pre className="schema-json">{JSON.stringify(streamDetails, null, 2)}</pre>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="empty-progress">
                        <p>No details available for this stream</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-progress">
                    <p>Select a data stream to view details</p>
                  </div>
                )}
              </div>
            )}

            {activeRightTab === 'processing' && (
              <div className="tab-pane">
                {isProcessingFiles || fileDetails.length > 0 ? (
                  <div className="processing-progress-section">
                    {isProcessingFiles && (
                      <>
                        <div className="progress-bar-container">
                          <div className="progress-bar">
                            <div 
                              className="progress-bar-fill" 
                              style={{ width: `${(processingProgress.current / processingProgress.total) * 100}%` }}
                            ></div>
                          </div>
                          <div className="progress-text">
                            Processing file {processingProgress.current} of {processingProgress.total}
                          </div>
                          <div className="progress-time">
                            Elapsed time: {formatTime(elapsedTime)}
                          </div>
                        </div>
                        
                        {currentProcessingFile && (
                          <div className="current-file-card">
                            <div className="current-file-header">
                              <span className="current-file-label">Currently Processing:</span>
                              <span className="current-file-badge">File {currentProcessingFile.index}/{currentProcessingFile.total}</span>
                            </div>
                            <div className="current-file-name">{currentProcessingFile.name}</div>
                            <div className="current-file-info">
                              <span className="current-file-size">{formatFileSize(currentProcessingFile.size)}</span>
                              <span className="current-file-time">⏱️ Elapsed: {getCurrentFileElapsedTime()}</span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    
                    {fileDetails.length > 0 && (
                      <>
                        {!isProcessingFiles && (
                          <div className="completion-message">
                            ✅ All files processed successfully! Select a data stream above and click "Start Ingestion" to begin uploading.
                          </div>
                        )}
                        <div className="total-records-summary">
                          <span className="total-label">Total Records Processed:</span>
                          <span className="total-count-large">
                            {fileDetails.reduce((sum, file) => sum + (file.recordCount || 0), 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="processed-files-preview">
                          <h4>Processed Files ({fileDetails.length})</h4>
                          <div className="file-details-list">
                            {[...fileDetails].reverse().map((detail, index) => (
                              <div key={index} className="file-detail-card">
                                <div className="file-detail-header">
                                  <span className="file-detail-name">{detail.fileName}</span>
                                  <span className="file-detail-count">{detail.recordCount.toLocaleString()} records</span>
                                </div>
                                <div className="file-detail-info">
                                  <span className="file-detail-size">{formatFileSize(detail.fileSize)}</span>
                                  {detail.headers && detail.headers.length > 0 && (
                                    <span className="file-detail-fields">{detail.headers.length} columns</span>
                                  )}
                                  {detail.processingTime !== undefined && (
                                    <span className="file-detail-time">⏱️ {formatTime(detail.processingTime)}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="empty-progress">
                    <p>No files processed yet</p>
                    <p className="help-text">Select files to begin processing</p>
                  </div>
                )}
              </div>
            )}

            {activeRightTab === 'ingestion' && (
              <div className="tab-pane ingestion-tab-pane">
                {isUploading || uploadProgress.length > 0 ? (
                  <>
                    {/* Fixed Top Section - Single Line */}
                    <div className="ingestion-fixed-header">
                      {ingestionJobId && (
                        <div className="ingestion-header-item">
                          <span className="header-label">Job ID:</span>
                          <span className="header-value">{ingestionJobId}</span>
                        </div>
                      )}
                      {ingestionStartTime && (
                        <div className="ingestion-header-item">
                          <span className="header-label">Started:</span>
                          <span className="header-value">{new Date(ingestionStartTime).toLocaleString()}</span>
                        </div>
                      )}
                      {ingestionElapsedTime > 0 && (
                        <div className="ingestion-header-item">
                          <span className="header-label">Elapsed:</span>
                          <span className="header-value">{formatTime(ingestionElapsedTime)}</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Fixed Progress Bar */}
                    {isUploading && fileDetails.length > 0 && (
                      <div className="ingestion-fixed-progress">
                        <div className="progress-bar-container">
                          <div className="progress-bar">
                            <div 
                              className="progress-bar-fill" 
                              style={{ width: `${(ingestedFiles.length / fileDetails.length) * 100}%` }}
                            ></div>
                          </div>
                          <div className="progress-text">
                            Uploaded {ingestedFiles.length} of {fileDetails.length} files
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Scrollable Progress List - Latest at Top */}
                    <div className="ingestion-scrollable-content">
                      <div className="ingestion-progress-list">
                        {[...uploadProgress].reverse().map((item, index) => (
                          <div key={`${item.timestamp}-${index}`} className={`progress-item ${item.status}`}>
                            <div className="progress-header">
                              <span className={`status-icon ${item.status}`}>
                                {item.status === 'completed' ? '✓' : 
                                 item.status === 'error' ? '✕' : 
                                 '⏳'}
                              </span>
                              <span className="progress-timestamp">{item.timestamp}</span>
                            </div>
                            <div className="progress-message">{item.message}</div>
                          </div>
                        ))}
                      </div>

                      {ingestedFiles.length > 0 && (
                        <div className="ingested-files-section">
                          <h4>Ingested Files ({ingestedFiles.length})</h4>
                          <div className="file-details-list">
                            {[...ingestedFiles].reverse().map((file, index) => (
                              <div key={`${file.timestamp}-${index}`} className="file-detail-card">
                                <div className="file-detail-header">
                                  <span className="file-detail-name">{file.fileName}</span>
                                  <span className={`status-badge ${file.status}`}>
                                    {file.status === 'completed' ? '✓ Uploaded' : 
                                     file.status === 'error' ? '✕ Failed' : 
                                     '⏳ Uploading'}
                                  </span>
                                </div>
                                <div className="file-detail-info">
                                  {file.size && <span className="file-detail-size">{formatFileSize(file.size)}</span>}
                                  {file.timestamp && (
                                    <span className="file-detail-time">⏱️ {file.timestamp}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="empty-progress">
                    <p>No ingestion in progress</p>
                    <p className="help-text">Click "Start Ingestion" to begin uploading files</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default IngestionAPITab;


          