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

// Referenced By Section Component - Shows all references to this component
const ReferencedBySection = ({ componentName, componentType }) => {
  const [referencedByData, setReferencedByData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (componentName) {
      loadReferencedByData();
    }
  }, [componentName]);

  const loadReferencedByData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log(`🔍 [REFERENCED-BY] Loading data for component: ${componentName}, type: ${componentType}`);
      
      // Get the cached component data which should have the referencedBy array
      const response = await axios.get(`/api/omnistudio/${componentType}/${encodeURIComponent(componentName)}/cached`, {
        withCredentials: true
      });
      
      console.log(`🔍 [REFERENCED-BY] API response:`, response.data);
      
      if (response.data && response.data.component && response.data.component.referencedBy) {
        console.log(`🔍 [REFERENCED-BY] Found ${response.data.component.referencedBy.length} references:`, response.data.component.referencedBy);
        setReferencedByData(response.data.component.referencedBy);
      } else {
        console.log(`🔍 [REFERENCED-BY] No referencedBy data found in response`);
        setReferencedByData([]);
      }
    } catch (err) {
      console.error('Error loading referencedBy data:', err);
      setError('Error loading reference data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="referenced-by-loading">
        <div className="loading-spinner">Loading reference data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="referenced-by-error">
        <div className="error-message">
          <span>⚠️ {error}</span>
        </div>
      </div>
      );
  }

  if (referencedByData.length === 0) {
    return (
      <div className="referenced-by-empty">
        <p>No references found for <strong>{componentName}</strong>.</p>
        <p>This component is not referenced by any other Integration Procedures or OmniScripts.</p>
      </div>
    );
  }

  return (
    <div className="referenced-by-list">
      <div className="references-header">
        <span>Found {referencedByData.length} reference(s)</span>
      </div>
      {referencedByData.map((ref, index) => (
        <div key={index} className="reference-item">
          <div className="reference-header">
            <span className="reference-path">{ref.path}</span>
            <span className="reference-type">{ref.type}</span>
          </div>
                    <div className="reference-details">
            <span className="reference-timestamp">{new Date(ref.timestamp).toLocaleString()}</span>
            {ref.stepName && <span className="step-name">Step: {ref.stepName}</span>}
            {ref.stepType && <span className="step-type">Type: {ref.stepType}</span>}
            {ref.referencingIP && <span className="referencing-ip">From IP: {ref.referencingIP}</span>}
            {ref.referencingOmniScript && <span className="referencing-omniscript">From OmniScript: {ref.referencingOmniScript}</span>}
          </div>
        </div>
      ))}
    </div>
  );
};

