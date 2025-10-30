const jsforce = require('jsforce');
const fs = require('fs');
const path = require('path');

class AdminModule {
  constructor(omnistudioModule) {
    this.omnistudioModule = omnistudioModule;
    this.startTime = new Date();
  }

  /**
   * Get system overview information
   */
  async getSystemOverview(req, res) {
    try {
      const uptime = Date.now() - this.startTime.getTime();
      const memoryUsage = process.memoryUsage();
      
      res.json({
        success: true,
        data: {
          serverStatus: 'running',
          startTime: this.startTime.toISOString(),
          uptime: {
            milliseconds: uptime,
            seconds: Math.floor(uptime / 1000),
            minutes: Math.floor(uptime / 60000),
            hours: Math.floor(uptime / 3600000)
          },
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          environment: process.env.NODE_ENV || 'development',
          memoryUsage: {
            rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
            external: Math.round(memoryUsage.external / 1024 / 1024) + ' MB'
          }
        }
      });
    } catch (error) {
      console.error('❌ [ADMIN] Error getting system overview:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get system overview: ' + error.message
      });
    }
  }

  /**
   * Get Redis status and configuration
   */
  async getRedisStatus(req, res) {
    try {
      const redisStatus = this.omnistudioModule.getRedisStatus();
      
      res.json({
        success: true,
        data: {
          redis: redisStatus,
          environment: {
            REDIS_ENABLED: process.env.REDIS_ENABLED || 'not set',
            NODE_ENV: process.env.NODE_ENV || 'development'
          },
          recommendations: {
            enableRedis: !redisStatus.enabled && redisStatus.moduleExists && redisStatus.available,
            checkConnection: redisStatus.enabled && !redisStatus.available,
            installRedis: !redisStatus.moduleExists
          }
        }
      });
    } catch (error) {
      console.error('❌ [ADMIN] Error getting Redis status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get Redis status: ' + error.message
      });
    }
  }

  /**
   * Get component data cache status for all orgs
   */
  async getComponentDataStatus(req, res) {
    try {
      const cacheData = {};
      const orgCache = this.omnistudioModule.orgComponentsDataCache;
      
      // Convert Map to object with org details
      for (const [orgId, data] of orgCache.entries()) {
        // Calculate cache size in bytes
        const cacheSize = JSON.stringify(data).length;
        const cacheSizeKB = (cacheSize / 1024).toFixed(2);
        const cacheSizeMB = (cacheSize / (1024 * 1024)).toFixed(2);

        cacheData[orgId] = {
          loadedAt: data.loadedAt,
          totalComponents: data.totalComponents,
          integrationProcedures: data.integrationProcedures?.length || 0,
          omniscripts: data.omniscripts?.length || 0,
          dataMappers: data.dataMappers?.length || 0,
          timing: data.timing,
          hierarchySize: Object.keys(data.hierarchy || {}).length,
          // Include org name if available from cached data
          orgName: data.orgName || null,
          // Add cache size information
          cacheSize: {
            bytes: cacheSize,
            kb: cacheSizeKB,
            mb: cacheSizeMB,
            formatted: cacheSize < 1024 ? `${cacheSize} bytes` :
                      cacheSize < 1024 * 1024 ? `${cacheSizeKB} KB` :
                      `${cacheSizeMB} MB`
          }
        };
      }

      res.json({
        success: true,
        data: {
          totalOrgsWithData: orgCache.size,
          cacheStatus: cacheData,
          cacheKeys: Array.from(orgCache.keys())
        }
      });
    } catch (error) {
      console.error('❌ [ADMIN] Error getting component data status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get component data status: ' + error.message
      });
    }
  }

  /**
   * Get current session information
   */
  async getSessionInfo(req, res) {
    try {
      const sessionData = {
        sessionExists: !!req.session,
        sessionId: req.sessionID,
        salesforceConnected: !!req.session?.salesforce,
        userInfo: null,
        orgInfo: null
      };

      if (req.session?.salesforce) {
        sessionData.userInfo = {
          userId: req.session.salesforce.userId,
          displayName: req.session.salesforce.displayName,
          username: req.session.salesforce.username,
          email: req.session.salesforce.email,
          organizationId: req.session.salesforce.organizationId
        };
        
        sessionData.orgInfo = {
          orgType: req.session.salesforce.orgType,
          orgKey: req.session.salesforce.orgKey,
          orgName: req.session.salesforce.orgName,
          instanceUrl: req.session.salesforce.instanceUrl
        };
      }

      res.json({
        success: true,
        data: sessionData
      });
    } catch (error) {
      console.error('❌ [ADMIN] Error getting session info:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get session info: ' + error.message
      });
    }
  }

  /**
   * Get detailed information about the currently connected Salesforce org
   */
  async getCurrentOrgInfo(req, res) {
    try {
      if (!req.session?.salesforce) {
        console.log('❌ [ADMIN] No Salesforce session found');
        return res.status(401).json({
          success: false,
          message: 'Not connected to Salesforce'
        });
      }

      const sf = req.session.salesforce;
      console.log('📋 [ADMIN] Fetching current org info...');
      console.log('📋 [ADMIN] Session orgId:', sf.organizationId);
      console.log('📋 [ADMIN] Session has accessToken:', !!sf.accessToken);
      console.log('📋 [ADMIN] Session instanceUrl:', sf.instanceUrl);
      
      // Build org info from session data
      const orgInfo = {
        // Organization details from session
        organizationId: sf.organizationId,
        organizationName: sf.organizationName || 'Unknown',
        organizationType: sf.orgType || 'Unknown',
        isSandbox: sf.orgType?.toLowerCase().includes('sandbox') || false,
        instanceUrl: sf.instanceUrl,
        instanceName: sf.instanceUrl ? new URL(sf.instanceUrl).hostname.split('.')[0] : 'Unknown',
        
        // API information
        apiVersion: '60.0',
        
        // Session information
        orgKey: sf.orgKey,
        orgName: sf.orgName,
        orgType: sf.orgType,
        
        // User information from session
        userId: sf.userId,
        username: sf.username || 'Unknown',
        userFullName: sf.displayName || sf.username || 'Unknown',
        userEmail: sf.email || 'Unknown',
        profileName: 'User',
        userType: 'Standard',
        
        // Login information
        loginTime: sf.loginTime || new Date().toISOString(),
        sessionActive: true
      };

      // Create a fresh connection from access token (same pattern as sobjects.js)
      if (sf.accessToken && sf.instanceUrl) {
        console.log('🔄 [ADMIN] Creating connection from access token');
        const conn = new jsforce.Connection({
          oauth2: req.session.oauth2,
          accessToken: sf.accessToken,
          instanceUrl: sf.instanceUrl,
          version: '60.0'
        });
      
        try {
          console.log('🔍 [ADMIN] Querying Organization object...');
          // Query Organization object for basic info (fields available in all editions)
          const orgQuery = await conn.query(
            "SELECT Id, Name, OrganizationType, IsSandbox, InstanceName, " +
            "CreatedById, CreatedDate, LastModifiedById, LastModifiedDate " +
            "FROM Organization LIMIT 1"
          );
          
          console.log('✅ [ADMIN] Basic org data retrieved');
          
          // Try to get additional fields that may not be in all editions
          let extendedOrgData = {};
          try {
            const extendedQuery = await conn.query(
              "SELECT Division, Street, City, State, PostalCode, Country, Phone, Fax, " +
              "PrimaryContact, NamespacePrefix, TrialExpirationDate, " +
              "FiscalYearStartMonth, DefaultLocaleSidKey, LanguageLocaleKey, TimeZoneSidKey " +
              "FROM Organization LIMIT 1"
            );
            if (extendedQuery.records && extendedQuery.records.length > 0) {
              extendedOrgData = extendedQuery.records[0];
              console.log('✅ [ADMIN] Extended org data retrieved');
            }
          } catch (extError) {
            console.log('ℹ️ [ADMIN] Some extended fields not available:', extError.message);
          }

          // Get user details
          const userQuery = await conn.query(
            `SELECT Id, Name, Username, Email, ProfileId, Profile.Name, UserType FROM User WHERE Id = '${sf.userId}' LIMIT 1`
          );
          
          // Get creator and modifier names
          let creatorName = 'Unknown';
          let modifierName = 'Unknown';
          if (orgQuery.records && orgQuery.records.length > 0) {
            const orgData = orgQuery.records[0];
            
            // Query for Created By and Modified By user names
            if (orgData.CreatedById) {
              const creatorQuery = await conn.query(
                `SELECT Name FROM User WHERE Id = '${orgData.CreatedById}' LIMIT 1`
              );
              if (creatorQuery.records && creatorQuery.records.length > 0) {
                creatorName = creatorQuery.records[0].Name;
              }
            }
            
            if (orgData.LastModifiedById) {
              const modifierQuery = await conn.query(
                `SELECT Name FROM User WHERE Id = '${orgData.LastModifiedById}' LIMIT 1`
              );
              if (modifierQuery.records && modifierQuery.records.length > 0) {
                modifierName = modifierQuery.records[0].Name;
              }
            }
          }

          // Get org limits (API usage, storage, etc.)
          let limits = {};
          try {
            limits = await conn.request('/services/data/v60.0/limits');
          } catch (limitsError) {
            console.log('⚠️ [ADMIN] Could not fetch org limits:', limitsError.message);
          }
          
          // Get User License information
          let userLicenses = [];
          try {
            const licenseQuery = await conn.query(
              "SELECT Id, Name, TotalLicenses, UsedLicenses, Status FROM UserLicense ORDER BY Name"
            );
            userLicenses = licenseQuery.records || [];
            console.log(`✅ [ADMIN] Retrieved ${userLicenses.length} user licenses`);
          } catch (licenseError) {
            console.log('⚠️ [ADMIN] Could not fetch user licenses:', licenseError.message);
          }
          
          // Get Permission Set License information
          let permissionSetLicenses = [];
          try {
            const pslQuery = await conn.query(
              "SELECT Id, MasterLabel, DeveloperName, TotalLicenses, UsedLicenses, Status FROM PermissionSetLicense ORDER BY MasterLabel"
            );
            permissionSetLicenses = pslQuery.records || [];
            console.log(`✅ [ADMIN] Retrieved ${permissionSetLicenses.length} permission set licenses`);
          } catch (pslError) {
            console.log('⚠️ [ADMIN] Could not fetch permission set licenses:', pslError.message);
          }
          
          // Get Permission Set information
          let permissionSets = [];
          try {
            const psQuery = await conn.query(
              "SELECT Id, Name, Label, Description, IsCustom, IsOwnedByProfile, Type, NamespacePrefix FROM PermissionSet ORDER BY Label"
            );
            permissionSets = psQuery.records || [];
            console.log(`✅ [ADMIN] Retrieved ${permissionSets.length} permission sets`);
          } catch (psError) {
            console.log('⚠️ [ADMIN] Could not fetch permission sets:', psError.message);
          }
          
          // Get Permission Set Group information
          let permissionSetGroups = [];
          try {
            const psgQuery = await conn.query(
              "SELECT Id, DeveloperName, MasterLabel, Description, Status FROM PermissionSetGroup ORDER BY MasterLabel"
            );
            permissionSetGroups = psgQuery.records || [];
            console.log(`✅ [ADMIN] Retrieved ${permissionSetGroups.length} permission set groups`);
          } catch (psgError) {
            console.log('⚠️ [ADMIN] Could not fetch permission set groups:', psgError.message);
          }

          if (orgQuery.records && orgQuery.records.length > 0) {
            const orgData = orgQuery.records[0];
            console.log('✅ [ADMIN] Organization data retrieved successfully');
            console.log('📋 [ADMIN] Org Name:', orgData.Name);
            
            // Merge extended data
            const fullOrgData = { ...orgData, ...extendedOrgData };
            
            // Organization details
            orgInfo.organizationName = fullOrgData.Name;
            orgInfo.organizationType = fullOrgData.OrganizationType;
            orgInfo.isSandbox = fullOrgData.IsSandbox;
            orgInfo.instanceName = fullOrgData.InstanceName;
            orgInfo.namespacePrefix = fullOrgData.NamespacePrefix || null;
            orgInfo.fiscalYearStart = fullOrgData.FiscalYearStartMonth;
            
            // Address information
            orgInfo.division = fullOrgData.Division;
            orgInfo.address = {
              street: fullOrgData.Street,
              city: fullOrgData.City,
              state: fullOrgData.State,
              postalCode: fullOrgData.PostalCode,
              country: fullOrgData.Country
            };
            
            // Contact information
            orgInfo.phone = fullOrgData.Phone;
            orgInfo.fax = fullOrgData.Fax;
            orgInfo.primaryContact = fullOrgData.PrimaryContact;
            
            // Locale and language settings
            orgInfo.defaultLocale = fullOrgData.DefaultLocaleSidKey;
            orgInfo.defaultLanguage = fullOrgData.LanguageLocaleKey;
            orgInfo.defaultTimeZone = fullOrgData.TimeZoneSidKey;
            
            // Audit information
            orgInfo.createdBy = {
              id: fullOrgData.CreatedById,
              name: creatorName,
              date: fullOrgData.CreatedDate
            };
            orgInfo.lastModifiedBy = {
              id: fullOrgData.LastModifiedById,
              name: modifierName,
              date: fullOrgData.LastModifiedDate
            };
            
            if (fullOrgData.TrialExpirationDate) {
              orgInfo.trialExpiration = fullOrgData.TrialExpirationDate;
            }
          }
          
          // Add limits information
          if (limits) {
            orgInfo.limits = {
              dataStorage: limits.DataStorageMB || {},
              fileStorage: limits.FileStorageMB || {},
              dailyApiRequests: limits.DailyApiRequests || {},
              dailyStreamingApiEvents: limits.DailyStreamingApiEvents || {},
              monthlyPlatformEvents: limits.MonthlyPlatformEvents || {}
            };
          }
          
          // Add license information
          orgInfo.userLicenses = userLicenses;
          orgInfo.permissionSetLicenses = permissionSetLicenses;
          
          // Add permission set information
          orgInfo.permissionSets = permissionSets;
          orgInfo.permissionSetGroups = permissionSetGroups;

          if (userQuery.records && userQuery.records.length > 0) {
            const userData = userQuery.records[0];
            orgInfo.userFullName = userData.Name;
            orgInfo.username = userData.Username;
            orgInfo.userEmail = userData.Email;
            orgInfo.profileName = userData.Profile?.Name || 'Unknown';
            orgInfo.userType = userData.UserType;
          }

          orgInfo.apiVersion = conn.version || '60.0';
        } catch (queryError) {
          console.log('⚠️ [ADMIN] Could not query additional org details, using session data only:', queryError.message);
          // Continue with session data
        }
      }

      res.json({
        success: true,
        data: orgInfo
      });
    } catch (error) {
      console.error('❌ [ADMIN] Error getting current org info:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get current org info: ' + error.message
      });
    }
  }

  /**
   * Get environment variables (sanitized)
   */
  async getEnvironmentInfo(req, res) {
    try {
      const sensitiveKeys = ['SALESFORCE_CLIENT_SECRET', 'SESSION_SECRET'];
      const envVars = {};
      
      // Only include relevant environment variables, sanitize sensitive ones
      Object.keys(process.env).forEach(key => {
        if (key.startsWith('SALESFORCE_') || key.startsWith('NODE_') || key.startsWith('APP_') || 
            key === 'PORT' || key === 'NODE_ENV') {
          if (sensitiveKeys.some(sensitive => key.includes(sensitive))) {
            envVars[key] = '***HIDDEN***';
          } else {
            envVars[key] = process.env[key];
          }
        }
      });

      res.json({
        success: true,
        data: {
          totalEnvVars: Object.keys(process.env).length,
          relevantEnvVars: envVars
        }
      });
    } catch (error) {
      console.error('❌ [ADMIN] Error getting environment info:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get environment info: ' + error.message
      });
    }
  }

  /**
   * Get server logs (last N lines)
   */
  async getServerLogs(req, res) {
    try {
      const { lines = 100 } = req.query;
      const logsDir = path.join(__dirname, '..', 'logs');
      
      if (!fs.existsSync(logsDir)) {
        return res.json({
          success: true,
          data: {
            logs: [],
            message: 'No log files found'
          }
        });
      }

      // Get the most recent log file
      const logFiles = fs.readdirSync(logsDir)
        .filter(file => file.startsWith('server-') && file.endsWith('.log'))
        .sort()
        .reverse();

      if (logFiles.length === 0) {
        return res.json({
          success: true,
          data: {
            logs: [],
            message: 'No log files found'
          }
        });
      }

      const latestLogFile = path.join(logsDir, logFiles[0]);
      const logContent = fs.readFileSync(latestLogFile, 'utf8');
      const logLines = logContent.split('\n').filter(line => line.trim());
      
      // Get the last N lines
      const recentLogs = logLines.slice(-parseInt(lines));

      res.json({
        success: true,
        data: {
          logFile: logFiles[0],
          totalLogFiles: logFiles.length,
          totalLines: logLines.length,
          recentLines: recentLogs.length,
          logs: recentLogs
        }
      });
    } catch (error) {
      console.error('❌ [ADMIN] Error getting server logs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get server logs: ' + error.message
      });
    }
  }

  /**
   * Clear component data cache for a specific org
   */
  async clearOrgCache(req, res) {
    try {
      const { orgId } = req.params;
      
      if (!orgId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required'
        });
      }

      const hadData = this.omnistudioModule.orgComponentsDataCache.has(orgId);
      this.omnistudioModule.orgComponentsDataCache.delete(orgId);

      res.json({
        success: true,
        data: {
          orgId,
          hadData,
          message: hadData ? `Cache cleared for org ${orgId}` : `No cache data found for org ${orgId}`
        }
      });
    } catch (error) {
      console.error('❌ [ADMIN] Error clearing org cache:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to clear org cache: ' + error.message
      });
    }
  }

  /**
   * Clear all component data caches
   */
  async clearAllCaches(req, res) {
    try {
      const orgCount = this.omnistudioModule.orgComponentsDataCache.size;
      this.omnistudioModule.orgComponentsDataCache.clear();

      res.json({
        success: true,
        data: {
          clearedOrgCount: orgCount,
          message: `Cleared cache data for ${orgCount} organizations`
        }
      });
    } catch (error) {
      console.error('❌ [ADMIN] Error clearing all caches:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to clear all caches: ' + error.message
      });
    }
  }
}

module.exports = AdminModule;

