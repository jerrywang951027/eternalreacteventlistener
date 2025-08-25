const jsforce = require('jsforce');

class OmnistudioModule {
  constructor(globalSalesforceConnection) {
    this.globalSalesforceConnection = globalSalesforceConnection;
    this.globalComponentsData = null; // Store all components globally
    this.componentHierarchy = new Map(); // Store hierarchical relationships
  }

  /**
   * Get component prefix based on component type
   */
  getComponentPrefix(componentType) {
    switch (componentType) {
      case 'integration-procedure':
        return 'IP-';
      case 'omniscript':
        return 'OS-';
      default:
        return '';
    }
  }

  /**
   * Set the global Salesforce connection
   */
  setGlobalConnection(connection) {
    this.globalSalesforceConnection = connection;
  }

  /**
   * Load all Omnistudio components globally with hierarchical relationships
   */
  async loadAllComponents(req, res) {
    try {
      if (!req.session.salesforce) {
        return res.status(401).json({ 
          success: false, 
          message: 'Not authenticated with Salesforce' 
        });
      }

      // Start timing
      const startTime = new Date();
      const startTimestamp = startTime.toISOString();
      
      const connection = this.createConnection(req);
      console.log(`🔄 [OMNISTUDIO] Starting global component loading at ${startTimestamp}...`);

      // Load all components in parallel
      const [integrationProcedures, omniscripts, dataMappers] = await Promise.all([
        this.loadAllIntegrationProcedures(connection),
        this.loadAllOmniscripts(connection), 
        this.loadAllDataMappers(connection)
      ]);

      console.log(`📊 [OMNISTUDIO] Loaded: ${integrationProcedures.length} IPs, ${omniscripts.length} Omniscripts, ${dataMappers.length} Data Mappers`);

      // Build hierarchical relationships
      this.buildHierarchicalRelationships([...integrationProcedures, ...omniscripts]);

      // End timing
      const endTime = new Date();
      const endTimestamp = endTime.toISOString();
      const durationMs = endTime.getTime() - startTime.getTime();

      console.log(`⏱️ [OMNISTUDIO] Component loading completed in ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`);

      // Store globally with timing information
      this.globalComponentsData = {
        integrationProcedures,
        omniscripts,
        dataMappers,
        hierarchy: Object.fromEntries(this.componentHierarchy),
        loadedAt: endTimestamp,
        totalComponents: integrationProcedures.length + omniscripts.length + dataMappers.length,
        timing: {
          startTime: startTimestamp,
          endTime: endTimestamp,
          durationMs: durationMs,
          durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
        }
      };

      res.json({
        success: true,
        message: 'All components loaded successfully',
        summary: {
          integrationProcedures: integrationProcedures.length,
          omniscripts: omniscripts.length,
          dataMappers: dataMappers.length,
          totalComponents: this.globalComponentsData.totalComponents,
          hierarchicalRelationships: this.componentHierarchy.size
        }
      });

    } catch (error) {
      console.error('❌ [OMNISTUDIO] Error loading all components:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to load components: ' + error.message 
      });
    }
  }

  /**
   * Load all Integration Procedures with full details
   */
  async loadAllIntegrationProcedures(connection) {
    const query = `
      SELECT Id, Name, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Version__c,
             vlocity_cmt__ProcedureKey__c, vlocity_cmt__IsActive__c,
             (SELECT Id, Name, vlocity_cmt__Sequence__c, vlocity_cmt__Content__c 
              FROM vlocity_cmt__OmniScriptDefinitions__r 
              ORDER BY vlocity_cmt__Sequence__c ASC LIMIT 1)
      FROM vlocity_cmt__OmniScript__c 
      WHERE vlocity_cmt__IsProcedure__c=true AND vlocity_cmt__IsActive__c=true
      ORDER BY Name ASC
    `;

    const result = await connection.query(query);
    return result.records.map(record => this.processComponentRecord(record, 'integration-procedure'));
  }

  /**
   * Load all Omniscripts with full details
   */
  async loadAllOmniscripts(connection) {
    const query = `
      SELECT Id, Name, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Version__c,
             vlocity_cmt__ProcedureKey__c, vlocity_cmt__IsActive__c,
             (SELECT Id, Name, vlocity_cmt__Sequence__c, vlocity_cmt__Content__c
              FROM vlocity_cmt__OmniScriptDefinitions__r 
              ORDER BY vlocity_cmt__Sequence__c ASC LIMIT 1)
      FROM vlocity_cmt__OmniScript__c 
      WHERE vlocity_cmt__IsProcedure__c=false AND vlocity_cmt__IsActive__c=true
      ORDER BY Name ASC
    `;

    const result = await connection.query(query);
    return result.records.map(record => this.processComponentRecord(record, 'omniscript'));
  }

  /**
   * Load all Data Mappers
   */
  async loadAllDataMappers(connection) {
    const query = `
      SELECT Id, Name, vlocity_cmt__Description__c, vlocity_cmt__Type__c
      FROM vlocity_cmt__DRBundle__c
      ORDER BY Name ASC
    `;

    const result = await connection.query(query);
    return result.records.map(record => ({
      id: record.Id,
      name: record.Name,
      componentType: 'data-mapper',
      description: record.vlocity_cmt__Description__c,
      type: record.vlocity_cmt__Type__c,
      uniqueId: record.Name,
      configItems: [] // Skip config items retrieval for now
    }));
  }

  /**
   * Process component record with full details
   */
  processComponentRecord(record, componentType) {
    const component = {
      id: record.Id,
      name: record.Name,
      componentType,
      type: record.vlocity_cmt__Type__c,
      subType: record.vlocity_cmt__SubType__c,
      version: record.vlocity_cmt__Version__c,
      procedureKey: record.vlocity_cmt__ProcedureKey__c,
      uniqueId: record.vlocity_cmt__Type__c && record.vlocity_cmt__SubType__c
        ? `${record.vlocity_cmt__Type__c}_${record.vlocity_cmt__SubType__c}`
        : record.Name,
      steps: [],
      childComponents: [], // References to child components
      referencedBy: [] // Enhanced hierarchical tracking - where this component is referenced from
    };

    console.log(`🔧 [OMNISTUDIO] Processing ${componentType}: "${record.Name}" (Type: ${record.vlocity_cmt__Type__c}, SubType: ${record.vlocity_cmt__SubType__c})
    📋 [COMPONENT-DETAILS] Full component info:
    ID: ${record.Id}
    Name: "${record.Name}"
    Type: "${record.vlocity_cmt__Type__c || 'N/A'}"
    SubType: "${record.vlocity_cmt__SubType__c || 'N/A'}"
    Version: "${record.vlocity_cmt__Version__c || 'N/A'}"
    UniqueId: "${record.vlocity_cmt__Type__c && record.vlocity_cmt__SubType__c ? `${record.vlocity_cmt__Type__c}_${record.vlocity_cmt__SubType__c}` : record.Name}"
    Procedure Key: "${record.vlocity_cmt__ProcedureKey__c || 'N/A'}"
    Has Definitions: ${record.vlocity_cmt__OmniScriptDefinitions__r && record.vlocity_cmt__OmniScriptDefinitions__r.records ? 'YES' : 'NO'}`);
    
    if (record.vlocity_cmt__OmniScriptDefinitions__r && record.vlocity_cmt__OmniScriptDefinitions__r.records) {
      console.log(`    📝 [DEFINITIONS-COUNT] Found ${record.vlocity_cmt__OmniScriptDefinitions__r.records.length} definition(s) for "${record.Name}"`);
    }

    // Process definition content if available
    if (record.vlocity_cmt__OmniScriptDefinitions__r && record.vlocity_cmt__OmniScriptDefinitions__r.records.length > 0) {
      const definition = record.vlocity_cmt__OmniScriptDefinitions__r.records[0];
      
      if (definition.vlocity_cmt__Content__c) {
        try {
          const parsedContent = JSON.parse(definition.vlocity_cmt__Content__c);
          
          console.log(`📋 [JSON-BLOB] Starting to process vlocity_cmt__Content__c JSON blob for:
    Component Type: ${componentType}
    Component Name: "${record.Name}"
    Integration Procedure: "${record.Name}" (${componentType === 'integration-procedure' ? 'THIS IS THE IP' : 'Child of IP'})
    JSON Content Size: ${definition.vlocity_cmt__Content__c.length} characters
    Parsed Object Keys: ${Object.keys(parsedContent).join(', ')}
    Has Children: ${parsedContent.children && Array.isArray(parsedContent.children) ? `YES (${parsedContent.children.length} children)` : 'NO'}`);
          
          // Extract steps with hierarchical structure
          if (parsedContent.children && Array.isArray(parsedContent.children)) {
            component.steps = this.extractHierarchicalSteps(parsedContent.children, componentType, record.Name);
            
            console.log(`✅ [CONTENT] Completed processing ${parsedContent.children.length} children for ${componentType}: "${record.Name}"`);
          } else {
            console.log(`⚠️ [CONTENT] No children found in content for ${componentType}: "${record.Name}"`);
          }
        } catch (error) {
          console.warn(`❌ [CONTENT] Failed to parse content for ${record.Name}:`, error);
          component.contentError = error.message;
        }
      } else {
        console.log(`⚠️ [CONTENT] No content found for ${componentType}: "${record.Name}"`);
      }
    } else {
      console.log(`⚠️ [CONTENT] No definition found for ${componentType}: "${record.Name}"`);
    }

    return component;
  }

  /**
   * Build hierarchical relationships between components
   */
  buildHierarchicalRelationships(allComponents) {
    console.log('🔗 [OMNISTUDIO] Building hierarchical relationships...');
    
    // Create lookup maps
    const componentsByUniqueId = new Map();
    const componentsByName = new Map();
    
    allComponents.forEach(component => {
      componentsByUniqueId.set(component.uniqueId, component);
      componentsByName.set(component.name, component);
    });

    // Find hierarchical relationships
    allComponents.forEach(component => {
      if (component.steps && component.steps.length > 0) {
        this.findChildComponents(component, componentsByUniqueId, componentsByName, []);
      }
    });
  }

  /**
   * Find child components referenced in steps
   */
  findChildComponents(parentComponent, componentsByUniqueId, componentsByName, hierarchicalPath = []) {
    const processSteps = (steps, currentLevel = 0, currentPath = []) => {
      if (currentLevel > 4) { // Prevent infinite recursion (max 4 levels)
        console.warn(`Max hierarchy depth reached for ${parentComponent.name}`);
        return;
      }

      steps.forEach(step => {
        // Check for Integration Procedure references
        if (step.integrationProcedureKey) {
          const childComponent = componentsByUniqueId.get(step.integrationProcedureKey) ||
                               componentsByName.get(step.integrationProcedureKey);
          
          if (childComponent) {
            step.childComponent = {
              id: childComponent.id,
              name: childComponent.name,
              componentType: childComponent.componentType,
              uniqueId: childComponent.uniqueId,
              steps: childComponent.steps,
              level: currentLevel + 1
            };
            
            // Build the full hierarchical path for this reference with prefixes and cycle detection
            const fullPath = [...currentPath, parentComponent.uniqueId];
            
            // Check for circular references - prevent adding child if it's already in the path
            if (fullPath.includes(childComponent.uniqueId)) {
              console.log(`    🔄 [CYCLE-DETECTED] Skipping circular reference: "${childComponent.name}" already exists in path [${fullPath.join(' => ')}]`);
              // Don't return here - we still want to process other aspects of this step (like conditional blocks)
            } else {
              // Only process the child component reference if no circular reference is detected
              const pathString = fullPath.length > 1 
                ? fullPath.slice(0, -1).map(id => {
                    const comp = componentsByUniqueId.get(id);
                    if (!comp) return id;
                    const prefix = comp.componentType === 'integration-procedure' ? 'IP-' : 
                                  comp.componentType === 'omniscript' ? 'OS-' : '';
                    return prefix + comp.name;
                  }).join(' => ') + ' => ' + this.getComponentPrefix(parentComponent.componentType) + parentComponent.name
                : this.getComponentPrefix(parentComponent.componentType) + parentComponent.name;
              
              console.log(`    🔗 [CHILD-IP] Step "${step.name}" references child IP "${childComponent.name}" with ${childComponent.steps.length} steps (Path: ${pathString})`);
              
              // Add to parent's child components list
              if (!parentComponent.childComponents.find(cc => cc.uniqueId === childComponent.uniqueId)) {
                parentComponent.childComponents.push({
                  uniqueId: childComponent.uniqueId,
                  name: childComponent.name,
                  componentType: childComponent.componentType,
                  referencedInStep: step.name,
                  level: currentLevel + 1,
                  hierarchicalPath: fullPath,
                  pathString: pathString
                });
              }
              
              // Add to child component's referencedBy array (enhanced hierarchical tracking)
              if (!childComponent.referencedBy) {
                childComponent.referencedBy = [];
              }
              
              const referenceEntry = {
                parentUniqueId: parentComponent.uniqueId,
                parentName: parentComponent.name,
                parentComponentType: parentComponent.componentType,
                stepName: step.name,
                hierarchicalPath: fullPath,
                pathString: pathString,
                level: currentLevel + 1
              };
              
              // Check if this reference already exists
              const existingRef = childComponent.referencedBy.find(ref => 
                ref.parentUniqueId === parentComponent.uniqueId && ref.stepName === step.name
              );
              
              if (!existingRef) {
                childComponent.referencedBy.push(referenceEntry);
                console.log(`    📈 [REFERENCE-ADDED] "${childComponent.name}" now referenced by "${parentComponent.name}" via step "${step.name}" (Path: ${pathString})`);
              }
              
              // Recursively process child component steps with updated path
              if (childComponent.steps && childComponent.steps.length > 0) {
                const newPath = [...fullPath, childComponent.uniqueId];
                processSteps(childComponent.steps, currentLevel + 1, newPath);
              }
            }
          }
        }

        // Process sub-steps recursively
        if (step.subSteps && step.subSteps.length > 0) {
          processSteps(step.subSteps, currentLevel, currentPath);
        }

        // Process conditional/loop/cache blocks
        if (step.blockSteps && step.blockSteps.length > 0) {
          processSteps(step.blockSteps, currentLevel, currentPath);
        }
      });
    };

    processSteps(parentComponent.steps, 0, []);
  }

  /**
   * Extract hierarchical steps with block support
   */
  extractHierarchicalSteps(children, componentType, containerName = 'Unknown') {
    const steps = [];

    const processStep = (child, parentLevel = 0, parentBlockType = null, childIndex = -1) => {
      // Debug logging for every component found in JSON blob
      // Identify block type first
      const blockType = this.identifyBlockType(child, componentType);
      
      console.log(`  📊 [STEP] Found component in "${containerName}" (${componentType}):
    Name: "${child.name || 'Unnamed'}"
    Type: "${child.type || 'Unknown'}"
    Level: ${parentLevel}
    Has Children: ${child.children ? child.children.length : 0}
    Block Type: ${blockType || 'None'}
    Parent Block: ${parentBlockType || 'None'}
    Containing Integration Procedure: "${containerName}"
    Component Index: ${childIndex}
    Element Type: ${child.eleType || 'N/A'}
    Class: ${child.class || 'N/A'}
    Implementation Class: ${child.implClass || 'N/A'}`);
      
      // Detailed children structure logging
      if (child.children) {
        const hasEleArray = child.children && Array.isArray(child.children) && child.children[0] && child.children[0].eleArray;
        console.log(`  🔍 [CHILDREN-ANALYSIS] "${child.name}" children structure:
    children is Array: ${Array.isArray(child.children)}
    children length: ${Array.isArray(child.children) ? child.children.length : 'N/A'}
    children[0] exists: ${child.children[0] ? 'YES' : 'NO'}
    children[0].eleArray exists: ${hasEleArray ? 'YES' : 'NO'}
    children[0].eleArray type: ${hasEleArray ? typeof child.children[0].eleArray : 'N/A'}
    children[0].eleArray length: ${hasEleArray && Array.isArray(child.children[0].eleArray) ? child.children[0].eleArray.length : 'N/A'}`);
        
        // If it has eleArray, show the first few elements with name and type
        if (hasEleArray && Array.isArray(child.children[0].eleArray)) {
          console.log(`  📋 [ELE-ARRAY-ITEMS] "${child.name}" eleArray contents (first 3):
${child.children[0].eleArray.slice(0, 3).map((item, i) => 
    `    [${i}] Name: "${item.name || 'Unnamed'}", Type: "${item.type || 'Unknown'}", Has Children: ${item.children ? 'YES' : 'NO'}`
  ).join('\n')}`);
        }
      }
      
      console.log(`  🔬 [BLOCK-TYPE-RESULT] Block type detection result for "${child.name}": ${blockType || 'None'} (Based on type: "${child.type}", name: "${child.name}")`);
      
      const step = {
        name: child.name || 'Unnamed Step',
        type: child.type,
        blockType: blockType,
        hasChildren: child.children && child.children.length > 0
      };

      // Extract conditions
      if (child.propSetMap) {
        if (child.propSetMap.executionConditionalFormula) {
          step.executionCondition = child.propSetMap.executionConditionalFormula;
        }
        if (child.propSetMap.show) {
          step.showCondition = this.formatCondition(child.propSetMap.show);
        }

        // Extract other properties
        step.label = child.propSetMap.label;
        step.description = child.propSetMap.description;
        step.bundle = child.propSetMap.bundle;
        step.integrationProcedureKey = child.propSetMap.integrationProcedureKey;
        
        if (step.integrationProcedureKey) {
          console.log(`    🔑 [IP-KEY] Step "${step.name}" has integrationProcedureKey: "${step.integrationProcedureKey}"`);
        }
        
        // Remote action details for IPs
        if (componentType === 'integration-procedure' && child.type && child.type.toLowerCase().includes('remote')) {
          step.remoteClass = child.propSetMap.remoteClass;
          step.remoteMethod = child.propSetMap.remoteMethod;
        }

        // Block-specific properties
        if (step.blockType) {
          step.blockCondition = child.propSetMap.condition || child.propSetMap.loopCondition;
          step.blockIterator = child.propSetMap.iterator;
          step.blockCacheKey = child.propSetMap.cacheKey;
        }
      }

      // Process children based on block type
      let childrenToProcess = [];
      
      // Process children based on the structure
      if (child.children) {
        if (componentType === 'omniscript' && child.type === 'Step' && Array.isArray(child.children)) {
          // For Omniscript Steps, iterate through ALL children elements and collect ALL eleArray items
          childrenToProcess = [];
          child.children.forEach((childElement, childIndex) => {
            if (childElement.eleArray && Array.isArray(childElement.eleArray)) {
              childrenToProcess.push(...childElement.eleArray);
              console.log(`    📋 [OMNISCRIPT-STEP] Found ${childElement.eleArray.length} items in children[${childIndex}].eleArray for Step "${child.name}"`);
            }
          });
          console.log(`    ✅ [OMNISCRIPT-STEP-TOTAL] Total ${childrenToProcess.length} children collected from all eleArray in Step "${child.name}"`);
        } else if (step.blockType === 'block' && Array.isArray(child.children)) {
          // Regular blocks (like CustInfoBlock) - iterate through ALL children and collect ALL eleArray items
          childrenToProcess = [];
          child.children.forEach((childElement, childIndex) => {
            if (childElement.eleArray && Array.isArray(childElement.eleArray)) {
              childrenToProcess.push(...childElement.eleArray);
              console.log(`    📋 [REGULAR-BLOCK] Found ${childElement.eleArray.length} items in children[${childIndex}].eleArray for Block "${child.name}"`);
            }
          });
          console.log(`    ✅ [REGULAR-BLOCK-TOTAL] Total ${childrenToProcess.length} children collected from all eleArray in Block "${child.name}"`);
        } else if (step.blockType === 'conditional' && Array.isArray(child.children) && 
            child.children[0] && child.children[0].eleArray && Array.isArray(child.children[0].eleArray)) {
          // Conditional blocks use eleArray from children[0]
          childrenToProcess = child.children[0].eleArray;
          console.log(`    ✅ [CONDITIONAL-CHILDREN] Found ${childrenToProcess.length} children in children[0].eleArray for conditional block "${child.name}"`);
        } else if (Array.isArray(child.children) && child.children[0] && 
                   child.children[0].eleArray && Array.isArray(child.children[0].eleArray)) {
          // Other components with eleArray structure
          childrenToProcess = child.children[0].eleArray;
          console.log(`    ✅ [ELEARRAY-CHILDREN] Found ${childrenToProcess.length} children in children[0].eleArray for "${child.name}"`);
        } else if (Array.isArray(child.children)) {
          // Regular children array
          childrenToProcess = child.children;
          console.log(`    📋 [REGULAR-CHILDREN] Found ${childrenToProcess.length} children in regular array for "${child.name}"`);
        } else if (step.blockType === 'conditional') {
          // Conditional block but no eleArray - log warning
          console.log(`    ⚠️ [CONDITIONAL-NO-ELEARRAY] Conditional block "${child.name}" has children but no eleArray in children[0]. Children structure: ${JSON.stringify(child.children).substring(0, 200)}...`);
        }
      }
      
      if (childrenToProcess.length > 0) {
        console.log(`    🎯 [PROCESSING] About to process ${childrenToProcess.length} children for step "${child.name}" with blockType "${step.blockType}"`);
        
        // Special handling for Omniscript "Step" elements - their children should always be subSteps
        const isOmniscriptStep = componentType === 'omniscript' && child.type === 'Step';
        
        if (isOmniscriptStep) {
          // For Omniscript Steps, children are sub-steps, but Block-type children need special handling
          console.log(`    📋 [OMNISCRIPT-SUBSTEPS] Creating subSteps array for Omniscript Step "${child.name}"`);
          
          // Debug: Show exactly what we're about to process for AccountCapture and CustInfoBlock
          if (child.name === 'AccountCapture' || child.name === 'CustInfoBlock') {
            console.log(`    🔍 [${child.name.toUpperCase()}-DEBUG] childrenToProcess array contains ${childrenToProcess.length} items:`);
            childrenToProcess.forEach((item, idx) => {
              console.log(`      [${idx}] Name: "${item.name}", Type: "${item.type}", Has Children: ${item.children ? 'YES' : 'NO'}`);
            });
          }
          
          step.subSteps = childrenToProcess.map((grandChild, index) => {
            console.log(`      📋 [SUB-STEP] Processing Omniscript sub-step ${index + 1}/${childrenToProcess.length} in "${containerName}" (type: ${grandChild.type}, name: "${grandChild.name}")`);
            
            // If the grandChild is a Block, ensure it can be expanded
            const processedGrandChild = processStep(grandChild, child.level + 1, parentBlockType, index);
            
            // Additional logging for Block-type children
            if (grandChild.type === 'Block') {
              console.log(`        🧱 [BLOCK-CHILD] Block "${grandChild.name}" has ${grandChild.children ? grandChild.children.length : 0} children`);
            }
            
            console.log(`      ✅ [SUB-STEP-DONE] Completed processing sub-step ${index + 1}: "${grandChild.name}" (result: ${processedGrandChild ? 'SUCCESS' : 'NULL'})`);
            return processedGrandChild;
          });
          console.log(`    ✅ [OMNISCRIPT-SUBSTEPS-DONE] Created ${step.subSteps.length} subSteps for Omniscript Step "${child.name}"`);
        } else if (step.blockType) {
          // For blocks (conditional, loop, cache), children are block steps
          console.log(`    🎛️ [BLOCK-STEPS] Creating blockSteps array for ${step.blockType} block "${child.name}"`);
          
          // Debug: Show exactly what we're about to process for CustInfoBlock
          if (child.name === 'CustInfoBlock') {
            console.log(`    🔍 [CUSTINFOBLOCK-BLOCK-DEBUG] childrenToProcess array contains ${childrenToProcess.length} items:`);
            childrenToProcess.forEach((item, idx) => {
              console.log(`      [${idx}] Name: "${item.name}", Type: "${item.type}", Has Children: ${item.children ? 'YES' : 'NO'}`);
            });
          }
          
          step.blockSteps = childrenToProcess.map((grandChild, index) => {
            console.log(`      🎛️ [BLOCK-CHILD] Processing block step ${index + 1}/${childrenToProcess.length} in "${containerName}" for ${step.blockType} block`);
            return processStep(grandChild, child.level + 1, step.blockType, index);
          });
          console.log(`    ✅ [BLOCK-STEPS-DONE] Created ${step.blockSteps.length} blockSteps for ${step.blockType} block "${child.name}"`);
        } else {
          // For regular steps, children are sub-steps  
          step.subSteps = childrenToProcess.map((grandChild, index) => {
            console.log(`      📋 [SUB-STEP] Processing sub-step ${index + 1}/${childrenToProcess.length} in "${containerName}"`);
            return processStep(grandChild, child.level + 1, parentBlockType, index);
          });
        }
      } else {
        console.log(`    ⚠️ [NO-CHILDREN] No children to process for step "${child.name}" (blockType: ${step.blockType})`);
      }

      // Special handling for Integration Procedure conditional blocks
      // These might not have traditional children but have conditional content
      if (step.blockType === 'conditional' && componentType === 'integration-procedure') {
        // Check for conditional content in propSetMap
        if (child.propSetMap) {
          // Create synthetic block steps for true/false branches
          const syntheticSteps = [];
          
          // Check for true branch
          if (child.propSetMap.trueBranch || child.propSetMap.ifTrue) {
            syntheticSteps.push({
              name: 'True Branch',
              type: 'Conditional Branch',
              syntheticStep: true,
              condition: 'when condition is true',
              content: child.propSetMap.trueBranch || child.propSetMap.ifTrue
            });
          }
          
          // Check for false branch
          if (child.propSetMap.falseBranch || child.propSetMap.ifFalse) {
            syntheticSteps.push({
              name: 'False Branch', 
              type: 'Conditional Branch',
              syntheticStep: true,
              condition: 'when condition is false',
              content: child.propSetMap.falseBranch || child.propSetMap.ifFalse
            });
          }

          // Check for nested actions or steps
          if (child.propSetMap.actions && Array.isArray(child.propSetMap.actions)) {
            child.propSetMap.actions.forEach((action, index) => {
              syntheticSteps.push({
                name: action.name || `Action ${index + 1}`,
                type: action.type || 'Conditional Action',
                syntheticStep: true,
                actionType: action.type,
                content: action
              });
            });
          }

          // If we found conditional content, add it as block steps
          if (syntheticSteps.length > 0) {
            console.log(`    🔄 [SYNTHETIC] Creating ${syntheticSteps.length} synthetic steps for conditional "${child.name}" in "${containerName}"`);
            step.blockSteps = syntheticSteps.map((synthStep, index) => {
              console.log(`      🤖 [SYNTHETIC-STEP] Processing synthetic step ${index + 1}/${syntheticSteps.length}: "${synthStep.name}" in "${containerName}"`);
              return processStep(synthStep, (child.level || 0) + 1, step.blockType);
            });
          }
          
          // If no explicit content found but it's a conditional, create a placeholder
          if (!step.blockSteps || step.blockSteps.length === 0) {
            console.log(`    📝 [PLACEHOLDER] Creating placeholder conditional logic for "${child.name}" in "${containerName}"`);
            step.blockSteps = [{
              name: 'Conditional Logic',
              type: 'Conditional Content',
              syntheticStep: true,
              description: 'This conditional block contains execution logic',
              condition: step.blockCondition || step.executionCondition || 'Has conditional logic'
            }];
          }
        }
      }

      return step;
    };

    console.log(`🚀 [MAIN-STEPS] Processing ${children.length} main steps for "${containerName}" (${componentType})`);
    
    children.forEach((child, index) => {
      console.log(`  🎯 [MAIN-STEP] Processing main step ${index + 1}/${children.length}: "${child.name || 'Unnamed'}" in "${containerName}"`);
      steps.push(processStep(child, 0, null, index));
    });

    console.log(`✨ [COMPLETED] Finished processing all steps for "${containerName}" (${componentType}) - Total steps: ${steps.length}`);
    return steps;
  }

  /**
   * Identify block types (conditional, cache, loop)
   */
  identifyBlockType(child, componentType) {
    if (!child.type && !child.name) return null;

    const type = (child.type || '').toLowerCase();
    const name = (child.name || '').toLowerCase();
    
    // Quick conditional block detection
    let isConditional = false;
    let detectionMethod = '';
    
    // Method 1: Check if has eleArray structure (user's specific guidance)
    // Structure: children[0].eleArray (not children.eleArray)  
    // BUT: Don't treat Omniscript Steps as conditional blocks even if they have eleArray
    // ALSO: Don't treat regular Blocks with multiple children as conditional blocks
    if (child.children && Array.isArray(child.children) && child.children[0] && 
        child.children[0].eleArray && Array.isArray(child.children[0].eleArray) &&
        !(componentType === 'omniscript' && child.type === 'Step') &&
        !(child.type === 'Block' && child.children.length > 1)) {
      isConditional = true;
      detectionMethod = 'eleArray';
    }
    
    // Method 2: Name patterns
    if (!isConditional && name.toLowerCase().includes('if')) {
      isConditional = true;
      detectionMethod = 'name(if)';
    }
    
    // Method 3: Type patterns  
    if (!isConditional && type.toLowerCase().includes('conditional')) {
      isConditional = true;
      detectionMethod = 'type(conditional)';
    }
    
    if (isConditional) {
      const eleArrayItems = child.children && child.children[0] && child.children[0].eleArray 
        ? child.children[0].eleArray.length 
        : 0;
      console.log(`    ✅ [CONDITIONAL-FOUND] "${child.name}" detected by ${detectionMethod} - eleArray: ${eleArrayItems > 0 ? eleArrayItems + ' items' : 'NO'}`);
      return 'conditional';
    }
    
    // Block type (Omniscript UI blocks that have nested children)
    if (type === 'block' && child.children && Array.isArray(child.children) && child.children.length > 0) {
      console.log(`    ✅ [BLOCK-FOUND] "${child.name}" detected as Block type with ${child.children.length} children`);
      return 'block';
    }
    
    // Loop blocks
    if (type.includes('loop') || type.includes('for') || type.includes('while') || type === 'loop block' ||
        name.includes('loop') || name.includes('foreach') || name.includes('for each')) {
      return 'loop';
    }
    
    // Cache blocks  
    if (type.includes('cache') || type === 'cache block' || name.includes('cache')) {
      return 'cache';
    }

    // Check properties for block indicators (more flexible)
    if (child.propSetMap) {
      if (child.propSetMap.loopCondition || child.propSetMap.iterator) {
        return 'loop';
      }
      if (child.propSetMap.cacheKey || child.propSetMap.cacheTimeout) {
        return 'cache';
      }
      // Check for conditional even if no children (might have nested logic)
      if (child.propSetMap.condition || child.propSetMap.executionConditionalFormula) {
        return 'conditional';
      }
    }

    return null;
  }

  /**
   * Extract block structure for better organization
   */
  extractBlockStructure(children, componentType) {
    const blocks = [];
    
    children.forEach((child, index) => {
      const blockType = this.identifyBlockType(child, componentType);
      
      if (blockType) {
        blocks.push({
          index,
          name: child.name,
          type: blockType,
          condition: child.propSetMap?.condition || child.propSetMap?.loopCondition,
          iterator: child.propSetMap?.iterator,
          cacheKey: child.propSetMap?.cacheKey,
          childrenCount: child.children ? child.children.length : 0
        });
      }
    });
    
    return blocks.length > 0 ? blocks : null;
  }

  /**
   * Get globally loaded component data
   */
  getGlobalComponentData() {
    return this.globalComponentsData;
  }

  /**
   * Get component by unique ID from global data
   */
  getComponentByUniqueId(uniqueId) {
    if (!this.globalComponentsData) return null;
    
    // Search in all component types
    const allComponents = [
      ...this.globalComponentsData.integrationProcedures,
      ...this.globalComponentsData.omniscripts,
      ...this.globalComponentsData.dataMappers
    ];
    
    return allComponents.find(comp => comp.uniqueId === uniqueId || comp.name === uniqueId);
  }

  /**
   * Get global component data with enhanced hierarchical references
   */
  async getGlobalComponentData(req, res) {
    try {
      if (!this.globalComponentsData) {
        return res.status(404).json({
          success: false,
          message: 'Global component data not loaded. Please call /api/omnistudio/load-all first.'
        });
      }

      // Maintain backward compatibility with frontend expectations
      // Frontend expects: response.data.data.integrationProcedures, etc.
      const backwardCompatibleData = {
        // Original structure that frontend expects
        integrationProcedures: this.globalComponentsData.integrationProcedures,
        omniscripts: this.globalComponentsData.omniscripts,
        dataMappers: this.globalComponentsData.dataMappers,
        hierarchy: this.globalComponentsData.hierarchy,
        loadedAt: this.globalComponentsData.loadedAt,
        totalComponents: (this.globalComponentsData.integrationProcedures?.length || 0) + 
                        (this.globalComponentsData.omniscripts?.length || 0) + 
                        (this.globalComponentsData.dataMappers?.length || 0),
        timing: this.globalComponentsData.timing,
        
        // Enhanced hierarchical reference summary (additional data)
        enhancedSummary: {
          integrationProcedures: this.globalComponentsData.integrationProcedures.map(ip => ({
            uniqueId: ip.uniqueId,
            name: ip.name,
            componentType: ip.componentType,
            totalSteps: ip.steps ? ip.steps.length : 0,
            childComponentsCount: ip.childComponents ? ip.childComponents.length : 0,
            referencedByCount: ip.referencedBy ? ip.referencedBy.length : 0,
            referencedBy: ip.referencedBy || [],
            childComponents: ip.childComponents || []
          })),
          omniscripts: this.globalComponentsData.omniscripts.map(os => ({
            uniqueId: os.uniqueId,
            name: os.name,
            componentType: os.componentType,
            totalSteps: os.steps ? os.steps.length : 0,
            childComponentsCount: os.childComponents ? os.childComponents.length : 0,
            referencedByCount: os.referencedBy ? os.referencedBy.length : 0,
            referencedBy: os.referencedBy || [],
            childComponents: os.childComponents || []
          })),
          dataMappers: this.globalComponentsData.dataMappers.map(dm => ({
            uniqueId: dm.uniqueId,
            name: dm.name,
            componentType: dm.componentType,
            referencedByCount: dm.referencedBy ? dm.referencedBy.length : 0,
            referencedBy: dm.referencedBy || []
          })),
          totals: {
            integrationProcedures: this.globalComponentsData.integrationProcedures.length,
            omniscripts: this.globalComponentsData.omniscripts.length,
            dataMappers: this.globalComponentsData.dataMappers.length,
            totalHierarchicalReferences: this.globalComponentsData.integrationProcedures.reduce((sum, ip) => sum + (ip.referencedBy?.length || 0), 0) + 
                                       this.globalComponentsData.omniscripts.reduce((sum, os) => sum + (os.referencedBy?.length || 0), 0) + 
                                       this.globalComponentsData.dataMappers.reduce((sum, dm) => sum + (dm.referencedBy?.length || 0), 0)
          }
        }
      };

      console.log(`📊 [GLOBAL-DATA] Serving backward compatible global component data with enhanced hierarchical references:
    🔧 Integration Procedures: ${backwardCompatibleData.enhancedSummary.totals.integrationProcedures}
    📋 Omniscripts: ${backwardCompatibleData.enhancedSummary.totals.omniscripts}
    🔄 Data Mappers: ${backwardCompatibleData.enhancedSummary.totals.dataMappers}
    🔗 Total Hierarchical References: ${backwardCompatibleData.enhancedSummary.totals.totalHierarchicalReferences}`);

      res.json({
        success: true,
        data: backwardCompatibleData,
        message: 'Global component data retrieved successfully with enhanced hierarchical references'
      });

    } catch (error) {
      console.error('Error retrieving global component data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve global component data: ' + error.message
      });
    }
  }

  /**
   * Create or get Salesforce connection
   */
  createConnection(req) {
    let conn = this.globalSalesforceConnection;
    if (!conn) {
      conn = new jsforce.Connection({
        oauth2: req.session.oauth2,
        accessToken: req.session.salesforce.accessToken,
        instanceUrl: req.session.salesforce.instanceUrl
      });
    }
    return conn;
  }

  // Component type configurations (now used only internally)
  getComponentTypes() {
    return [
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
  }

  // Get instances based on component type
  async getInstances(req, res) {
    try {
      if (!req.session.salesforce) {
        return res.status(401).json({ 
          success: false, 
          message: 'Not authenticated with Salesforce' 
        });
      }

      const connection = this.createConnection(req);

      const { componentType, searchTerm = '' } = req.query;

      if (!componentType) {
        return res.status(400).json({
          success: false,
          message: 'Component type is required'
        });
      }

      let query = '';
      let instances = [];

      switch (componentType) {
        case 'integration-procedure':
          query = `SELECT Id,Name,vlocity_cmt__Type__c,vlocity_cmt__SubType__c,vlocity_cmt__IsProcedure__c,vlocity_cmt__ProcedureKey__c,vlocity_cmt__Version__c 
                  FROM vlocity_cmt__OmniScript__c 
                  WHERE vlocity_cmt__IsProcedure__c=true AND vlocity_cmt__IsActive__c=true`;
          break;

        case 'omniscript':
          query = `SELECT Id,Name,vlocity_cmt__Type__c,vlocity_cmt__SubType__c,vlocity_cmt__IsProcedure__c,vlocity_cmt__ProcedureKey__c,vlocity_cmt__Version__c 
                  FROM vlocity_cmt__OmniScript__c 
                  WHERE vlocity_cmt__IsProcedure__c=false AND vlocity_cmt__IsActive__c=true`;
          break;

        case 'data-mapper':
          query = `SELECT Id,Name,vlocity_cmt__Description__c,vlocity_cmt__Type__c 
                  FROM vlocity_cmt__DRBundle__c`;
          break;

        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid component type'
          });
      }

      // Add search filter if provided
      if (searchTerm) {
            query += ` AND Name LIKE '%${searchTerm}%'`;
      }

      // Add ordering
      query += ` ORDER BY Name ASC LIMIT 1000`;

      console.log(`Executing Omnistudio query: ${query}`);
      const result = await connection.query(query);

      // Process the results based on component type
      instances = result.records.map(record => {
        const baseInstance = {
          id: record.Id,
          name: record.Name || 'Unnamed'
        };

        if (componentType === 'data-mapper') {
          return {
            ...baseInstance,
            description: record.vlocity_cmt__Description__c,
            type: record.vlocity_cmt__Type__c,
            uniqueId: record.Name // For data mappers, name is the unique identifier
          };
        } else {
          // For Omniscripts and Integration Procedures
          const uniqueId = record.vlocity_cmt__Type__c && record.vlocity_cmt__SubType__c
            ? `${record.vlocity_cmt__Type__c}_${record.vlocity_cmt__SubType__c}`
            : record.Name;

          return {
            ...baseInstance,
            type: record.vlocity_cmt__Type__c,
            subType: record.vlocity_cmt__SubType__c,
            procedureKey: record.vlocity_cmt__ProcedureKey__c,
            version: record.vlocity_cmt__Version__c,
            isProcedure: record.vlocity_cmt__IsProcedure__c,
            uniqueId: uniqueId
          };
        }
      });

      res.json({
        success: true,
        componentType,
        instances,
        total: instances.length,
        searchTerm
      });

    } catch (error) {
      console.error('Error fetching Omnistudio instances:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch instances: ' + error.message 
      });
    }
  }

  // Get detailed information for a specific instance
  async getInstanceDetails(req, res) {
    try {
      if (!req.session.salesforce) {
        return res.status(401).json({ 
          success: false, 
          message: 'Not authenticated with Salesforce' 
        });
      }

      const connection = this.createConnection(req);

      const { componentType, instanceName } = req.params;

      if (!componentType || !instanceName) {
        return res.status(400).json({
          success: false,
          message: 'Component type and instance name are required'
        });
      }

      let query = '';
      let details = null;

      switch (componentType) {
        case 'integration-procedure':
        case 'omniscript':
          // Both use the same detail query
          query = `SELECT Name,Id,vlocity_cmt__OmniScriptId__c,vlocity_cmt__Sequence__c,vlocity_cmt__Content__c 
                  FROM vlocity_cmt__OmniScriptDefinition__c 
                  WHERE vlocity_cmt__OmniScriptId__r.Name='${instanceName}' AND vlocity_cmt__OmniScriptId__r.vlocity_cmt__IsActive__c=true 
                  ORDER BY vlocity_cmt__Sequence__c ASC 
                  LIMIT 1`;
          break;

        case 'data-mapper':
          query = `SELECT Name,vlocity_cmt__ConfigurationAttribute__c,vlocity_cmt__ConfigurationGroup__c,vlocity_cmt__ConfigurationKey__c,vlocity_cmt__ConfigurationPattern__c,vlocity_cmt__ConfigurationProcess__c,vlocity_cmt__ConfigurationType__c,vlocity_cmt__ConfigurationValue__c,vlocity_cmt__DomainObjectAPIName__c,vlocity_cmt__DomainObjectCreationOrder__c,vlocity_cmt__DomainObjectFieldAPIName__c,vlocity_cmt__DomainObjectFieldType__c,vlocity_cmt__FilterGroup__c,vlocity_cmt__FilterOperator__c,vlocity_cmt__FilterValue__c,vlocity_cmt__FormulaConverted__c,vlocity_cmt__FormulaOrder__c,vlocity_cmt__FormulaResultPath__c,vlocity_cmt__Formula__c,vlocity_cmt__GlobalKey__c,vlocity_cmt__InterfaceFieldAPIName__c,vlocity_cmt__InterfaceObjectLookupOrder__c,vlocity_cmt__InterfaceObjectName__c,vlocity_cmt__LookupDomainObjectFieldName__c,vlocity_cmt__LookupDomainObjectName__c,vlocity_cmt__LookupDomainObjectRequestedFieldName__c 
                  FROM vlocity_cmt__DRMapItem__c 
                  WHERE Name='${instanceName}' 
                  ORDER BY vlocity_cmt__DomainObjectCreationOrder__c ASC`;
          break;

        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid component type'
          });
      }

      console.log(`Executing Omnistudio detail query: ${query}`);
      const result = await connection.query(query);

      if (result.totalSize === 0) {
        return res.status(404).json({
          success: false,
          message: `No details found for ${componentType}: ${instanceName}`
        });
      }

      if (componentType === 'data-mapper') {
        // For data mappers, return all configuration items
        details = {
          name: instanceName,
          componentType: 'data-mapper',
          totalItems: result.totalSize,
          configurationItems: result.records.map(record => ({
            configurationAttribute: record.vlocity_cmt__ConfigurationAttribute__c,
            configurationGroup: record.vlocity_cmt__ConfigurationGroup__c,
            configurationKey: record.vlocity_cmt__ConfigurationKey__c,
            configurationPattern: record.vlocity_cmt__ConfigurationPattern__c,
            configurationProcess: record.vlocity_cmt__ConfigurationProcess__c,
            configurationType: record.vlocity_cmt__ConfigurationType__c,
            configurationValue: record.vlocity_cmt__ConfigurationValue__c,
            domainObjectAPIName: record.vlocity_cmt__DomainObjectAPIName__c,
            domainObjectCreationOrder: record.vlocity_cmt__DomainObjectCreationOrder__c,
            domainObjectFieldAPIName: record.vlocity_cmt__DomainObjectFieldAPIName__c,
            domainObjectFieldType: record.vlocity_cmt__DomainObjectFieldType__c,
            filterGroup: record.vlocity_cmt__FilterGroup__c,
            filterOperator: record.vlocity_cmt__FilterOperator__c,
            filterValue: record.vlocity_cmt__FilterValue__c,
            formulaConverted: record.vlocity_cmt__FormulaConverted__c,
            formulaOrder: record.vlocity_cmt__FormulaOrder__c,
            formulaResultPath: record.vlocity_cmt__FormulaResultPath__c,
            formula: record.vlocity_cmt__Formula__c,
            globalKey: record.vlocity_cmt__GlobalKey__c,
            interfaceFieldAPIName: record.vlocity_cmt__InterfaceFieldAPIName__c,
            interfaceObjectLookupOrder: record.vlocity_cmt__InterfaceObjectLookupOrder__c,
            interfaceObjectName: record.vlocity_cmt__InterfaceObjectName__c,
            lookupDomainObjectFieldName: record.vlocity_cmt__LookupDomainObjectFieldName__c,
            lookupDomainObjectName: record.vlocity_cmt__LookupDomainObjectName__c,
            lookupDomainObjectRequestedFieldName: record.vlocity_cmt__LookupDomainObjectRequestedFieldName__c
          }))
        };
      } else {
        // For Omniscripts and Integration Procedures
        const record = result.records[0];
        let parsedContent = null;
        let contentError = null;

        // Try to parse the JSON content
        if (record.vlocity_cmt__Content__c) {
          try {
            parsedContent = JSON.parse(record.vlocity_cmt__Content__c);
          } catch (error) {
            contentError = `Failed to parse content JSON: ${error.message}`;
            console.warn(`JSON parse error for ${instanceName}:`, error);
          }
        }

        details = {
          name: record.Name,
          id: record.Id,
          omniScriptId: record.vlocity_cmt__OmniScriptId__c,
          sequence: record.vlocity_cmt__Sequence__c,
          componentType: componentType,
          rawContent: record.vlocity_cmt__Content__c,
          parsedContent: parsedContent,
          contentError: contentError,
          // Extract key information from parsed content if available
          summary: parsedContent ? this.extractContentSummary(parsedContent, componentType) : null
        };
      }

      res.json({
        success: true,
        componentType,
        instanceName,
        details
      });

    } catch (error) {
      console.error('Error fetching Omnistudio instance details:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch instance details: ' + error.message 
      });
    }
  }

  // Extract summary information from parsed content
  extractContentSummary(content, componentType) {
    try {
      const summary = {
        type: content.bpType,
        subType: content.bpSubType,
        language: content.bpLang,
        version: content.bpVersion,
        isReusable: content.bReusable,
        hasAttachment: content.bHasAttachment,
        childrenCount: 0,
        steps: []
      };

      // Count and summarize children
      if (content.children && Array.isArray(content.children)) {
        summary.childrenCount = content.children.length;
        summary.steps = this.extractStepsWithDetails(content.children, componentType);
      }

      // Add Integration Procedure specific information
      if (componentType === 'integration-procedure') {
        summary.procedureType = 'Integration Procedure';
        summary.actions = summary.steps.filter(step => 
          step.type && step.type.toLowerCase().includes('action')
        );
      }

      // Add Omniscript specific information
      if (componentType === 'omniscript') {
        summary.procedureType = 'Omniscript';
        summary.omniscriptSteps = summary.steps.filter(step => 
          step.type === 'Step'
        );
        summary.formElements = summary.steps.filter(step => 
          step.type && ['Text', 'Select', 'Multi-select', 'Date'].includes(step.type)
        );
      }

      return summary;
    } catch (error) {
      console.warn('Error extracting content summary:', error);
      return {
        error: 'Failed to extract summary',
        message: error.message
      };
    }
  }

  // Extract detailed step information
  extractStepsWithDetails(children, componentType) {
    const steps = [];

    const processStep = (child, parentLevel = 0) => {
      const step = {
        name: child.name,
        type: child.type,
        level: child.level || parentLevel,
        indexInParent: child.indexInParent,
        hasChildren: child.children && child.children.length > 0
      };

      // Extract execution condition
      if (child.propSetMap && child.propSetMap.executionConditionalFormula) {
        step.executionCondition = child.propSetMap.executionConditionalFormula;
      }

      // Extract show condition  
      if (child.propSetMap && child.propSetMap.show) {
        step.showCondition = this.formatCondition(child.propSetMap.show);
      }

      // For Integration Procedures - extract remote action details
      if (componentType === 'integration-procedure' && child.type && child.type.toLowerCase().includes('remote')) {
        if (child.propSetMap) {
          step.remoteClass = child.propSetMap.remoteClass;
          step.remoteMethod = child.propSetMap.remoteMethod;
        }
      }

      // Extract other useful properties
      if (child.propSetMap) {
        step.label = child.propSetMap.label;
        step.description = child.propSetMap.description;
        
        // For steps with validation
        if (child.propSetMap.validationRequired) {
          step.validationRequired = child.propSetMap.validationRequired;
        }
        
        // For integration procedure actions
        if (child.propSetMap.bundle) {
          step.bundle = child.propSetMap.bundle;
        }
        if (child.propSetMap.integrationProcedureKey) {
          step.integrationProcedureKey = child.propSetMap.integrationProcedureKey;
        }
      }

      // Process children recursively for omniscripts with Step types
      if (child.children && child.children.length > 0) {
        step.subSteps = child.children.map(grandChild => processStep(grandChild, child.level + 1));
      }

      return step;
    };

    children.forEach(child => {
      steps.push(processStep(child));
    });

    return steps;
  }

  // Format condition object to readable string
  formatCondition(showCondition) {
    try {
      if (typeof showCondition === 'string') {
        return showCondition;
      }

      if (showCondition && showCondition.group && showCondition.group.rules) {
        const rules = showCondition.group.rules;
        const operator = showCondition.group.operator || 'AND';
        
        const ruleStrings = rules.map(rule => {
          return `${rule.field} ${rule.condition} '${rule.data}'`;
        });

        return ruleStrings.join(` ${operator} `);
      }

      return JSON.stringify(showCondition);
    } catch (error) {
      return 'Complex condition';
    }
  }


}

module.exports = OmnistudioModule;
