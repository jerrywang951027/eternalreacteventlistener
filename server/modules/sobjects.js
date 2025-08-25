const jsforce = require('jsforce');

class SObjectsModule {
  constructor() {
    // No more global connection storage
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

  /**
   * Search for SObjects by name or label
   */
  async searchSObjects(req, res) {
    try {
      const { query } = req.query;
      
      if (!query || query.trim().length === 0) {
        return res.json({ success: true, sobjects: [] });
      }

      const conn = this.createConnection(req);

      // Search for SObjects by name (case-insensitive prefix match)
      const searchPattern = query.trim().toLowerCase();
      
      // Get all SObjects first, then filter
      const describe = await conn.describeGlobal();
      const matchingSObjects = describe.sobjects
        .filter(sobject => 
          sobject.name.toLowerCase().startsWith(searchPattern) ||
          sobject.name.toLowerCase().includes(searchPattern) ||
          (sobject.label && sobject.label.toLowerCase().includes(searchPattern))
        )
        .sort((a, b) => {
          // Prioritize exact prefix matches
          const aStartsWith = a.name.toLowerCase().startsWith(searchPattern);
          const bStartsWith = b.name.toLowerCase().startsWith(searchPattern);
          
          if (aStartsWith && !bStartsWith) return -1;
          if (!aStartsWith && bStartsWith) return 1;
          
          // Then sort alphabetically
          return a.name.localeCompare(b.name);
        })
        .slice(0, 20); // Limit to top 20 results for performance

      res.json({
        success: true,
        sobjects: matchingSObjects.map(sobject => ({
          name: sobject.name,
          label: sobject.label,
          labelPlural: sobject.labelPlural,
          keyPrefix: sobject.keyPrefix,
          custom: sobject.custom,
          queryable: sobject.queryable,
          createable: sobject.createable,
          updateable: sobject.updateable,
          deletable: sobject.deletable
        }))
      });
    } catch (error) {
      console.error('❌ [SOBJECTS] Error searching SObjects:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to search SObjects: ' + error.message 
      });
    }
  }

