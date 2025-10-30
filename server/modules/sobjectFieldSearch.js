const jsforce = require('jsforce');
const RedisModule = require('./redis');

class SObjectFieldSearchModule {
  constructor() {
    this.redisModule = new RedisModule();
    this.CACHE_KEY_PREFIX = 'sobject_field_metadata:';
    this.CACHE_EXPIRY = 86400; // 24 hours in seconds
  }

  /**
   * Create Salesforce connection from session
   */
  createConnection(req) {
    return new jsforce.Connection({
      oauth2: req.session.oauth2,
      accessToken: req.session.salesforce.accessToken,
      instanceUrl: req.session.salesforce.instanceUrl,
      version: '65.0'
    });
  }

  /**
   * Get org-specific cache key
   */
  getOrgCacheKey(orgId) {
    return `${this.CACHE_KEY_PREFIX}${orgId}`;
  }

  /**
   * Check if SObject should be excluded based on suffix
   */
  shouldExcludeSObject(sobjectName) {
    const name = sobjectName.toLowerCase();
    const excludedSuffixes = [
      'share',
      'changeevent',
      'history',
      'feed',
      'sharingrule',
      '__tag',
      '__history',
      '__share'
    ];
    
    return excludedSuffixes.some(suffix => name.endsWith(suffix));
  }

  /**
   * Check if field is a system default field to be excluded
   */
  isSystemDefaultField(fieldName) {
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
  }

  /**
   * Clean field data by removing default/zero values
   */
  cleanFieldData(field) {
    const cleanedField = {
      name: field.name,
      label: field.label,
      type: field.type
    };

    // Only include custom if true
    if (field.custom) {
      cleanedField.custom = field.custom;
    }

    // Only include length if > 0
    if (field.length && field.length > 0) {
      cleanedField.length = field.length;
    }

    // Only include precision if > 0
    if (field.precision && field.precision > 0) {
      cleanedField.precision = field.precision;
    }

    // Only include scale if > 0
    if (field.scale && field.scale > 0) {
      cleanedField.scale = field.scale;
    }

    return cleanedField;
  }

  /**
   * Build and cache all SObject field metadata for an org
   */
  async buildFieldMetadataCache(req, res) {
    try {
      const conn = this.createConnection(req);
      const orgId = req.session.salesforce.organizationId;
      
      console.log(`🔧 [FIELD_SEARCH] Building field metadata cache for org: ${orgId}`);
      
      // Get all SObjects
      const globalDescribe = await conn.describeGlobal();
      const queryableSObjects = globalDescribe.sobjects.filter(obj => {
        return obj.queryable && !this.shouldExcludeSObject(obj.name);
      });

      console.log(`📊 [FIELD_SEARCH] Found ${queryableSObjects.length} queryable SObjects (after filtering)`);

      const metadataCache = {};
      let processedCount = 0;
      let errorCount = 0;

      // Process SObjects in batches to avoid overwhelming the API
      const batchSize = 5;
      for (let i = 0; i < queryableSObjects.length; i += batchSize) {
        const batch = queryableSObjects.slice(i, i + batchSize);
        
        // Process batch in parallel
        await Promise.all(batch.map(async (sobject) => {
          try {
            const describe = await conn.sobject(sobject.name).describe();
            
            // Filter out system default fields and clean field data
            const filteredFields = describe.fields
              .filter(field => !this.isSystemDefaultField(field.name))
              .map(field => this.cleanFieldData(field));
            
            // Store minimal field metadata
            metadataCache[sobject.name] = {
              name: sobject.name,
              label: sobject.label,
              labelPlural: sobject.labelPlural,
              keyPrefix: sobject.keyPrefix,
              custom: sobject.custom,
              fields: filteredFields
            };
            
            processedCount++;
            
            if (processedCount % 10 === 0) {
              console.log(`📦 [FIELD_SEARCH] Progress: ${processedCount}/${queryableSObjects.length} SObjects processed`);
            }
          } catch (error) {
            errorCount++;
            console.warn(`⚠️ [FIELD_SEARCH] Failed to describe ${sobject.name}:`, error.message);
          }
        }));

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < queryableSObjects.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      console.log(`✅ [FIELD_SEARCH] Cache build complete. Processed: ${processedCount}, Errors: ${errorCount}`);
      console.log(`🔧 [FIELD_SEARCH] System fields filtered, optimized field data stored`);

      // Store in Redis
      const cacheKey = this.getOrgCacheKey(orgId);
      const cacheData = {
        metadata: metadataCache,
        cachedAt: new Date().toISOString(),
        sobjectCount: processedCount,
        optimized: true,
        excludedSystemFields: [
          'Id', 'IsDeleted', 'Name', 'CreatedDate', 'CreatedById',
          'LastModifiedDate', 'LastModifiedById', 'SystemModstamp',
          'LastViewedDate', 'LastReferencedDate'
        ]
      };

      await this.redisModule.set(cacheKey, JSON.stringify(cacheData), this.CACHE_EXPIRY);

      console.log(`💾 [FIELD_SEARCH] Cached ${processedCount} SObjects for org ${orgId}`);

      res.json({
        success: true,
        message: 'Field metadata cache built successfully',
        sobjectCount: processedCount,
        errorCount: errorCount,
        cachedAt: cacheData.cachedAt
      });
    } catch (error) {
      console.error('❌ [FIELD_SEARCH] Error building field metadata cache:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to build field metadata cache: ' + error.message
      });
    }
  }

