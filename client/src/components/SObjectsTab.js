import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './SObjectsTab.css';
import SObjectDetailsTab from './SObjectDetailsTab';
import SObjectQueryTab from './SObjectQueryTab';
import FreeSOQLEditorTab from './FreeSOQLEditorTab';

const SObjectsTab = ({
  // State props
  searchQuery,
  searchResults,
  allSObjects,
  selectedSObject,
  describe,
  showAllSObjects,
  loading,
  error,
  // Function props
  searchSObjects,
  selectSObject,
  toggleShowAllSObjects,
  clearSObjectsState
}) => {
  const [searchInput, setSearchInput] = useState(searchQuery || '');
  const [dropdownSelection, setDropdownSelection] = useState('');
  
  // Sub-tab state
  const [activeSubTab, setActiveSubTab] = useState('details'); // 'details', 'query', or 'free-soql'
  
  // Field search state
  const [searchMode, setSearchMode] = useState('object'); // 'object' or 'field'
  const [fieldSearchInput, setFieldSearchInput] = useState('');
  const [fieldSearchResults, setFieldSearchResults] = useState([]);
  const [fieldSearchLoading, setFieldSearchLoading] = useState(false);
  const [fieldSearchError, setFieldSearchError] = useState(null);
  const [cacheStatus, setCacheStatus] = useState({ cached: false, checking: true });
  const [buildingCache, setBuildingCache] = useState(false)

  // Filter out objects with unwanted suffixes
  // eslint-disable-next-line no-unused-vars
  const filteredSearchResults = searchResults.filter(sobject => {
    const name = sobject.name.toLowerCase();
    return !name.endsWith('history') && 
           !name.endsWith('changeevent') && 
           !name.endsWith('feed') &&
           !name.endsWith('share') &&
           !name.endsWith('sharingrule');
  });

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchInput.trim() !== searchQuery) {
        searchSObjects(searchInput);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchInput, searchQuery, searchSObjects]);

  // Update local input when prop changes (for tab switching)
  useEffect(() => {
    setSearchInput(searchQuery || '');
  }, [searchQuery]);

  const handleSObjectSelect = (sobject) => {
    selectSObject(sobject);
  };

  const handleDropdownChange = (e) => {
    const sobjectName = e.target.value;
    setDropdownSelection(sobjectName);
    
    if (sobjectName) {
      const selectedSObj = allSObjects.find(obj => obj.name === sobjectName);
      if (selectedSObj) {
        selectSObject(selectedSObj);
      }
    }
  };

  const handleShowAllToggle = (e) => {
    const checked = e.target.checked;
    toggleShowAllSObjects(checked);
    if (!checked) {
      setDropdownSelection('');
    }
  };

  // Field search functions
  const checkCacheStatus = async () => {
    try {
      const response = await axios.get('/api/sobjects/field-search/cache-status');
      setCacheStatus({
        cached: response.data.cached,
        sobjectCount: response.data.sobjectCount,
        cachedAt: response.data.cachedAt,
        checking: false
      });
    } catch (err) {
      console.error('Error checking cache status:', err);
      setCacheStatus({ cached: false, checking: false });
    }
  };

  const buildCache = async () => {
    setBuildingCache(true);
    setFieldSearchError(null);
    try {
      const response = await axios.post('/api/sobjects/field-search/build-cache');
      setCacheStatus({
        cached: true,
        sobjectCount: response.data.sobjectCount,
        cachedAt: response.data.cachedAt,
        checking: false
      });
      alert(`Cache built successfully! ${response.data.sobjectCount} SObjects cached.`);
    } catch (err) {
      console.error('Error building cache:', err);
      setFieldSearchError('Failed to build cache: ' + (err.response?.data?.message || err.message));
    } finally {
      setBuildingCache(false);
    }
  };

  const searchByFieldName = async (query) => {
    if (!query || query.trim().length < 2) {
      setFieldSearchResults([]);
      setFieldSearchError(null);
      return;
    }

    setFieldSearchLoading(true);
    setFieldSearchError(null);
    
    try {
      const response = await axios.get('/api/sobjects/field-search/search', {
        params: { query: query.trim() }
      });
      
      if (response.data.cacheRequired) {
        setFieldSearchError('Cache not found. Please build the cache first.');
        setFieldSearchResults([]);
      } else {
        setFieldSearchResults(response.data.sobjects || []);
      }
    } catch (err) {
      console.error('Error searching by field:', err);
      setFieldSearchError('Failed to search: ' + (err.response?.data?.message || err.message));
      setFieldSearchResults([]);
    } finally {
      setFieldSearchLoading(false);
    }
  };

  // Check cache status on mount when in field mode
  useEffect(() => {
    if (searchMode === 'field') {
      checkCacheStatus();
    }
  }, [searchMode]);

  // Debounced field search
  useEffect(() => {
    if (searchMode === 'field') {
      const timeoutId = setTimeout(() => {
        searchByFieldName(fieldSearchInput);
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [fieldSearchInput, searchMode]);

  const handleSearchModeChange = (mode) => {
    setSearchMode(mode);
    if (mode === 'field') {
      checkCacheStatus();
    }
  };


  return (
    <div className="tab-content">
      <div className="dashboard-content sobjects-content">
        <div className="sobjects-layout-expanded">
          {/* Left Panel - Search */}
          <div className="sobjects-left-panel-compact">
            <div className="sobjects-search-section">
              <h3>🔍 Search SObjects</h3>
              
              {/* Search Mode Tabs */}
              <div className="search-mode-tabs" style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '15px',
                borderBottom: '1px solid #4b5563'
              }}>
                <button
                  className={`mode-tab ${searchMode === 'object' ? 'active' : ''}`}
                  onClick={() => handleSearchModeChange('object')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: searchMode === 'object' ? '#374151' : 'transparent',
                    color: searchMode === 'object' ? '#fff' : '#9ca3af',
                    border: 'none',
                    borderBottom: searchMode === 'object' ? '2px solid #3b82f6' : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    transition: 'all 0.2s'
                  }}
                >
                  📦 By Object Name
                </button>
                <button
                  className={`mode-tab ${searchMode === 'field' ? 'active' : ''}`}
                  onClick={() => handleSearchModeChange('field')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: searchMode === 'field' ? '#374151' : 'transparent',
                    color: searchMode === 'field' ? '#fff' : '#9ca3af',
                    border: 'none',
                    borderBottom: searchMode === 'field' ? '2px solid #3b82f6' : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    transition: 'all 0.2s'
                  }}
                >
                  📝 By Field Name
                </button>
              </div>
              
              {/* Object Search Mode */}
              {searchMode === 'object' && (
                <>
              <div className="search-input-container">
                <input
                  type="text"
                  placeholder="Type SObject name or label..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="sobject-search-input"
                />
                {searchInput && (
                  <button
                    onClick={() => {
                      setSearchInput('');
                      clearSObjectsState();
                    }}
                    className="clear-search-btn"
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Search Results */}
              <div className="search-results">
                {filteredSearchResults.length > 0 ? (
                  <React.Fragment>
                    <div className="results-header">
                      <span>Found {filteredSearchResults.length} SObjects</span>
                      {searchResults.length !== filteredSearchResults.length && (
                        <span style={{ fontSize: '0.85em', color: '#6b7280', marginLeft: '8px' }}>
                          ({searchResults.length - filteredSearchResults.length} filtered out)
                        </span>
                      )}
                    </div>
                    <div className="results-list">
                      {filteredSearchResults.map((sobject, index) => (
                      <div
                        key={sobject.name}
                        className={`result-item ${selectedSObject?.name === sobject.name ? 'selected' : ''}`}
                        onClick={() => handleSObjectSelect(sobject)}
                      >
                        <div className="sobject-name">
                          <strong>{sobject.name}</strong>
                          {sobject.custom && (
                            <span
                              className="custom-badge-left"
                              style={{
                                backgroundColor: '#fbbf24',
                                color: '#1f2937',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                marginLeft: '8px',
                                border: 'none',
                                background: '#fbbf24',
                                display: 'inline-block',
                                minWidth: 'auto',
                                textAlign: 'center',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {sobject.name.endsWith('__e') ? 'PLATFORM EVENT' : 
                               sobject.name.endsWith('__mdt') ? 'CUSTOM META DATA' : 
                               'CUSTOM'}
                            </span>
                          )}
                        </div>
                      </div>
                      ))}
                    </div>
                  </React.Fragment>
                ) : (
                  <div className="no-results-message">
                    <p>No SObjects found. Try searching for a different term.</p>
                  </div>
                )}
              </div>

              {/* Show All SObjects Option */}
              <div className="show-all-section">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={showAllSObjects}
                    onChange={handleShowAllToggle}
                    className="checkbox-input"
                  />
                  <span className="checkbox-text">Show all SObjects in dropdown</span>
                </label>

                {showAllSObjects && (
                  <div className="all-sobjects-dropdown">
                    <select
                      value={dropdownSelection}
                      onChange={handleDropdownChange}
                      className="sobject-select"
                      disabled={loading}
                    >
                      <option value="">-- Select an SObject --</option>
                      {allSObjects.map(sobject => (
                        <option key={sobject.name} value={sobject.name}>
                          {sobject.name} - {sobject.label}
                        </option>
                      ))}
                    </select>
                    {allSObjects.length > 0 && (
                      <div className="dropdown-info">
                        {allSObjects.length} SObjects available
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Loading and Error States */}
              {loading && (
                <div className="loading-message">
                  🔄 Loading...
                </div>
              )}

              {error && (
                <div className="error-message">
                  ⚠️ {error}
                </div>
              )}
              </>
              )}
              
              {/* Field Search Mode */}
              {searchMode === 'field' && (
                <>
                  {/* Cache Status */}
                  {cacheStatus.checking ? (
                    <div style={{ padding: '15px', color: '#9ca3af', textAlign: 'center' }}>
                      🔄 Checking cache status...
                    </div>
                  ) : !cacheStatus.cached ? (
                    <div style={{
                      padding: '15px',
                      backgroundColor: '#374151',
                      borderRadius: '6px',
                      border: '1px solid #4b5563',
                      marginBottom: '15px'
                    }}>
                      <p style={{ color: '#fbbf24', marginBottom: '10px', fontSize: '14px' }}>
                        ⚠️ Cache not built yet
                      </p>
                      <p style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '15px' }}>
                        To search by field name, we need to build a cache of all field metadata first. This is a one-time operation that takes 1-2 minutes.
                      </p>
                      <button
                        onClick={buildCache}
                        disabled={buildingCache}
                        style={{
                          width: '100%',
                          padding: '10px',
                          background: buildingCache ? '#6b7280' : '#3b82f6',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: buildingCache ? 'not-allowed' : 'pointer',
                          fontSize: '14px',
                          fontWeight: '500'
                        }}
                      >
                        {buildingCache ? '🔄 Building Cache...' : '🔧 Build Cache Now'}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{
                        padding: '10px',
                        backgroundColor: '#1e3a5f',
                        borderRadius: '6px',
                        border: '1px solid #3b82f6',
                        marginBottom: '15px',
                        fontSize: '13px',
                        color: '#93c5fd'
                      }}>
                        ✅ Cache ready: {cacheStatus.sobjectCount} SObjects
                        {cacheStatus.cachedAt && (
                          <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                            Updated: {new Date(cacheStatus.cachedAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                      
                      <div className="search-input-container">
                        <input
                          type="text"
                          placeholder="Search by field API name or label..."
                          value={fieldSearchInput}
                          onChange={(e) => setFieldSearchInput(e.target.value)}
                          className="sobject-search-input"
                          style={{
                            backgroundColor: '#1f2937',
                            color: '#e5e7eb',
                            border: '1px solid #4b5563'
                          }}
                        />
                        {fieldSearchInput && (
                          <button
                            onClick={() => setFieldSearchInput('')}
                            className="clear-search-btn"
                            title="Clear search"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {/* Field Search Results */}
                      <div className="search-results" style={{ marginTop: '15px' }}>
                        {fieldSearchLoading ? (
                          <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>
                            🔄 Searching...
                          </div>
                        ) : fieldSearchError ? (
                          <div style={{
                            padding: '15px',
                            backgroundColor: '#7f1d1d',
                            borderRadius: '6px',
                            border: '1px solid #ef4444',
                            color: '#fca5a5',
                            fontSize: '14px'
                          }}>
                            ⚠️ {fieldSearchError}
                          </div>
                        ) : fieldSearchResults.length > 0 ? (
                          <React.Fragment>
                            <div className="results-header" style={{ color: '#e5e7eb' }}>
                              <span>Found {fieldSearchResults.length} SObjects with matching fields</span>
                            </div>
                            <div className="results-list">
                              {fieldSearchResults.map((sobject) => (
                                <div
                                  key={sobject.name}
                                  className={`result-item ${selectedSObject?.name === sobject.name ? 'selected' : ''}`}
                                  onClick={() => handleSObjectSelect(sobject)}
                                  style={{
                                    backgroundColor: selectedSObject?.name === sobject.name ? '#374151' : 'transparent'
                                  }}
                                >
                                  <div className="sobject-name">
                                    <strong style={{ color: '#e5e7eb' }}>{sobject.name}</strong>
                                    {sobject.custom && (
                                      <span
                                        className="custom-badge-left"
                                        style={{
                                          backgroundColor: '#fbbf24',
                                          color: '#1f2937',
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          fontSize: '0.7rem',
                                          fontWeight: '600',
                                          marginLeft: '8px'
                                        }}
                                      >
                                        CUSTOM
                                      </span>
                                    )}
                                  </div>
                                  <div style={{
                                    fontSize: '12px',
                                    color: '#9ca3af',
                                    marginTop: '4px'
                                  }}>
                                    {sobject.matchCount} matching field{sobject.matchCount !== 1 ? 's' : ''}
                                  </div>
                                  <div style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '4px',
                                    marginTop: '6px'
                                  }}>
                                    {sobject.matchingFields.slice(0, 5).map((field, idx) => (
                                      <span
                                        key={idx}
                                        style={{
                                          fontSize: '11px',
                                          padding: '2px 6px',
                                          backgroundColor: '#1f2937',
                                          border: '1px solid #4b5563',
                                          borderRadius: '4px',
                                          color: '#93c5fd'
                                        }}
                                      >
                                        {field.name} ({field.type})
                                      </span>
                                    ))}
                                    {sobject.matchingFields.length > 5 && (
                                      <span style={{
                                        fontSize: '11px',
                                        padding: '2px 6px',
                                        color: '#6b7280'
                                      }}>
                                        +{sobject.matchingFields.length - 5} more
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </React.Fragment>
                        ) : fieldSearchInput.trim().length >= 2 ? (
                          <div className="no-results-message" style={{ color: '#9ca3af' }}>
                            <p>No SObjects found with matching fields.</p>
                          </div>
                        ) : (
                          <div className="no-results-message" style={{ color: '#9ca3af' }}>
                            <p>Type at least 2 characters to search for fields...</p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right Panel - Details with Sub-tabs */}
          <div className="sobjects-right-panel-expanded">
            {!selectedSObject ? (
              <div className="no-selection-placeholder">
                <div className="placeholder-content">
                  <h3>🗃️ SObject Details</h3>
                  <p>Search for an SObject to view its details and query records</p>
                  <div className="help-text">
                    <p>💡 <strong>Tips:</strong></p>
                    <ul>
                      <li>Type partial names like "Acc" to find "Account"</li>
                      <li>Search by labels like "Contact" or "Opportunity"</li>
                      <li>Use the "Show all SObjects" option to browse everything</li>
                      <li>After selecting an SObject, use the "SOQL Query" tab to view and filter records</li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="sobject-details">
                <div className="sobject-header">
                  <div className="sobject-title-row">
                    <h3>📋 {selectedSObject.name}</h3>
                    <div className="sobject-meta">
                      <span className="sobject-label">{selectedSObject.label}</span>
                      {selectedSObject.custom && (
                        <span 
                          className="custom-badge"
                          style={{
                            backgroundColor: '#fbbf24',
                            color: '#1f2937',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}
                        >
                          {selectedSObject.name.endsWith('__e') ? 'PLATFORM EVENT' : 
                           selectedSObject.name.endsWith('__mdt') ? 'CUSTOM META DATA' : 
                           'CUSTOM'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sub-tabs Navigation */}
                <div className="sobject-subtabs">
                  <button 
                    className={`subtab-button ${activeSubTab === 'details' ? 'active' : ''}`}
                    onClick={() => setActiveSubTab('details')}
                  >
                    📊 Details
                  </button>
                  <button 
                    className={`subtab-button ${activeSubTab === 'query' ? 'active' : ''}`}
                    onClick={() => setActiveSubTab('query')}
                  >
                    🔍 SOQL Query
                  </button>
                  <button 
                    className={`subtab-button ${activeSubTab === 'free-soql' ? 'active' : ''}`}
                    onClick={() => setActiveSubTab('free-soql')}
                  >
                    ✏️ Free SOQL Editor
                  </button>
                </div>

                {/* Sub-tab Content */}
                <div className="subtab-content">
                  {/* Details Tab Content */}
                  {activeSubTab === 'details' && (
                    <SObjectDetailsTab
                      selectedSObject={selectedSObject}
                      describe={describe}
                      loading={loading}
                      error={error}
                    />
                  )}

                  {/* SOQL Query Tab Content */}
                  {activeSubTab === 'query' && (
                    <SObjectQueryTab
                      selectedSObject={selectedSObject}
                    />
                  )}

                  {/* Free SOQL Editor Tab Content */}
                  {activeSubTab === 'free-soql' && (
                    <FreeSOQLEditorTab />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SObjectsTab;