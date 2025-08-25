import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import './OmnistudioTab.css';

// Condition Tooltip Component
const ConditionTooltip = ({ condition, isVisible, position }) => {
  if (!isVisible || !condition) return null;

  return (
    <div 
      className="condition-tooltip" 
      style={{ 
        left: position.x, 
        top: position.y - 10,
        transform: 'translateX(-50%) translateY(-100%)'
      }}
    >
      <div className="tooltip-content">
        <strong>Condition:</strong>
        <div className="condition-text">{condition}</div>
      </div>
    </div>
  );
};

// Steps Section Component
const StepsSection = ({ steps, componentType, hierarchy = [], blockStructure = null }) => {
  const [expandedSteps, setExpandedSteps] = useState({});
  const [expandedBlocks, setExpandedBlocks] = useState({});
  const [expandedChildren, setExpandedChildren] = useState({});
  const [hoveredCondition, setHoveredCondition] = useState({ show: false, condition: '', position: { x: 0, y: 0 } });

  const toggleStepExpansion = (stepIndex) => {
    setExpandedSteps(prev => ({
      ...prev,
      [stepIndex]: !prev[stepIndex]
    }));
  };

  const toggleBlockExpansion = (blockIndex) => {
    setExpandedBlocks(prev => ({
      ...prev,
      [blockIndex]: !prev[blockIndex]
    }));
  };

  const toggleChildComponentExpansion = (stepIndex) => {
    setExpandedChildren(prev => ({
      ...prev,
      [stepIndex]: !prev[stepIndex]
    }));
  };

  const handleConditionHover = (e, condition) => {
    const rect = e.target.getBoundingClientRect();
    setHoveredCondition({
      show: true,
      condition,
      position: {
        x: rect.left + rect.width / 2,
        y: rect.top
      }
    });
  };

  const handleConditionLeave = () => {
    setHoveredCondition({ show: false, condition: '', position: { x: 0, y: 0 } });
  };

  const renderStep = (step, index, isSubStep = false, level = 0) => {
    const hasCondition = step.executionCondition || step.showCondition || step.blockCondition;
    const condition = step.executionCondition || step.showCondition || step.blockCondition;
    const isOmniscriptStep = componentType === 'omniscript' && step.type === 'Step';
    const isExpanded = expandedSteps[`${index}-${step.name}`];
    const hasChildComponent = step.childComponent && step.childComponent.steps && step.childComponent.steps.length > 0;
    

    const isChildExpanded = expandedChildren[`${index}-${step.name}`];
    const hasBlockSteps = step.blockSteps && step.blockSteps.length > 0;
    const isBlockExpanded = expandedBlocks[`${index}-${step.name}`];
    
    // Determine block type styling
    const blockTypeClass = step.blockType ? `block-${step.blockType}` : '';
    const levelClass = `level-${Math.min(level, 4)}`; // Max 4 levels

    return (
      <div key={`${index}-${step.name}`} className={`step-item ${isSubStep ? 'sub-step' : ''} ${blockTypeClass} ${levelClass}`}>
        <div className="step-header">
          {/* Block type indicator */}
          {step.blockType && (
            <div className="block-type-indicator">
              {step.blockType === 'conditional' && '🔀'}
              {step.blockType === 'loop' && '🔄'}
              {step.blockType === 'cache' && '💾'}
            </div>
          )}
          
          {/* Block toggle for Conditional/Loop/Cache blocks */}
          {hasBlockSteps && (
            <button 
              className={`step-accordion-toggle ${isBlockExpanded ? 'expanded' : ''}`}
              onClick={() => toggleBlockExpansion(`${index}-${step.name}`)}
              title={isBlockExpanded ? `Collapse ${step.blockType} block` : `Expand ${step.blockType} block`}
            >
              ▶
            </button>
          )}
          
          {/* Accordion toggle for Omniscript Steps */}
          {isOmniscriptStep && step.subSteps && step.subSteps.length > 0 && (
            <button 
              className={`step-accordion-toggle ${isExpanded ? 'expanded' : ''}`}
              onClick={() => toggleStepExpansion(`${index}-${step.name}`)}
              title={isExpanded ? 'Collapse step' : 'Expand step'}
            >
              ▶
            </button>
          )}

          {/* Child component toggle */}
          {hasChildComponent && (
            <button 
              className={`child-component-toggle ${isChildExpanded ? 'expanded' : ''}`}
              onClick={() => toggleChildComponentExpansion(`${index}-${step.name}`)}
              title={isChildExpanded ? 'Collapse child component' : 'Expand child component'}
            >
              📁
            </button>
          )}
          
          <div className="step-main-info">
            {/* Primary row with name, type, and condition */}
            <div className="step-primary-row">
              <span className="step-name">{step.name || 'Unnamed Step'}</span>
              <span className="step-type">{step.type}</span>
              

              
              {/* Condition Eye Icon */}
              {hasCondition && (
                <span 
                  className="condition-indicator"
                  onMouseEnter={(e) => handleConditionHover(e, condition)}
                  onMouseLeave={handleConditionLeave}
                  title="Has execution condition"
                >
                  👁️
                </span>
              )}
            </div>
            
            {/* Secondary row with additional details */}
            {(step.remoteClass || step.remoteMethod || step.bundle || step.integrationProcedureKey || step.blockIterator || step.blockCacheKey || hasChildComponent) && (
              <div className="step-secondary-row">
                {/* Remote Action Details */}
                {step.remoteClass && (
                  <span className="remote-class">Class: {step.remoteClass}</span>
                )}
                {step.remoteMethod && (
                  <span className="remote-method">Method: {step.remoteMethod}</span>
                )}

                {/* Block-specific details */}
                {step.blockIterator && (
                  <span className="block-iterator">Iterator: {step.blockIterator}</span>
                )}
                {step.blockCacheKey && (
                  <span className="block-cache-key">Cache: {step.blockCacheKey}</span>
                )}

                {/* Additional step info */}
                {step.bundle && (
                  <span className="step-bundle">Bundle: {step.bundle}</span>
                )}
                
                {step.integrationProcedureKey && (
                  <span className="step-ip-key">IP: {step.integrationProcedureKey}</span>
                )}

                {/* Child component info */}
                {hasChildComponent && (
                  <span className="child-component-info">
                    🔗 {step.childComponent.componentType}: {step.childComponent.name} 
                    ({step.childComponent.steps.length} steps)
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sub-steps for Omniscript Steps (accordion content) */}
        {isOmniscriptStep && step.subSteps && step.subSteps.length > 0 && isExpanded && (
          <div className="step-sub-steps">
            {step.subSteps.map((subStep, subIndex) => 
              renderStep(subStep, `${index}-${subIndex}`, true, level + 1)
            )}
          </div>
        )}

        {/* Block steps for conditional/loop/cache blocks */}
        {hasBlockSteps && isBlockExpanded && (
          <div className="step-block-steps">
            <div className="block-steps-header">
              <strong>🎛️ {step.blockType} block steps ({step.blockSteps.length}):</strong>
            </div>
            {step.blockSteps.map((blockStep, blockIndex) => 
              renderStep(blockStep, `${index}-block-${blockIndex}`, true, level + 1)
            )}
          </div>
        )}

        {/* Child component steps (hierarchical) */}
        {hasChildComponent && isChildExpanded && (
          <div className="child-component-steps">
            <div className="child-steps-header">
              <strong>🔗 {step.childComponent.name} ({step.childComponent.componentType}) steps:</strong>
            </div>
            {step.childComponent.steps.map((childStep, childIndex) => 
              renderStep(childStep, `${index}-child-${childIndex}`, true, level + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="steps-section">
      <h5>📋 Steps ({steps.length})</h5>
      
      <div className="steps-list">
        {steps.map((step, index) => renderStep(step, index))}
      </div>
      
      {/* Condition Tooltip */}
      <ConditionTooltip 
        condition={hoveredCondition.condition}
        isVisible={hoveredCondition.show}
        position={hoveredCondition.position}
      />
    </div>
  );
};

const OmnistudioTab = () => {
  // Hard-coded component types (no need to fetch from server)
  const componentTypes = [
    {
      id: 'integration-procedure',
      name: 'Integration Procedure',
      description: 'Serverless integration procedures for data processing',
      icon: '⚡'
    },
    {
      id: 'omniscript',
      name: 'Omniscript', 
      description: 'Guided user experiences and forms',
      icon: '📋'
    },
    {
      id: 'data-mapper',
      name: 'Data Mapper',
      description: 'Data transformation and mapping tools',
      icon: '🔄'
    }
  ];

  // State management
  const [selectedComponentType, setSelectedComponentType] = useState('integration-procedure');
  const [instances, setInstances] = useState([]);
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [instanceDetails, setInstanceDetails] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [globalComponentsData, setGlobalComponentsData] = useState(null);
  
  // Loading states
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingGlobalData, setLoadingGlobalData] = useState(false);
  
  // Error states
  const [instanceError, setInstanceError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [globalDataError, setGlobalDataError] = useState('');

  // Load global components data on mount (for hierarchy features)
  useEffect(() => {
    loadGlobalComponentsData();
  }, []);

  // Fetch instances when component type changes or search term changes
  useEffect(() => {
    if (globalComponentsData) {
      processInstancesFromGlobalData();
    } else {
      // Fallback to individual API calls when global data not available
      fetchInstancesFromAPI();
    }
  }, [globalComponentsData, selectedComponentType, searchTerm]);

  // Clear selected instance when component type changes
  useEffect(() => {
    setSelectedInstance(null);
    setInstanceDetails(null);
    setDetailError('');
  }, [selectedComponentType]);



  const loadGlobalComponentsData = async () => {
    try {
      setLoadingGlobalData(true);
      setGlobalDataError('');
      
      const response = await axios.get('/api/omnistudio/global-data');
      
      if (response.data.success) {
        setGlobalComponentsData(response.data.data);
        console.log('✅ [OMNISTUDIO] Global components data loaded:', response.data.data.totalComponents, 'components');
      } else {
        setGlobalDataError('Global data not available - using fallback API calls');
        console.warn('⚠️ [OMNISTUDIO] No global data available, falling back to individual API calls:', response.data.message);
      }
    } catch (error) {
      setGlobalDataError('Global data unavailable - using fallback API calls');
      console.warn('⚠️ [OMNISTUDIO] Global data not available, falling back to individual API calls:', error.response?.data?.message || error.message);
    } finally {
      setLoadingGlobalData(false);
    }
  };

  const fetchInstancesFromAPI = async () => {
    try {
      setLoadingInstances(true);
      setInstanceError('');
      
      const params = {
        componentType: selectedComponentType
      };
      
      if (searchTerm.trim()) {
        params.searchTerm = searchTerm.trim();
      }

      const response = await axios.get('/api/omnistudio/instances', { params });
      
      if (response.data.success) {
        setInstances(response.data.instances);
        console.log('✅ [OMNISTUDIO] Loaded instances via API:', response.data.instances.length, 'components');
      } else {
        setInstanceError('Failed to load instances');
        setInstances([]);
      }
    } catch (error) {
      setInstanceError('Error loading instances: ' + (error.response?.data?.message || error.message));
      setInstances([]);
    } finally {
      setLoadingInstances(false);
    }
  };

  const processInstancesFromGlobalData = () => {
    if (!globalComponentsData) return;

    setLoadingInstances(true);
    setInstanceError('');

    try {
      let sourceData = [];
      
      switch (selectedComponentType) {
        case 'integration-procedure':
          sourceData = globalComponentsData.integrationProcedures || [];
          break;
        case 'omniscript':
          sourceData = globalComponentsData.omniscripts || [];
          break;
        case 'data-mapper':
          sourceData = globalComponentsData.dataMappers || [];
          break;
        default:
          sourceData = [];
      }

      // Apply search filter
      let filteredData = sourceData;
      if (searchTerm.trim()) {
        const searchLower = searchTerm.toLowerCase().trim();
        filteredData = sourceData.filter(component =>
          component.name.toLowerCase().includes(searchLower) ||
          (component.type && component.type.toLowerCase().includes(searchLower)) ||
          (component.subType && component.subType.toLowerCase().includes(searchLower))
        );
      }

      // Convert to display format
      const processedInstances = filteredData.map(component => ({
        id: component.id,
        name: component.name,
        type: component.type,
        subType: component.subType,
        version: component.version,
        procedureKey: component.procedureKey,
        uniqueId: component.uniqueId,
        description: component.description,
        componentType: component.componentType
      }));

      setInstances(processedInstances);
    } catch (error) {
      setInstanceError('Error processing component data: ' + error.message);
      setInstances([]);
    } finally {
      setLoadingInstances(false);
    }
  };

  const getInstanceDetailsFromGlobalData = (componentType, instanceName) => {
    if (!globalComponentsData) return null;

    let sourceData = [];
    switch (componentType) {
      case 'integration-procedure':
        sourceData = globalComponentsData.integrationProcedures || [];
        break;
      case 'omniscript':
        sourceData = globalComponentsData.omniscripts || [];
        break;
      case 'data-mapper':
        sourceData = globalComponentsData.dataMappers || [];
        break;
      default:
        return null;
    }

    const component = sourceData.find(comp => comp.name === instanceName);
    if (!component) return null;

    // Convert to the expected details format
    if (componentType === 'data-mapper') {
      return {
        name: component.name,
        id: component.id,
        componentType: component.componentType,
        description: component.description,
        configurationItems: component.configItems || [],
        totalItems: (component.configItems || []).length
      };
    } else {
      // For omniscripts and integration procedures
      return {
        name: component.name,
        id: component.id,
        componentType: component.componentType,
        rawContent: component.rawContent,
        parsedContent: component.parsedContent,
        contentError: component.contentError,
        summary: {
          type: component.type,
          subType: component.subType,
          version: component.version,
          childrenCount: component.steps ? component.steps.length : 0,
          steps: component.steps || [],
          hierarchy: component.childComponents || [],
          blockStructure: component.blockStructure
        }
      };
    }
  };

  const handleInstanceSelect = (instance) => {
    setSelectedInstance(instance);
    
    if (globalComponentsData) {
      // Use global data for enhanced hierarchy features
      setLoadingDetails(true);
      setDetailError('');
      
      try {
        const details = getInstanceDetailsFromGlobalData(selectedComponentType, instance.name);
        if (details) {
          setInstanceDetails(details);
          console.log(`📋 [OMNISTUDIO] Loaded details for ${instance.name} from global data:`, details);
        } else {
          setDetailError(`No details found for ${instance.name}`);
          setInstanceDetails(null);
        }
      } catch (error) {
        setDetailError('Error loading details: ' + error.message);
        setInstanceDetails(null);
      } finally {
        setLoadingDetails(false);
      }
    } else {
      // Fallback to API call for basic details
      fetchInstanceDetailsFromAPI(selectedComponentType, instance.name);
    }
  };

  const fetchInstanceDetailsFromAPI = async (componentType, instanceName) => {
    try {
      setLoadingDetails(true);
      setDetailError('');
      
      const response = await axios.get(`/api/omnistudio/${componentType}/${encodeURIComponent(instanceName)}/details`);
      
      if (response.data.success) {
        setInstanceDetails(response.data.details);
        console.log(`📋 [OMNISTUDIO] Loaded details for ${instanceName} via API:`, response.data.details);
      } else {
        setDetailError('Failed to load instance details');
        setInstanceDetails(null);
      }
    } catch (error) {
      setDetailError('Error loading details: ' + (error.response?.data?.message || error.message));
      setInstanceDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleComponentTypeChange = (componentTypeId) => {
    setSelectedComponentType(componentTypeId);
    setSearchTerm(''); // Clear search when changing component type
  };

  // Get current component type info
  const currentComponentType = componentTypes.find(type => type.id === selectedComponentType);

  // Filtered instances (client-side filtering as backup)
  const filteredInstances = useMemo(() => {
    if (!instances || instances.length === 0) {
      return [];
    }
    if (!searchTerm.trim()) {
      return instances;
    }
    return instances.filter(instance => 
      instance.name && instance.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [instances, searchTerm]);

  const clearSearch = () => {
    setSearchTerm('');
  };

  return (
    <div className="omnistudio-tab">
      <div className="omnistudio-content">
        {/* Left Panel - Component Selection and List */}
        <div className="control-panel">
          <div className="panel-header">
            <h3>🔧 Omnistudio Components</h3>
            <p>Explore Integration Procedures, Omniscripts, and Data Mappers</p>
            
            {/* Component Counts Summary */}
            {globalComponentsData && (
              <div className="component-counts-summary">
                <div className="count-item">
                  <span className="count-icon">⚡</span>
                  <span className="count-label">Integration Procedures:</span>
                  <span className="count-value">{globalComponentsData.integrationProcedures?.length || 0}</span>
                </div>
                <div className="count-item">
                  <span className="count-icon">📋</span>
                  <span className="count-label">Omniscripts:</span>
                  <span className="count-value">{globalComponentsData.omniscripts?.length || 0}</span>
                </div>
                <div className="count-item">
                  <span className="count-icon">🔄</span>
                  <span className="count-label">Data Mappers:</span>
                  <span className="count-value">{globalComponentsData.dataMappers?.length || 0}</span>
                </div>
                <div className="count-total">
                  <strong>Total: {globalComponentsData.totalComponents || 0} components</strong>
                  {globalComponentsData.loadedAt && (
                    <small> • Loaded {new Date(globalComponentsData.loadedAt).toLocaleTimeString()}</small>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Component Type Selection */}
          <div className="component-type-section">
            <label htmlFor="componentTypeSelect">Select Component Type:</label>
            <select
              id="componentTypeSelect"
              value={selectedComponentType}
              onChange={(e) => handleComponentTypeChange(e.target.value)}
              className="component-type-select"
            >
              {componentTypes.map(type => (
                <option key={type.id} value={type.id}>
                  {type.icon} {type.name}
                </option>
              ))}
            </select>
            
            {currentComponentType && (
              <div className="component-type-info">
                <small>{currentComponentType.description}</small>
              </div>
            )}
          </div>

          {/* Search Filter */}
          <div className="search-section">
            <label htmlFor="instanceSearch">Filter by name prefix:</label>
            <div className="search-container">
              <input
                id="instanceSearch"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Enter component name prefix..."
                className="search-input"
              />
              {searchTerm && (
                <button 
                  onClick={clearSearch} 
                  className="clear-search"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
            {filteredInstances.length !== instances.length && instances.length > 0 && (
              <div className="search-results-info">
                Showing {filteredInstances.length} of {instances.length} components
                {globalComponentsData && <span> • Enhanced mode</span>}
                {!globalComponentsData && <span> • Basic mode</span>}
              </div>
            )}
          </div>

          {/* Instance List */}
          <div className="instances-section">
            <div className="instances-header">
              <h4>
                {currentComponentType?.icon} {currentComponentType?.name} Instances
                {!loadingInstances && instances.length > 0 && (
                  <span className="instance-count">({filteredInstances.length})</span>
                )}
              </h4>
            </div>

            {/* Global data loading info (non-blocking) */}
            {loadingGlobalData && (
              <div className="info-message">
                <span>🔄 Loading enhanced hierarchy features...</span>
              </div>
            )}

            {globalDataError && !globalComponentsData && (
              <div className="info-message">
                <span>ℹ️ {globalDataError}</span>
                <button onClick={loadGlobalComponentsData} className="retry-btn">
                  🔄 Retry Enhanced Features
                </button>
              </div>
            )}

            {/* Force refresh button when global data is available */}
            {globalComponentsData && (
              <div className="info-message">
                <span>🚀 Enhanced hierarchy mode active</span>
                <button onClick={() => {
                  setGlobalComponentsData(null);
                  loadGlobalComponentsData();
                }} className="retry-btn">
                  🔄 Refresh Data
                </button>
              </div>
            )}

            {instanceError && (
              <div className="error-message">
                <span>⚠️ {instanceError}</span>
              </div>
            )}

            {loadingInstances ? (
              <div className="loading-spinner">
                {globalComponentsData ? 'Processing components...' : 'Loading instances...'}
              </div>
            ) : filteredInstances.length === 0 ? (
              <div className="no-instances">
                {instances.length === 0 ? 
                  `No ${currentComponentType?.name} instances found` :
                  'No instances match your search'
                }
              </div>
            ) : (
              <div className="instances-list">
                {filteredInstances.map(instance => (
                  <div
                    key={instance.uniqueId || instance.id}
                    className={`instance-item ${selectedInstance?.id === instance.id ? 'selected' : ''}`}
                    onClick={() => handleInstanceSelect(instance)}
                  >
                    <div className="instance-name">{instance.name}</div>
                    <div className="instance-meta">
                      {instance.type && (
                        <span className="instance-type">Type: {instance.type}</span>
                      )}
                      {instance.subType && (
                        <span className="instance-subtype">SubType: {instance.subType}</span>
                      )}
                      {instance.version && (
                        <span className="instance-version">v{instance.version}</span>
                      )}
                    </div>
                    {instance.description && (
                      <div className="instance-description">{instance.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Instance Details */}
        <div className="details-panel">
          {selectedInstance ? (
            <>
              <div className="details-header">
                <h3>
                  {currentComponentType?.icon} {selectedInstance.name}
                </h3>
                <div className="details-meta">
                  <span className="component-type-badge">
                    {currentComponentType?.name}
                  </span>
                  {selectedInstance.uniqueId && (
                    <span className="unique-id">ID: {selectedInstance.uniqueId}</span>
                  )}
                </div>
              </div>

              {detailError && (
                <div className="error-message">
                  <span>⚠️ {detailError}</span>
                </div>
              )}

              {loadingDetails ? (
                <div className="loading-spinner">Loading details...</div>
              ) : instanceDetails ? (
                <div className="instance-details">
                  {/* Basic Information - Compact */}
                  <div className="details-section compact">
                    <div className="compact-info">
                      <strong>{instanceDetails.name}</strong>
                      {instanceDetails.componentType && (
                        <span className="info-badge">{instanceDetails.componentType}</span>
                      )}
                      {instanceDetails.id && (
                        <span className="info-id">ID: {instanceDetails.id}</span>
                      )}
                      {instanceDetails.sequence && (
                        <span className="info-seq">Seq: {instanceDetails.sequence}</span>
                      )}
                    </div>
                  </div>

                  {/* Summary Information - Compact */}
                  {instanceDetails.summary && (
                    <div className="details-section compact">
                      <div className="compact-summary">
                        {instanceDetails.summary.type && instanceDetails.summary.subType && (
                          <span className="summary-badge">{instanceDetails.summary.type}_{instanceDetails.summary.subType}</span>
                        )}
                        {instanceDetails.summary.version && (
                          <span className="summary-version">v{instanceDetails.summary.version}</span>
                        )}
                        {instanceDetails.summary.language && (
                          <span className="summary-lang">{instanceDetails.summary.language}</span>
                        )}
                        {instanceDetails.summary.childrenCount > 0 && (
                          <span className="summary-steps">{instanceDetails.summary.childrenCount} steps</span>
                        )}
                      </div>

                      {/* Steps */}
                      {instanceDetails.summary.steps && instanceDetails.summary.steps.length > 0 && (
                        <StepsSection 
                          steps={instanceDetails.summary.steps}
                          componentType={instanceDetails.componentType}
                          hierarchy={instanceDetails.summary.hierarchy || []}
                          blockStructure={instanceDetails.summary.blockStructure || null}
                        />
                      )}
                    </div>
                  )}

                  {/* Configuration Items (for Data Mappers) */}
                  {instanceDetails.configurationItems && (
                    <div className="details-section">
                      <h4>⚙️ Configuration Items ({instanceDetails.totalItems})</h4>
                      <div className="config-items-container">
                        {instanceDetails.configurationItems.slice(0, 50).map((item, index) => (
                          <div key={index} className="config-item">
                            {item.configurationKey && (
                              <div className="config-detail">
                                <label>Key:</label>
                                <span>{item.configurationKey}</span>
                              </div>
                            )}
                            {item.configurationType && (
                              <div className="config-detail">
                                <label>Type:</label>
                                <span>{item.configurationType}</span>
                              </div>
                            )}
                            {item.configurationValue && (
                              <div className="config-detail">
                                <label>Value:</label>
                                <span className="config-value">{item.configurationValue}</span>
                              </div>
                            )}
                            {item.domainObjectAPIName && (
                              <div className="config-detail">
                                <label>Object:</label>
                                <span>{item.domainObjectAPIName}</span>
                              </div>
                            )}
                          </div>
                        ))}
                        {instanceDetails.configurationItems.length > 50 && (
                          <div className="config-more">
                            ... and {instanceDetails.configurationItems.length - 50} more configuration items
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* References Section - Show where this component is referenced from */}
                  {globalComponentsData && instanceDetails && (instanceDetails.componentType === 'integration-procedure' || instanceDetails.componentType === 'omniscript') && (
                    <div className="details-section">
                      <h4>🔗 Referenced From</h4>
                      {(() => {
                        // Find the component in global data to get its references
                        let component = null;
                        if (instanceDetails.componentType === 'integration-procedure') {
                          component = globalComponentsData.integrationProcedures?.find(ip => 
                            ip.name === instanceDetails.name || ip.id === instanceDetails.id
                          );
                        } else if (instanceDetails.componentType === 'omniscript') {
                          component = globalComponentsData.omniscripts?.find(os => 
                            os.name === instanceDetails.name || os.id === instanceDetails.id
                          );
                        }

                        const references = component?.referencedBy || [];

                        if (references.length === 0) {
                          return (
                            <div className="no-references">
                              <p>This component is not referenced by any other components.</p>
                            </div>
                          );
                        }

                        return (
                          <div className="references-list">
                            {references.map((ref, index) => (
                              <div key={index} className="reference-item">
                                <div className="reference-path">
                                  <span className="path-string">{ref.pathString}</span>
                                </div>
                                <div className="reference-details">
                                  <span className="reference-step">via step: <strong>{ref.stepName}</strong></span>
                                  <span className="reference-level">Level: {ref.level}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Content Error */}
                  {instanceDetails.contentError && (
                    <div className="details-section">
                      <div className="error-message">
                        <span>⚠️ Content Parse Error: {instanceDetails.contentError}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="no-selection">
              <div className="no-selection-content">
                <h3>🔍 Select an Instance</h3>
                <p>Choose a component from the left panel to view its detailed information.</p>
                <div className="selection-help">
                  <p>Available features:</p>
                  <ul>
                    <li>🔄 Switch between Integration Procedures, Omniscripts, and Data Mappers</li>
                    <li>🔍 Search for specific components by name</li>
                    <li>📋 View detailed step-by-step configuration and structure</li>
                    <li>👁️ See execution conditions and remote action details</li>
                    <li>📁 Expand Omniscript steps to view sub-elements</li>
                    {globalComponentsData && (
                      <li>🚀 <strong>Enhanced hierarchy features available</strong> - see nested component relationships up to 4 levels deep</li>
                    )}
                    {!globalComponentsData && (
                      <li>ℹ️ Basic mode - enhanced hierarchy features will be available once global data loads</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OmnistudioTab;