  /**
   * Get cached field metadata for an org
   */
  async getCachedMetadata(orgId) {
    try {
      const cacheKey = this.getOrgCacheKey(orgId);
      const cachedData = await this.redisModule.get(cacheKey);
      
      if (!cachedData) {
        return null;
      }

      return JSON.parse(cachedData);
    } catch (error) {
      console.error('❌ [FIELD_SEARCH] Error retrieving cached metadata:', error);
      return null;
    }
  }

  /**
   * Check cache status
   */
  async getCacheStatus(req, res) {
    try {
      const orgId = req.session.salesforce.organizationId;
      const cachedData = await this.getCachedMetadata(orgId);

      if (!cachedData) {
        return res.json({
          success: true,
          cached: false,
          message: 'No cache found for this org'
        });
      }

      res.json({
        success: true,
        cached: true,
        sobjectCount: cachedData.sobjectCount,
        cachedAt: cachedData.cachedAt
      });
    } catch (error) {
      console.error('❌ [FIELD_SEARCH] Error checking cache status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check cache status: ' + error.message
      });
    }
  }

  /**
   * Search SObjects by field name using cached metadata
   */
  async searchByFieldName(req, res) {
    try {
      const { query } = req.query;
      const orgId = req.session.salesforce.organizationId;

      if (!query || query.trim().length < 2) {
        return res.json({
          success: true,
          sobjects: [],
          message: 'Query must be at least 2 characters'
        });
      }

      console.log(`🔍 [FIELD_SEARCH] Searching for fields matching: "${query}"`);

      // Get cached metadata
      const cachedData = await this.getCachedMetadata(orgId);

      if (!cachedData) {
        return res.json({
          success: false,
          message: 'Field metadata cache not found. Please build cache first.',
          cacheRequired: true
        });
      }

      const searchPattern = query.trim().toLowerCase();
      const matchingSObjects = [];

      // Search through cached metadata
      Object.values(cachedData.metadata).forEach(sobject => {
        const matchingFields = sobject.fields.filter(field =>
          field.name.toLowerCase().includes(searchPattern) ||
          field.label.toLowerCase().includes(searchPattern)
        );

        if (matchingFields.length > 0) {
          matchingSObjects.push({
            name: sobject.name,
            label: sobject.label,
            labelPlural: sobject.labelPlural,
            keyPrefix: sobject.keyPrefix,
            custom: sobject.custom,
            matchingFields: matchingFields.slice(0, 10), // Limit to 10 fields per object
            matchCount: matchingFields.length
          });
        }
      });

      // Sort by relevance: exact matches first, then by match count
      matchingSObjects.sort((a, b) => {
        // Check for exact field name matches
        const aExactMatch = a.matchingFields.some(f => 
          f.name.toLowerCase() === searchPattern || 
          f.label.toLowerCase() === searchPattern
        );
        const bExactMatch = b.matchingFields.some(f => 
          f.name.toLowerCase() === searchPattern || 
          f.label.toLowerCase() === searchPattern
        );

        if (aExactMatch && !bExactMatch) return -1;
        if (!aExactMatch && bExactMatch) return 1;

        // Then by match count
        return b.matchCount - a.matchCount;
      });

      console.log(`✅ [FIELD_SEARCH] Found ${matchingSObjects.length} SObjects with matching fields`);

      res.json({
        success: true,
        sobjects: matchingSObjects.slice(0, 100), // Limit to 100 results
        totalMatches: matchingSObjects.length,
        searchQuery: query,
        cachedAt: cachedData.cachedAt
      });
    } catch (error) {
      console.error('❌ [FIELD_SEARCH] Error searching by field name:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search by field name: ' + error.message
      });
    }
  }

  /**
   * Clear cache for an org
   */
  async clearCache(req, res) {
    try {
      const orgId = req.session.salesforce.organizationId;
      const cacheKey = this.getOrgCacheKey(orgId);
      
      await this.redisModule.delete(cacheKey);
      
      console.log(`🗑️ [FIELD_SEARCH] Cache cleared for org ${orgId}`);
      
      res.json({
        success: true,
        message: 'Cache cleared successfully'
      });
    } catch (error) {
      console.error('❌ [FIELD_SEARCH] Error clearing cache:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to clear cache: ' + error.message
      });
    }
  }

  /**
   * Get detailed cache data for admin viewing
   */
  async getCacheData(req, res) {
    try {
      const orgId = req.session.salesforce.organizationId;
      const cachedData = await this.getCachedMetadata(orgId);

      if (!cachedData) {
        return res.json({
          success: true,
          data: {
            cached: false,
            message: 'No cache found for this organization'
          }
        });
      }

      // Calculate statistics
      const sobjects = Object.values(cachedData.metadata);
      const totalFields = sobjects.reduce((sum, obj) => sum + obj.fields.length, 0);
      const customSObjects = sobjects.filter(obj => obj.custom).length;
      const standardSObjects = sobjects.length - customSObjects;
      
      // Field type distribution
      const fieldTypes = {};
      sobjects.forEach(obj => {
        obj.fields.forEach(field => {
          fieldTypes[field.type] = (fieldTypes[field.type] || 0) + 1;
        });
      });

      // Calculate cache size
      const cacheString = JSON.stringify(cachedData);
      const cacheSizeBytes = Buffer.byteLength(cacheString, 'utf8');
      const cacheSizeKB = (cacheSizeBytes / 1024).toFixed(2);
      const cacheSizeMB = (cacheSizeBytes / (1024 * 1024)).toFixed(2);

      res.json({
        success: true,
        data: {
          cached: true,
          orgId: orgId,
          cachedAt: cachedData.cachedAt,
          sobjectCount: cachedData.sobjectCount,
          statistics: {
            totalSObjects: sobjects.length,
            customSObjects: customSObjects,
            standardSObjects: standardSObjects,
            totalFields: totalFields,
            averageFieldsPerObject: Math.round(totalFields / sobjects.length),
            fieldTypeDistribution: fieldTypes,
            cacheSize: {
              bytes: cacheSizeBytes,
              kb: cacheSizeKB,
              mb: cacheSizeMB,
              formatted: cacheSizeMB > 1 ? `${cacheSizeMB} MB` : `${cacheSizeKB} KB`
            }
          },
          metadata: cachedData.metadata,
          fullCache: cachedData
        }
      });
    } catch (error) {
      console.error('❌ [FIELD_SEARCH] Error retrieving cache data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve cache data: ' + error.message
      });
    }
  }
}

module.exports = SObjectFieldSearchModule;

