import React, { useState, useEffect } from 'react';
import './SObjectsTab.css';
import SObjectDetailsTab from './SObjectDetailsTab';
import SObjectQueryTab from './SObjectQueryTab';

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
  const [activeSubTab, setActiveSubTab] = useState('details'); // 'details' or 'query'

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





  return (
    <div className="tab-content">
      <div className="dashboard-content sobjects-content">
        <div className="sobjects-layout sobjects-layout-expanded">
          {/* Left Panel - Search */}
          <div className="sobjects-left-panel sobjects-left-panel-compact">
            <div className="search-section">
              <h3>🔍 Search SObjects</h3>
              
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
              {searchResults.length > 0 && (
                <div className="search-results">
                  <div className="results-header">
                    <span>Found {searchResults.length} SObjects</span>
                  </div>
                  <div className="results-list">
                    {searchResults.map((sobject, index) => (
                      <div
                        key={sobject.name}
                        className={`result-item ${selectedSObject?.name === sobject.name ? 'selected' : ''}`}
                        onClick={() => handleSObjectSelect(sobject)}
                      >
                        <div className="sobject-name">
                          <strong>{sobject.name}</strong>
                          {sobject.custom && <span className="custom-badge">Custom</span>}
                        </div>
                        <div className="sobject-label">{sobject.label}</div>
                        <div className="sobject-properties">
                          {sobject.keyPrefix && <span className="key-prefix">{sobject.keyPrefix}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
            </div>
          </div>

          {/* Right Panel - Details with Sub-tabs */}
          <div className="sobjects-right-panel sobjects-right-panel-expanded">
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
                  <h3>📋 {selectedSObject.name}</h3>
                  <div className="sobject-meta">
                    <span className="sobject-label">{selectedSObject.label}</span>
                    {selectedSObject.custom && <span className="custom-badge">Custom</span>}
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