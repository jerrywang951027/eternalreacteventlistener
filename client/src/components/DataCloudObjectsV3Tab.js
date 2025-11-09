import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './DataCloudObjectsTab.css'; // Reuse the same CSS

const DataCloudObjectsV3Tab = ({ persistedState, onStateChange }) => {
  // Initialize from persisted state or defaults (no connection state needed)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(persistedState?.error || '');
  const [entityType, setEntityType] = useState(persistedState?.entityType || '');
  const [objects, setObjects] = useState(persistedState?.objects || []);
  const [selectedObject, setSelectedObject] = useState(persistedState?.selectedObject || null);
  const [searchTerm, setSearchTerm] = useState(persistedState?.searchTerm || '');

  // Sync state changes back to parent for persistence
  useEffect(() => {
    if (onStateChange) {
      onStateChange({
        entityType,
        objects,
        selectedObject,
        searchTerm,
        error
      });
    }
  }, [entityType, objects, selectedObject, searchTerm, error, onStateChange]);

  const handleEntityTypeChange = (e) => {
    setEntityType(e.target.value);
    setObjects([]);
    setSelectedObject(null);
  };

  const handleLoadObjects = async () => {
    if (!entityType) {
      setObjects([]);
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const response = await axios.get(`/api/datacloud/v3/metadata?entityType=${entityType}`, {
        withCredentials: true
      });
      
      if (response.data.success) {
        setObjects(response.data.metadata || []);
        setSelectedObject(null);
        setError('');
      } else {
        setError(response.data.message || 'Failed to load metadata');
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message;
      const errorDetails = err.response?.data?.details;
      setError(`Failed to load metadata: ${errorMsg}${errorDetails ? ' - ' + JSON.stringify(errorDetails) : ''}`);
    } finally {
      setLoading(false);
    }
  };

  // Auto-load objects when entity type changes
  useEffect(() => {
    if (entityType) {
      handleLoadObjects();
    }
  }, [entityType]);

  const handleObjectSelect = (object) => {
    setSelectedObject(object);
  };

  const renderObjectDetails = () => {
    if (!selectedObject) {
      return (
        <div className="no-selection">
          Select an object from the list to view its details
        </div>
      );
    }

    return (
      <div className="object-details">
        <div className="details-header">
          <h3>
            {selectedObject.displayName || selectedObject.name}
            {selectedObject.category && (
              <span className="category-badge">{selectedObject.category}</span>
            )}
          </h3>
          <div className="details-meta">
            <span className="meta-item">
              <strong>Name:</strong> {selectedObject.name}
            </span>
          </div>
        </div>

        {/* Fields Section */}
        {selectedObject.fields && selectedObject.fields.length > 0 && (
          <div className="details-section">
            <h4>Fields ({selectedObject.fields.length})</h4>
            <div className="table-wrapper">
              <table className="details-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Display Name</th>
                    <th>Type</th>
                    <th>Business Type</th>
                    <th>Key Qualifier</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedObject.fields.map((field, index) => (
                    <tr key={index}>
                      <td><code>{field.name}</code></td>
                      <td>{field.displayName}</td>
                      <td><span className="type-badge">{field.type}</span></td>
                      <td>{field.businessType}</td>
                      <td>{field.keyQualifier || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Primary Keys Section */}
        {selectedObject.primaryKeys && selectedObject.primaryKeys.length > 0 && (
          <div className="details-section">
            <h4>Primary Keys ({selectedObject.primaryKeys.length})</h4>
            <div className="keys-list">
              {selectedObject.primaryKeys.map((key, index) => (
                <div key={index} className="key-item">
                  <code>{key.name}</code>
                  <span className="key-display">{key.displayName}</span>
                  {key.indexOrder && <span className="key-order">Order: {key.indexOrder}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Relationships Section */}
        {selectedObject.relationships && selectedObject.relationships.length > 0 && (
          <div className="details-section">
            <h4>Relationships ({selectedObject.relationships.length})</h4>
            <div className="table-wrapper">
              <table className="details-table">
                <thead>
                  <tr>
                    <th>From Entity</th>
                    <th>To Entity</th>
                    <th>From Attribute</th>
                    <th>To Attribute</th>
                    <th>Cardinality</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedObject.relationships.map((rel, index) => (
                    <tr key={index}>
                      <td><code>{rel.fromEntity}</code></td>
                      <td><code>{rel.toEntity}</code></td>
                      <td>{rel.fromEntityAttribute}</td>
                      <td>{rel.toEntityAttribute}</td>
                      <td>{rel.cardinality}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Indexes Section */}
        {selectedObject.indexes && selectedObject.indexes.length > 0 && (
          <div className="details-section">
            <h4>Indexes ({selectedObject.indexes.length})</h4>
            <pre className="json-display">{JSON.stringify(selectedObject.indexes, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="datacloud-objects-tab">
      {/* Header */}
      <div className="tab-header">
        <h2>☁️ DC Objects</h2>
        <div className="tab-header-info">
          <span className="info-badge">Using Salesforce API v65.0</span>
          <span className="info-badge">✅ Always Connected</span>
        </div>
      </div>

      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      {/* Main Content - Two Panel Layout */}
      <div className="main-content">
        {/* Left Panel */}
        <div className="left-panel">
          <div className="panel-header">
            <label htmlFor="entity-type">Entity Type:</label>
            <select
              id="entity-type"
              value={entityType}
              onChange={handleEntityTypeChange}
              className="entity-type-select"
            >
              <option value="">Select Entity Type...</option>
              <option value="DataLakeObject">DataLake</option>
              <option value="DataModelObject">DataModel</option>
            </select>
            
            <label htmlFor="search-objects">Search:</label>
            <input
              id="search-objects"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter by name..."
              className="search-input"
            />
          </div>

          <div className="objects-list">
            {loading ? (
              <div className="loading-state">
                <div className="spinner">⏳</div>
                <p>Loading objects...</p>
              </div>
            ) : objects.length > 0 ? (
              <>
                <div className="list-header">
                  Objects ({objects.filter(obj => 
                    !searchTerm || 
                    (obj.name && obj.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
                    (obj.displayName && obj.displayName.toLowerCase().includes(searchTerm.toLowerCase()))
                  ).length} / {objects.length})
                </div>
                {objects
                  .filter(obj => 
                    !searchTerm || 
                    (obj.name && obj.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
                    (obj.displayName && obj.displayName.toLowerCase().includes(searchTerm.toLowerCase()))
                  )
                  .map((obj, index) => (
                  <div
                    key={index}
                    className={`object-item ${selectedObject === obj ? 'selected' : ''}`}
                    onClick={() => handleObjectSelect(obj)}
                  >
                    <div className="object-name">{obj.displayName || obj.name}</div>
                    <div className="object-meta">
                      <code>{obj.name}</code>
                      {obj.category && <span className="object-category">{obj.category}</span>}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="empty-state">
                {!entityType 
                  ? 'Select an entity type to load objects'
                  : 'No objects found'}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="right-panel">
          {renderObjectDetails()}
        </div>
      </div>
    </div>
  );
};

export default DataCloudObjectsV3Tab;


