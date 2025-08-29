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

