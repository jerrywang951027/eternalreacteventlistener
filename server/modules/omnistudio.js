const jsforce = require('jsforce');

class OmnistudioModule {
  constructor(redisModule = null) {
    this.orgComponentsDataCache = new Map(); // Store components per org: orgId -> componentData
    this.componentHierarchy = new Map(); // Store hierarchical relationships
    this.redisModule = redisModule; // Redis integration for persistent caching
  }

  /**
   * Clear cache for specific org (debug utility)
   */
  clearCache(orgId) {
    console.log(`🧹 [CACHE-CLEAR] Clearing cache for org ${orgId}`);
    this.orgComponentsDataCache.delete(orgId);
    this.componentHierarchy.delete(orgId);
  }

  /**
   * Clear all caches (debug utility)
   */
  clearAllCaches() {
    console.log(`🧹 [CACHE-CLEAR-ALL] Clearing all caches`);
    this.orgComponentsDataCache.clear();
    this.componentHierarchy.clear();
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
   * Internal method to load all components without HTTP response handling
   */
  async loadAllComponentsInternal(req) {
    if (!req.session.salesforce) {
      throw new Error('Not authenticated with Salesforce');
    }

    const orgId = req.session.salesforce.organizationId;

    // 🔍 REDIS INTEGRATION: Check Redis cache first
    if (this.redisModule && this.redisModule.isAvailable()) {
      console.log(`🔍 [REDIS-CHECK] Checking Redis cache for org ${orgId}...`);
      const cachedData = await this.redisModule.getCachedComponentData(orgId);
      
      if (cachedData) {
        console.log(`🎯 [REDIS-HIT] Found cached component data for org ${orgId}, loading from Redis...`);
        
        // Store in memory cache for quick access
        this.orgComponentsDataCache.set(orgId, cachedData);
        
        // Rebuild hierarchy map from cached data
        if (cachedData.hierarchy) {
          this.componentHierarchy.set(orgId, new Map(Object.entries(cachedData.hierarchy)));
        }
        
        console.log(`✅ [REDIS-RESTORE] Successfully restored ${cachedData.totalComponents} components from Redis cache`);
        console.log(`📅 [REDIS-RESTORE] Original load time: ${cachedData.timing?.startTime || 'unknown'}`);
        console.log(`💾 [REDIS-RESTORE] Cached at: ${cachedData.cachedAt}`);
        
        return cachedData;
      } else {
        console.log(`📭 [REDIS-MISS] No cached data found in Redis for org ${orgId}, will load from Salesforce...`);
      }
    } else {
      console.log('⚠️ [REDIS-UNAVAILABLE] Redis not available, loading directly from Salesforce...');
    }

    // Start timing
    const startTime = new Date();
    const startTimestamp = startTime.toISOString();
    
    const connection = this.createConnection(req);
    console.log(`🔄 [OMNISTUDIO] Starting component loading from Salesforce at ${startTimestamp}...`);

    // Load all components in parallel
    const [integrationProcedures, omniscripts, dataMappers] = await Promise.all([
      this.loadAllIntegrationProcedures(connection),
      this.loadAllOmniscripts(connection), 
      this.loadAllDataMappers(connection)
    ]);

    console.log(`📊 [OMNISTUDIO] Loaded: ${integrationProcedures.length} IPs, ${omniscripts.length} Omniscripts, ${dataMappers.length} Data Mappers`);
    console.log('🔗 [OMNISTUDIO] Building hierarchical relationships...');

    // Build hierarchical relationships
    this.buildHierarchicalRelationships(integrationProcedures, omniscripts);

    // End timing
    const endTime = new Date();
    const endTimestamp = endTime.toISOString();
    const durationMs = endTime.getTime() - startTime.getTime();

    console.log(`⏱️ [OMNISTUDIO] Component loading completed in ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`);

    // 🔍 DEBUG: Check if Partner_SalesOrder is in the loaded components
    const partnerSalesOrder = integrationProcedures.find(ip => ip.name === 'Partner_SalesOrder');
    if (partnerSalesOrder) {
      console.log(`✅ [CACHE-STORE] Partner_SalesOrder FOUND in loaded components:`, {
        name: partnerSalesOrder.name,
        uniqueId: partnerSalesOrder.uniqueId,
        steps: partnerSalesOrder.steps?.length || 0,
        type: partnerSalesOrder.type,
        subtype: partnerSalesOrder.subtype
      });
    } else {
      console.log(`❌ [CACHE-STORE] Partner_SalesOrder NOT FOUND in loaded ${integrationProcedures.length} integration procedures`);
      console.log(`🔍 [CACHE-STORE] First 5 IP names:`, integrationProcedures.slice(0, 5).map(ip => ip.name));
    }

    // Get org name from session if available
    const orgName = req.session?.salesforce?.orgName || null;

    // OPTIMAL LOADING SEQUENCE: Data Mappers → IPs → OmniScripts
    console.log('🔄 [RECURSIVE-EXPANSION] Starting recursive expansion in optimal sequence...');
    console.log('📋 [SEQUENCE] 1/3: Data Mappers loaded (no expansion needed)');
    
    // STEP 2: Fully expand all Integration Procedures first
    console.log('📋 [SEQUENCE] 2/3: Expanding all Integration Procedures with full hierarchy...');
    const expandedIntegrationProcedures = await this.recursivelyExpandChildIPs(integrationProcedures, req);
    console.log(`✅ [SEQUENCE] Step 2 Complete: Expanded ${expandedIntegrationProcedures.length} IPs with full hierarchy.`);

    // Store expanded IPs in cache immediately for OmniScript reuse
    this.orgComponentsDataCache.set(orgId, {
      integrationProcedures: expandedIntegrationProcedures,
      omniscripts,
      dataMappers,
      hierarchy: Object.fromEntries(this.componentHierarchy),
      loadedAt: endTimestamp,
      totalComponents: expandedIntegrationProcedures.length + omniscripts.length + dataMappers.length,
      orgName,
      timing: {
        startTime: startTimestamp,
        endTime: endTimestamp,
        durationMs: durationMs,
        durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
      }
    });

    // STEP 3: Expand all OmniScripts (reusing already expanded IPs)
    console.log('📋 [SEQUENCE] 3/3: Expanding all OmniScripts with child IP hierarchy...');
    const expandedOmniScripts = await this.recursivelyExpandOmniScripts(omniscripts, req);
    console.log(`✅ [SEQUENCE] Step 3 Complete: Expanded ${expandedOmniScripts.length} OmniScripts with full hierarchy.`);

    // Final cache update with both expanded IPs and OmniScripts
    const finalComponentData = {
      integrationProcedures: expandedIntegrationProcedures,
      omniscripts: expandedOmniScripts,
      dataMappers,
      hierarchy: Object.fromEntries(this.componentHierarchy),
      loadedAt: endTimestamp,
      totalComponents: expandedIntegrationProcedures.length + expandedOmniScripts.length + dataMappers.length,
      orgName,
      timing: {
        startTime: startTimestamp,
        endTime: endTimestamp,
        durationMs: durationMs,
        durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
      }
    };

    this.orgComponentsDataCache.set(orgId, finalComponentData);

    // 💾 REDIS INTEGRATION: Cache the component data in Redis with 2-day expiration
    if (this.redisModule && this.redisModule.isAvailable()) {
      console.log(`💾 [REDIS-CACHE] Saving component data to Redis for org ${orgId}...`);
      try {
        const redisCacheResult = await this.redisModule.setCachedComponentData(orgId, finalComponentData);
        if (redisCacheResult) {
          console.log(`✅ [REDIS-CACHE] Successfully cached ${finalComponentData.totalComponents} components in Redis (expires in 2 days)`);
        } else {
          console.log(`⚠️ [REDIS-CACHE] Failed to cache component data in Redis, but continuing...`);
        }
      } catch (redisError) {
        console.error('❌ [REDIS-CACHE] Error caching component data in Redis:', redisError.message);
        console.log('⚠️ [REDIS-CACHE] Application will continue without Redis caching...');
      }
    }

    console.log('🎉 [RECURSIVE-EXPANSION] Complete! All components have full recursive hierarchy.');

    return this.orgComponentsDataCache.get(orgId);
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

      // Use the internal method to do the actual loading
      const componentData = await this.loadAllComponentsInternal(req);

      res.json({
        success: true,
        message: 'All components loaded successfully',
        summary: {
          integrationProcedures: componentData.integrationProcedures.length,
          omniscripts: componentData.omniscripts.length,
          dataMappers: componentData.dataMappers.length,
          totalComponents: componentData.totalComponents,
          hierarchicalRelationships: this.componentHierarchy.size,
          timing: componentData.timing
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
    // 🛠️ CRITICAL FIX: Remove subquery that limits results to 125 instead of 536
    // Make query identical to search query to get ALL Integration Procedures
    const query = `
      SELECT Id, Name, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Version__c,
             vlocity_cmt__ProcedureKey__c, vlocity_cmt__IsActive__c
      FROM vlocity_cmt__OmniScript__c 
      WHERE vlocity_cmt__IsProcedure__c=true AND vlocity_cmt__IsActive__c=true
      ORDER BY Name ASC
    `;

    const result = await connection.query(query);
    
    console.log(`🔍 [FIXED-QUERY] loadAllIntegrationProcedures returned ${result.records.length} records (removed problematic subquery)`);
    
    // 🔍 DEBUG: Check if Partner_SalesOrder is now found
    const partnerVersions = result.records.filter(r => r.Name === 'Partner_SalesOrder');
    if (partnerVersions.length > 0) {
      console.log(`✅ [FIXED-SUCCESS] Found ${partnerVersions.length} Partner_SalesOrder versions in loadAll:`, partnerVersions.map(p => ({ Version: p.vlocity_cmt__Version__c, Id: p.Id })));
    } else {
      console.log(`❌ [STILL-MISSING] Partner_SalesOrder still not found in ${result.records.length} records`);
      const similarNames = result.records.filter(r => r.Name.toLowerCase().includes('partner') || r.Name.toLowerCase().includes('sales')).slice(0, 10).map(r => r.Name);
      console.log(`🔍 [SIMILAR-NAMES] Components with partner or sales:`, similarNames);
    }
    
    // 🔍 DEBUG: Check if Partner_SalesOrder is in the results
    const partnerSalesOrder = result.records.find(r => r.Name === 'Partner_SalesOrder');
    if (partnerSalesOrder) {
      console.log(`✅ [DEBUG-LOAD] Partner_SalesOrder FOUND in loadAll query:`, {
        Id: partnerSalesOrder.Id,
        Name: partnerSalesOrder.Name,
        Type: partnerSalesOrder.vlocity_cmt__Type__c,
        SubType: partnerSalesOrder.vlocity_cmt__SubType__c,
        Version: partnerSalesOrder.vlocity_cmt__Version__c,
        IsActive: partnerSalesOrder.vlocity_cmt__IsActive__c,
        IsProcedure: partnerSalesOrder.vlocity_cmt__IsProcedure__c,
        HasDefinitions: partnerSalesOrder.vlocity_cmt__OmniScriptDefinitions__r?.records?.length || 0
      });
    } else {
      console.log(`❌ [DEBUG-LOAD] Partner_SalesOrder NOT FOUND in loadAll query results (${result.records.length} total records)`);
      console.log(`🔍 [DEBUG-LOAD] First 5 IP names:`, result.records.slice(0, 5).map(r => r.Name));
    }
    
    // Process records and load definitions on-demand for better performance
    const processedRecords = await Promise.all(result.records.map(async (record) => {
      try {
        // Load definitions on-demand to avoid subquery performance issues
        const definitionsQuery = `
          SELECT Id, Name, vlocity_cmt__Sequence__c, vlocity_cmt__Content__c
          FROM vlocity_cmt__OmniScriptDefinition__c
          WHERE vlocity_cmt__OmniScriptId__c = '${record.Id}'
          ORDER BY vlocity_cmt__Sequence__c ASC
          LIMIT 1
        `;
        const definitionsResult = await connection.query(definitionsQuery);
        
        // Simulate the original subquery structure
        record.vlocity_cmt__OmniScriptDefinitions__r = {
          records: definitionsResult.records || []
        };
        
        const processed = this.processComponentRecord(record, 'integration-procedure');
        
        if (record.Name === 'Partner_SalesOrder') {
          console.log(`✅ [FIXED-PROCESSING] Successfully processing Partner_SalesOrder:`, {
            originalRecord: {
              Id: record.Id,
              Name: record.Name,
              Type: record.vlocity_cmt__Type__c,
              SubType: record.vlocity_cmt__SubType__c,
              Version: record.vlocity_cmt__Version__c,
              IsActive: record.vlocity_cmt__IsActive__c,
              IsProcedure: record.vlocity_cmt__IsProcedure__c,
              HasDefinitions: record.vlocity_cmt__OmniScriptDefinitions__r?.records?.length || 0
            },
            processedRecord: processed ? {
              name: processed.name,
              uniqueId: processed.uniqueId,
              steps: processed.steps?.length || 0
            } : 'NULL/UNDEFINED'
          });
        }
        
        return processed;
      } catch (error) {
        console.log(`⚠️ [PROCESSING-ERROR] Error processing ${record.Name}:`, error.message);
        return null;
      }
    }));
    
    const validRecords = processedRecords.filter(Boolean);
    const finalPartner = validRecords.find(p => p && p.name === 'Partner_SalesOrder');
    console.log(`🎯 [FIXED-FINAL] Partner_SalesOrder in final processed array: ${finalPartner ? 'FOUND with ' + finalPartner.steps.length + ' steps' : 'NOT FOUND'}`);
    
    return validRecords;
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
        if (step.integrationProcedureKey && step.integrationProcedureKey !== 'undefined' && step.integrationProcedureKey !== '') {
          const childComponent = componentsByUniqueId.get(step.integrationProcedureKey) ||
                               componentsByName.get(step.integrationProcedureKey);
          
          if (childComponent) {
            step.childComponent = {
              id: childComponent.id,
              name: childComponent.name,
              componentType: childComponent.componentType,
              uniqueId: childComponent.uniqueId,
              stepsCount: childComponent.steps ? childComponent.steps.length : 0,
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
      
      // Special logging for CustInfoBlock to track our fix
      if (child.name === 'CustInfoBlock') {
        console.log(`  🔥 [CUSTINFOBLOCK-FIX] CustInfoBlock detected with blockType: "${blockType}" (should be "block", not "conditional")`);
      }
      
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
        
        if (step.integrationProcedureKey && step.integrationProcedureKey !== 'undefined' && step.integrationProcedureKey !== '') {
          console.log(`    🔑 [IP-KEY] Step "${step.name}" has integrationProcedureKey: "${step.integrationProcedureKey}"`);
          // 🔧 FIX: Mark IP reference steps as expandable (only if not already a block)
          if (!step.blockType || step.blockType === 'None') {
            step.hasChildren = true;
            step.blockType = 'ip-reference';
            step.referencedIP = step.integrationProcedureKey;
            console.log(`    ✅ [IP-REFERENCE] Step "${step.name}" marked as expandable IP reference to "${step.integrationProcedureKey}"`);
          } else {
            // For block steps with IP references, store IP reference info but keep block type
            step.referencedIP = step.integrationProcedureKey;
            step.hasIPReference = true;
            console.log(`    🔗 [BLOCK-WITH-IP] Step "${step.name}" (blockType: ${step.blockType}) has IP reference: "${step.integrationProcedureKey}"`);
          }
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
          console.log(`    ✅ [REGULAR-BLOCK-TOTAL] Total ${childrenToProcess.length} children collected from all eleArray in Block "${child.name}" - This ensures ALL child steps are processed, not just the first one`);
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
          
          // 🔧 CRITICAL FIX: Try alternative structures for Integration Procedure conditional blocks
          console.log(`    🔍 [CONDITIONAL-FALLBACK] Trying direct children array for conditional block "${child.name}"`);
          if (Array.isArray(child.children) && child.children.length > 0) {
            childrenToProcess = child.children;
            console.log(`    ✅ [CONDITIONAL-DIRECT] Using direct children array: ${childrenToProcess.length} children for conditional block "${child.name}"`);
          }
        }
      }
      
      if (childrenToProcess.length > 0) {
        console.log(`    🎯 [PROCESSING] About to process ${childrenToProcess.length} children for step "${child.name}" with blockType "${step.blockType}"`);
        
        // Special handling for Omniscript "Step" elements - their children should always be subSteps
        const isOmniscriptStep = componentType === 'omniscript' && child.type === 'Step';
        
        if (isOmniscriptStep) {
          // For Omniscript Steps, children are sub-steps, but Block-type children need special handling
          console.log(`    📋 [OMNISCRIPT-SUBSTEPS] Creating subSteps array for Omniscript Step "${child.name}"`);
          
          // 🔥 CRITICAL DEBUG: Show exactly what we're about to process for AccountCapture and CustInfoBlock
          if (child.name === 'AccountCapture' || child.name === 'CustInfoBlock') {
            console.log(`    ===============================================`);
            console.log(`    🔥 [${child.name.toUpperCase()}-CRITICAL-DEBUG] PROCESSING ${child.name.toUpperCase()}!`);
            console.log(`    🔥 Component Type: ${componentType}, Step Type: ${child.type}`);
            console.log(`    🔥 childrenToProcess array contains ${childrenToProcess.length} items:`);
            childrenToProcess.forEach((item, idx) => {
              console.log(`      🔥 [${idx}] Name: "${item.name}", Type: "${item.type}", Has Children: ${item.children ? 'YES' : 'NO'}`);
            });
            console.log(`    ===============================================`);
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
          
          // 🔥 CRITICAL DEBUG: Show exactly what we're about to process for CustInfoBlock
          if (child.name === 'CustInfoBlock') {
            console.log(`    ===============================================`);
            console.log(`    🔥 [CUSTINFOBLOCK-CRITICAL-DEBUG] PROCESSING CUSTINFOBLOCK!`);
            console.log(`    🔥 Block Type: ${step.blockType}`);
            console.log(`    🔥 childrenToProcess array contains ${childrenToProcess.length} items:`);
            childrenToProcess.forEach((item, idx) => {
              console.log(`      🔥 [${idx}] Name: "${item.name}", Type: "${item.type}", Has Children: ${item.children ? 'YES' : 'NO'}`);
            });
            console.log(`    ===============================================`);
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
          
          // Don't create placeholder steps for empty conditional blocks
          // if (!step.blockSteps || step.blockSteps.length === 0) {
          //   console.log(`    📝 [PLACEHOLDER] Creating placeholder conditional logic for "${child.name}" in "${containerName}"`);
          //   step.blockSteps = [{
          //     name: 'Conditional Logic',
          //     type: 'Conditional Content',
          //     syntheticStep: true,
          //     description: 'This conditional block contains execution logic',
          //     condition: step.blockCondition || step.executionCondition || 'Has conditional logic'
          //   }];
          // }
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
    
    // 🔥 CRITICAL DEBUG: Track CustInfoBlock block type detection
    if (child.name === 'CustInfoBlock') {
      console.log(`    🔥 [CUSTINFOBLOCK-BLOCKTYPE-DEBUG] Starting block type detection for CustInfoBlock`);
      console.log(`    🔥 Type: "${child.type}", Name: "${child.name}"`);
      console.log(`    🔥 Component Type: ${componentType}`);
      console.log(`    🔥 Has children: ${child.children ? 'YES (' + child.children.length + ')' : 'NO'}`);
      if (child.children && child.children[0]) {
        console.log(`    🔥 Has children[0].eleArray: ${child.children[0].eleArray ? 'YES (' + child.children[0].eleArray.length + ' items)' : 'NO'}`);
      }
    }
    
    // Quick conditional block detection
    let isConditional = false;
    let detectionMethod = '';
    
    // Method 1: Check if has eleArray structure (user's specific guidance)
    // Structure: children[0].eleArray (not children.eleArray)  
    // BUT: Don't treat Omniscript Steps as conditional blocks even if they have eleArray
    // 🔧 FIX: Allow Omniscript Blocks to be conditional regardless of child count
    if (child.children && Array.isArray(child.children) && child.children[0] && 
        child.children[0].eleArray && Array.isArray(child.children[0].eleArray) &&
        !(componentType === 'omniscript' && child.type === 'Step')) {
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
      
      // 🔥 CRITICAL DEBUG: Track CustInfoBlock conditional detection result
      if (child.name === 'CustInfoBlock') {
        console.log(`    🔥 [CUSTINFOBLOCK-RESULT] CustInfoBlock DETECTED AS CONDITIONAL! Method: ${detectionMethod}, eleArray items: ${eleArrayItems}`);
      }
      
      return 'conditional';
    }
    
    // Block type (Omniscript UI blocks that have nested children)
    if (type === 'block' && child.children && Array.isArray(child.children) && child.children.length > 0) {
      console.log(`    ✅ [BLOCK-FOUND] "${child.name}" detected as Block type with ${child.children.length} children`);
      
      // 🔥 CRITICAL DEBUG: Track CustInfoBlock block detection result
      if (child.name === 'CustInfoBlock') {
        console.log(`    🔥 [CUSTINFOBLOCK-RESULT] CustInfoBlock DETECTED AS BLOCK! Children count: ${child.children.length}`);
      }
      
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
   * Get component data for a specific org
   * First checks in-memory cache, then falls back to Redis if available
   */
  async getOrgComponentData(orgId) {
    // Check in-memory cache first
    const memoryData = this.orgComponentsDataCache.get(orgId);
    if (memoryData) {
      return memoryData;
    }

    // If not in memory and Redis is available, check Redis
    if (this.redisModule && this.redisModule.isAvailable()) {
      console.log(`🔍 [REDIS-FALLBACK] Memory cache miss for org ${orgId}, checking Redis...`);
      try {
        const redisData = await this.redisModule.getCachedComponentData(orgId);
        if (redisData) {
          console.log(`🎯 [REDIS-FALLBACK] Found data in Redis for org ${orgId}, restoring to memory cache...`);
          
          // Restore to memory cache
          this.orgComponentsDataCache.set(orgId, redisData);
          
          // Rebuild hierarchy map
          if (redisData.hierarchy) {
            this.componentHierarchy.set(orgId, new Map(Object.entries(redisData.hierarchy)));
          }
          
          return redisData;
        } else {
          console.log(`📭 [REDIS-FALLBACK] No data found in Redis for org ${orgId}`);
        }
      } catch (error) {
        console.error('❌ [REDIS-FALLBACK] Error accessing Redis:', error.message);
      }
    }

    return null;
  }

  /**
   * Get component by unique ID from org data
   */
  getComponentByUniqueId(uniqueId, orgId) {
    const orgData = this.orgComponentsDataCache.get(orgId);
    if (!orgData) return null;
    
    // Search in all component types
    const allComponents = [
      ...orgData.integrationProcedures,
      ...orgData.omniscripts,
      ...orgData.dataMappers
    ];
    
    return allComponents.find(comp => comp.uniqueId === uniqueId || comp.name === uniqueId);
  }

  /**
   * Get global component data with enhanced hierarchical references
   */
  async getGlobalComponentData(req, res) {
    try {
      const orgId = req.session.salesforce.organizationId;
      let globalComponentsData = this.orgComponentsDataCache.get(orgId);
      
      // Auto-load global data if it doesn't exist
      if (!globalComponentsData) {
        console.log(`📦 [OMNISTUDIO] No global data found for org ${orgId}. Auto-loading...`);
        
        try {
          // Load all components for this org
          await this.loadAllComponentsInternal(req);
          globalComponentsData = this.orgComponentsDataCache.get(orgId);
          
          if (!globalComponentsData) {
            return res.status(500).json({
              success: false,
              message: 'Failed to auto-load global component data for this org.'
            });
          }
          
          console.log(`✅ [OMNISTUDIO] Auto-loaded global data for org ${orgId}: ${globalComponentsData.totalComponents} components`);
        } catch (loadError) {
          console.error(`❌ [OMNISTUDIO] Auto-load failed for org ${orgId}:`, loadError);
          return res.status(500).json({
            success: false,
            message: 'Failed to load global component data: ' + loadError.message
          });
        }
      }

      // Maintain backward compatibility with frontend expectations
      // Frontend expects: response.data.data.integrationProcedures, etc.
      const backwardCompatibleData = {
        // Original structure that frontend expects
        integrationProcedures: globalComponentsData.integrationProcedures,
        omniscripts: globalComponentsData.omniscripts,
        dataMappers: globalComponentsData.dataMappers,
        hierarchy: globalComponentsData.hierarchy,
        loadedAt: globalComponentsData.loadedAt,
        totalComponents: (globalComponentsData.integrationProcedures?.length || 0) + 
                        (globalComponentsData.omniscripts?.length || 0) + 
                        (globalComponentsData.dataMappers?.length || 0),
        timing: globalComponentsData.timing,
        
        // Enhanced hierarchical reference summary (additional data)
        enhancedSummary: {
          integrationProcedures: globalComponentsData.integrationProcedures.map(ip => ({
            uniqueId: ip.uniqueId,
            name: ip.name,
            componentType: ip.componentType,
            totalSteps: ip.steps ? ip.steps.length : 0,
            childComponentsCount: ip.childComponents ? ip.childComponents.length : 0,
            referencedByCount: ip.referencedBy ? ip.referencedBy.length : 0,
            referencedBy: ip.referencedBy || [],
            childComponents: ip.childComponents || []
          })),
          omniscripts: globalComponentsData.omniscripts.map(os => ({
            uniqueId: os.uniqueId,
            name: os.name,
            componentType: os.componentType,
            totalSteps: os.steps ? os.steps.length : 0,
            childComponentsCount: os.childComponents ? os.childComponents.length : 0,
            referencedByCount: os.referencedBy ? os.referencedBy.length : 0,
            referencedBy: os.referencedBy || [],
            childComponents: os.childComponents || []
          })),
          dataMappers: globalComponentsData.dataMappers.map(dm => ({
            uniqueId: dm.uniqueId,
            name: dm.name,
            componentType: dm.componentType,
            referencedByCount: dm.referencedBy ? dm.referencedBy.length : 0,
            referencedBy: dm.referencedBy || []
          })),
          totals: {
            integrationProcedures: globalComponentsData.integrationProcedures.length,
            omniscripts: globalComponentsData.omniscripts.length,
            dataMappers: globalComponentsData.dataMappers.length,
            totalHierarchicalReferences: globalComponentsData.integrationProcedures.reduce((sum, ip) => sum + (ip.referencedBy?.length || 0), 0) + 
                                       globalComponentsData.omniscripts.reduce((sum, os) => sum + (os.referencedBy?.length || 0), 0) + 
                                       globalComponentsData.dataMappers.reduce((sum, dm) => sum + (dm.referencedBy?.length || 0), 0)
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
   * Create Salesforce connection from session
   */
  createConnection(req) {
    return new jsforce.Connection({
      oauth2: req.session.oauth2,
      accessToken: req.session.salesforce.accessToken,
      instanceUrl: req.session.salesforce.instanceUrl
    });
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

  /**
   * Search for omnistudio components by name (real-time API endpoint)
   */
  async searchComponents(req, res) {
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

      let instances = [];

      switch (componentType) {
        case 'integration-procedure':
          const ipQuery = `SELECT Id,Name,vlocity_cmt__Type__c,vlocity_cmt__SubType__c,vlocity_cmt__IsProcedure__c,vlocity_cmt__ProcedureKey__c,vlocity_cmt__Version__c
                          FROM vlocity_cmt__OmniScript__c 
                          WHERE vlocity_cmt__IsProcedure__c=true AND vlocity_cmt__IsActive__c=true ${searchTerm ? `AND Name LIKE '%${searchTerm}%'` : ''}
                          ORDER BY Name ASC LIMIT 1000`;
          
          console.log(`🔍 [OMNISTUDIO] Executing search query: ${ipQuery}`);
          const ipResult = await connection.query(ipQuery);
          
          instances = ipResult.records.map(record => {
            const uniqueId = `${record.vlocity_cmt__Type__c}_${record.vlocity_cmt__SubType__c}`;
            return {
              id: record.Id,
              name: record.Name,
              uniqueId: uniqueId,
              type: record.vlocity_cmt__Type__c,
              subtype: record.vlocity_cmt__SubType__c,
              procedureKey: record.vlocity_cmt__ProcedureKey__c,
              version: record.vlocity_cmt__Version__c,
              componentType: 'integration-procedure'
            };
          });
          break;

        case 'omniscript':
          const osQuery = `SELECT Id,Name,vlocity_cmt__Type__c,vlocity_cmt__SubType__c,vlocity_cmt__IsProcedure__c,vlocity_cmt__ProcedureKey__c,vlocity_cmt__Version__c
                          FROM vlocity_cmt__OmniScript__c 
                          WHERE vlocity_cmt__IsProcedure__c=false AND vlocity_cmt__IsActive__c=true ${searchTerm ? `AND Name LIKE '%${searchTerm}%'` : ''}
                          ORDER BY Name ASC LIMIT 1000`;
          
          console.log(`🔍 [OMNISTUDIO] Executing search query: ${osQuery}`);
          const osResult = await connection.query(osQuery);
          
          instances = osResult.records.map(record => {
            const uniqueId = `${record.vlocity_cmt__Type__c}_${record.vlocity_cmt__SubType__c}`;
            return {
              id: record.Id,
              name: record.Name,
              uniqueId: uniqueId,
              type: record.vlocity_cmt__Type__c,
              subtype: record.vlocity_cmt__SubType__c,
              version: record.vlocity_cmt__Version__c,
              componentType: 'omniscript'
            };
          });
          break;

        case 'data-mapper':
          const dmQuery = `SELECT Id,Name,vlocity_cmt__Type__c,vlocity_cmt__Version__c
                          FROM vlocity_cmt__DRBundle__c 
                          WHERE vlocity_cmt__IsActive__c=true ${searchTerm ? `AND Name LIKE '%${searchTerm}%'` : ''}
                          ORDER BY Name ASC LIMIT 1000`;
          
          console.log(`🔍 [OMNISTUDIO] Executing search query: ${dmQuery}`);
          const dmResult = await connection.query(dmQuery);
          
          instances = dmResult.records.map(record => ({
            id: record.Id,
            name: record.Name,
            uniqueId: record.Name,
            type: record.vlocity_cmt__Type__c,
            version: record.vlocity_cmt__Version__c,
            componentType: 'data-mapper'
          }));
          break;

        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid component type'
          });
      }

      console.log(`✅ [OMNISTUDIO] Search completed: Found ${instances.length} ${componentType} components`);

      res.json({
        success: true,
        instances,
        searchTerm,
        componentType,
        totalFound: instances.length
      });

    } catch (error) {
      console.error(`❌ [OMNISTUDIO] Error searching ${req.query.componentType}:`, error);
      res.status(500).json({
        success: false,
        message: 'Failed to search components: ' + error.message
      });
    }
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
        if (step.integrationProcedureKey && step.integrationProcedureKey !== 'undefined' && step.integrationProcedureKey !== '') {
          const childComponent = componentsByUniqueId.get(step.integrationProcedureKey) ||
                               componentsByName.get(step.integrationProcedureKey);
          
          if (childComponent) {
            step.childComponent = {
              id: childComponent.id,
              name: childComponent.name,
              componentType: childComponent.componentType,
              uniqueId: childComponent.uniqueId,
              stepsCount: childComponent.steps ? childComponent.steps.length : 0,
              level: currentLevel + 1
            };
            
            // Build the full hierarchical path for this reference with prefixes and cycle detection
            const fullPath = [...currentPath, parentComponent.uniqueId];
            
            // Check for circular references - prevent adding child if it's already in the path
            if (fullPath.includes(childComponent.uniqueId)) {
              console.log(`    🔄 [CYCLE-DETECTED] Skipping circular reference: "${childComponent.name}" already exists in path [${fullPath.join(' => ')}]`);
              // Skip this child component but continue processing other steps
              return;
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
        
        if (step.integrationProcedureKey && step.integrationProcedureKey !== 'undefined' && step.integrationProcedureKey !== '') {
          console.log(`    🔑 [IP-KEY] Step "${step.name}" has integrationProcedureKey: "${step.integrationProcedureKey}"`);
          // 🔧 FIX: Mark IP reference steps as expandable (only if not already a block)
          if (!step.blockType || step.blockType === 'None') {
            step.hasChildren = true;
            step.blockType = 'ip-reference';
            step.referencedIP = step.integrationProcedureKey;
            console.log(`    ✅ [IP-REFERENCE] Step "${step.name}" marked as expandable IP reference to "${step.integrationProcedureKey}"`);
          } else {
            // For block steps with IP references, store IP reference info but keep block type
            step.referencedIP = step.integrationProcedureKey;
            step.hasIPReference = true;
            console.log(`    🔗 [BLOCK-WITH-IP] Step "${step.name}" (blockType: ${step.blockType}) has IP reference: "${step.integrationProcedureKey}"`);
          }
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
          
          // 🔧 CRITICAL FIX: Try alternative structures for Integration Procedure conditional blocks
          console.log(`    🔍 [CONDITIONAL-FALLBACK] Trying direct children array for conditional block "${child.name}"`);
          if (Array.isArray(child.children) && child.children.length > 0) {
            childrenToProcess = child.children;
            console.log(`    ✅ [CONDITIONAL-DIRECT] Using direct children array: ${childrenToProcess.length} children for conditional block "${child.name}"`);
          }
        }
      }
      
      if (childrenToProcess.length > 0) {
        console.log(`    🎯 [PROCESSING] About to process ${childrenToProcess.length} children for step "${child.name}" with blockType "${step.blockType}"`);
        
        // Special handling for Omniscript "Step" elements - their children should always be subSteps
        const isOmniscriptStep = componentType === 'omniscript' && child.type === 'Step';
        
        if (isOmniscriptStep) {
          // For Omniscript Steps, children are sub-steps
          console.log(`    📋 [OMNISCRIPT-SUBSTEPS] Creating subSteps array for Omniscript Step "${child.name}"`);
          
          step.subSteps = childrenToProcess.map((grandChild, index) => {
            console.log(`      📋 [SUB-STEP] Processing Omniscript sub-step ${index + 1}/${childrenToProcess.length} in "${containerName}" (type: ${grandChild.type}, name: "${grandChild.name}")`);
            return processStep(grandChild, child.level + 1, parentBlockType, index);
          });
          console.log(`    ✅ [OMNISCRIPT-SUBSTEPS-DONE] Created ${step.subSteps.length} subSteps for Omniscript Step "${child.name}"`);                                                                                
        } else if (step.blockType === 'ip-reference') {
          // For IP references, we'll load child IP steps on-demand (placeholder for now)
          console.log(`    🔗 [IP-REFERENCE] Preparing expandable IP reference "${child.name}" -> "${step.referencedIP}"`);
          step.ipSteps = []; // Empty array - will be populated when expanded
          step.needsChildLoad = true; // Flag to indicate child IP needs to be loaded
          console.log(`    ✅ [IP-REFERENCE-READY] IP reference "${child.name}" marked for on-demand loading`);
        } else if (step.blockType) {
          // For blocks (conditional, loop, cache), children are block steps
          console.log(`    🎛️ [BLOCK-STEPS] Creating blockSteps array for ${step.blockType} block "${child.name}"`);
          
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
    
    // DEBUG: Log ALL potential conditional structures to understand what's available
    if (child.children && Array.isArray(child.children) && child.children[0] && 
        child.children[0].eleArray && Array.isArray(child.children[0].eleArray)) {
      
      const isOmniscriptStep = componentType === 'omniscript' && child.type === 'Step';
      
      console.log(`    🔍 [POTENTIAL-CONDITIONAL] "${child.name}" has eleArray structure:
        Type: "${child.type}", Name: "${child.name}"
        Component Type: ${componentType}
        eleArray length: ${child.children[0].eleArray.length}
        Is Omniscript Step: ${isOmniscriptStep}
        Would be excluded: ${isOmniscriptStep}`);
    }
    
    // Quick conditional block detection
    let isConditional = false;
    let detectionMethod = '';
    
    // Method 1: Check if has eleArray structure
    // RELAXED CRITERIA - Let's see what we find first
    if (child.children && Array.isArray(child.children) && child.children[0] && 
        child.children[0].eleArray && Array.isArray(child.children[0].eleArray)) {
      
      // For now, let's be more permissive and see what gets detected
      const isOmniscriptStep = componentType === 'omniscript' && child.type === 'Step';
      const isRegularBlock = child.type === 'Block';
      
      // Only exclude obvious UI steps, but DON'T mark regular Blocks as conditional
      // CRITICAL FIX: Exclude regular Blocks (like CustInfoBlock) from being detected as conditional
      if ((!isOmniscriptStep && !isRegularBlock) || name.toLowerCase().includes('if') || name.toLowerCase().includes('conditional')) {
        isConditional = true;
        detectionMethod = 'eleArray';
      }
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
    
    // Method 4: Block type detection - REMOVED (this was causing blocks to be detected as conditional)
    
    if (isConditional) {
      const eleArrayItems = child.children && child.children[0] && child.children[0].eleArray 
        ? child.children[0].eleArray.length 
        : 0;
      console.log(`    ✅ [CONDITIONAL-FOUND] "${child.name}" detected by ${detectionMethod} - eleArray: ${eleArrayItems > 0 ? eleArrayItems + ' items' : 'NO'}`);
      // Additional debug for blocks that might be incorrectly detected as conditional
      if (type.toLowerCase() === 'block') {
        console.log(`    ⚠️ [BLOCK-AS-CONDITIONAL-WARNING] "${child.name}" is type "Block" but detected as conditional - this might be wrong!`);
      }
      return 'conditional';
    }
    
    // Block type (Omniscript UI blocks that have nested children) - Fixed to catch all Block types
    if (type.toLowerCase() === 'block' && child.children && Array.isArray(child.children) && child.children.length > 0) {
      console.log(`    ✅ [BLOCK-FOUND] "${child.name}" detected as Block type with ${child.children.length} children - This will process ALL eleArray items from all children`);                                                                                                
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
   * Get component prefix for display
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
   * Get child IP hierarchy for expandable IP reference steps
   */
  async getChildIPHierarchy(req, res) {
    try {
      const { ipName } = req.params;
      
      console.log(`🔗 [CHILD-IP] Loading hierarchy for referenced IP: "${ipName}"`);
      
      if (!req.session.salesforce) {
        return res.status(401).json({ 
          success: false, 
          message: 'Not authenticated with Salesforce' 
        });
      }
      
      // Create Salesforce connection
      const connection = this.createConnection(req);
      
      // Query for the referenced IP
      const query = `
        SELECT Id, Name, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Version__c,
               vlocity_cmt__ProcedureKey__c, vlocity_cmt__IsActive__c,
               (SELECT Id, Name, vlocity_cmt__Sequence__c, vlocity_cmt__Content__c 
                FROM vlocity_cmt__OmniScriptDefinitions__r 
                ORDER BY vlocity_cmt__Sequence__c ASC LIMIT 1)
        FROM vlocity_cmt__OmniScript__c 
        WHERE Name = '${ipName}' 
          AND vlocity_cmt__IsProcedure__c=true 
          AND vlocity_cmt__IsActive__c=true
        ORDER BY vlocity_cmt__Version__c DESC
        LIMIT 1
      `;
      
      const result = await connection.query(query);
      
      if (!result.records || result.records.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Child IP not found: ${ipName}`
        });
      }
      
      // Process the child IP using our existing logic
      const record = result.records[0];
      const childIP = this.processComponentRecord(record, 'integration-procedure');
      
      console.log(`✅ [CHILD-IP] Successfully processed child IP: "${ipName}" with ${childIP.steps.length} steps`);
      
      res.json({
        success: true,
        ipName: ipName,
        hierarchy: childIP.steps || []
      });
      
    } catch (error) {
      console.error(`❌ [CHILD-IP] Error loading child IP hierarchy for ${req.params.ipName}:`, error);
      res.status(500).json({
        success: false,
        message: 'Failed to load child IP hierarchy: ' + error.message
      });
    }
  }

  /**
   * Get instance details on-demand (for components not in cache)
   */
  async getInstanceDetails(req, res) {
    try {
      const { componentType, instanceName } = req.params;
      
      console.log(`🔍 [DETAILS] Fetching details for ${componentType}: "${instanceName}"`);
      
      if (!req.session.salesforce) {
        return res.status(401).json({ 
          success: false, 
          message: 'Not authenticated with Salesforce' 
        });
      }
      
      // Create Salesforce connection
      const connection = this.createConnection(req);
      
      // Build query based on component type
      let query;
      if (componentType === 'integration-procedure' || componentType === 'omniscript') {
        const isProcedure = componentType === 'integration-procedure';
        
        query = `
          SELECT Id, Name, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Version__c,
                 vlocity_cmt__ProcedureKey__c, vlocity_cmt__IsActive__c,
                 (SELECT Id, Name, vlocity_cmt__Sequence__c, vlocity_cmt__Content__c 
                  FROM vlocity_cmt__OmniScriptDefinitions__r 
                  ORDER BY vlocity_cmt__Sequence__c ASC LIMIT 1)
          FROM vlocity_cmt__OmniScript__c 
          WHERE Name = '${instanceName}' 
            AND vlocity_cmt__IsProcedure__c=${isProcedure} 
            AND vlocity_cmt__IsActive__c=true
          ORDER BY vlocity_cmt__Version__c DESC
          LIMIT 1
        `;
      } else {
        return res.status(400).json({
          success: false,
          message: `Unsupported component type: ${componentType}`
        });
      }
      
      const result = await connection.query(query);
      
      if (!result.records || result.records.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Component not found: ${instanceName}`
        });
      }
      
      // Process the component using our existing logic (includes conditional block fixes!)
      const record = result.records[0];
      const component = this.processComponentRecord(record, componentType);
      
      console.log(`✅ [DETAILS] Successfully processed ${componentType}: "${instanceName}" with ${component.steps.length} steps`);
      
      // 🔧 FIX: Wrap in structure expected by frontend (details.summary.steps)
      const details = {
        name: component.name,
        id: component.id,
        componentType: component.componentType,
        summary: {
          type: component.type,
          subType: component.subType,
          version: component.version,
          language: component.language || 'en_US',
          isReusable: component.isReusable || false,
          hasAttachment: component.hasAttachment || false,
          childrenCount: component.steps?.length || 0,
          steps: component.steps || [],  // <-- Steps nested under summary as expected by frontend
          procedureType: componentType === 'integration-procedure' ? 'Integration Procedure' : 'Omniscript',
          // Add conditional block information
          hasConditionalBlocks: component.steps?.some(step => step.blockType === 'conditional') || false,
          conditionalBlocksCount: component.steps?.filter(step => step.blockType === 'conditional').length || 0
        }
      };
      
      res.json({
        success: true,
        details: details
      });
      
    } catch (error) {
      console.error(`❌ [DETAILS] Error fetching ${req.params.componentType}:`, error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch component details: ' + error.message
      });
    }
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


  /**
   * Recursively expand all child IPs to create full hierarchy (OPTIMIZED)
   */
  async recursivelyExpandChildIPs(integrationProcedures, req) {
    const startTime = Date.now();
    const expandedIPs = [];
    const processedIPs = new Map(); // Track processed IPs to avoid infinite recursion
    const sharedIPCache = new Map(); // OPTIMIZATION: Shared cache to avoid duplicate SOQL queries
    let soqlQueryCount = 0;
    
    console.log(`🚀 [PERFORMANCE] Starting optimized recursive expansion for ${integrationProcedures.length} IPs`);
    
    for (let i = 0; i < integrationProcedures.length; i++) {
      const ip = integrationProcedures[i];
      if (i % 50 === 0 || i === integrationProcedures.length - 1) {
        console.log(`⚡ [PROGRESS] Processing IP ${i + 1}/${integrationProcedures.length}: ${ip.name} (SOQL queries so far: ${soqlQueryCount})`);
      }
      
      const expandedIP = await this.expandSingleIPRecursively(ip, req, processedIPs, 0, sharedIPCache);
      expandedIPs.push(expandedIP);
      soqlQueryCount = sharedIPCache.get('__SOQL_COUNT__') || 0;
    }
    
    const duration = Date.now() - startTime;
    console.log(`🎯 [PERFORMANCE] Completed IP expansion: ${duration}ms, ${soqlQueryCount} SOQL queries, ${expandedIPs.length} IPs processed`);
    
    return expandedIPs;
  }

  /**
   * Recursively expand a single IP with all its child IPs (OPTIMIZED)
   */
  async expandSingleIPRecursively(ip, req, processedIPs, depth = 0, sharedIPCache = new Map()) {
    const maxDepth = 10; // Prevent infinite recursion
    
    if (depth > maxDepth) {
      if (depth === maxDepth + 1) console.warn(`⚠️ [RECURSIVE-EXPANSION] Max recursion depth reached for IP: ${ip.name}`);
      return ip;
    }

    if (processedIPs.has(ip.name)) {
      return processedIPs.get(ip.name);
    }

    // Only log every 10th IP at depth 0 to reduce noise
    if (depth === 0 && Math.random() < 0.1) {
      console.log(`🔍 [RECURSIVE-EXPANSION] Expanding IP: ${ip.name} (depth: ${depth})`);
    }
    
    // Clone the IP to avoid modifying the original
    const expandedIP = JSON.parse(JSON.stringify(ip));
    
    // Mark as being processed to avoid circular references
    processedIPs.set(ip.name, expandedIP);

    if (expandedIP.steps) {
      expandedIP.steps = await this.expandStepsRecursively(expandedIP.steps, req, processedIPs, depth + 1, 'ip', sharedIPCache);
    }

    expandedIP.fullyExpanded = true;
    return expandedIP;
  }

  /**
   * Recursively expand steps that contain child IPs (HEAVILY OPTIMIZED)
   */
  async expandStepsRecursively(steps, req, processedIPs, depth, contextType = 'ip', sharedIPCache = new Map()) {
    const expandedSteps = [];
    const contextLabel = contextType === 'omniscript' ? 'OMNISCRIPT-EXPANSION' : 'RECURSIVE-EXPANSION';
    
    for (const step of steps) {
      const expandedStep = JSON.parse(JSON.stringify(step));
      
      // Check if this step has a child IP reference
      if (step.blockType === 'ip-reference' && step.referencedIP) {
        const ipName = step.referencedIP;
        
        try {
          let childIPStructure = null;
          let cacheHit = false;
          
          // OPTIMIZED PRIORITY 1: Check shared IP cache FIRST (fastest)
          if (sharedIPCache.has(ipName)) {
            childIPStructure = sharedIPCache.get(ipName);
            cacheHit = true;
          }
          
          // OPTIMIZED PRIORITY 2: Check current processing cache 
          else if (processedIPs.has(ipName)) {
            childIPStructure = processedIPs.get(ipName);
            sharedIPCache.set(ipName, childIPStructure); // Cache for future use
            cacheHit = true;
          }
          
          // OPTIMIZED PRIORITY 3: Check global cache
          else {
            const orgId = req.session.salesforce.organizationId;
            const globalCache = this.orgComponentsDataCache.get(orgId);
            
            if (globalCache && globalCache.integrationProcedures) {
              const existingIP = globalCache.integrationProcedures.find(ip => ip.name === ipName);
              if (existingIP) {
                childIPStructure = existingIP;
                childIPStructure.fullyExpanded = true;
                sharedIPCache.set(ipName, childIPStructure); // Cache for future use
                cacheHit = true;
              }
            }
          }
          
          // LAST RESORT: Load from Salesforce (track queries)
          if (!childIPStructure) {
            // Increment SOQL counter
            const currentCount = sharedIPCache.get('__SOQL_COUNT__') || 0;
            sharedIPCache.set('__SOQL_COUNT__', currentCount + 1);
            
            // Only log every 10th SOQL query to reduce noise
            if (currentCount % 10 === 0) {
              console.log(`🔄 [${contextLabel}] SOQL query #${currentCount + 1}: Loading ${ipName} from Salesforce`);
            }
            
            childIPStructure = await this.loadChildIPFromSalesforce(ipName, req);
            
            if (childIPStructure) {
              // For OmniScript context, expand recursively
              if (contextType === 'omniscript') {
                childIPStructure = await this.expandSingleIPRecursively(childIPStructure, req, processedIPs, depth + 1, sharedIPCache);
              }
              childIPStructure.fullyExpanded = true;
              sharedIPCache.set(ipName, childIPStructure); // Cache for future use
            }
          }
          
          // Add the fully expanded child IP structure to the step
          if (childIPStructure) {
            expandedStep.childIPStructure = childIPStructure;
            expandedStep.hasExpandedStructure = true;
            
            // Only log cache misses or every 20th cache hit
            if (!cacheHit || Math.random() < 0.05) {
              const source = cacheHit ? 'CACHE HIT' : 'SALESFORCE';
              console.log(`📦 [${contextLabel}] Added child IP ${ipName} (${source}) with ${childIPStructure.steps?.length || 0} steps`);
            }
          } else {
            console.warn(`⚠️ [${contextLabel}] Could not load child IP: ${ipName}`);
          }
          
        } catch (error) {
          console.error(`❌ [${contextLabel}] Error expanding child IP ${step.referencedIP}:`, error.message);
        }
      }
      
      // Recursively expand sub-steps if they exist
      if (step.subSteps && step.subSteps.length > 0) {
        expandedStep.subSteps = await this.expandStepsRecursively(step.subSteps, req, processedIPs, depth, contextType, sharedIPCache);
      }
      
      // Recursively expand block steps if they exist
      if (step.blockSteps && step.blockSteps.length > 0) {
        expandedStep.blockSteps = await this.expandStepsRecursively(step.blockSteps, req, processedIPs, depth, contextType, sharedIPCache);
      }
      
      expandedSteps.push(expandedStep);
    }
    
    return expandedSteps;
  }

  /**
   * Recursively expand all OmniScripts to include full child IP hierarchy (OPTIMIZED)
   */
  async recursivelyExpandOmniScripts(omniscripts, req) {
    const startTime = Date.now();
    const expandedOmniScripts = [];
    const processedOmniScripts = new Map(); // Track processed OmniScripts
    const sharedIPCache = new Map(); // OPTIMIZATION: Reuse cache from IP expansion phase
    
    console.log(`🚀 [PERFORMANCE] Starting optimized OmniScript expansion for ${omniscripts.length} OmniScripts`);
    
    // Copy existing IP cache if available (reuse from previous IP expansion)
    const orgId = req.session.salesforce.organizationId;
    const globalCache = this.orgComponentsDataCache.get(orgId);
    if (globalCache && globalCache.integrationProcedures) {
      for (const ip of globalCache.integrationProcedures) {
        if (ip.fullyExpanded) {
          sharedIPCache.set(ip.name, ip);
        }
      }
      console.log(`📋 [CACHE-SEED] Pre-seeded OmniScript cache with ${sharedIPCache.size} already expanded IPs`);
    }
    
    for (let i = 0; i < omniscripts.length; i++) {
      const omniscript = omniscripts[i];
      if (i % 20 === 0 || i === omniscripts.length - 1) {
        const soqlCount = sharedIPCache.get('__SOQL_COUNT__') || 0;
        console.log(`⚡ [PROGRESS] Processing OmniScript ${i + 1}/${omniscripts.length}: ${omniscript.name} (SOQL: ${soqlCount})`);
      }
      
      const expandedOmniScript = await this.expandSingleOmniScriptRecursively(omniscript, req, processedOmniScripts, 0, sharedIPCache);
      expandedOmniScripts.push(expandedOmniScript);
    }
    
    const duration = Date.now() - startTime;
    const soqlCount = sharedIPCache.get('__SOQL_COUNT__') || 0;
    console.log(`🎯 [PERFORMANCE] Completed OmniScript expansion: ${duration}ms, ${soqlCount} additional SOQL queries, ${expandedOmniScripts.length} OmniScripts processed`);
    
    return expandedOmniScripts;
  }

  /**
   * Recursively expand a single OmniScript with all its child IPs (OPTIMIZED)
   */
  async expandSingleOmniScriptRecursively(omniscript, req, processedOmniScripts, depth = 0, sharedIPCache = new Map()) {
    const maxDepth = 10; // Prevent infinite recursion
    
    if (depth > maxDepth) {
      if (depth === maxDepth + 1) console.warn(`⚠️ [OMNISCRIPT-EXPANSION] Max recursion depth reached for OmniScript: ${omniscript.name}`);
      return omniscript;
    }

    if (processedOmniScripts.has(omniscript.name)) {
      return processedOmniScripts.get(omniscript.name);
    }

    // Only log occasionally to reduce noise
    if (depth === 0 && Math.random() < 0.05) {
      console.log(`🔍 [OMNISCRIPT-EXPANSION] Expanding OmniScript: ${omniscript.name} (depth: ${depth})`);
    }
    
    // Clone the OmniScript to avoid modifying the original
    const expandedOmniScript = JSON.parse(JSON.stringify(omniscript));
    
    // Mark as being processed to avoid circular references
    processedOmniScripts.set(omniscript.name, expandedOmniScript);

    if (expandedOmniScript.steps) {
      // Reuse the same step expansion logic, but with OmniScript context and shared cache
      expandedOmniScript.steps = await this.expandStepsRecursively(expandedOmniScript.steps, req, new Map(), depth + 1, 'omniscript', sharedIPCache);
    }

    return expandedOmniScript;
  }

  /**
   * Get component from cached data (avoiding SOQL queries)
   */
  async getCachedComponent(req, res) {
    try {
      const { componentType, instanceName } = req.params;
      
      if (!req.session.salesforce) {
        return res.status(401).json({ 
          success: false, 
          message: 'Not authenticated with Salesforce' 
        });
      }

      const orgId = req.session.salesforce.organizationId;
      const globalData = this.orgComponentsDataCache.get(orgId);
      
      if (!globalData) {
        return res.status(404).json({
          success: false,
          message: 'No cached component data available. Please load global data first.',
          requiresGlobalLoad: true
        });
      }

      let component = null;
      let componentArray = null;

      // Select the appropriate component array based on type
      switch (componentType) {
        case 'integration-procedure':
          componentArray = globalData.integrationProcedures;
          break;
        case 'omniscript':
          componentArray = globalData.omniscripts;
          break;
        case 'data-mapper':
          componentArray = globalData.dataMappers;
          break;
        default:
          return res.status(400).json({
            success: false,
            message: `Invalid component type: ${componentType}`
          });
      }

      // Find the component by name (case insensitive)
      component = componentArray.find(comp => 
        comp.name.toLowerCase() === instanceName.toLowerCase()
      );

      if (!component) {
        return res.status(404).json({
          success: false,
          message: `Component "${instanceName}" not found in cached data`
        });
      }

      console.log(`📦 [CACHED-COMPONENT] Serving ${componentType} "${instanceName}" from cache with ${component.steps?.length || 0} steps`);
      
      // Check if component has fully expanded child IPs
      const hasExpandedChildren = component.steps?.some(step => 
        step.blockType === 'ip-reference' && step.hasExpandedStructure
      ) || false;

      // FRONTEND COMPATIBILITY: Transform cached data to match expected frontend format
      const transformedComponent = {
        id: component.id,
        name: component.name,
        componentType: componentType,
        componentName: component.name,
        
        // Add summary object in expected format
        summary: {
          id: component.id,
          name: component.name,
          type: component.type,
          subType: component.subType,
          version: component.version,
          language: component.language || 'en_US',
          isActive: component.isActive || true,
          childrenCount: component.steps?.length || 0,
          steps: component.steps || [],  // ← This is what frontend expects
          hierarchy: [],
          blockStructure: null
        },
        
        // Keep original data for compatibility
        ...component
      };

      res.json({
        success: true,
        component: transformedComponent,
        fromCache: true,
        fullyExpanded: component.fullyExpanded || hasExpandedChildren,
        expandedChildrenCount: this.countExpandedChildren(component),
        message: hasExpandedChildren ? 
          'Component served from cache with fully expanded child IP hierarchy' : 
          'Component served from cache'
      });

    } catch (error) {
      console.error(`❌ [CACHED-COMPONENT] Error serving cached component:`, error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve cached component data',
        error: error.message
      });
    }
  }

  /**
   * Count expanded children in a component (for debugging/info)
   */
  countExpandedChildren(component) {
    let count = 0;
    
    const countInSteps = (steps) => {
      if (!steps) return;
      
      for (const step of steps) {
        if (step.blockType === 'ip-reference' && step.hasExpandedStructure) {
          count++;
          // Recursively count in child IP structure
          if (step.childIPStructure && step.childIPStructure.steps) {
            countInSteps(step.childIPStructure.steps);
          }
        }
        
        // Check sub-steps and block steps
        if (step.subSteps) countInSteps(step.subSteps);
        if (step.blockSteps) countInSteps(step.blockSteps);
      }
    };
    
    countInSteps(component.steps);
    return count;
  }

  /**
   * Load a single child IP from Salesforce (similar to getChildIPHierarchy but returns the full IP structure)
   */
  async loadChildIPFromSalesforce(ipName, req) {
    try {
      // Create Salesforce connection
      const connection = this.createConnection(req);
      
      // Query for the referenced IP
      const query = `
        SELECT Id, Name, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Version__c,
               vlocity_cmt__ProcedureKey__c, vlocity_cmt__IsActive__c,
               (SELECT Id, Name, vlocity_cmt__Sequence__c, vlocity_cmt__Content__c 
                FROM vlocity_cmt__OmniScriptDefinitions__r 
                ORDER BY vlocity_cmt__Sequence__c ASC LIMIT 1)
        FROM vlocity_cmt__OmniScript__c 
        WHERE Name = '${ipName}' 
          AND vlocity_cmt__IsProcedure__c=true
          AND vlocity_cmt__IsActive__c=true
        ORDER BY vlocity_cmt__Version__c DESC
        LIMIT 1`;
      
      const result = await connection.query(query);
      
      if (result.records.length === 0) {
        console.warn(`⚠️ [RECURSIVE-EXPANSION] Child IP not found: ${ipName}`);
        return null;
      }
      
      // Process the child IP using our existing logic
      const record = result.records[0];
      const childIP = this.processComponentRecord(record, 'integration-procedure');
      
      console.log(`✅ [RECURSIVE-EXPANSION] Successfully loaded child IP: ${ipName} with ${childIP.steps?.length || 0} steps`);
      return childIP;
      
    } catch (error) {
      console.error(`❌ [RECURSIVE-EXPANSION] Error loading child IP ${ipName}:`, error.message);
      return null;
    }
  }
}

module.exports = OmnistudioModule;
