import React, { useState } from 'react';

const SObjectDetailsTab = ({ selectedSObject, describe, loading, error }) => {
  const [hoveredField, setHoveredField] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const [showOnlyPicklists, setShowOnlyPicklists] = useState(false);
  const [fieldSearchQuery, setFieldSearchQuery] = useState('');
  const [hideSystemFields, setHideSystemFields] = useState(true); // Hide by default
  const [sortField, setSortField] = useState(null); // null, 'name', or 'label'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' or 'desc'

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

  const isSystemField = (fieldName) => {
    const systemFields = [
      'Id',
      'IsDeleted',
      'Name',
      'CreatedDate',
      'CreatedById',
      'LastModifiedDate',
      'LastModifiedById',
      'SystemModstamp',
      'LastViewedDate',
      'LastReferencedDate'
    ];
    return systemFields.includes(fieldName);
  };

  const filterFields = (fields) => {
    let filtered = fields;
    
    // Filter out system fields if checkbox is checked
    if (hideSystemFields) {
      filtered = filtered.filter(f => !isSystemField(f.name));
    }
    
    // Filter by picklist type if checkbox is checked
    if (showOnlyPicklists) {
      filtered = filtered.filter(f => f.type === 'picklist');
    }
    
    // Filter by search query
    if (fieldSearchQuery.trim() !== '') {
      const query = fieldSearchQuery.toLowerCase();
      filtered = filtered.filter(f => 
        f.name.toLowerCase().includes(query) || 
        f.label.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  };

  const sortFields = (fields) => {
    if (!sortField) return fields;
    
    const sorted = [...fields].sort((a, b) => {
      let aValue, bValue;
      
      if (sortField === 'name') {
        aValue = a.name.toLowerCase();
        bValue = b.name.toLowerCase();
      } else if (sortField === 'label') {
        aValue = a.label.toLowerCase();
        bValue = b.label.toLowerCase();
      }
      
      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });
    
    return sorted;
  };

  const groupFieldsByCategory = (fields) => {
    const filteredFields = filterFields(fields);
    const sortedFields = sortFields(filteredFields);
    const standard = sortedFields.filter(f => !f.custom);
    const custom = sortedFields.filter(f => f.custom);
    
    return { standard, custom };
  };
  
  const handleSort = (field) => {
    if (sortField === field) {
      // Toggle sort order
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleFieldHover = (field, event) => {
    // Handle picklist fields
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
    
    // Handle reference fields
    if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0) {
      const rect = event.target.getBoundingClientRect();
      const popupWidth = 300;
      const popupHeight = Math.min(300, field.referenceTo.length * 40 + 100);
      
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

  if (loading && describe === null) {
    return (
      <div className="loading-details">
        🔄 Loading SObject details...
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-details">
        <p>⚠️ Failed to load SObject details</p>
        <p>{error}</p>
      </div>
    );
  }

  if (!describe) {
    return null;
  }

  return (
    <>
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
          
          {/* Filter Controls */}
          <div style={{ 
            display: 'flex', 
            gap: '15px', 
            marginBottom: '15px', 
            alignItems: 'center',
            padding: '12px',
            backgroundColor: '#374151',
            borderRadius: '8px',
            border: '2px solid #4b5563',
            flexWrap: 'wrap'
          }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              color: '#e5e7eb'
            }}>
              <input
                type="checkbox"
                checked={hideSystemFields}
                onChange={(e) => setHideSystemFields(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Hide system fields</span>
            </label>
            
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              color: '#e5e7eb'
            }}>
              <input
                type="checkbox"
                checked={showOnlyPicklists}
                onChange={(e) => setShowOnlyPicklists(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Show only Picklist fields</span>
            </label>
            
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              flex: '1'
            }}>
              <input
                type="text"
                placeholder="Search by field API name or label..."
                value={fieldSearchQuery}
                onChange={(e) => setFieldSearchQuery(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #4b5563',
                  borderRadius: '6px',
                  fontSize: '14px',
                  flex: '1',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  backgroundColor: '#1f2937',
                  color: '#e5e7eb'
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = '#4b5563'}
              />
              {fieldSearchQuery && (
                <button
                  onClick={() => setFieldSearchQuery('')}
                  style={{
                    padding: '8px 12px',
                    border: 'none',
                    background: '#ef4444',
                    color: 'white',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          
          {(() => {
            const { standard, custom } = groupFieldsByCategory(describe.fields);
            const totalFiltered = standard.length + custom.length;
            
            if (totalFiltered === 0) {
              return (
                <div style={{
                  padding: '20px',
                  textAlign: 'center',
                  color: '#9ca3af',
                  backgroundColor: '#374151',
                  borderRadius: '6px',
                  border: '1px solid #4b5563'
                }}>
                  <p>No fields match the current filters.</p>
                  <p style={{ fontSize: '14px', marginTop: '8px' }}>
                    Try adjusting your search or unchecking the picklist filter.
                  </p>
                </div>
              );
            }
            
            return (
              <div className="fields-container">
                {totalFiltered < describe.fields.length && (
                  <div style={{
                    padding: '10px',
                    marginBottom: '15px',
                    backgroundColor: '#1e3a5f',
                    borderRadius: '6px',
                    border: '1px solid #3b82f6',
                    fontSize: '14px',
                    color: '#93c5fd'
                  }}>
                    Showing {totalFiltered} of {describe.fields.length} fields
                  </div>
                )}
                {custom.length > 0 && (
                  <div className="field-group">
                    <h5>🔧 Custom Fields ({custom.length})</h5>
                    <div className="fields-table">
                      <table>
                        <thead>
                          <tr>
                            <th 
                              onClick={() => handleSort('name')}
                              style={{ cursor: 'pointer', userSelect: 'none' }}
                              title="Click to sort by API Name"
                            >
                              API Name {sortField === 'name' && (sortOrder === 'asc' ? '▲' : '▼')}
                            </th>
                            <th 
                              onClick={() => handleSort('label')}
                              style={{ cursor: 'pointer', userSelect: 'none' }}
                              title="Click to sort by Label"
                            >
                              Label {sortField === 'label' && (sortOrder === 'asc' ? '▲' : '▼')}
                            </th>
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
                              <td 
                                className="field-type"
                                onMouseEnter={(e) => {
                                  if (field.type === 'reference') {
                                    handleFieldHover(field, e);
                                  }
                                }}
                                onMouseLeave={() => {
                                  if (field.type === 'reference') {
                                    handleFieldLeave();
                                  }
                                }}
                                style={{ 
                                  cursor: field.type === 'reference' ? 'help' : 'default'
                                }}
                              >
                                {renderFieldType(field)}
                                {field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0 && (
                                  <span style={{ marginLeft: '6px', fontSize: '12px' }}>🔗</span>
                                )}
                              </td>
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
                          <th 
                            onClick={() => handleSort('name')}
                            style={{ cursor: 'pointer', userSelect: 'none' }}
                            title="Click to sort by API Name"
                          >
                            API Name {sortField === 'name' && (sortOrder === 'asc' ? '▲' : '▼')}
                          </th>
                          <th 
                            onClick={() => handleSort('label')}
                            style={{ cursor: 'pointer', userSelect: 'none' }}
                            title="Click to sort by Label"
                          >
                            Label {sortField === 'label' && (sortOrder === 'asc' ? '▲' : '▼')}
                          </th>
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
                            <td 
                              className="field-type"
                              onMouseEnter={(e) => {
                                if (field.type === 'reference') {
                                  handleFieldHover(field, e);
                                }
                              }}
                              onMouseLeave={() => {
                                if (field.type === 'reference') {
                                  handleFieldLeave();
                                }
                              }}
                              style={{ 
                                cursor: field.type === 'reference' ? 'help' : 'default'
                              }}
                            >
                              {renderFieldType(field)}
                              {field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0 && (
                                <span style={{ marginLeft: '6px', fontSize: '12px' }}>🔗</span>
                              )}
                            </td>
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

        {/* Record Types */}
        {describe.recordTypeInfos && describe.recordTypeInfos.length > 0 && (
          <div className="record-types-section">
            <h4>🎯 Record Types ({describe.recordTypeInfos.length})</h4>
            <div className="record-types-table">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Developer Name</th>
                    <th>Record Type ID</th>
                    <th>Active</th>
                    <th>Available</th>
                    <th>Default</th>
                    <th>Master</th>
                  </tr>
                </thead>
                <tbody>
                  {describe.recordTypeInfos.map((rt, index) => (
                    <tr key={index}>
                      <td className="record-type-name">{rt.name}</td>
                      <td>{rt.developerName || 'N/A'}</td>
                      <td className="record-type-id">{rt.recordTypeId}</td>
                      <td>{rt.active ? '✅ Yes' : '❌ No'}</td>
                      <td>{rt.available ? '✅ Yes' : '❌ No'}</td>
                      <td>{rt.defaultRecordTypeMapping ? '⭐ Yes' : '—'}</td>
                      <td>{rt.master ? '🔑 Yes' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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

      {/* Reference Type Popup */}
      {hoveredField && hoveredField.type === 'reference' && hoveredField.referenceTo && hoveredField.referenceTo.length > 0 && (
        <div 
          className="picklist-popup"
          style={{
            position: 'fixed',
            left: popupPosition.x,
            top: popupPosition.y,
            zIndex: 1000,
            minWidth: '250px'
          }}
        >
          <div className="picklist-popup-header">
            <strong>{hoveredField.name}</strong> - References
          </div>
          <div className="picklist-values-list">
            {hoveredField.referenceTo.map((refObject, index) => (
              <div key={index} className="picklist-value-item" style={{ 
                padding: '8px 12px',
                justifyContent: 'flex-start'
              }}>
                <span style={{ 
                  fontSize: '14px', 
                  fontWeight: '500',
                  color: '#60a5fa',
                  fontFamily: 'monospace'
                }}>
                  🔗 {refObject}
                </span>
              </div>
            ))}
          </div>
          {hoveredField.referenceTo.length > 1 && (
            <div style={{
              padding: '8px 12px',
              fontSize: '12px',
              color: '#9ca3af',
              borderTop: '1px solid #4b5563',
              fontStyle: 'italic'
            }}>
              Polymorphic reference ({hoveredField.referenceTo.length} objects)
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default SObjectDetailsTab;