  /**
   * Fetch all available SObjects
   */
  async fetchAllSObjects(req, res) {
    try {
      const conn = this.createConnection(req);

      const describe = await conn.describeGlobal();
      const allSObjects = describe.sobjects
        .filter(sobject => sobject.queryable) // Only include queryable objects
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(sobject => ({
          name: sobject.name,
          label: sobject.label,
          labelPlural: sobject.labelPlural,
          keyPrefix: sobject.keyPrefix,
          custom: sobject.custom,
          queryable: sobject.queryable,
          createable: sobject.createable,
          updateable: sobject.updateable,
          deletable: sobject.deletable
        }));

      res.json({
        success: true,
        sobjects: allSObjects
      });
    } catch (error) {
      console.error('❌ [SOBJECTS] Error fetching all SObjects:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch SObjects: ' + error.message 
      });
    }
  }

  /**
   * Query SObject records with optional conditions
   */
  async querySObjectRecords(req, res) {
    try {
      const { sobjectName } = req.params;
      const { condition } = req.query;

      const conn = this.createConnection(req);
      
      // Build SOQL query
      let soql = `SELECT Id`;
      
      // First get the SObject description to determine what fields to select
      const describe = await conn.sobject(sobjectName).describe();
      
      // Select common fields (Name, CreatedDate, LastModifiedDate) plus a few more
      const fieldsToSelect = ['Id'];
      
      // Add Name field if it exists
      const nameField = describe.fields.find(f => f.nameField || f.name === 'Name');
      if (nameField) {
        fieldsToSelect.push(nameField.name);
      }
      
      // Add common timestamp fields
      if (describe.fields.find(f => f.name === 'CreatedDate')) {
        fieldsToSelect.push('CreatedDate');
      }
      if (describe.fields.find(f => f.name === 'LastModifiedDate')) {
        fieldsToSelect.push('LastModifiedDate');
      }
      
      // Add the first few visible/queryable fields (up to 10 total)
      const additionalFields = describe.fields
        .filter(f => f.name !== 'Id' && !fieldsToSelect.includes(f.name) && 
                     f.type !== 'base64' && // Skip binary fields
                     !f.name.endsWith('__c') || // Skip most custom fields initially
                     (f.custom && f.name.endsWith('__c'))) // But include some custom fields
        .slice(0, 7); // Limit additional fields
        
      additionalFields.forEach(field => {
        if (!fieldsToSelect.includes(field.name)) {
          fieldsToSelect.push(field.name);
        }
      });
      
      soql = `SELECT ${fieldsToSelect.join(', ')} FROM ${sobjectName}`;
      
      // Add WHERE clause if condition is provided
      if (condition && condition.trim()) {
        soql += ` WHERE ${condition.trim()}`;
      }
      
      // Add ORDER BY for consistent results (most recent first if possible)
      if (fieldsToSelect.includes('CreatedDate')) {
        soql += ` ORDER BY CreatedDate DESC`;
      } else if (fieldsToSelect.includes('LastModifiedDate')) {
        soql += ` ORDER BY LastModifiedDate DESC`;
      }
      
      // Limit results
      soql += ` LIMIT 20`;
      
      console.log(`🔍 [SOBJECTS] Executing SOQL: ${soql}`);
      
      const queryResult = await conn.query(soql);
      
      res.json({
        success: true,
        soql: soql,
        records: queryResult.records,
        totalSize: queryResult.totalSize,
        fields: fieldsToSelect
      });
    } catch (error) {
      console.error(`❌ [SOBJECTS] Error querying SObject ${req.params.sobjectName}:`, error);
      res.status(500).json({ 
        success: false, 
        message: `Failed to query SObject: ${error.message}`,
        soql: req.query.soql || 'N/A'
      });
    }
  }

  /**
   * Describe a specific SObject
   */
  async describeSObject(req, res) {
    try {
      const { sobjectName } = req.params;

      const conn = this.createConnection(req);

      const describe = await conn.sobject(sobjectName).describe();
      
      res.json({
        success: true,
        describe: {
          name: describe.name,
          label: describe.label,
          labelPlural: describe.labelPlural,
          keyPrefix: describe.keyPrefix,
          custom: describe.custom,
          queryable: describe.queryable,
          createable: describe.createable,
          updateable: describe.updateable,
          deletable: describe.deletable,
          mergeable: describe.mergeable,
          replicateable: describe.replicateable,
          retrieveable: describe.retrieveable,
          searchable: describe.searchable,
          undeletable: describe.undeletable,
          triggerable: describe.triggerable,
          fields: describe.fields.map(field => ({
            name: field.name,
            label: field.label,
            type: field.type,
            length: field.length,
            byteLength: field.byteLength,
            digits: field.digits,
            precision: field.precision,
            scale: field.scale,
            custom: field.custom,
            nillable: field.nillable,
            createable: field.createable,
            updateable: field.updateable,
            unique: field.unique,
            externalId: field.externalId,
            idLookup: field.idLookup,
            filterable: field.filterable,
            sortable: field.sortable,
            groupable: field.groupable,
            autoNumber: field.autoNumber,
            defaultValue: field.defaultValue,
            calculated: field.calculated,
            controllerName: field.controllerName,
            dependentPicklist: field.dependentPicklist,
            htmlFormatted: field.htmlFormatted,
            nameField: field.nameField,
            namePointing: field.namePointing,
            restrictedPicklist: field.restrictedPicklist,
            picklistValues: field.picklistValues,
            referenceTo: field.referenceTo,
            relationshipName: field.relationshipName,
            relationshipOrder: field.relationshipOrder,
            writeRequiresMasterRead: field.writeRequiresMasterRead,
            cascadeDelete: field.cascadeDelete,
            restrictedDelete: field.restrictedDelete
          })),
          recordTypeInfos: describe.recordTypeInfos,
          childRelationships: describe.childRelationships?.map(rel => ({
            cascadeDelete: rel.cascadeDelete,
            childSObject: rel.childSObject,
            deprecatedAndHidden: rel.deprecatedAndHidden,
            field: rel.field,
            junctionIdListNames: rel.junctionIdListNames,
            junctionReferenceTo: rel.junctionReferenceTo,
            relationshipName: rel.relationshipName,
            restrictedDelete: rel.restrictedDelete
          })) || []
        }
      });
    } catch (error) {
      console.error(`❌ [SOBJECTS] Error describing SObject ${req.params.sobjectName}:`, error);
      res.status(500).json({ 
        success: false, 
        message: `Failed to describe SObject: ${error.message}` 
      });
    }
  }
}

module.exports = SObjectsModule;
