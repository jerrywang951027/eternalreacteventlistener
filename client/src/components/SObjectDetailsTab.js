import React, { useState } from 'react';

const SObjectDetailsTab = ({ selectedSObject, describe, loading, error }) => {
  const [hoveredField, setHoveredField] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });

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
    </>
  );
};

export default SObjectDetailsTab;
