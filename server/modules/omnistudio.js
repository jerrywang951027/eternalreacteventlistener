const jsforce = require('jsforce');

class OmnistudioModule {
  constructor(redisModule = null) {
    this.orgComponentsDataCache = new Map(); // Store components per org: orgId -> componentData
    this.componentHierarchy = new Map(); // Store hierarchical relationships
    this.redisModule = redisModule; // Redis integration for persistent caching
    this.redisEnabled = false; // Default to disabled
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
   * Toggle Redis functionality on/off
   */
  toggleRedis(enabled) {
    this.redisEnabled = enabled;
    console.log(`🔄 [REDIS-TOGGLE] Redis functionality ${enabled ? 'ENABLED' : 'DISABLED'}`);
    return this.redisEnabled;
  }

  /**
   * Get current Redis status
   */
  getRedisStatus() {
    return {
      enabled: this.redisEnabled,
      available: this.redisModule && this.redisModule.isAvailable(),
      moduleExists: !!this.redisModule
    };
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

    // 🔍 REDIS INTEGRATION: Check Redis cache first (only if enabled)
    if (this.redisEnabled && this.redisModule && this.redisModule.isAvailable()) {
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
    } else if (!this.redisEnabled) {
      console.log('🚫 [REDIS-DISABLED] Redis functionality is disabled, loading directly from Salesforce...');
    } else {
      console.log('⚠️ [REDIS-UNAVAILABLE] Redis not available, loading directly from Salesforce...');
    }

    // Start timing
    const startTime = new Date();
    const startTimestamp = startTime.toISOString();
    
    const connection = this.createConnection(req);
    console.log(`🔄 [OMNISTUDIO] Starting component loading from Salesforce at ${startTimestamp}...`);

    // Load all components sequentially in specific order: Data Mapper → Integration Procedure → OmniScript
    console.log('📋 [SEQUENCE] 1/3: Loading Data Mappers...');
    const dataMappers = await this.loadAllDataMappers(connection);
    console.log(`✅ [SEQUENCE] Step 1 Complete: Loaded ${dataMappers.length} Data Mappers.`);
    
    console.log('📋 [SEQUENCE] 2/3: Loading Integration Procedures...');
    const integrationProcedures = await this.loadAllIntegrationProcedures(connection);
    console.log(`✅ [SEQUENCE] Step 2 Complete: Loaded ${integrationProcedures.length} Integration Procedures.`);
    
    console.log('📋 [SEQUENCE] 3/3: Loading OmniScripts...');
    const omniscripts = await this.loadAllOmniscripts(connection);
    console.log(`✅ [SEQUENCE] Step 3 Complete: Loaded ${omniscripts.length} OmniScripts.`);

    console.log(`📊 [OMNISTUDIO] Loaded: ${integrationProcedures.length} IPs, ${omniscripts.length} Omniscripts, ${dataMappers.length} Data Mappers`);
    console.log('🔗 [OMNISTUDIO] Using new recursive algorithm for hierarchy building...');

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

    // RECURSIVE ALGORITHM: Build full IP hierarchy as instructed
    console.log('🔄 [RECURSIVE-ALGORITHM] Starting recursive IP hierarchy building using new algorithm...');
    
    // STEP 2: Build full hierarchy for all Integration Procedures
    console.log('📋 [SEQUENCE] 2/3: Building full IP hierarchy for all Integration Procedures...');
    const expandedIntegrationProcedures = this.buildFullIPHierarchy(integrationProcedures);
    console.log(`✅ [SEQUENCE] Step 2 Complete: Built full hierarchy for ${expandedIntegrationProcedures.length} IPs.`);

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

    // STEP 3: Process OmniScripts (no hierarchy building needed - they are not IPs)
    console.log('📋 [SEQUENCE] 3/3: Processing OmniScripts (no IP hierarchy building needed)...');
    // OmniScripts don't need IP hierarchy building - they are different component types
    const processedOmniScripts = omniscripts; // Store as-is, no hierarchy processing
    console.log(`✅ [SEQUENCE] Step 3 Complete: Processed ${processedOmniScripts.length} OmniScripts (no hierarchy building).`);

    // Final cache update with both expanded IPs and processed OmniScripts
    const finalComponentData = {
      integrationProcedures: expandedIntegrationProcedures,
      omniscripts: processedOmniScripts,
      dataMappers,
      hierarchy: Object.fromEntries(this.componentHierarchy),
      loadedAt: endTimestamp,
      totalComponents: expandedIntegrationProcedures.length + processedOmniScripts.length + dataMappers.length,
      orgName,
      timing: {
        startTime: startTimestamp,
        endTime: endTimestamp,
        durationMs: durationMs,
        durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
      }
    };

    this.orgComponentsDataCache.set(orgId, finalComponentData);

    // 💾 REDIS INTEGRATION: Cache the component data in Redis with 2-day expiration (only if enabled)
    if (this.redisEnabled && this.redisModule && this.redisModule.isAvailable()) {
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
    } else if (!this.redisEnabled) {
      console.log('🚫 [REDIS-DISABLED] Redis caching is disabled, skipping Redis save...');
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
    // 🚀 ENHANCED: Use single subquery to get all Integration Procedures with definitions in one request
    // This avoids Promise.all() failures and leverages enhanced SOQL pagination
    const query = `
      SELECT Id, Name, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Version__c,
             vlocity_cmt__ProcedureKey__c, vlocity_cmt__IsActive__c,
             (SELECT Id, Name, vlocity_cmt__Sequence__c, vlocity_cmt__Content__c
              FROM vlocity_cmt__OmniScriptDefinitions__r
              ORDER BY vlocity_cmt__Sequence__c ASC)
      FROM vlocity_cmt__OmniScript__c 
      WHERE vlocity_cmt__IsProcedure__c=true AND vlocity_cmt__IsActive__c=true
      ORDER BY Name ASC
    `;

    console.log(`🔍 [ENHANCED-QUERY] Executing single subquery for all Integration Procedures with definitions`);
    
    const startTime = Date.now();
    
    // Execute initial query and handle pagination like executeFreeSOQLQuery
    const allRecords = [];
    let currentResult = await connection.query(query);
    let totalRecords = 0;
    let batchCount = 0;
    
    // Add first batch of records
    allRecords.push(...currentResult.records);
    totalRecords = currentResult.totalSize;
    batchCount++;
    
    console.log(`📦 [ENHANCED-BATCH] Batch ${batchCount}: Retrieved ${currentResult.records.length} Integration Procedures`);
    
    // Continue fetching records if there are more
    while (currentResult.done === false && currentResult.nextRecordsUrl) {
      try {
        batchCount++;
        currentResult = await connection.queryMore(currentResult.nextRecordsUrl);
        allRecords.push(...currentResult.records);
        console.log(`📦 [ENHANCED-BATCH] Batch ${batchCount}: Retrieved ${currentResult.records.length} records (Total: ${allRecords.length}/${totalRecords})`);
        
        // Safety check to prevent infinite loops
        if (batchCount > 100) {
          console.warn(`⚠️ [ENHANCED-SAFETY] Safety limit reached (${batchCount} batches). Stopping pagination.`);
          break;
        }
        
        // Add a small delay between batches to prevent overwhelming the API
        if (currentResult.nextRecordsUrl) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`❌ [ENHANCED-BATCH-ERROR] Error fetching batch ${batchCount}:`, error);
        break;
      }
    }
    
    const queryDuration = Date.now() - startTime;
    console.log(`✅ [ENHANCED-QUERY] Pagination completed. Total batches: ${batchCount}, Total records: ${allRecords.length}/${totalRecords} in ${queryDuration}ms`);
    
    // 🔍 DEBUG: Check if Partner_SalesOrder is found
    const partnerVersions = allRecords.filter(r => r.Name === 'Partner_SalesOrder');
    if (partnerVersions.length > 0) {
      console.log(`✅ [ENHANCED-SUCCESS] Found ${partnerVersions.length} Partner_SalesOrder versions:`, 
        partnerVersions.map(p => ({ 
          Version: p.vlocity_cmt__Version__c, 
          Id: p.Id,
          Definitions: p.vlocity_cmt__OmniScriptDefinitions__r?.records?.length || 0
        }))
      );
    } else {
      console.log(`❌ [ENHANCED-MISSING] Partner_SalesOrder not found in ${allRecords.length} records`);
      const similarNames = allRecords.filter(r => 
        r.Name.toLowerCase().includes('partner') || r.Name.toLowerCase().includes('sales')
      ).slice(0, 10).map(r => r.Name);
      console.log(`🔍 [SIMILAR-NAMES] Components with partner or sales:`, similarNames);
    }
    
    // Process records sequentially to ensure proper order for recursive algorithm
    const processStartTime = Date.now();
    const processedRecords = [];
    
    for (let i = 0; i < allRecords.length; i++) {
      const record = allRecords[i];
      try {
        // The subquery already provides the definitions, no need for additional queries
        const processed = this.processComponentRecord(record, 'integration-procedure');
        
        if (record.Name === 'Partner_SalesOrder') {
          console.log(`✅ [ENHANCED-PROCESSING] Successfully processing Partner_SalesOrder:`, {
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
        
        processedRecords.push(processed);
      } catch (error) {
        console.log(`⚠️ [ENHANCED-PROCESSING-ERROR] Error processing ${record.Name}:`, error.message);
        processedRecords.push(null);
      }
    }
    
    const validRecords = processedRecords.filter(Boolean);
    const finalPartner = validRecords.find(p => p && p.name === 'Partner_SalesOrder');
    console.log(`🎯 [ENHANCED-FINAL] Partner_SalesOrder in final processed array: ${finalPartner ? 'FOUND with ' + finalPartner.steps.length + ' steps' : 'NOT FOUND'}`);
    
    const processDuration = Date.now() - processStartTime;
    const totalDuration = Date.now() - startTime;
    
    console.log(`✅ [ENHANCED-COMPLETE] Successfully processed ${validRecords.length}/${allRecords.length} Integration Procedures`);
    console.log(`⏱️ [ENHANCED-TIMING] Query: ${queryDuration}ms, Processing: ${processDuration}ms, Total: ${totalDuration}ms`);
    
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

    console.log(`🔍 [OMNISCRIPTS] Executing query for all OmniScripts with definitions`);
    
    // Execute initial query and handle pagination like executeFreeSOQLQuery
    const allRecords = [];
    let currentResult = await connection.query(query);
    let totalRecords = 0;
    let batchCount = 0;
    
    // Add first batch of records
    allRecords.push(...currentResult.records);
    totalRecords = currentResult.totalSize;
    batchCount++;
    
    console.log(`📦 [OMNISCRIPTS-BATCH] Batch ${batchCount}: Retrieved ${currentResult.records.length} OmniScripts`);
    
    // Continue fetching records if there are more
    while (currentResult.done === false && currentResult.nextRecordsUrl) {
      try {
        batchCount++;
        currentResult = await connection.queryMore(currentResult.nextRecordsUrl);
        allRecords.push(...currentResult.records);
        console.log(`📦 [OMNISCRIPTS-BATCH] Batch ${batchCount}: Retrieved ${currentResult.records.length} records (Total: ${allRecords.length}/${totalRecords})`);
        
        // Safety check to prevent infinite loops
        if (batchCount > 100) {
          console.warn(`⚠️ [OMNISCRIPTS-SAFETY] Safety limit reached (${batchCount} batches). Stopping pagination.`);
          break;
        }
        
        // Add a small delay between batches to prevent overwhelming the API
        if (currentResult.nextRecordsUrl) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`❌ [OMNISCRIPTS-BATCH-ERROR] Error fetching batch ${batchCount}:`, error);
        break;
      }
    }
    
    console.log(`✅ [OMNISCRIPTS] Pagination completed. Total batches: ${batchCount}, Total records: ${allRecords.length}/${totalRecords}`);
    
    return allRecords.map(record => this.processComponentRecord(record, 'omniscript', record.vlocity_cmt__ProcedureKey__c));
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

    console.log(`🔍 [DATA-MAPPERS] Executing query for all Data Mappers`);
    
    // Execute initial query and handle pagination like executeFreeSOQLQuery
    const allRecords = [];
    let currentResult = await connection.query(query);
    let totalRecords = 0;
    let batchCount = 0;
    
    // Add first batch of records
    allRecords.push(...currentResult.records);
    totalRecords = currentResult.totalSize;
    batchCount++;
    
    console.log(`📦 [DATA-MAPPERS-BATCH] Batch ${batchCount}: Retrieved ${currentResult.records.length} Data Mappers`);
    
    // Continue fetching records if there are more
    while (currentResult.done === false && currentResult.nextRecordsUrl) {
      try {
        batchCount++;
        currentResult = await connection.queryMore(currentResult.nextRecordsUrl);
        allRecords.push(...currentResult.records);
        console.log(`📦 [DATA-MAPPERS-BATCH] Batch ${batchCount}: Retrieved ${currentResult.records.length} records (Total: ${allRecords.length}/${totalRecords})`);
        
        // Safety check to prevent infinite loops
        if (batchCount > 100) {
          console.warn(`⚠️ [DATA-MAPPERS-SAFETY] Safety limit reached (${batchCount} batches). Stopping pagination.`);
          break;
        }
        
        // Add a small delay between batches to prevent overwhelming the API
        if (currentResult.nextRecordsUrl) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`❌ [DATA-MAPPERS-BATCH-ERROR] Error fetching batch ${batchCount}:`, error);
        break;
      }
    }
    
    console.log(`✅ [DATA-MAPPERS] Pagination completed. Total batches: ${batchCount}, Total records: ${allRecords.length}/${totalRecords}`);
    
    return allRecords.map(record => ({
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
  processComponentRecord(record, componentType, currentPath = null) {
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
            component.steps = this.extractHierarchicalSteps(parsedContent.children, componentType, record.Name, record.vlocity_cmt__ProcedureKey__c);
            
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
   * Process single IP structure recursively as per the algorithm with path tracking
   */
  processSingleIPStructure(rootIP, originalIPArray, currentPath = '') {
    // 🔥 SPECIAL DEBUG: Track V8_IP_OE_AddEnrichmentProduct specifically
    const isTargetIP = rootIP.procedureKey === 'V8_IP_OE_AddEnrichmentProduct' || rootIP.name === 'V8_IP_OE_AddEnrichmentProduct';
    if (isTargetIP) {
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] ===============================================`);
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] ENTERING processSingleIPStructure for V8_IP_OE_AddEnrichmentProduct`);
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] rootIP.name: "${rootIP.name}"`);
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] rootIP.procedureKey: "${rootIP.procedureKey}"`);
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] currentPath: "${currentPath || 'ROOT'}"`);
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] processedIPHierachyArray.length: ${this.processedIPHierachyArray.length}`);
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] ===============================================`);
    }
    
    console.log(`    🔍 [PROCESS] Processing IP: ${rootIP.name} with path: ${currentPath || 'ROOT'}`);
    
    // 1. Check if this IP is already processed - if so, just add current path to referencedBy and skip
    if (isTargetIP) {
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] 🔍 SEARCHING FOR EXISTING IP:`);
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] Searching for procedureKey: "${rootIP.procedureKey}"`);
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] Array length: ${this.processedIPHierachyArray.length}`);
      console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] First few IPs in array:`);
      this.processedIPHierachyArray.slice(0, 5).forEach((ip, index) => {
        console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG]   [${index}] ${ip.name} -> procedureKey: "${ip.procedureKey}"`);
      });
    }
    
    const existingIPIndex = this.processedIPHierachyArray.findIndex(ip => ip.procedureKey === rootIP.procedureKey);
    if (existingIPIndex !== -1) {
      if (isTargetIP) {
        console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] ⏭️ V8_IP_OE_AddEnrichmentProduct already exists at index ${existingIPIndex}`);
        console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-DEBUG] Current referencedBy: ${JSON.stringify(this.processedIPHierachyArray[existingIPIndex].referencedBy)}`);
      }
      
      console.log(`        ⏭️ [PROCESS] IP ${rootIP.name} already exists in processedIPHierachyArray, adding current path to referencedBy`);
      
      // Add current path to the existing IP's referencedBy array
      if (!this.processedIPHierachyArray[existingIPIndex].referencedBy) {
        this.processedIPHierachyArray[existingIPIndex].referencedBy = [];
      }
      
      // 🔧 NEW: No referencedBy logic during hierarchy building - this will be handled in Phase 3 & 4
      // Just return the existing IP, references will be stamped separately
      
      // Return the existing processed IP
      return this.processedIPHierachyArray[existingIPIndex];
    }
    
    // Clone the root IP to avoid modifying the original
    const processedIP = JSON.parse(JSON.stringify(rootIP));
    
    // Initialize referencedBy array if it doesn't exist
    if (!processedIP.referencedBy) {
      processedIP.referencedBy = [];
    }
    
    // 🔧 NEW: No referencedBy logic during hierarchy building - this will be handled in Phase 3 & 4
    // Just build the structure, references will be stamped separately
    
    // If this IP has steps, process them recursively with updated path
    if (processedIP.steps && processedIP.steps.length > 0) {
      // Build the new path for child IPs: currentPath + current IP
      const newPath = currentPath ? `${currentPath}-${rootIP.procedureKey}` : rootIP.procedureKey;
      processedIP.steps = this.processStepsRecursively(processedIP.steps, originalIPArray, newPath);
    }
    
    // Mark as fully processed
    processedIP.fullyExpanded = true;
    
    // 🔧 FIX: Add this processed IP to the global array immediately
    // This ensures child IPs are available for lookup in subsequent processing
    this.processedIPHierachyArray.push(processedIP);
    
    return processedIP;
  }

  /**
   * Process steps recursively, handling child steps and grandchild steps with path tracking
   */
  processStepsRecursively(steps, originalIPArray, currentPath = '') {
    const processedSteps = [];
    
    for (const step of steps) {
      const processedStep = JSON.parse(JSON.stringify(step));
      
      // Handle child step which may contain grandchild steps like "Conditional block", "Cached Block", "Integration Procedure"
      if (step.integrationProcedureKey && step.integrationProcedureKey !== 'undefined' && step.integrationProcedureKey !== '') {
        const childIPName = step.integrationProcedureKey;
        
        // 🔥 SPECIAL DEBUG: Track when V8_IP_OE_AddEnrichmentProduct is referenced
        const isReferencingTargetIP = childIPName === 'V8_IP_OE_AddEnrichmentProduct';
        if (isReferencingTargetIP) {
          console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] ===============================================`);
          console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] V8_IP_OE_AddEnrichmentProduct is being referenced!`);
          console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] Step name: "${step.name}"`);
          console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] Step type: "${step.type}"`);
          console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] Current path: "${currentPath}"`);
          console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] ===============================================`);
        }
        
        // Check processedIPHierachyArray to see if entry for child IP already exists
        // IMPORTANT: Search by procedureKey since that's what steps reference
        let existingChildIP = this.processedIPHierachyArray.find(ip => ip.procedureKey === childIPName);
        
        if (existingChildIP) {
          // If exists, then just copy its entire structure under rootIP
          console.log(`        📋 [PROCESS] Found existing child IP: ${childIPName} (procedureKey: ${existingChildIP.procedureKey}), copying structure`);
          processedStep.childIPStructure = existingChildIP;
          processedStep.hasExpandedStructure = true;
          
          if (isReferencingTargetIP) {
            console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] 📋 V8_IP_OE_AddEnrichmentProduct already exists in processedIPHierachyArray`);
            console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] Current referencedBy: ${JSON.stringify(existingChildIP.referencedBy)}`);
          }
          
          // 🔧 NEW: No referencedBy logic during hierarchy building - this will be handled in Phase 3 & 4
          // Just copy the structure, references will be stamped separately
        } else {
          // If it does not exist, then recursively invoke processSingleIPStructure on such child IP
          console.log(`        🔄 [PROCESS] Child IP not found: ${childIPName}, processing recursively with path: ${currentPath}`);
          
          if (isReferencingTargetIP) {
            console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] 🔄 V8_IP_OE_AddEnrichmentProduct not found, will process recursively`);
          }
          
          // Find the child IP in the original array by procedureKey
          const childIP = originalIPArray.find(ip => ip.procedureKey === childIPName);
          
          if (childIP) {
            // Recursively process the child IP with the current path
            const processedChildIP = this.processSingleIPStructure(childIP, originalIPArray, currentPath);
            
            // 🔧 FIX: Use the returned object (which may be from global array) instead of creating new
            // This ensures we're working with the same object that has the updated referencedBy
            processedStep.childIPStructure = processedChildIP;
            processedStep.hasExpandedStructure = true;
            
            console.log(`        ✅ [PROCESS] Successfully processed child IP: ${childIPName} with ${processedChildIP.steps?.length || 0} steps`);
            
            if (isReferencingTargetIP) {
              console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] ✅ V8_IP_OE_AddEnrichmentProduct processed recursively`);
              console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-REFERENCE-DEBUG] Final referencedBy: ${JSON.stringify(processedChildIP.referencedBy)}`);
            }
            

          } else {
            console.warn(`        ⚠️ [PROCESS] Child IP not found in original array: ${childIPName}`);
            console.warn(`        🔍 [PROCESS] Available IPs in array: ${originalIPArray.slice(0, 5).map(ip => `${ip.name}(${ip.procedureKey})`).join(', ')}...`);
          }
        }
        

      }
      
      // Recursively process sub-steps and block steps if they exist with the same path
      if (step.subSteps && step.subSteps.length > 0) {
        processedStep.subSteps = this.processStepsRecursively(step.subSteps, originalIPArray, currentPath);
      }
      
      if (step.blockSteps && step.blockSteps.length > 0) {
        processedStep.blockSteps = this.processStepsRecursively(step.blockSteps, originalIPArray, currentPath);
      }
      
      processedSteps.push(processedStep);
    }
    
    return processedSteps;
  }

  /**
   * Build hierarchical relationships between components (legacy method - kept for compatibility)
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
   * Extract hierarchical steps with block support and IP reference path tracking
   */
  extractHierarchicalSteps(children, componentType, containerName = 'Unknown', currentProcedureKey = '') {
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

      // 🔧 FIX: Preserve the entire propSetMap for frontend access
      if (child.propSetMap) {
        step.propSetMap = child.propSetMap;
      }

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
          
          // 🔧 NEW: Add referencedBy path tracking for IP references
          if (currentProcedureKey) {
            if (!step.referencedBy) {
              step.referencedBy = [];
            }
            const referencePath = `${currentProcedureKey}-${step.integrationProcedureKey}`;
            step.referencedBy.push({
              path: referencePath,
              timestamp: new Date().toISOString(),
              type: 'ip-reference-path',
              parentIP: currentProcedureKey,
              childIP: step.integrationProcedureKey
            });
            console.log(`    ➕ [REFERENCED-BY] Added reference path "${referencePath}" to step "${step.name}"`);
          }
          
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
   * Search for omnistudio components by name (using cached data - PREFERRED METHOD)
   */
  async searchComponents(req, res) {
    try {
      if (!req.session.salesforce) {
        return res.status(401).json({ 
          success: false, 
          message: 'Not authenticated with Salesforce' 
        });
      }

      const { componentType, searchTerm = '' } = req.query;

      if (!componentType) {
        return res.status(400).json({
          success: false,
          message: 'Component type is required'
        });
      }

      // Get cached data instead of making real-time SOQL queries
      const orgId = req.session.salesforce.organizationId;
      const cachedData = this.orgComponentsDataCache.get(orgId);
      
      if (!cachedData) {
        return res.status(404).json({
          success: false,
          message: 'No cached component data found. Please load components first.'
        });
      }

      let instances = [];

      switch (componentType) {
        case 'integration-procedure':
          // Search in cached integration procedures by BOTH name AND procedureKey for flexibility
          instances = cachedData.integrationProcedures
            .filter(ip => {
              if (!searchTerm) return true;
              const searchLower = searchTerm.toLowerCase();
              const nameMatch = ip.name && ip.name.toLowerCase().includes(searchLower);
              const procedureKeyMatch = ip.procedureKey && ip.procedureKey.toLowerCase().includes(searchLower);
              return nameMatch || procedureKeyMatch;
            })
            .map(ip => ({
              id: ip.id,
              name: ip.name,
              uniqueId: ip.uniqueId,
              type: ip.type,
              subtype: ip.subType,
              procedureKey: ip.procedureKey,
              version: ip.version,
              componentType: 'integration-procedure'
            }))
            .slice(0, 1000); // Limit results
          break;

        case 'omniscript':
          // Search in cached omniscripts
          instances = cachedData.omniscripts
            .filter(os => !searchTerm || os.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .map(os => ({
              id: os.id,
              name: os.name,
              uniqueId: os.uniqueId,
              type: os.type,
              subtype: os.subType,
              version: os.version,
              componentType: 'omniscript'
            }))
            .slice(0, 1000); // Limit results
          break;

        case 'data-mapper':
          // Search in cached data mappers
          instances = cachedData.dataMappers
            .filter(dm => !searchTerm || dm.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .map(dm => ({
              id: dm.id,
              name: dm.name,
              uniqueId: dm.uniqueId,
              type: dm.type,
              version: dm.version,
              componentType: 'data-mapper'
            }))
            .slice(0, 1000); // Limit results
          break;

        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid component type'
          });
      }

      // 🔧 FIX: Deduplicate results to prevent duplicate records
      if (componentType === 'integration-procedure') {
        const uniqueInstances = [];
        const seenProcedureKeys = new Set();
        
        instances.forEach(ip => {
          if (!seenProcedureKeys.has(ip.procedureKey)) {
            seenProcedureKeys.add(ip.procedureKey);
            uniqueInstances.push(ip);
          } else {
            console.log(`⚠️ [SEARCH-DEDUP] Skipping duplicate IP with procedureKey: "${ip.procedureKey}"`);
          }
        });
        
        instances = uniqueInstances;
        console.log(`🔧 [SEARCH-DEDUP] Deduplicated from ${instances.length + seenProcedureKeys.size - uniqueInstances.length} to ${uniqueInstances.length} unique IPs`);
      } else if (componentType === 'omniscript') {
        const uniqueInstances = [];
        const seenNames = new Set();
        
        instances.forEach(os => {
          if (!seenNames.has(os.name)) {
            seenNames.add(os.name);
            uniqueInstances.push(os);
          } else {
            console.log(`⚠️ [SEARCH-DEDUP] Skipping duplicate OmniScript with name: "${os.name}"`);
          }
        });
        
        instances = uniqueInstances;
        console.log(`🔧 [SEARCH-DEDUP] Deduplicated from ${instances.length + seenNames.size - uniqueInstances.length} to ${uniqueInstances.length} unique OmniScripts`);
      }
      
      console.log(`✅ [OMNISTUDIO] Search completed: Found ${instances.length} ${componentType} components in cached data`);
      
      // Debug: Log what we found for integration procedures
      if (componentType === 'integration-procedure' && searchTerm) {
        console.log(`🔍 [SEARCH-DEBUG] Searching by name OR procedureKey: "${searchTerm}"`);
        console.log(`🔍 [SEARCH-DEBUG] Found ${instances.length} IPs:`);
        instances.forEach((ip, idx) => {
          console.log(`  [${idx + 1}] Name: "${ip.name}", ProcedureKey: "${ip.procedureKey}"`);
        });
      }

      res.json({
        success: true,
        instances,
        searchTerm,
        componentType,
        totalFound: instances.length,
        fromCache: true
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

      // 🔧 FIX: Preserve the entire propSetMap for frontend access
      if (child.propSetMap) {
        step.propSetMap = child.propSetMap;
      }

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
   * Extract hierarchical steps with block support and IP reference path tracking
   */
  extractHierarchicalSteps(children, componentType, containerName = 'Unknown', currentProcedureKey = '') {
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

      // 🔧 FIX: Preserve the entire propSetMap for frontend access
      if (child.propSetMap) {
        step.propSetMap = child.propSetMap;
      }

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
          
          // 🔧 NEW: Add referencedBy path tracking for IP references
          if (currentProcedureKey) {
            if (!step.referencedBy) {
              step.referencedBy = [];
            }
            const referencePath = `${currentProcedureKey}-${step.integrationProcedureKey}`;
            step.referencedBy.push({
              path: referencePath,
              timestamp: new Date().toISOString(),
              type: 'ip-reference-path',
              parentIP: currentProcedureKey,
              childIP: step.integrationProcedureKey
            });
            console.log(`    ➕ [REFERENCED-BY] Added reference path "${referencePath}" to step "${step.name}"`);
          }
          
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
      const childIP = this.processComponentRecord(record, 'integration-procedure', ipName);
      
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
      const component = this.processComponentRecord(record, componentType, instanceName);
      
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
   * IMPLEMENTATION OF THE RECURSIVE ALGORITHM AS INSTRUCTED
   */
  buildFullIPHierarchy(originalIPArray) {
    console.log(`🚀 [ALGORITHM] Starting recursive IP hierarchy building for ${originalIPArray.length} IPs`);
    
    // Initialize the processed IP hierarchy array as a global static variable
    // Always reset for a fresh build to prevent duplication
    this.processedIPHierachyArray = [];
    console.log(`🔄 [ALGORITHM] Reset processedIPHierachyArray for fresh build`);
    
    // Iterate through originalIPArray
    for (let i = 0; i < originalIPArray.length; i++) {
      const rootIP = originalIPArray[i];
      if (i % 50 === 0 || i === originalIPArray.length - 1) {
        console.log(`⚡ [ALGORITHM] Processing IP ${i + 1}/${originalIPArray.length}: ${rootIP.name}`);
      }
      
      // Process single IP structure recursively with initial path (root IP)
      // 🔧 NEW: No referencedBy logic during hierarchy building - just build the structure
      const processedIP = this.processSingleIPStructure(rootIP, originalIPArray, rootIP.procedureKey);
      
      // 🔒 SAFEGUARD: Check for duplicates before adding
      const existingIndex = this.processedIPHierachyArray.findIndex(ip => 
        ip.procedureKey === processedIP.procedureKey || 
        ip.id === processedIP.id
      );
      
      if (existingIndex === -1) {
        this.processedIPHierachyArray.push(processedIP);
        console.log(`✅ [ALGORITHM] Added IP: ${processedIP.name} (${processedIP.procedureKey})`);
      } else {
        console.log(`⚠️ [ALGORITHM] Skipped duplicate IP: ${processedIP.name} (${processedIP.procedureKey}) - already exists at index ${existingIndex}`);
      }
    }
    
    console.log(`✅ [ALGORITHM] Completed recursive hierarchy building for ${this.processedIPHierachyArray.length} IPs`);
    
    // 🔒 FINAL SAFEGUARD: Remove any duplicates that might have slipped through
    const uniqueIPs = [];
    const seenKeys = new Set();
    let duplicatesRemoved = 0;
    
    this.processedIPHierachyArray.forEach(ip => {
      const key = ip.procedureKey || ip.id;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueIPs.push(ip);
      } else {
        duplicatesRemoved++;
        console.log(`⚠️ [ALGORITHM] Removed duplicate IP: ${ip.name} (${key})`);
      }
    });
    
    if (duplicatesRemoved > 0) {
      console.log(`🔒 [ALGORITHM] Final deduplication: Removed ${duplicatesRemoved} duplicates`);
      this.processedIPHierachyArray = uniqueIPs;
    }
    
    console.log(`✅ [ALGORITHM] Final result: ${this.processedIPHierachyArray.length} unique IPs`);
    
    // 🔧 NEW: Decoupled reference path stamping - Phase 3 & 4
    console.log('🔗 [REFERENCE-STAMPING] Starting decoupled reference path stamping...');
    this.stampAllIPReferencePaths();
    this.stampAllOmniScriptReferencePaths();
    
    return this.processedIPHierachyArray;
  }

  /**
   * 🔧 NEW: Decoupled IP reference path stamping - Phase 3
   * This method iterates all IPs and recursively processes each child + descendants
   * Stamping reference paths within global array for every encountered child IP at any level
   */
  stampAllIPReferencePaths() {
    console.log(`🔗 [REFERENCE-STAMPING] Phase 3: Stamping reference paths for all IPs and their descendants...`);
    
    let totalPathsStamped = 0;
    
    // Iterate through all IPs in the global array
    this.processedIPHierachyArray.forEach(rootIP => {
      if (!rootIP.steps || rootIP.steps.length === 0) return;
      
      // Recursively process this IP's steps and stamp reference paths
      const pathsStamped = this.stampIPReferencePathsRecursively(rootIP.steps, rootIP.procedureKey, rootIP.procedureKey);
      totalPathsStamped += pathsStamped;
      
      if (pathsStamped > 0) {
        console.log(`🔗 [REFERENCE-STAMPING] Stamped ${pathsStamped} reference paths for IP: ${rootIP.name}`);
      }
    });
    
    console.log(`✅ [REFERENCE-STAMPING] Phase 3 Complete: Stamped ${totalPathsStamped} reference paths across all IPs`);
  }

  /**
   * 🔧 NEW: Recursively stamp reference paths for IP steps and their descendants
   * This method processes every step and stamps reference paths for every child IP encountered
   */
  stampIPReferencePathsRecursively(steps, currentIPKey, currentPath) {
    let pathsStamped = 0;
    
    steps.forEach(step => {
      // Check for direct IP references
      if (step.integrationProcedureKey && step.integrationProcedureKey !== 'undefined' && step.integrationProcedureKey !== '') {
        const childIPKey = step.integrationProcedureKey;
        
        // Find the child IP in the global array
        const childIP = this.processedIPHierachyArray.find(ip => ip.procedureKey === childIPKey);
        
        if (childIP) {
          // Initialize referencedBy array if it doesn't exist
          if (!childIP.referencedBy) {
            childIP.referencedBy = [];
          }
          
          // Build the reference path: Current Path -> Child IP
          const referencePath = `${currentPath}-${childIPKey}`;
          
          // Check if this reference path already exists
          const pathExists = childIP.referencedBy.some(ref => ref.path === referencePath);
          
          if (!pathExists) {
            // Stamp the reference path
            childIP.referencedBy.push({
              path: referencePath,
              timestamp: new Date().toISOString(),
              type: 'hierarchical-reference',
              referencingIP: currentPath, // 🔧 FIX: Show full hierarchical path, not just direct parent
              stepName: step.name,
              stepType: step.type
            });
            
            pathsStamped++;
            
            // Special logging for our target IP
            if (childIP.procedureKey === 'V8_IP_OE_AddEnrichmentProduct') {
              console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-STAMP] ➕ Stamped path: ${referencePath} from ${currentIPKey}`);
            }
          }
          
          // Recursively process the child IP's steps with the new path
          if (childIP.steps && childIP.steps.length > 0) {
            const childPathsStamped = this.stampIPReferencePathsRecursively(
              childIP.steps, 
              childIPKey, 
              referencePath
            );
            pathsStamped += childPathsStamped;
          }
        }
      }
      
      // Recursively process sub-steps
      if (step.subSteps && step.subSteps.length > 0) {
        const subPathsStamped = this.stampIPReferencePathsRecursively(
          step.subSteps, 
          currentIPKey, 
          currentPath
        );
        pathsStamped += subPathsStamped;
      }
      
      // Recursively process block steps
      if (step.blockSteps && step.blockSteps.length > 0) {
        const blockPathsStamped = this.stampIPReferencePathsRecursively(
          step.blockSteps, 
          currentIPKey, 
          currentPath
        );
        pathsStamped += blockPathsStamped;
      }
      
      // Recursively process child IP structures
      if (step.childIPStructure && step.childIPStructure.steps) {
        const childPathsStamped = this.stampIPReferencePathsRecursively(
          step.childIPStructure.steps, 
          currentIPKey, 
          currentPath
        );
        pathsStamped += childPathsStamped;
      }
    });
    
    return pathsStamped;
  }

  /**
   * 🔧 NEW: Decoupled OmniScript reference path stamping - Phase 4
   * This method iterates all OmniScripts and recursively processes each child + descendants
   * Stamping reference paths within global array for every encountered child IP/OS at any level
   */
  stampAllOmniScriptReferencePaths() {
    console.log(`🔗 [REFERENCE-STAMPING] Phase 4: Stamping reference paths for all OmniScripts and their descendants...`);
    
    // Get the current org's cached data to access OmniScripts
    const orgIds = Array.from(this.orgComponentsDataCache.keys());
    if (orgIds.length === 0) {
      console.log('⚠️ [REFERENCE-STAMPING] No org data found, skipping OmniScript analysis');
      return;
    }
    
    const orgId = orgIds[0]; // Use the first org for now
    const orgData = this.orgComponentsDataCache.get(orgId);
    
    if (!orgData || !orgData.omniscripts) {
      console.log('⚠️ [REFERENCE-STAMPING] No OmniScript data found, skipping analysis');
      return;
    }
    
    let totalPathsStamped = 0;
    
    // Iterate through all OmniScripts
    orgData.omniscripts.forEach(omniscript => {
      if (!omniscript.steps || omniscript.steps.length === 0) return;
      
      // Recursively process this OmniScript's steps and stamp reference paths
      const pathsStamped = this.stampOmniScriptReferencePathsRecursively(
        omniscript.steps, 
        omniscript.name, 
        omniscript.name
      );
      totalPathsStamped += pathsStamped;
      
      if (pathsStamped > 0) {
        console.log(`🔗 [REFERENCE-STAMPING] Stamped ${pathsStamped} reference paths for OmniScript: ${omniscript.name}`);
      }
    });
    
    console.log(`✅ [REFERENCE-STAMPING] Phase 4 Complete: Stamped ${totalPathsStamped} reference paths across all OmniScripts`);
  }

  /**
   * 🔧 NEW: Recursively stamp reference paths for OmniScript steps and their descendants
   * This method processes every step and stamps reference paths for every child IP/OS encountered
   */
  stampOmniScriptReferencePathsRecursively(steps, currentOmniScriptName, currentPath) {
    let pathsStamped = 0;
    
    steps.forEach(step => {
      // Check for IP references
      if (step.integrationProcedureKey && step.integrationProcedureKey !== 'undefined' && step.integrationProcedureKey !== '') {
        const childIPKey = step.integrationProcedureKey;
        
        // Find the child IP in the global array
        const childIP = this.processedIPHierachyArray.find(ip => ip.procedureKey === childIPKey);
        
        if (childIP) {
          // Initialize referencedBy array if it doesn't exist
          if (!childIP.referencedBy) {
            childIP.referencedBy = [];
          }
          
          // Build the reference path: OmniScript -> Child IP
          const referencePath = `${currentPath}-${childIPKey}`;
          
          // Check if this reference path already exists
          const pathExists = childIP.referencedBy.some(ref => ref.path === referencePath);
          
          if (!pathExists) {
            // Stamp the reference path
            childIP.referencedBy.push({
              path: referencePath,
              timestamp: new Date().toISOString(),
              type: 'omniscript-reference',
              referencingOmniScript: currentPath, // 🔧 FIX: Show full hierarchical path, not just OmniScript name
              stepName: step.name,
              stepType: step.type
            });
            
            pathsStamped++;
            
            // Special logging for our target IP
            if (childIP.procedureKey === 'V8_IP_OE_AddEnrichmentProduct') {
              console.log(`🔥 [V8_IP_OE_AddEnrichmentProduct-STAMP] ➕ Stamped OmniScript path: ${referencePath} from ${currentOmniScriptName}`);
            }
          }
          
          // Recursively process the child IP's steps with the new path
          if (childIP.steps && childIP.steps.length > 0) {
            const childPathsStamped = this.stampIPReferencePathsRecursively(
              childIP.steps, 
              childIPKey, 
              referencePath
            );
            pathsStamped += childPathsStamped;
          }
        }
      }
      
      // Recursively process sub-steps
      if (step.subSteps && step.subSteps.length > 0) {
        const subPathsStamped = this.stampOmniScriptReferencePathsRecursively(
          step.subSteps, 
          currentOmniScriptName, 
          currentPath
        );
        pathsStamped += subPathsStamped;
      }
      
      // Recursively process block steps
      if (step.blockSteps && step.blockSteps.length > 0) {
        const blockPathsStamped = this.stampOmniScriptReferencePathsRecursively(
          step.blockSteps, 
          currentOmniScriptName, 
          currentPath
        );
        pathsStamped += blockPathsStamped;
      }
    });
    
    return pathsStamped;
  }

  /**
   * STUB: This method should not be called anymore
   */
  async recursivelyExpandChildIPs(integrationProcedures, req) {
    console.log(`🚫 [STUB] recursivelyExpandChildIPs called - this should not happen!`);
    console.log(`🚫 [STUB] Returning original components without modification`);
    return integrationProcedures;
  }

  /**
   * STUB: This method should not be called anymore
   */
  async expandSingleIPRecursively(ip, req, processedIPs, depth = 0, sharedIPCache = new Map()) {
    console.log(`🚫 [STUB] expandSingleIPRecursively called - this should not happen!`);
    console.log(`🚫 [STUB] Returning original IP without modification`);
    return ip;
  }

  /**
   * STUB: This method should not be called anymore
   */
  async expandStepsRecursively(steps, req, processedIPs, depth, contextType = 'ip', sharedIPCache = new Map()) {
    console.log(`🚫 [STUB] expandStepsRecursively called - this should not happen!`);
    console.log(`🚫 [STUB] Returning original steps without modification`);
    return steps;
  }

  /**
   * STUB: This method should not be called anymore
   */
  async recursivelyExpandOmniScripts(omniscripts, req) {
    console.log(`🚫 [STUB] recursivelyExpandOmniScripts called - this should not happen!`);
    console.log(`🚫 [STUB] Returning original components without modification`);
    return omniscripts;
  }

  /**
   * STUB: This method should not be called anymore
   */
  async expandSingleOmniScriptRecursively(omniscript, req, processedOmniScripts, depth = 0, sharedIPCache = new Map()) {
    console.log(`🚫 [STUB] expandSingleOmniScriptRecursively called - this should not happen!`);
    console.log(`🚫 [STUB] Returning original OmniScript without modification`);
    return omniscript;
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

      // Find the component by name OR procedureKey (for Integration Procedures)
      if (componentType === 'integration-procedure') {
        // For IPs, search by both name AND procedureKey to handle URL mismatches
        component = componentArray.find(comp => 
          comp.name.toLowerCase() === instanceName.toLowerCase() ||
          (comp.procedureKey && comp.procedureKey.toLowerCase() === instanceName.toLowerCase())
        );
        
        if (component) {
          console.log(`🔍 [CACHED-COMPONENT] Found IP "${instanceName}" by ${component.name.toLowerCase() === instanceName.toLowerCase() ? 'name' : 'procedureKey'}`);
        }
      } else {
        // For other components, search by name only
        component = componentArray.find(comp => 
          comp.name.toLowerCase() === instanceName.toLowerCase()
        );
      }

      if (!component) {
        let errorMessage = `Component "${instanceName}" not found in cached data`;
        
        if (componentType === 'integration-procedure') {
          errorMessage += `. Searched by both name and procedureKey. Available IPs: ${componentArray.slice(0, 5).map(ip => `${ip.name}(${ip.procedureKey})`).join(', ')}...`;
        }
        
        return res.status(404).json({
          success: false,
          message: errorMessage
        });
      }

      console.log(`📦 [CACHED-COMPONENT] Serving ${componentType} "${instanceName}" from cache with ${component.steps?.length || 0} steps`);
      
      // Always apply our algorithm to expand child IPs for components that have IP references
      let expandedComponent = component;
      if (component.steps && component.steps.length > 0) {
        // Check if this component has any IP references that need expansion
        const hasIPReferences = component.steps.some(step => 
          step.integrationProcedureKey && step.integrationProcedureKey !== 'undefined' && step.integrationProcedureKey !== ''
        );
        
        if (hasIPReferences) {
          console.log(`🔄 [CACHED-COMPONENT] Applying recursive algorithm to expand child IPs for "${instanceName}"`);
          
          // Get the global data to find child IPs
          const globalData = this.orgComponentsDataCache.get(req.session.salesforce.organizationId);
          if (globalData && globalData.integrationProcedures) {
            if (componentType === 'integration-procedure') {
              // For Integration Procedures, find the already processed IP from the cache
              // NO NEED to call buildFullIPHierarchy again - it's already been processed!
              const existingIP = globalData.integrationProcedures.find(ip => 
                ip.id === component.id || 
                ip.name === component.name || 
                (component.procedureKey && ip.procedureKey === component.procedureKey)
              );
              if (existingIP) {
                expandedComponent = existingIP;
                console.log(`✅ [CACHED-COMPONENT] Found existing processed IP "${instanceName}" in cache (no re-processing needed)`);
              }
            } else if (componentType === 'omniscript') {
              // For Omniscripts, we don't need IP hierarchy building - they reference IPs but don't build IP hierarchies
              console.log(`🔄 [CACHED-COMPONENT] Processing Omniscript "${instanceName}" - no IP hierarchy building needed`);
              
              // OmniScripts can reference IPs but don't need to go through IP hierarchy building
              // The child IP references are already available in the steps
              expandedComponent = component;
              console.log(`✅ [CACHED-COMPONENT] Omniscript "${instanceName}" processed without IP hierarchy building`);
            }
          }
        }
      }
      
      // Check if component has fully expanded child IPs
      const hasExpandedChildren = expandedComponent.steps?.some(step => 
        (step.blockType === 'ip-reference' && step.hasExpandedStructure) ||
        (step.integrationProcedureKey && step.hasExpandedStructure)
      ) || false;

      // FRONTEND COMPATIBILITY: Transform cached data to match expected frontend format
      const transformedComponent = {
        id: expandedComponent.id,
        name: expandedComponent.name,
        componentType: componentType,
        componentName: expandedComponent.name,
        
        // Add summary object in expected format
        summary: {
          id: expandedComponent.id,
          name: expandedComponent.name,
          type: expandedComponent.type,
          subType: expandedComponent.subType,
          version: expandedComponent.version,
          language: expandedComponent.language || 'en_US',
          isActive: expandedComponent.isActive || true,
          childrenCount: expandedComponent.steps?.length || 0,
          steps: expandedComponent.steps || [],  // ← This is what frontend expects
          hierarchy: [],
          blockStructure: null
        },
        
        // Add expanded child IP structures to the main component for frontend access
        expandedSteps: expandedComponent.steps?.map(step => {
          console.log(`🔍 [DEBUG] Processing step: ${step.name}`);
          console.log(`  - hasExpandedStructure: ${step.hasExpandedStructure}`);
          console.log(`  - has childIPStructure: ${!!step.childIPStructure}`);
          console.log(`  - integrationProcedureKey: ${step.integrationProcedureKey}`);
          console.log(`  - step keys: ${Object.keys(step).join(', ')}`);
          
          if (step.hasExpandedStructure && step.childIPStructure) {
            console.log(`✅ [DEBUG] Step ${step.name} has expanded structure: ${step.childIPStructure.name}`);
            // Return step as-is - childIPStructure already contains all the needed data
            return step;
          }
          return step;
        }) || expandedComponent.steps || [],
        
        // Keep original data for compatibility
        ...expandedComponent
      };

      res.json({
        success: true,
        component: transformedComponent,
        fromCache: true,
        fullyExpanded: component.fullyExpanded || hasExpandedChildren,
        expandedChildrenCount: this.countExpandedChildren(expandedComponent),
        message: hasExpandedChildren ? 
          'Component served from cache with fully expanded child IP hierarchy' : 
          'Component served from cache (no child IP hierarchy expanded)'
      });
    } catch (error) {
      console.error(`❌ [CACHED-COMPONENT] Error serving cached component:`, error);
      res.status(500).json({
        success: false,
        message: 'Failed to serve cached component: ' + error.message
      });
    }
  }

  /**
   * Count expanded children in a component
   */
  countExpandedChildren(component) {
    if (!component.steps || component.steps.length === 0) {
      return 0;
    }

    let count = 0;
    
    const countInSteps = (steps) => {
      steps.forEach(step => {
        // Check for our new algorithm's expanded structure
        if (step.hasExpandedStructure && step.childIPStructure) {
          count++;
          // Recursively count children of children
          if (step.childIPStructure.steps && step.childIPStructure.steps.length > 0) {
            countInSteps(step.childIPStructure.steps);
          }
        }
        // Also check for legacy format for backward compatibility
        else if (step.hasChildComponent && step.childHierarchy) {
          count++;
          if (step.childHierarchy.steps && step.childHierarchy.steps.length > 0) {
            countInSteps(step.childHierarchy.steps);
          }
        }
      });
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
      const childIP = this.processComponentRecord(record, 'integration-procedure', ipName);
      
      console.log(`✅ [RECURSIVE-EXPANSION] Successfully loaded child IP: ${ipName} with ${childIP.steps?.length || 0} steps`);
      return childIP;
      
    } catch (error) {
      console.error(`❌ [RECURSIVE-EXPANSION] Error loading child IP ${ipName}:`, error.message);
      return null;
    }
  }
}

module.exports = OmnistudioModule;