// Steps Section Component
const StepsSection = ({ steps, componentType, hierarchy = [], blockStructure = null, instanceDetails = null }) => {
  const [expandedSteps, setExpandedSteps] = useState({});
  const [expandedBlocks, setExpandedBlocks] = useState({});
  const [expandedChildren, setExpandedChildren] = useState({});
  const [expandedIPReferences, setExpandedIPReferences] = useState({});
  const [loadedIPHierarchies, setLoadedIPHierarchies] = useState({});
  const [loadingIPReferences, setLoadingIPReferences] = useState({});
  const [hoveredCondition, setHoveredCondition] = useState({ show: false, condition: '', position: { x: 0, y: 0 } });
  
  // New state for step search functionality
  const [stepSearchTerm, setStepSearchTerm] = useState('');
  const [highlightedSteps, setHighlightedSteps] = useState(new Set());
  const [isExpandingAll, setIsExpandingAll] = useState(false);

  // Effect to handle step search when search term changes
  useEffect(() => {
    searchSteps(stepSearchTerm);
  }, [stepSearchTerm]);

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

  const toggleIPReferenceExpansion = async (stepIndex, ipName) => {
    const isCurrentlyExpanded = expandedIPReferences[stepIndex];
    
    // Toggle expansion state
    setExpandedIPReferences(prev => ({
      ...prev,
      [stepIndex]: !prev[stepIndex]
    }));
    
    // If this step already has an expanded structure, automatically load it
    if (!isCurrentlyExpanded && !loadedIPHierarchies[ipName]) {
      // Find the step that has this IP reference
      const findStepWithIP = (steps) => {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          if ((step.blockType === 'ip-reference' && step.referencedIP === ipName) ||
              (step.integrationProcedureKey === ipName && step.hasExpandedStructure)) {
            return { step, index: i };
          }
          // Recursively search in sub-steps and block steps
          if (step.subSteps && step.subSteps.length > 0) {
            const found = findStepWithIP(step.subSteps);
            if (found) return found;
          }
          if (step.blockSteps && step.blockSteps.length > 0) {
            const found = findStepWithIP(step.blockSteps);
            if (found) return found;
          }
        }
        return null;
      };
      
      if (instanceDetails && instanceDetails.steps) {
        const foundStep = findStepWithIP(instanceDetails.steps);
        if (foundStep && foundStep.step.hasExpandedStructure && foundStep.step.childIPStructure) {
          console.log(`🚀 [FRONTEND] Auto-loading expanded structure for ${ipName} from step ${foundStep.step.name}`);
          setLoadedIPHierarchies(prev => ({
            ...prev,
            [ipName]: foundStep.step.childIPStructure
          }));
          return; // Already loaded, no need for API call
        }
      }
    }
    
    // If expanding and we haven't loaded the hierarchy yet, load it
    if (!isCurrentlyExpanded && !loadedIPHierarchies[ipName]) {
      setLoadingIPReferences(prev => ({ ...prev, [stepIndex]: true }));
      
      try {
        // First check if we have the expanded structure in our current instance details
        let foundExpandedStructure = false;
        
        if (instanceDetails && instanceDetails.steps) {
          const findExpandedIP = (steps, stepPath = '') => {
            for (let i = 0; i < steps.length; i++) {
              const step = steps[i];
              const currentPath = stepPath ? `${stepPath}.${i}` : `${i}`;
              
              // Check for IP references in both old and new structures
              if ((step.blockType === 'ip-reference' && step.referencedIP === ipName) ||
                  (step.integrationProcedureKey === ipName && step.hasExpandedStructure)) {
                
                // Check if this step has pre-expanded structure
                if (step.hasExpandedStructure && step.childIPStructure && step.childIPStructure.steps) {
                  console.log(`📦 [FRONTEND] Found pre-expanded child IP: ${ipName} with ${step.childIPStructure.steps.length} steps at path: ${currentPath}`);
                  return step.childIPStructure.steps;
                } else if (step.blockType === 'ip-reference') {
                  console.log(`🔍 [FRONTEND] Found IP reference ${ipName} but no expanded structure at path: ${currentPath}`);
                } else {
                  console.log(`🔍 [FRONTEND] Found integrationProcedureKey ${ipName} but no expanded structure at path: ${currentPath}`);
                }
              }
              
              // Recursively search in sub-steps and block steps
              if (step.subSteps && step.subSteps.length > 0) {
                const found = findExpandedIP(step.subSteps, `${currentPath}.subSteps`);
                if (found) return found;
              }
              if (step.blockSteps && step.blockSteps.length > 0) {
                const found = findExpandedIP(step.blockSteps, `${currentPath}.blockSteps`);
                if (found) return found;
              }
            }
            return null;
          };

          const expandedSteps = findExpandedIP(instanceDetails.steps);
          if (expandedSteps && expandedSteps.length > 0) {
            setLoadedIPHierarchies(prev => ({
              ...prev,
              [ipName]: expandedSteps
            }));
            foundExpandedStructure = true;
            console.log(`✅ [FRONTEND] Using pre-expanded structure for ${ipName} with ${expandedSteps.length} steps`);
          } else {
            console.log(`⚠️ [FRONTEND] No pre-expanded structure found for ${ipName} in instance details`);
          }
        }
        
        // Fallback to API call if not in expanded cache
        if (!foundExpandedStructure) {
          console.log(`🔄 [FRONTEND] Fallback: Loading child IP from API: ${ipName}`);
          const response = await axios.get(`/api/omnistudio/ip-reference/${encodeURIComponent(ipName)}/hierarchy`);
          
          if (response.data.success) {
            setLoadedIPHierarchies(prev => ({
              ...prev,
              [ipName]: response.data.hierarchy
            }));
            console.log(`🔗 [IP-REFERENCE] Loaded hierarchy for "${ipName}":`, response.data.hierarchy);
          } else {
            console.error(`❌ [IP-REFERENCE] Failed to load hierarchy for "${ipName}"`);
          }
        }
      } catch (error) {
        console.error(`❌ [IP-REFERENCE] Error loading hierarchy for "${ipName}":`, error);
      } finally {
        setLoadingIPReferences(prev => ({ ...prev, [stepIndex]: false }));
      }
    }
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

  // Expand all steps that have children
  const expandAllSteps = async () => {
    try {
      setIsExpandingAll(true);
      
      // Log expansion start
      
      console.log('🚀 [EXPAND-ALL] Starting expansion process...');
      console.log('🔍 [EXPAND-ALL] Current steps array:', steps);
      
      const newExpandedSteps = {};
      const newExpandedBlocks = {};
      const newExpandedChildren = {};
      const newExpandedIPReferences = {};

      const expandRecursively = (stepList, stepPrefix = '') => {
        console.log(`🔍 [EXPAND-ALL] Processing stepList with prefix: ${stepPrefix}`, stepList);
        
        stepList.forEach((step, index) => {
          // CONVERT DOT NOTATION TO DASH NOTATION for renderStep compatibility
          let stepKey;
          if (stepPrefix) {
            // Convert "2.subSteps.0" to "2-0" format
            const prefixParts = stepPrefix.split('.');
            if (prefixParts.length >= 2) {
              // Extract main step index and nested index
              const mainStepIndex = prefixParts[0];
              const nestedIndex = prefixParts[prefixParts.length - 1];
              stepKey = `${mainStepIndex}-${nestedIndex}`;
            } else {
              stepKey = `${stepPrefix}-${index}`;
            }
          } else {
            stepKey = `${index}`;
          }
          
          const stepKeyWithName = `${stepKey}-${step.name}`;
          
          console.log(`🔍 [EXPAND-ALL] Processing step: ${step.name}`, {
            originalPrefix: stepPrefix,
            stepKey,
            stepKeyWithName,
            type: step.type,
            blockType: step.blockType,
            hasSubSteps: step.subSteps && step.subSteps.length > 0,
            hasBlockSteps: step.blockSteps && step.blockSteps.length > 0,
            hasChildren: step.children && step.children.length > 0,
            hasChildComponent: step.childComponent && step.childComponent.steps && step.childComponent.steps.length > 0,
            isIPReference: step.blockType === 'ip-reference',
            hasExpandedStructure: step.hasExpandedStructure,
            integrationProcedureKey: step.integrationProcedureKey
          });
          
          // Check if step has expandable content
          if (step.subSteps && step.subSteps.length > 0) {
            newExpandedSteps[stepKeyWithName] = true;
            console.log(`✅ [EXPAND-ALL] Will expand step: ${stepKeyWithName} (subSteps)`);
            // Pass the converted stepKey format, not the original stepKey
            expandRecursively(step.subSteps, `${stepKey}`);
          }
          
          if (step.blockSteps && step.blockSteps.length > 0) {
            newExpandedBlocks[stepKeyWithName] = true;
            console.log(`✅ [EXPAND-ALL] Will expand block: ${stepKeyWithName} (blockSteps)`);
            // Pass the converted stepKey format, not the original stepKey
            expandRecursively(step.blockSteps, `${stepKey}`);
          }
          
          if (step.childComponent && step.childComponent.steps && step.childComponent.steps.length > 0) {
            newExpandedChildren[stepKeyWithName] = true;
            console.log(`✅ [EXPAND-ALL] Will expand child component: ${stepKeyWithName}`);
          }
          
          // Handle IP references - both old and new structures
          if (step.blockType === 'ip-reference' && step.referencedIP) {
            newExpandedIPReferences[stepKeyWithName] = true;
            console.log(`✅ [EXPAND-ALL] Will expand IP reference: ${stepKeyWithName} (${step.referencedIP})`);
          } else if (step.integrationProcedureKey && step.hasExpandedStructure) {
            newExpandedIPReferences[stepKeyWithName] = true;
            console.log(`✅ [EXPAND-ALL] Will expand integration procedure: ${stepKeyWithName} (${step.integrationProcedureKey})`);
          }
          
          // Handle blocks that are not IP references (like CustInfoBlock)
          if (step.blockType === 'block' && step.children && step.children.length > 0) {
            newExpandedBlocks[stepKeyWithName] = true;
            console.log(`✅ [EXPAND-ALL] Will expand block: ${stepKeyWithName} (children)`);
            // Also expand the children of this block
            expandRecursively(step.children, `${stepKey}`);
          }
          
          // Handle conditional blocks
          if (step.blockType === 'conditional' && step.children && step.children.length > 0) {
            newExpandedBlocks[stepKeyWithName] = true;
            console.log(`✅ [EXPAND-ALL] Will expand conditional block: ${stepKeyWithName}`);
            expandRecursively(step.children, `${stepKey}`);
          }
          
          // Handle loop blocks
          if (step.blockType === 'loop' && step.children && step.children.length > 0) {
            newExpandedBlocks[stepKeyWithName] = true;
            console.log(`✅ [EXPAND-ALL] Will expand loop block: ${stepKeyWithName}`);
            expandRecursively(step.children, `${stepKey}`);
          }
          
          // Handle cache blocks
          if (step.blockType === 'cache' && step.children && step.children.length > 0) {
            newExpandedBlocks[stepKeyWithName] = true;
            console.log(`✅ [EXPAND-ALL] Will expand cache block: ${stepKeyWithName}`);
            expandRecursively(step.children, `${stepKey}`);
          }
        });
      };

      expandRecursively(steps);
      
      // Set expansion states first
      console.log('🔍 [EXPAND-ALL] Current expansion states before update:', {
        expandedSteps: Object.keys(expandedSteps),
        expandedBlocks: Object.keys(expandedBlocks),
        expandedChildren: Object.keys(expandedChildren),
        expandedIPReferences: Object.keys(expandedIPReferences)
      });
      
      setExpandedSteps(newExpandedSteps);
      setExpandedBlocks(newExpandedBlocks);
      setExpandedChildren(newExpandedChildren);
      setExpandedIPReferences(newExpandedIPReferences);
      
      // Log state verification
      
      console.log('🚀 [STEPS] Expanded all expandable steps');
      console.log('📊 [EXPAND-ALL] Expansion summary:', {
        steps: Object.keys(newExpandedSteps).length,
        blocks: Object.keys(newExpandedBlocks).length,
        children: Object.keys(newExpandedChildren).length,
        ipReferences: Object.keys(newExpandedIPReferences).length
      });
      console.log('🔍 [EXPAND-ALL] Expanded steps:', Object.keys(newExpandedSteps));
      console.log('🔍 [EXPAND-ALL] Expanded blocks:', Object.keys(newExpandedBlocks));
      console.log('🔍 [EXPAND-ALL] Expanded IP references:', Object.keys(newExpandedIPReferences));
      
      // Log expansion completion
      
      // Log the new state values that were just set
      console.log('🔍 [EXPAND-ALL] New expansion states that were just set:', {
        newExpandedSteps: Object.keys(newExpandedSteps),
        newExpandedBlocks: Object.keys(newExpandedBlocks),
        newExpandedChildren: Object.keys(newExpandedChildren),
        newExpandedIPReferences: Object.keys(newExpandedIPReferences)
      });
      
      // Now load any child IPs that haven't been loaded yet
      await loadMissingChildIPs();
      
    } catch (error) {
      console.error('❌ [STEPS] Error during expand all:', error);
    } finally {
      setIsExpandingAll(false);
    }
  };

  // Load missing child IPs that need to be fetched from API
  const loadMissingChildIPs = async () => {
    const ipReferencesToLoad = [];
    
    // Find all IP references that are expanded but not loaded
    const findMissingIPs = (stepList, stepPrefix = '') => {
      stepList.forEach((step, index) => {
        const stepKey = stepPrefix ? `${stepPrefix}-${index}` : `${index}`;
        const stepKeyWithName = `${stepKey}-${step.name}`;
        
        // Debug logging for IP references
        if (step.blockType === 'ip-reference' || step.integrationProcedureKey) {
          console.log(`🔍 [EXPAND-ALL] Found IP reference: ${step.name}`, {
            blockType: step.blockType,
            referencedIP: step.referencedIP,
            integrationProcedureKey: step.integrationProcedureKey,
            hasExpandedStructure: step.hasExpandedStructure,
            isExpanded: expandedIPReferences[stepKeyWithName],
            isLoaded: loadedIPHierarchies[step.referencedIP || step.integrationProcedureKey]
          });
        }
        
        if (step.blockType === 'ip-reference' && step.referencedIP) {
          // Check if this IP reference is expanded but not loaded
          if (expandedIPReferences[stepKeyWithName] && !loadedIPHierarchies[step.referencedIP]) {
            ipReferencesToLoad.push({
              stepKey: stepKeyWithName,
              ipName: step.referencedIP,
              step: step
            });
            console.log(`📥 [EXPAND-ALL] Will load IP: ${step.referencedIP}`);
          }
        } else if (step.integrationProcedureKey && step.hasExpandedStructure) {
          // Check if this integration procedure reference is expanded but not loaded
          if (expandedIPReferences[stepKeyWithName] && !loadedIPHierarchies[step.integrationProcedureKey]) {
            ipReferencesToLoad.push({
              stepKey: stepKeyWithName,
              ipName: step.integrationProcedureKey,
              step: step
            });
            console.log(`📥 [EXPAND-ALL] Will load IP: ${step.integrationProcedureKey}`);
          }
        }
        
        // Recursively check sub-steps and block steps
        if (step.subSteps && step.subSteps.length > 0) {
          findMissingIPs(step.subSteps, `${stepKey}.subSteps`);
        }
        if (step.blockSteps && step.blockSteps.length > 0) {
          findMissingIPs(step.blockSteps, `${stepKey}.blockSteps`);
        }
        // Also check children for blocks
        if (step.children && step.children.length > 0) {
          findMissingIPs(step.children, `${stepKey}.children`);
        }
      });
    };

    findMissingIPs(steps);
    
    if (ipReferencesToLoad.length === 0) {
      console.log('✅ [STEPS] All child IPs are already loaded');
      return;
    }
    
    console.log(`🔄 [STEPS] Loading ${ipReferencesToLoad.length} missing child IPs...`);
    
    // Load each missing IP reference
    for (const ipRef of ipReferencesToLoad) {
      try {
        console.log(`📥 [STEPS] Loading child IP: ${ipRef.ipName}`);
        
        // Check if we have pre-expanded structure in the current instance
        let foundExpandedStructure = false;
        
        if (instanceDetails && instanceDetails.steps) {
          const findExpandedIP = (steps, stepPath = '') => {
            for (let i = 0; i < steps.length; i++) {
              const step = steps[i];
              const currentPath = stepPath ? `${stepPath}.${i}` : `${i}`;
              
              if ((step.blockType === 'ip-reference' && step.referencedIP === ipRef.ipName) ||
                  (step.integrationProcedureKey === ipRef.ipName && step.hasExpandedStructure)) {
                
                if (step.hasExpandedStructure && step.childIPStructure && step.childIPStructure.steps) {
                  console.log(`📦 [STEPS] Found pre-expanded structure for ${ipRef.ipName}`);
                  setLoadedIPHierarchies(prev => ({
                    ...prev,
                    [ipRef.ipName]: step.childIPStructure
                  }));
                  foundExpandedStructure = true;
                  break;
                }
              }
              
              // Recursively search in sub-steps and block steps
              if (step.subSteps && step.subSteps.length > 0) {
                const found = findExpandedIP(step.subSteps, `${currentPath}.subSteps`);
                if (found) break;
              }
              if (step.blockSteps && step.blockSteps.length > 0) {
                const found = findExpandedIP(step.blockSteps, `${currentPath}.blockSteps`);
                if (found) break;
              }
            }
          };
          
          findExpandedIP(instanceDetails.steps);
        }
        
        // If not found in pre-expanded structure, load from API
        if (!foundExpandedStructure) {
          console.log(`🔄 [STEPS] Loading ${ipRef.ipName} from API...`);
          const response = await axios.get(`/api/omnistudio/ip-reference/${encodeURIComponent(ipRef.ipName)}/hierarchy`);
          
          if (response.data.success) {
            setLoadedIPHierarchies(prev => ({
              ...prev,
              [ipRef.ipName]: response.data.hierarchy
            }));
            console.log(`✅ [STEPS] Successfully loaded ${ipRef.ipName} with ${response.data.hierarchy.steps?.length || 0} steps`);
          } else {
            console.error(`❌ [STEPS] Failed to load ${ipRef.ipName}`);
          }
        }
        
        // Small delay to prevent overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ [STEPS] Error loading ${ipRef.ipName}:`, error);
      }
    }
    
    console.log('✅ [STEPS] Finished loading all missing child IPs');
  };

  // Collapse all steps to show only direct steps
  const collapseAllSteps = () => {
    setExpandedSteps({});
    setExpandedBlocks({});
    setExpandedChildren({});
    setExpandedIPReferences({});
    setHighlightedSteps(new Set());
    setStepSearchTerm('');
    
    console.log('📁 [STEPS] Collapsed all steps to direct level only');
  };

  // Search through steps and sub-steps for matching labels
  const searchSteps = (searchTerm) => {
    if (searchTerm.length < 2) {
      setHighlightedSteps(new Set());
      return;
    }

    const matchingSteps = new Set();
    const searchLower = searchTerm.toLowerCase();

    const searchRecursively = (stepList, stepPrefix = '') => {
      stepList.forEach((step, index) => {
        const stepKey = stepPrefix ? `${stepPrefix}-${index}` : `${index}`;
        
        // Check if step name/label matches search term
        const stepName = step.name || '';
        const stepLabel = step.label || '';
        const stepType = step.type || '';
        
        if (stepName.toLowerCase().includes(searchLower) || 
            stepLabel.toLowerCase().includes(searchLower) ||
            stepType.toLowerCase().includes(searchLower)) {
          matchingSteps.add(stepKey);
          
          // Auto-expand parent steps to show matching child
          if (stepPrefix) {
            const parentKey = stepPrefix.split('.').pop();
            if (parentKey) {
              const parentIndex = parentKey.split('-')[0];
              const parentName = stepList[parentIndex]?.name;
              if (parentName) {
                matchingSteps.add(`${parentIndex}-${parentName}`);
              }
            }
          }
        }
        
        // Recursively search in sub-steps and block steps
        if (step.subSteps && step.subSteps.length > 0) {
          searchRecursively(step.subSteps, `${stepKey}.subSteps`);
        }
        if (step.blockSteps && step.blockSteps.length > 0) {
          searchRecursively(step.blockSteps, `${stepKey}.blockSteps`);
        }
      });
    };

    searchRecursively(steps);
    setHighlightedSteps(matchingSteps);
    
    // Auto-expand steps that contain matches
    if (matchingSteps.size > 0) {
      const newExpandedSteps = {};
      const newExpandedBlocks = {};
      
      matchingSteps.forEach(stepKey => {
        const [index, name] = stepKey.split('-');
        const step = steps[parseInt(index)];
        
        if (step) {
          if (step.subSteps && step.subSteps.length > 0) {
            newExpandedSteps[stepKey] = true;
          }
          if (step.blockSteps && step.blockSteps.length > 0) {
            newExpandedBlocks[stepKey] = true;
          }
        }
      });
      
      setExpandedSteps(prev => ({ ...prev, ...newExpandedSteps }));
      setExpandedBlocks(prev => ({ ...prev, ...newExpandedBlocks }));
    }
    
    console.log(`🔍 [STEPS] Found ${matchingSteps.size} matching steps for "${searchTerm}"`);
  };

  const renderStep = (step, index, isSubStep = false, level = 0) => {
    const hasCondition = step.executionCondition || step.showCondition || step.blockCondition;
    const condition = step.executionCondition || step.showCondition || step.blockCondition;
    const isOmniscriptStep = componentType === 'omniscript' && step.type === 'Step';
    
    // Check expansion states with debugging
    const stepKey = `${index}-${step.name}`;
    const isExpanded = expandedSteps[stepKey];
    const isBlockExpanded = expandedBlocks[stepKey];
    const isChildExpanded = expandedChildren[stepKey];
    const isIPReferenceExpanded = expandedIPReferences[stepKey];
    
    // Debug IP reference expansion specifically
    if (step.name === 'IPInitiateCustDataCreationAndFetchDSCatalogData') {
      console.log(`🔍 [IP-REFERENCE-DEBUG] Step: ${step.name}`, {
        stepKey,
        isIPReferenceExpanded,
        blockType: step.blockType,
        referencedIP: step.referencedIP,
        integrationProcedureKey: step.integrationProcedureKey,
        hasExpandedStructure: step.hasExpandedStructure,
        childIPStructure: step.childIPStructure ? 'EXISTS' : 'MISSING',
        childIPStructureDetails: step.childIPStructure ? {
          hasSteps: !!step.childIPStructure.steps,
          stepsLength: step.childIPStructure.steps?.length || 0,
          stepsPreview: step.childIPStructure.steps?.slice(0, 3).map(s => s.name) || []
        } : 'N/A',
        expandedIPReferencesKeys: Object.keys(expandedIPReferences),
        lookupResult: expandedIPReferences[stepKey]
      });
    }
    
    const hasChildComponent = step.childComponent && step.childComponent.steps && step.childComponent.steps.length > 0;
    
    // Check if this step should be highlighted based on search
    const isHighlighted = highlightedSteps.has(stepKey);
    
    // Helper function to get the appropriate name for LWC steps
    const getStepDisplayName = (step) => {
      // For Custom Lightning Web Components, prefer lwcName from propSetMap
      if (step.type === 'Custom Lightning Web Component' && step.propSetMap) {
        console.log(`🔍 [STEP-NAME] LWC step "${step.name}" propSetMap:`, step.propSetMap);
        
        // Check if propSetMap has lwcName property (specific to LWC steps)
        if (step.propSetMap.lwcName) {
          console.log(`✅ [STEP-NAME] Using propSetMap.lwcName: "${step.propSetMap.lwcName}"`);
          return step.propSetMap.lwcName;
        }
        // Fallback to other common propSetMap name fields if lwcName is not available
        if (step.propSetMap.name) {
          console.log(`✅ [STEP-NAME] Using propSetMap.name: "${step.propSetMap.name}"`);
          return step.propSetMap.name;
        }
        if (step.propSetMap.label) {
          console.log(`✅ [STEP-NAME] Using propSetMap.label: "${step.propSetMap.label}"`);
          return step.propSetMap.label;
        }
        if (step.propSetMap.title) {
          console.log(`✅ [STEP-NAME] Using propSetMap.title: "${step.propSetMap.title}"`);
          return step.propSetMap.title;
        }
        
        console.log(`⚠️ [STEP-NAME] No suitable name found in propSetMap, falling back to step.name: "${step.name}"`);
      }
      // For all other step types, use the standard name field
      return step.name || 'Unnamed Step';
    };
    

    const hasBlockSteps = step.blockSteps && step.blockSteps.length > 0;
    
    // IP Reference handling - Support both old and new backend structures
    const isIPReference = step.blockType === 'ip-reference' || (step.integrationProcedureKey && step.hasExpandedStructure);
    const ipReferenceKey = `${index}-${step.name}`;
    const isLoadingIPReference = loadingIPReferences[ipReferenceKey];
    
    // Get IP reference data from either old or new structure
    let ipReferenceHierarchy = null;
    let ipReferenceName = null;
    
    // PRIORITIZE NEW STRUCTURE when hasExpandedStructure is true
    if (step.integrationProcedureKey && step.hasExpandedStructure && step.childIPStructure) {
      // New structure - use the expanded child IP structure (highest priority)
      ipReferenceHierarchy = step.childIPStructure;
      ipReferenceName = step.integrationProcedureKey;
      console.log(`🔍 [IP-REFERENCE] Using NEW structure for ${step.name}:`, {
        integrationProcedureKey: step.integrationProcedureKey,
        hasExpandedStructure: step.hasExpandedStructure,
        childIPStructureExists: !!step.childIPStructure,
        stepsCount: step.childIPStructure?.steps?.length || 0
      });
    } else if (step.blockType === 'ip-reference' && step.referencedIP) {
      // Old structure - fallback to loaded hierarchies
      ipReferenceHierarchy = loadedIPHierarchies[step.referencedIP];
      ipReferenceName = step.referencedIP;
      console.log(`🔍 [IP-REFERENCE] Using OLD structure for ${step.name}:`, {
        referencedIP: step.referencedIP,
        loadedHierarchyExists: !!loadedIPHierarchies[step.referencedIP],
        stepsCount: loadedIPHierarchies[step.referencedIP]?.steps?.length || 0
      });
    }
    
    // Determine block type styling
    const blockTypeClass = step.blockType ? `block-${step.blockType}` : '';
    const levelClass = level > 0 ? `level-${Math.min(level, 4)}` : ''; // Only add level class if level > 0
    
    // FORCE MAIN LEVEL ALIGNMENT: For main-level steps, remove problematic classes
    let finalClassName = `step-item ${isSubStep ? 'sub-step' : ''}`;
    let inlineStyle = {};
    
    // Add highlighting class if step matches search
    if (isHighlighted) {
      finalClassName += ' step-highlighted';
    }
    
    if (level === 0 && !isSubStep) {
      // Main level steps - force consistent styling
      finalClassName = 'step-item main-level-step force-alignment'; // Clean classes with force flag
      // Add highlighting class if step matches search
      if (isHighlighted) {
        finalClassName += ' step-highlighted';
      }
      inlineStyle = {
        marginLeft: '0px',
        background: '#f8f9fa',
        borderLeft: '3px solid #0176D3',
        position: 'relative' // Ensure proper positioning
      };
      // Main level alignment fix applied successfully
    } else {
      // Nested steps - preserve original logic
      finalClassName += ` ${blockTypeClass} ${levelClass}`;
    }

    return (
      <div 
        key={`${index}-${step.name}`} 
        className={finalClassName}
        style={inlineStyle}
      >
        <div className="step-header">
          {/* Block type indicator - REMOVED for cleaner UI */}
          
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
              title={isExpanded ? `Collapse step: ${getStepDisplayName(step)}` : `Expand step: ${getStepDisplayName(step)}`}
            >
              ▶
            </button>
          )}

          {/* Child component toggle */}
          {hasChildComponent && (
            <button 
              className={`child-component-toggle ${isChildExpanded ? 'expanded' : ''}`}
              onClick={() => toggleChildComponentExpansion(`${index}-${step.name}`)}
              title={isChildExpanded ? `Collapse child component: ${getStepDisplayName(step)}` : `Expand child component: ${getStepDisplayName(step)}`}
            >
              📁
            </button>
          )}

          {/* IP Reference toggle */}
          {isIPReference && (
            <button 
              className={`ip-reference-toggle ${isIPReferenceExpanded ? 'expanded' : ''} ${isLoadingIPReference ? 'loading' : ''}`}
              onClick={() => toggleIPReferenceExpansion(ipReferenceKey, ipReferenceName)}
              title={isIPReferenceExpanded ? `Collapse IP: ${ipReferenceName}` : `Expand IP: ${ipReferenceName}`}
              disabled={isLoadingIPReference}
            >
              {isLoadingIPReference ? '⏳' : '▶'}
            </button>
          )}
          
          <div className="step-main-info">
            {/* Primary row with name, type, and condition */}
            <div className="step-primary-row">
              <span className="step-name">{getStepDisplayName(step)}</span>
              <span className="step-type">{step.type}</span>
              
              {/* LWC Component Override Icon */}
              {step.propSetMap && step.propSetMap.lwcComponentOverride && step.propSetMap.lwcComponentOverride.trim() !== '' && (
                <span 
                  className="lwc-override-indicator"
                  title={`LWC Component Override: ${step.propSetMap.lwcComponentOverride}`}
                  role="img"
                  aria-label={`LWC Component Override: ${step.propSetMap.lwcComponentOverride}`}
                >
                  ⚡
                </span>
              )}
              
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
            <div className="sub-steps-header">
              <strong>📋 Elements ({step.subSteps.length}):</strong>
            </div>
            {step.subSteps.map((subStep, subIndex) => 
              renderStep(subStep, `${index}-${subIndex}`, true, level + 1)
            )}
          </div>
        )}

        {/* Block steps for conditional/loop/cache blocks */}
        {hasBlockSteps && isBlockExpanded && (
          <div className="step-block-steps">
            <div className="block-steps-header">
              <strong>📋 Steps ({step.blockSteps.length}):</strong>
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
              <strong>📋 Steps ({step.childComponent.steps.length}):</strong>
            </div>
            {step.childComponent.steps.map((childStep, childIndex) => 
              renderStep(childStep, `${index}-child-${childIndex}`, true, level + 1)
            )}
          </div>
        )}

        {/* IP Reference steps (on-demand loaded) */}
        {isIPReference && isIPReferenceExpanded && (
          <div className="ip-reference-steps">
            <div className="ip-reference-header">
              <strong>📋 Steps ({ipReferenceHierarchy && ipReferenceHierarchy.steps ? ipReferenceHierarchy.steps.length : 0}):</strong>
            </div>
            {isLoadingIPReference ? (
              <div className="loading-message">⏳ Loading IP hierarchy...</div>
            ) : ipReferenceHierarchy && ipReferenceHierarchy.steps && ipReferenceHierarchy.steps.length > 0 ? (
              ipReferenceHierarchy.steps.map((ipStep, ipIndex) => 
                renderStep(ipStep, `${index}-ip-${ipIndex}`, true, level + 1)
              )
            ) : (
              <div className="no-steps-message">No steps found for this IP reference</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="steps-section">
      <div className="steps-header">
        <h5>📋 Steps ({steps.length})</h5>
        
        {/* Step Controls */}
        <div className="step-controls">
          {/* Expand All Button */}
          <button 
            className="step-control-btn expand-all-btn"
            onClick={expandAllSteps}
            disabled={isExpandingAll}
            title="Expand all steps with children"
          >
            {isExpandingAll ? '⏳ Expanding...' : '🚀 Expand All'}
          </button>
          
          {/* Collapse All Button */}
          <button 
            className="step-control-btn collapse-all-btn"
            onClick={collapseAllSteps}
            title="Collapse all steps to show only direct steps"
          >
            📁 Collapse All
          </button>
          
          {/* Step Search Box */}
          <div className="step-search-container">
            <input
              type="text"
              className="step-search-input"
              placeholder="Search steps (min 2 chars)..."
              value={stepSearchTerm}
              onChange={(e) => setStepSearchTerm(e.target.value)}
              title="Search through step names, labels, and types"
            />
            {stepSearchTerm.length > 0 && (
              <button 
                className="step-search-clear"
                onClick={() => setStepSearchTerm('')}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>
      
      <div className="steps-list">
        {steps.map((step, index) => renderStep(step, index, false, 0))}
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

const OmnistudioTab = ({ onTabLoad }) => {
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
  
  // Loading states
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  
  // Error states
  const [instanceError, setInstanceError] = useState('');
  const [detailError, setDetailError] = useState('');

  // Fetch instances when component type changes or search term changes
  useEffect(() => {
    fetchInstancesFromAPI();
  }, [selectedComponentType, searchTerm]);

  // Separate effect for one-time global data loading
  useEffect(() => {
    if (onTabLoad) {
      onTabLoad();
    }
  }, [onTabLoad]);

  // Clear selected instance when component type changes
  useEffect(() => {
    setSelectedInstance(null);
    setInstanceDetails(null);
    setDetailError('');
  }, [selectedComponentType]);





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

      // Use the new search endpoint for real-time search
      const response = await axios.get('/api/omnistudio/search', { params });
      
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





  const handleInstanceSelect = (instance) => {
    setSelectedInstance(instance);
    // Always use API call for instance details
    fetchInstanceDetailsFromAPI(selectedComponentType, instance.name);
  };

  const fetchInstanceDetailsFromAPI = async (componentType, instanceName) => {
    try {
      setLoadingDetails(true);
      setDetailError('');
      
      // PRIORITY 1: TRY CACHED DATA FIRST (preferred method - uses pre-built hierarchy)
      try {
        console.log(`📦 [CACHED] Attempting to load ${componentType} "${instanceName}" from cached hierarchy...`);
        const cachedResponse = await axios.get(`/api/omnistudio/${componentType}/${encodeURIComponent(instanceName)}/cached`);
        
        if (cachedResponse.data.success) {
          const details = cachedResponse.data.component;
          console.log(`✅ [CACHED] Successfully loaded component from cached hierarchy:`, {
            name: details.name,
            type: details.type,
            subType: details.subType,
            stepsCount: details.steps ? details.steps.length : 0,
            fullyExpanded: cachedResponse.data.fullyExpanded,
            expandedChildrenCount: cachedResponse.data.expandedChildrenCount,
            fromCache: true
          });
          
          // Set instance details with cached data (includes pre-built hierarchy)
          setInstanceDetails(details);
          return; // Success with cached hierarchy data, no SOQL query needed
        }
      } catch (cacheError) {
        console.warn(`⚠️ [CACHED] Cache miss for ${componentType} "${instanceName}":`, cacheError.response?.data?.message || cacheError.message);
        
        // Check if this is a "requires global load" error
        if (cacheError.response?.data?.requiresGlobalLoad) {
          console.log(`🔄 [CACHED] Global data not loaded, attempting to load global data first...`);
          try {
            // Try to load global data first
            await axios.post('/api/omnistudio/global-data', {}, { withCredentials: true });
            console.log(`✅ [CACHED] Global data loaded, retrying cached component request...`);
            
            // Retry the cached request
            const retryResponse = await axios.get(`/api/omnistudio/${componentType}/${encodeURIComponent(instanceName)}/cached`);
            if (retryResponse.data.success) {
              const details = retryResponse.data.component;
              console.log(`✅ [CACHED-RETRY] Successfully loaded component after global data load:`, {
                name: details.name,
                stepsCount: details.steps ? details.steps.length : 0,
                fullyExpanded: retryResponse.data.fullyExpanded
              });
              setInstanceDetails(details);
              return;
            }
          } catch (globalLoadError) {
            console.warn(`⚠️ [CACHED] Failed to load global data:`, globalLoadError.message);
          }
        }
      }
      
      // PRIORITY 2: FALLBACK TO SOQL QUERY (only if cache completely fails)
      console.log(`🔄 [FALLBACK] Cache unavailable, falling back to SOQL query for ${componentType} "${instanceName}"...`);
      const response = await axios.get(`/api/omnistudio/${componentType}/${encodeURIComponent(instanceName)}/details`);
      
      if (response.data.success) {
        setInstanceDetails(response.data.details);
        console.log(`📋 [FALLBACK] Loaded details via SOQL query:`, {
          name: response.data.details.name,
          stepsCount: response.data.details.steps ? response.data.details.steps.length : 0,
          fromAPI: true
        });
      } else {
        setDetailError('Failed to load instance details from both cache and API');
        setInstanceDetails(null);
      }
    } catch (error) {
      setDetailError('Error loading details: ' + (error.response?.data?.message || error.message));
      setInstanceDetails(null);
      console.error(`❌ [FETCH-ERROR] Failed to load ${componentType} "${instanceName}":`, error);
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
            <label htmlFor="instanceSearch">
              {selectedComponentType === 'integration-procedure' ? 
                "Filter by name or procedure key:" : 
                "Filter by name prefix:"
              }
            </label>
            <div className="search-container">
              <input
                id="instanceSearch"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={selectedComponentType === 'integration-procedure' ? 
                  "Enter name or procedure key..." : 
                  "Enter component name prefix..."
                }
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





            {instanceError && (
              <div className="error-message">
                <span>⚠️ {instanceError}</span>
              </div>
            )}

            {loadingInstances ? (
              <div className="loading-spinner">
                Loading instances...
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
                      {/* Show procedureKey for Integration Procedures to avoid confusion */}
                      {instance.procedureKey && selectedComponentType === 'integration-procedure' && (
                        <span className="instance-procedure-key">Key: {instance.procedureKey}</span>
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
                          instanceDetails={instanceDetails}
                          blockStructure={instanceDetails.summary.blockStructure || null}
                        />
                      )}
                    </div>
                  )}

                  {/* Referenced By Section - Shows all references to this component */}
                  {instanceDetails.name && (
                    <div className="details-section">
                      <h4>🔗 Referenced By</h4>
                      <div className="referenced-by-container">
                        <div className="referenced-by-info">
                          <p>This section shows all Integration Procedures and OmniScripts that reference the currently selected component: <strong>{instanceDetails.name}</strong></p>
                        </div>
                        <ReferencedBySection 
                          componentName={instanceDetails.name}
                          componentType={instanceDetails.componentType}
                        />
                      </div>
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
