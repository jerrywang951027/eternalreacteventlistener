import React, { useState, useEffect } from 'react';

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
  const [hoveredField, setHoveredField] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });

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

  const renderFieldType = (field) => {
    let typeDisplay = field.type;
    
    if (field.length && field.type !== 'boolean') {
      typeDisplay += `(${field.length})`;
    }
    
    if (field.precision && field.scale !== undefined) {
      typeDisplay += `(${field.precision},${field.scale})`;
    }

    return typeDisplay;
  };

  const renderFieldProperties = (field) => {
    const props = [];
    
    if (field.custom) props.push('Custom');
    if (field.unique) props.push('Unique');
    if (field.externalId) props.push('External ID');
    if (field.autoNumber) props.push('Auto Number');
    if (field.calculated) props.push('Formula');
    if (!field.nillable && field.createable) props.push('Required');
    if (field.nameField) props.push('Name Field');
    
    return props.length > 0 ? props.join(', ') : '-';
  };

  const groupFieldsByCategory = (fields) => {
    const standard = fields.filter(f => !f.custom);
    const custom = fields.filter(f => f.custom);
    
    return { standard, custom };
  };

  const handleFieldHover = (field, event) => {
    if (field.type === 'picklist' && field.picklistValues && field.picklistValues.length > 0) {
      const rect = event.target.getBoundingClientRect();
      const popupWidth = 400; // max width from CSS
      const popupHeight = Math.min(400, field.picklistValues.length * 25 + 60); // estimate height
      
      let x = rect.right + 10;
      let y = rect.top;
      
      // Check if popup would go off the right edge of screen
      if (x + popupWidth > window.innerWidth) {
        x = rect.left - popupWidth - 10; // Show on left side instead
      }
      
      // Check if popup would go off the bottom of screen
      if (y + popupHeight > window.innerHeight) {
        y = window.innerHeight - popupHeight - 10; // Adjust to stay in view
      }
      
      // Make sure it doesn't go above the top
      if (y < 10) {
        y = 10;
      }
      
      setPopupPosition({ x, y });
      setHoveredField(field);
    }
  };

  const handleFieldLeave = () => {
    setHoveredField(null);
  };

  return (
    <div className="tab-content">
      <div className="dashboard-content sobjects-content">
        <div className="sobjects-layout">
          {/* Left Panel - Search */}
          <div className="sobjects-left-panel">
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

          {/* Right Panel - Details */}
          <div className="sobjects-right-panel">
            {!selectedSObject ? (
              <div className="no-selection-placeholder">
                <div className="placeholder-content">
                  <h3>🗃️ SObject Details</h3>
                  <p>Search for an SObject to view its details</p>
                  <div className="help-text">
                    <p>💡 <strong>Tips:</strong></p>
                    <ul>
                      <li>Type partial names like "Acc" to find "Account"</li>
                      <li>Search by labels like "Contact" or "Opportunity"</li>
                      <li>Use the "Show all SObjects" option to browse everything</li>
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

                {loading && describe === null ? (
                  <div className="loading-details">
                    🔄 Loading SObject details...
                  </div>
                ) : describe ? (
                  <div className="describe-content">
                    {/* Object Properties */}
                    <div className="object-properties">
                      <h4>📊 Object Properties</h4>
                      <div className="properties-grid">
                        <div className="property">
                          <label>API Name:</label>
                          <span>{describe.name}</span>
                        </div>
                        <div className="property">
                          <label>Label:</label>
                          <span>{describe.label}</span>
                        </div>
                        <div className="property">
                          <label>Plural Label:</label>
                          <span>{describe.labelPlural}</span>
                        </div>
                        <div className="property">
                          <label>Key Prefix:</label>
                          <span>{describe.keyPrefix || 'N/A'}</span>
                        </div>
                        <div className="property">
                          <label>Custom:</label>
                          <span>{describe.custom ? 'Yes' : 'No'}</span>
                        </div>
                      </div>

                      <div className="permissions-grid">
                        <div className="permission">
                          <label>Queryable:</label>
                          <span className={describe.queryable ? 'yes' : 'no'}>
                            {describe.queryable ? '✅ Yes' : '❌ No'}
                          </span>
                        </div>
                        <div className="permission">
                          <label>Createable:</label>
                          <span className={describe.createable ? 'yes' : 'no'}>
                            {describe.createable ? '✅ Yes' : '❌ No'}
                          </span>
                        </div>
                        <div className="permission">
                          <label>Updateable:</label>
                          <span className={describe.updateable ? 'yes' : 'no'}>
                            {describe.updateable ? '✅ Yes' : '❌ No'}
                          </span>
                        </div>
                        <div className="permission">
                          <label>Deletable:</label>
                          <span className={describe.deletable ? 'yes' : 'no'}>
                            {describe.deletable ? '✅ Yes' : '❌ No'}
                          </span>
                        </div>
                        <div className="permission">
                          <label>Searchable:</label>
                          <span className={describe.searchable ? 'yes' : 'no'}>
                            {describe.searchable ? '✅ Yes' : '❌ No'}
                          </span>
                        </div>
                        <div className="permission">
                          <label>Triggerable:</label>
                          <span className={describe.triggerable ? 'yes' : 'no'}>
                            {describe.triggerable ? '✅ Yes' : '❌ No'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Fields */}
                    <div className="fields-section">
                      <h4>📝 Fields ({describe.fields.length})</h4>
                      
                      {(() => {
                        const { standard, custom } = groupFieldsByCategory(describe.fields);
                        return (
                          <div className="fields-container">
                            {custom.length > 0 && (
                              <div className="field-group">
                                <h5>🔧 Custom Fields ({custom.length})</h5>
                                <div className="fields-table">
                                  <table>
                                    <thead>
                                      <tr>
                                        <th>API Name</th>
                                        <th>Label</th>
                                        <th>Type</th>
                                        <th>Properties</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {custom.map(field => (
                                        <tr key={field.name}>
                                          <td 
                                            className={`field-name ${field.type === 'picklist' ? 'picklist-field' : ''}`}
                                            onMouseEnter={(e) => handleFieldHover(field, e)}
                                            onMouseLeave={handleFieldLeave}
                                          >
                                            {field.name}
                                            {field.type === 'picklist' && field.picklistValues && field.picklistValues.length > 0 && (
                                              <span className="picklist-indicator">📋</span>
                                            )}
                                          </td>
                                          <td className="field-label">{field.label}</td>
                                          <td className="field-type">{renderFieldType(field)}</td>
                                          <td className="field-properties">{renderFieldProperties(field)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            <div className="field-group">
                              <h5>🏠 Standard Fields ({standard.length})</h5>
                              <div className="fields-table">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>API Name</th>
                                      <th>Label</th>
                                      <th>Type</th>
                                      <th>Properties</th>
                                    </tr>
                                  </thead>
                                                                      <tbody>
                                      {standard.map(field => (
                                        <tr key={field.name}>
                                          <td 
                                            className={`field-name ${field.type === 'picklist' ? 'picklist-field' : ''}`}
                                            onMouseEnter={(e) => handleFieldHover(field, e)}
                                            onMouseLeave={handleFieldLeave}
                                          >
                                            {field.name}
                                            {field.type === 'picklist' && field.picklistValues && field.picklistValues.length > 0 && (
                                              <span className="picklist-indicator">📋</span>
                                            )}
                                          </td>
                                          <td className="field-label">{field.label}</td>
                                          <td className="field-type">{renderFieldType(field)}</td>
                                          <td className="field-properties">{renderFieldProperties(field)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Child Relationships */}
                    {describe.childRelationships && describe.childRelationships.length > 0 && (
                      <div className="relationships-section">
                        <h4>🔗 Child Relationships ({describe.childRelationships.length})</h4>
                        <div className="relationships-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Child SObject</th>
                                <th>Field</th>
                                <th>Relationship Name</th>
                                <th>Cascade Delete</th>
                              </tr>
                            </thead>
                            <tbody>
                              {describe.childRelationships.map((rel, index) => (
                                <tr key={index}>
                                  <td>{rel.childSObject}</td>
                                  <td>{rel.field}</td>
                                  <td>{rel.relationshipName || 'N/A'}</td>
                                  <td>{rel.cascadeDelete ? '✅ Yes' : '❌ No'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : error ? (
                  <div className="error-details">
                    <p>⚠️ Failed to load SObject details</p>
                    <p>{error}</p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Picklist Values Popup */}
      {hoveredField && hoveredField.type === 'picklist' && hoveredField.picklistValues && (
        <div 
          className="picklist-popup"
          style={{
            position: 'fixed',
            left: popupPosition.x,
            top: popupPosition.y,
            zIndex: 1000
          }}
        >
          <div className="picklist-popup-header">
            <strong>{hoveredField.name}</strong> - Picklist Values ({hoveredField.picklistValues.length})
          </div>
          <div className="picklist-values-list">
            {hoveredField.picklistValues.map((value, index) => (
              <div key={index} className="picklist-value-item">
                <span className="picklist-value">{value.value}</span>
                <span className="picklist-label">{value.label}</span>
                {value.active === false && <span className="inactive-badge">Inactive</span>}
                {value.defaultValue && <span className="default-badge">Default</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SObjectsTab;