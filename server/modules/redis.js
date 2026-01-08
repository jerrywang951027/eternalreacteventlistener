const redis = require('redis');

class RedisModule {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.connectionOptions = this.getConnectionOptions();
    this.initializeConnection();
  }

  /**
   * Get Redis connection options based on environment
   */
  getConnectionOptions() {
    // Check for REDIS_URL first (Heroku Redis sets this automatically)
    // This is the definitive indicator of Heroku Redis, regardless of NODE_ENV
    if (process.env.REDIS_URL) {
      // Heroku Redis configuration
      console.log('🔧 [REDIS] Using Heroku Redis configuration');
      return {
        url: process.env.REDIS_URL,
        socket: {
          tls: true,
          rejectUnauthorized: false
        }
      };
    } else {
      // Local Redis configuration
      console.log('🔧 [REDIS] Using local Redis configuration');
      return {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0
      };
    }
  }

  /**
   * Initialize Redis connection
   */
  async initializeConnection() {
    try {
      console.log('🔄 [REDIS] Initializing Redis connection...');
      
      this.client = redis.createClient(this.connectionOptions);
      
      // Setup event handlers
      this.client.on('error', (err) => {
        console.error('❌ [REDIS] Connection error:', err.message);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('🔌 [REDIS] Connected to Redis server');
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        console.log('✅ [REDIS] Redis client ready');
        this.isConnected = true;
      });

      this.client.on('end', () => {
        console.log('🔌 [REDIS] Redis connection closed');
        this.isConnected = false;
      });

      await this.client.connect();
      
      // Test the connection
      await this.client.ping();
      console.log('🏓 [REDIS] Connection test successful');
      
    } catch (error) {
      console.error('❌ [REDIS] Failed to initialize Redis connection:', error.message);
      console.log('⚠️ [REDIS] Application will continue without Redis caching');
      this.isConnected = false;
    }
  }

  /**
   * Check if Redis is available
   */
  isAvailable() {
    return this.isConnected && this.client;
  }

  /**
   * Store cached component data with 2-day expiration
   * @param {string} orgId - Organization ID
   * @param {object} componentData - Component data to cache
   */
  async setCachedComponentData(orgId, componentData) {
    if (!this.isAvailable()) {
      console.log('⚠️ [REDIS] Redis not available, skipping cache storage');
      return false;
    }

    try {
      const key = `component_data:${orgId}`;
      const data = {
        ...componentData,
        cachedAt: new Date().toISOString(),
        cacheSource: 'redis'
      };
      
      // Store with 2-day expiration (48 hours = 172800 seconds)
      await this.client.setEx(key, 172800, JSON.stringify(data));
      
      console.log(`💾 [REDIS] Cached component data for org ${orgId} (expires in 2 days)`);
      return true;
    } catch (error) {
      console.error('❌ [REDIS] Failed to cache component data:', error.message);
      return false;
    }
  }

  /**
   * Retrieve cached component data
   * @param {string} orgId - Organization ID
   */
  async getCachedComponentData(orgId) {
    if (!this.isAvailable()) {
      console.log('⚠️ [REDIS] Redis not available, skipping cache retrieval');
      return null;
    }

    try {
      const key = `component_data:${orgId}`;
      const cachedData = await this.client.get(key);
      
      if (cachedData) {
        const data = JSON.parse(cachedData);
        console.log(`📦 [REDIS] Retrieved cached component data for org ${orgId} (cached at: ${data.cachedAt})`);
        return data;
      } else {
        console.log(`📭 [REDIS] No cached component data found for org ${orgId}`);
        return null;
      }
    } catch (error) {
      console.error('❌ [REDIS] Failed to retrieve cached component data:', error.message);
      return null;
    }
  }

  /**
   * Get all cached component data (for all orgs)
   */
  async getAllCachedComponentData() {
    if (!this.isAvailable()) {
      console.log('⚠️ [REDIS] Redis not available, skipping cache retrieval');
      return {};
    }

    try {
      const keys = await this.client.keys('component_data:*');
      const allData = {};
      
      if (keys.length > 0) {
        const values = await this.client.mGet(keys);
        
        keys.forEach((key, index) => {
          if (values[index]) {
            const orgId = key.replace('component_data:', '');
            try {
              allData[orgId] = JSON.parse(values[index]);
            } catch (parseError) {
              console.error(`❌ [REDIS] Failed to parse cached data for org ${orgId}:`, parseError.message);
            }
          }
        });
        
        console.log(`📦 [REDIS] Retrieved cached component data for ${Object.keys(allData).length} orgs`);
      } else {
        console.log('📭 [REDIS] No cached component data found');
      }
      
      return allData;
    } catch (error) {
      console.error('❌ [REDIS] Failed to retrieve all cached component data:', error.message);
      return {};
    }
  }

  /**
   * Force refresh cached component data (delete from cache)
   * @param {string} orgId - Organization ID (optional, if not provided, clears all)
   */
  async clearCachedComponentData(orgId = null) {
    if (!this.isAvailable()) {
      console.log('⚠️ [REDIS] Redis not available, skipping cache clear');
      return false;
    }

    try {
      if (orgId) {
        const key = `component_data:${orgId}`;
        const result = await this.client.del(key);
        console.log(`🗑️ [REDIS] Cleared cached component data for org ${orgId} (${result} key deleted)`);
        return result > 0;
      } else {
        const keys = await this.client.keys('component_data:*');
        if (keys.length > 0) {
          const result = await this.client.del(keys);
          console.log(`🗑️ [REDIS] Cleared all cached component data (${result} keys deleted)`);
          return result > 0;
        } else {
          console.log('📭 [REDIS] No cached component data to clear');
          return true;
        }
      }
    } catch (error) {
      console.error('❌ [REDIS] Failed to clear cached component data:', error.message);
      return false;
    }
  }

  /**
   * Set a key-value pair in Redis
   * @param {string} key - Key name
   * @param {any} value - Value to store
   * @param {number} expireSeconds - Optional expiration time in seconds
   */
  async set(key, value, expireSeconds = null) {
    if (!this.isAvailable()) {
      console.log('⚠️ [REDIS] Redis not available, skipping key-value storage');
      return false;
    }

    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      
      if (expireSeconds) {
        await this.client.setEx(key, expireSeconds, stringValue);
        console.log(`💾 [REDIS] Set key '${key}' with expiration ${expireSeconds}s`);
      } else {
        await this.client.set(key, stringValue);
        console.log(`💾 [REDIS] Set key '${key}' (no expiration)`);
      }
      
      return true;
    } catch (error) {
      console.error(`❌ [REDIS] Failed to set key '${key}':`, error.message);
      return false;
    }
  }

  /**
   * Get a value from Redis
   * @param {string} key - Key name
   * @param {boolean} parseJson - Whether to parse the value as JSON
   */
  async get(key, parseJson = false) {
    if (!this.isAvailable()) {
      console.log('⚠️ [REDIS] Redis not available, skipping key-value retrieval');
      return null;
    }

    try {
      const value = await this.client.get(key);
      
      if (value === null) {
        console.log(`📭 [REDIS] Key '${key}' not found`);
        return null;
      }
      
      if (parseJson) {
        try {
          const parsedValue = JSON.parse(value);
          console.log(`📦 [REDIS] Retrieved and parsed key '${key}'`);
          return parsedValue;
        } catch (parseError) {
          console.error(`❌ [REDIS] Failed to parse JSON for key '${key}':`, parseError.message);
          return value; // Return raw value if JSON parsing fails
        }
      } else {
        console.log(`📦 [REDIS] Retrieved key '${key}'`);
        return value;
      }
    } catch (error) {
      console.error(`❌ [REDIS] Failed to get key '${key}':`, error.message);
      return null;
    }
  }

  /**
   * Delete a key from Redis
   * @param {string} key - Key name
   */
  async delete(key) {
    if (!this.isAvailable()) {
      console.log('⚠️ [REDIS] Redis not available, skipping key deletion');
      return false;
    }

    try {
      const result = await this.client.del(key);
      console.log(`🗑️ [REDIS] Deleted key '${key}' (${result} key deleted)`);
      return result > 0;
    } catch (error) {
      console.error(`❌ [REDIS] Failed to delete key '${key}':`, error.message);
      return false;
    }
  }

  /**
   * Set system-level setting for an org
   * @param {string} orgId - Organization ID
   * @param {string} settingName - Setting name
   * @param {any} settingValue - Setting value
   */
  async setOrgSetting(orgId, settingName, settingValue) {
    const key = `org_setting:${orgId}:${settingName}`;
    return await this.set(key, settingValue);
  }

  /**
   * Get system-level setting for an org
   * @param {string} orgId - Organization ID
   * @param {string} settingName - Setting name
   */
  async getOrgSetting(orgId, settingName) {
    const key = `org_setting:${orgId}:${settingName}`;
    return await this.get(key, true);
  }

  /**
   * Set user-level setting
   * @param {string} userId - User ID
   * @param {string} settingName - Setting name
   * @param {any} settingValue - Setting value
   */
  async setUserSetting(userId, settingName, settingValue) {
    const key = `user_setting:${userId}:${settingName}`;
    return await this.set(key, settingValue);
  }

  /**
   * Get user-level setting
   * @param {string} userId - User ID
   * @param {string} settingName - Setting name
   */
  async getUserSetting(userId, settingName) {
    const key = `user_setting:${userId}:${settingName}`;
    return await this.get(key, true);
  }

  /**
   * Get connection status and stats
   */
  async getStatus() {
    const status = {
      isConnected: this.isConnected,
      isAvailable: this.isAvailable(),
      connectionOptions: {
        ...this.connectionOptions,
        password: this.connectionOptions.password ? '[HIDDEN]' : undefined
      }
    };

    if (this.isAvailable()) {
      try {
        // Get Redis server info
        const info = await this.client.info();
        const memory = await this.client.info('memory');
        
        status.serverInfo = {
          version: this.extractInfoValue(info, 'redis_version'),
          uptime: this.extractInfoValue(info, 'uptime_in_seconds'),
          connectedClients: this.extractInfoValue(info, 'connected_clients'),
          memoryUsed: this.extractInfoValue(memory, 'used_memory_human')
        };
        
        // Count our cached data
        const componentKeys = await this.client.keys('component_data:*');
        const settingKeys = await this.client.keys('*_setting:*');
        
        status.cacheStats = {
          cachedOrgs: componentKeys.length,
          settingKeys: settingKeys.length,
          totalKeys: componentKeys.length + settingKeys.length
        };
        
      } catch (error) {
        console.error('❌ [REDIS] Failed to get status info:', error.message);
        status.error = error.message;
      }
    }

    return status;
  }

  /**
   * Helper method to extract values from Redis INFO command output
   */
  extractInfoValue(infoString, key) {
    const regex = new RegExp(`${key}:(.+)`);
    const match = infoString.match(regex);
    return match ? match[1].trim() : 'N/A';
  }

  /**
   * Close Redis connection
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.quit();
        console.log('👋 [REDIS] Connection closed gracefully');
      } catch (error) {
        console.error('❌ [REDIS] Error closing connection:', error.message);
      }
    }
  }
}

module.exports = RedisModule;
