const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class EnvManagerModule {
  constructor() {
    this.envPath = path.join(__dirname, '../.env');
    this.backupDir = path.join(__dirname, '../env_backups');
    this.ensureBackupDir();
  }

  /**
   * Ensure backup directory exists
   */
  ensureBackupDir() {
    if (!fsSync.existsSync(this.backupDir)) {
      fsSync.mkdirSync(this.backupDir, { recursive: true });
      console.log(`📁 [ENV-MANAGER] Created backup directory: ${this.backupDir}`);
    }
  }

  /**
   * Parse .env file content into org objects
   * @param {string} content - .env file content
   * @returns {Array} - Array of org objects
   */
  parseEnvContent(content) {
    const lines = content.split('\n');
    
    // Find the SALESFORCE_ORGS line
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      // Check if this is the SALESFORCE_ORGS JSON line
      if (trimmedLine.startsWith('SALESFORCE_ORGS=')) {
        try {
          const jsonStr = trimmedLine.substring('SALESFORCE_ORGS='.length);
          const orgsArray = JSON.parse(jsonStr);
          
          // Convert JSON format to envManager format - preserve ALL fields dynamically
          return orgsArray.map((org, index) => ({
            index: index + 1,
            fields: {
              // Spread all fields from the org object
              ...org,
              // Ensure required fields have defaults if missing
              name: org.name || '',
              clientId: org.clientId || '',
              clientSecret: org.clientSecret || '',
              url: org.url || '',
              agentId: org.agentId || '',
              agentType: org.agentType || '', // AEA or ASA
              orgId: org.orgId || '', // Salesforce Org ID for tenant header
              oAuthType: org.oAuthType || 'authorizationCode' // authorizationCode or clientCredential
            }
          }));
        } catch (error) {
          console.error('❌ [ENV-MANAGER] Error parsing SALESFORCE_ORGS JSON:', error.message);
          return [];
        }
      }
    }

    return [];
  }

  /**
   * Convert org objects back to .env format
   * @param {Array} orgs - Array of org objects
   * @returns {string} - .env file content
   */
  async formatEnvContent(orgs) {
    // Read the current .env file to preserve non-org settings
    let existingContent = '';
    if (fsSync.existsSync(this.envPath)) {
      existingContent = await fs.readFile(this.envPath, 'utf8');
    }

    // Convert orgs back to JSON format - preserve ALL fields dynamically
    const orgsJson = orgs.map(org => {
      // Create a new object with all fields from org.fields
      const orgData = { ...org.fields };
      
      // Ensure required fields are present and in the correct order
      const orderedOrg = {
        name: orgData.name || '',
        clientId: orgData.clientId || '',
        clientSecret: orgData.clientSecret || '',
        url: orgData.url || '',
        agentId: orgData.agentId || '',
        agentType: orgData.agentType || '',
        orgId: orgData.orgId || '',
        oAuthType: orgData.oAuthType || 'authorizationCode',
        dataCloud: orgData.dataCloud || false,
        dataCloudClientId: orgData.dataCloudClientId || '',
        dataCloudClientSecret: orgData.dataCloudClientSecret || ''
      };
      
      // Add any additional custom fields that aren't in the standard set
      const standardFields = ['name', 'clientId', 'clientSecret', 'url', 'agentId', 'agentType', 'orgId', 'oAuthType', 'dataCloud', 'dataCloudClientId', 'dataCloudClientSecret'];
      Object.keys(orgData).forEach(key => {
        if (!standardFields.includes(key)) {
          orderedOrg[key] = orgData[key];
        }
      });
      
      return orderedOrg;
    });

    const orgsJsonStr = JSON.stringify(orgsJson);

    // Replace the SALESFORCE_ORGS line in existing content
    const lines = existingContent.split('\n');
    let newContent = '';
    let foundOrgsLine = false;

    for (const line of lines) {
      if (line.trim().startsWith('SALESFORCE_ORGS=')) {
        newContent += `SALESFORCE_ORGS=${orgsJsonStr}\n`;
        foundOrgsLine = true;
      } else {
        newContent += line + '\n';
      }
    }

    // If SALESFORCE_ORGS line wasn't found, append it
    if (!foundOrgsLine) {
      newContent += `\n# Predefined Salesforce Organizations (SINGLE LINE JSON)\nSALESFORCE_ORGS=${orgsJsonStr}\n`;
    }

    return newContent;
  }

  /**
   * Get all orgs from .env file
   */
  async getOrgs(req, res) {
    try {
      console.log('📖 [ENV-MANAGER] Reading .env file...');
      
      // Check if .env file exists
      if (!fsSync.existsSync(this.envPath)) {
        console.log('⚠️ [ENV-MANAGER] .env file does not exist, returning empty array');
        return res.json({
          success: true,
          orgs: [],
          message: 'No .env file found. Click "Add Org" to create your first organization.'
        });
      }
      
      const content = await fs.readFile(this.envPath, 'utf8');
      const orgs = this.parseEnvContent(content);
      
      console.log(`✅ [ENV-MANAGER] Found ${orgs.length} organizations`);
      
      res.json({
        success: true,
        orgs: orgs
      });
    } catch (error) {
      console.error('❌ [ENV-MANAGER] Error reading .env file:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to read .env file: ' + error.message
      });
    }
  }

  /**
   * Get list of backup files
   */
  async getBackups(req, res) {
    try {
      console.log('📋 [ENV-MANAGER] Listing backup files...');
      
      const files = await fs.readdir(this.backupDir);
      const envBackups = files.filter(f => f.startsWith('.env.backup-'));
      
      // Parse timestamps and sort by date (newest first)
      const backups = envBackups.map(filename => {
        const timestampMatch = filename.match(/\.env\.backup-(\d{8}-\d{6})$/);
        if (timestampMatch) {
          const timestamp = timestampMatch[1];
          const year = timestamp.substr(0, 4);
          const month = timestamp.substr(4, 2);
          const day = timestamp.substr(6, 2);
          const hour = timestamp.substr(9, 2);
          const minute = timestamp.substr(11, 2);
          const second = timestamp.substr(13, 2);
          
          return {
            filename,
            timestamp,
            date: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
            fullPath: path.join(this.backupDir, filename)
          };
        }
        return null;
      }).filter(Boolean);
      
      // Sort by timestamp (newest first)
      backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      
      console.log(`✅ [ENV-MANAGER] Found ${backups.length} backup files`);
      
      res.json({
        success: true,
        backups: backups
      });
    } catch (error) {
      console.error('❌ [ENV-MANAGER] Error listing backups:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to list backups: ' + error.message
      });
    }
  }

  /**
   * Backup current .env file
   * @returns {string} - Backup filename or null if no file to backup
   */
  async backupEnvFile() {
    // Check if .env file exists before backing up
    if (!fsSync.existsSync(this.envPath)) {
      console.log('ℹ️ [ENV-MANAGER] No .env file to backup, skipping backup');
      return null;
    }
    
    const now = new Date();
    // Use local timezone instead of UTC
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}${month}${day}-${hour}${minute}${second}`;
    
    const backupFilename = `.env.backup-${timestamp}`;
    const backupPath = path.join(this.backupDir, backupFilename);
    
    const content = await fs.readFile(this.envPath, 'utf8');
    await fs.writeFile(backupPath, content, 'utf8');
    
    console.log(`💾 [ENV-MANAGER] Backup created: ${backupFilename}`);
    
    return backupFilename;
  }

  /**
   * Update .env file with new org data
   */
  async updateOrgs(req, res) {
    try {
      const { orgs } = req.body;
      
      if (!orgs || !Array.isArray(orgs)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid request: orgs array is required'
        });
      }

      console.log(`💾 [ENV-MANAGER] Updating .env file with ${orgs.length} organizations...`);
      
      // Create backup first
      const backupFilename = await this.backupEnvFile();
      
      // Format and write new content
      const newContent = await this.formatEnvContent(orgs);
      await fs.writeFile(this.envPath, newContent, 'utf8');
      
      console.log('✅ [ENV-MANAGER] .env file updated successfully');
      
      res.json({
        success: true,
        message: '.env file updated successfully',
        backupFilename: backupFilename
      });
    } catch (error) {
      console.error('❌ [ENV-MANAGER] Error updating .env file:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update .env file: ' + error.message
      });
    }
  }

  /**
   * Add a new org
   */
  async addOrg(req, res) {
    try {
      const { org } = req.body;
      
      if (!org || !org.fields) {
        return res.status(400).json({
          success: false,
          message: 'Invalid request: org object with fields is required'
        });
      }

      console.log('➕ [ENV-MANAGER] Adding new organization...');
      
      // Read current orgs (or start with empty array if file doesn't exist)
      let orgs = [];
      if (fsSync.existsSync(this.envPath)) {
        const content = await fs.readFile(this.envPath, 'utf8');
        orgs = this.parseEnvContent(content);
      }
      
      // Determine new index
      const maxIndex = orgs.reduce((max, o) => Math.max(max, o.index), 0);
      const newIndex = maxIndex + 1;
      
      // Add new org
      const newOrg = {
        index: newIndex,
        fields: org.fields
      };
      orgs.push(newOrg);
      
      // Create backup (if file exists) and save
      const backupFilename = await this.backupEnvFile();
      const newContent = await this.formatEnvContent(orgs);
      await fs.writeFile(this.envPath, newContent, 'utf8');
      
      console.log(`✅ [ENV-MANAGER] New organization added with index ${newIndex}`);
      
      res.json({
        success: true,
        message: 'Organization added successfully',
        org: newOrg,
        backupFilename: backupFilename
      });
    } catch (error) {
      console.error('❌ [ENV-MANAGER] Error adding organization:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add organization: ' + error.message
      });
    }
  }

  /**
   * Delete an org
   */
  async deleteOrg(req, res) {
    try {
      const { index } = req.params;
      const orgIndex = parseInt(index);
      
      if (isNaN(orgIndex)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid org index'
        });
      }

      console.log(`🗑️ [ENV-MANAGER] Deleting organization with index ${orgIndex}...`);
      
      // Read current orgs
      const content = await fs.readFile(this.envPath, 'utf8');
      const orgs = this.parseEnvContent(content);
      
      // Find and remove org
      const orgIndexInArray = orgs.findIndex(o => o.index === orgIndex);
      if (orgIndexInArray === -1) {
        return res.status(404).json({
          success: false,
          message: `Organization with index ${orgIndex} not found`
        });
      }
      
      orgs.splice(orgIndexInArray, 1);
      
      // Create backup and save
      const backupFilename = await this.backupEnvFile();
      const newContent = await this.formatEnvContent(orgs);
      await fs.writeFile(this.envPath, newContent, 'utf8');
      
      console.log(`✅ [ENV-MANAGER] Organization with index ${orgIndex} deleted`);
      
      res.json({
        success: true,
        message: 'Organization deleted successfully',
        backupFilename: backupFilename
      });
    } catch (error) {
      console.error('❌ [ENV-MANAGER] Error deleting organization:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete organization: ' + error.message
      });
    }
  }

  /**
   * Get backup file content
   */
  async getBackupContent(req, res) {
    try {
      const { filename } = req.params;
      const backupPath = path.join(this.backupDir, filename);

      if (!fsSync.existsSync(backupPath)) {
        return res.status(404).json({
          success: false,
          message: 'Backup file not found'
        });
      }

      const content = await fs.readFile(backupPath, 'utf8');
      
      res.json({
        success: true,
        filename,
        content
      });
    } catch (error) {
      console.error('❌ [ENV-MANAGER] Error reading backup:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to read backup file: ' + error.message
      });
    }
  }

  /**
   * Delete backup files
   */
  async deleteBackups(req, res) {
    try {
      const { filenames } = req.body;

      if (!Array.isArray(filenames) || filenames.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please provide an array of filenames to delete'
        });
      }

      const results = [];
      for (const filename of filenames) {
        const backupPath = path.join(this.backupDir, filename);
        
        if (fsSync.existsSync(backupPath)) {
          await fs.unlink(backupPath);
          results.push({ filename, deleted: true });
          console.log(`🗑️ [ENV-MANAGER] Deleted backup: ${filename}`);
        } else {
          results.push({ filename, deleted: false, reason: 'File not found' });
        }
      }

      // Get updated backup list
      const backups = await this.getBackupList();

      res.json({
        success: true,
        message: `Deleted ${results.filter(r => r.deleted).length} of ${filenames.length} backup(s)`,
        results,
        backups
      });
    } catch (error) {
      console.error('❌ [ENV-MANAGER] Error deleting backups:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete backups: ' + error.message
      });
    }
  }

  /**
   * Get current .env file content
   */
  async getCurrentEnvContent(req, res) {
    try {
      if (!fsSync.existsSync(this.envPath)) {
        return res.status(404).json({
          success: false,
          message: '.env file not found'
        });
      }

      const content = await fs.readFile(this.envPath, 'utf8');
      
      res.json({
        success: true,
        content
      });
    } catch (error) {
      console.error('❌ [ENV-MANAGER] Error reading .env file:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to read .env file: ' + error.message
      });
    }
  }
}

module.exports = EnvManagerModule;

