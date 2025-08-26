const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
require('dotenv').config();

// Setup file logging
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFileName = `server-${timestamp}.log`;
const logFilePath = path.join(logsDir, logFileName);
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

// Override console.log to write to both console and file
const originalLog = console.log;
console.log = function(...args) {
  const logMessage = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  const timestampedMessage = `[${new Date().toISOString()}] ${logMessage}`;
  
  originalLog.apply(console, args); // Still log to console
  logStream.write(timestampedMessage + '\n'); // Also write to file
};

console.log(`📝 [LOGGING] Server logs will be written to: ${logFilePath}`);

// Import modules
const LoginModule = require('./modules/login');
const PlatformEventsModule = require('./modules/platformEvents');
const SObjectsModule = require('./modules/sobjects');
const OrderManagementModule = require('./modules/orderManagement');
const OmnistudioModule = require('./modules/omnistudio');
const AdminModule = require('./modules/admin');
const RedisModule = require('./modules/redis');

const PORT = process.env.PORT || 5000;
const CLIENT_PORT = process.env.CLIENT_PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  `http://localhost:${CLIENT_PORT}`,
  'http://localhost:3001'
];

// Add production origins if in production
if (NODE_ENV === 'production') {
  // Add Heroku app URL from environment variable
  if (process.env.APP_URL) {
    allowedOrigins.push(process.env.APP_URL);
  }
  // Also allow any herokuapp.com subdomain as fallback
  allowedOrigins.push(/^https:\/\/.*\.herokuapp\.com$/);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

// Store active connections and subscriptions
const activeConnections = new Map();
const platformEventSubscriptions = new Map();
let reactProcess = null;

// Initialize modules (no more global connection sharing)
const redisModule = new RedisModule();
const loginModule = new LoginModule();
const platformEventsModule = new PlatformEventsModule(io, platformEventSubscriptions);
const sObjectsModule = new SObjectsModule();
const orderManagementModule = new OrderManagementModule();
const omnistudioModule = new OmnistudioModule(redisModule);
const adminModule = new AdminModule(omnistudioModule);

// Auto-start React development server in development mode
function startReactDev() {
  if (NODE_ENV === 'development') {
    console.log('🚀 Starting React development server...');
    
    const clientPath = path.join(__dirname, '..', 'client');
    reactProcess = spawn('npm', ['start'], {
      cwd: clientPath,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
      env: { 
        ...process.env, 
        PORT: CLIENT_PORT,
        BROWSER: 'none' // Prevent auto-opening browser
      }
    });

    reactProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('compiled successfully')) {
        console.log(`📱 React app available at http://localhost:${CLIENT_PORT}`);
      }
      process.stdout.write(`[React] ${output}`);
    });

    reactProcess.stderr.on('data', (data) => {
      process.stderr.write(`[React Error] ${data}`);
    });

    reactProcess.on('close', (code) => {
      if (code !== 0) {
        console.log(`❌ React process exited with code ${code}`);
      }
    });

    // Handle cleanup
    process.on('SIGTERM', () => {
      if (reactProcess) {
        reactProcess.kill('SIGTERM');
      }
    });

    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down servers...');
      if (reactProcess) {
        reactProcess.kill('SIGTERM');
      }
      process.exit(0);
    });
  }
}

// Middleware
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Serve React build files in production
if (NODE_ENV === 'production') {
  const buildPath = path.join(__dirname, '..', 'client', 'build');
  app.use(express.static(buildPath));
}

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to EternalReactEventListener API',
    timestamp: new Date().toISOString(),
    status: 'Server is running successfully!'
  });
});

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Authentication Routes
app.get('/api/auth/orgs', (req, res) => {
  loginModule.getOrgsList(req, res);
});

app.post('/api/auth/salesforce/login', (req, res) => {
  loginModule.handleSalesforceLogin(req, res);
});

app.get('/api/auth/salesforce/callback', (req, res) => {
  loginModule.handleSalesforceCallback(req, res);
});

app.get('/api/auth/user', (req, res) => {
  loginModule.getCurrentUser(req, res);
});

app.post('/api/auth/logout', (req, res) => {
  loginModule.handleLogout(req, res, platformEventsModule.cleanupSubscriptions.bind(platformEventsModule));
});

// Platform Events Routes
app.get('/api/platform-events', loginModule.requireAuth, (req, res) => {
  platformEventsModule.fetchPlatformEvents(req, res);
});

app.post('/api/platform-events/subscribe', loginModule.requireAuth, (req, res) => {
  platformEventsModule.subscribeToPlatformEvents(req, res);
});

app.post('/api/platform-events/cleanup', loginModule.requireAuth, (req, res) => {
  platformEventsModule.manualCleanup(req, res);
});

app.get('/api/platform-events/status', loginModule.requireAuth, (req, res) => {
  platformEventsModule.getSubscriptionStatus(req, res);
});

// SObjects Routes
app.get('/api/sobjects/search', loginModule.requireAuth, (req, res) => {
  sObjectsModule.searchSObjects(req, res);
});

app.get('/api/sobjects/all', loginModule.requireAuth, (req, res) => {
  sObjectsModule.fetchAllSObjects(req, res);
});

app.get('/api/sobjects/:sobjectName/describe', loginModule.requireAuth, (req, res) => {
  sObjectsModule.describeSObject(req, res);
});

app.get('/api/sobjects/:sobjectName/query', loginModule.requireAuth, (req, res) => {
  sObjectsModule.querySObjectRecords(req, res);
});

// Order Management Routes
app.get('/api/orders/search', loginModule.requireAuth, (req, res) => {
  orderManagementModule.searchOrders(req, res);
});

app.get('/api/orders/:orderId/items', loginModule.requireAuth, (req, res) => {
  orderManagementModule.getOrderItems(req, res);
});

app.post('/api/orders/:orderId/activate', loginModule.requireAuth, (req, res) => {
  orderManagementModule.activateOrder(req, res);
});

app.get('/api/orders/:orderId/orchestration-status', loginModule.requireAuth, (req, res) => {
  orderManagementModule.getOrchestrationStatus(req, res);
});

// Omnistudio API routes
app.post('/api/omnistudio/load-all', loginModule.requireAuth, (req, res) => {
  omnistudioModule.loadAllComponents(req, res);
});

app.get('/api/omnistudio/global-data', loginModule.requireAuth, (req, res) => {
  omnistudioModule.getGlobalComponentData(req, res);
});

app.get('/api/omnistudio/global-summary', loginModule.requireAuth, async (req, res) => {
  try {
    const orgId = req.session.salesforce.organizationId;
    const globalData = await omnistudioModule.getOrgComponentData(orgId);
    if (!globalData) {
      return res.status(404).json({
        success: false,
        message: 'No global component data loaded for this org. Please call /api/omnistudio/load-all first.'
      });
    }
  
  // Create a comprehensive summary
  const summary = {
    loadedAt: globalData.loadedAt,
    totalComponents: globalData.totalComponents,
    counts: {
      integrationProcedures: globalData.integrationProcedures ? globalData.integrationProcedures.length : 0,
      omniscripts: globalData.omniscripts ? globalData.omniscripts.length : 0,
      dataMappers: globalData.dataMappers ? globalData.dataMappers.length : 0
    },
    hierarchyRelationships: Object.keys(globalData.hierarchy || {}).length,
    components: {
      integrationProcedures: (globalData.integrationProcedures || []).map(ip => ({
        id: ip.id,
        name: ip.name,
        type: ip.type,
        subType: ip.subType,
        version: ip.version,
        uniqueId: ip.uniqueId,
        stepsCount: ip.steps ? ip.steps.length : 0,
        childComponents: ip.childComponents ? ip.childComponents.length : 0,
        hasBlockStructure: ip.blockStructure && ip.blockStructure.length > 0
      })),
      omniscripts: (globalData.omniscripts || []).map(os => ({
        id: os.id,
        name: os.name,
        type: os.type,
        subType: os.subType,
        version: os.version,
        uniqueId: os.uniqueId,
        stepsCount: os.steps ? os.steps.length : 0,
        childComponents: os.childComponents ? os.childComponents.length : 0,
        hasBlockStructure: os.blockStructure && os.blockStructure.length > 0
      })),
      dataMappers: (globalData.dataMappers || []).map(dm => ({
        id: dm.id,
        name: dm.name,
        type: dm.type,
        description: dm.description,
        uniqueId: dm.uniqueId,
        configItemsCount: dm.configItems ? dm.configItems.length : 0
      }))
    }
  };
  
    res.json({
      success: true,
      summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ [GLOBAL-SUMMARY] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve global component summary',
      error: error.message
    });
  }
});

app.get('/api/omnistudio/instances', loginModule.requireAuth, (req, res) => {
  omnistudioModule.getInstances(req, res);
});

app.get('/api/omnistudio/search', loginModule.requireAuth, (req, res) => {
  omnistudioModule.searchComponents(req, res);
});

app.get('/api/omnistudio/:componentType/:instanceName/details', loginModule.requireAuth, (req, res) => {
  omnistudioModule.getInstanceDetails(req, res);
});

// 📦 Get component from cached data (avoiding SOQL queries) - PREFERRED METHOD
app.get('/api/omnistudio/:componentType/:instanceName/cached', loginModule.requireAuth, (req, res) => {
  omnistudioModule.getCachedComponent(req, res);
});

// 🔗 API endpoint to load child IP hierarchy for expandable IP references
app.get('/api/omnistudio/ip-reference/:ipName/hierarchy', loginModule.requireAuth, (req, res) => {
  omnistudioModule.getChildIPHierarchy(req, res);
});

// 🧪 DEBUG: Force clear cache and reload 
app.post('/api/omnistudio/force-reload', loginModule.requireAuth, (req, res) => {
  console.log(`🔄 [FORCE-RELOAD] Clearing cache and forcing reload for org ${req.session.salesforce.organizationId}`);
  omnistudioModule.clearCache(req.session.salesforce.organizationId);
  omnistudioModule.loadAllComponents(req, res);
});

// 🔍 DEBUG: Inspect CustInfoBlock structure  
app.get('/api/debug/custinfoblock', async (req, res) => {
  try {
    console.log('🔥🔥🔥 [CUSTINFOBLOCK-DEBUG] === COMPREHENSIVE CUSTINFOBLOCK ANALYSIS ===');
    
    // Check all available org caches
    const cacheKeys = Array.from(omnistudioModule.orgComponentsDataCache.keys());
    console.log('🔍 [DEBUG] Available org caches:', cacheKeys);
    
    // Use the first available org or a default
    const orgId = cacheKeys.length > 0 ? cacheKeys[0] : 'debug-org';
    
    // Try to find Partner Initiate Selling Motion in cache
    if (omnistudioModule.orgComponentsDataCache.has(orgId)) {
      const cache = omnistudioModule.orgComponentsDataCache.get(orgId);
      const component = cache.omniscripts.find(os => 
        os.Name === 'Partner Initiate Selling Motion' || 
        os.UniqueId === 'Partner Initiate Selling Motion'
      );
      
      if (component && component.vlocity_cmt__Definition__c) {
        const definition = JSON.parse(component.vlocity_cmt__Definition__c.vlocity_cmt__Content__c);
        
        // Find AccountCapture step
        const accountCapture = definition.children?.find(child => child.name === 'AccountCapture');
        if (accountCapture) {
          // Find CustInfoBlock within AccountCapture
          let custInfoBlock = null;
          
          // Look in different possible locations
          if (accountCapture.children) {
            accountCapture.children.forEach((child, idx) => {
              if (child.eleArray) {
                child.eleArray.forEach((subChild, subIdx) => {
                  if (subChild.name === 'CustInfoBlock') {
                    custInfoBlock = {
                      location: `children[${idx}].eleArray[${subIdx}]`,
                      data: subChild
                    };
                  }
                });
              }
              if (child.name === 'CustInfoBlock') {
                custInfoBlock = {
                  location: `children[${idx}]`,
                  data: child
                };
              }
            });
          }
          
          if (custInfoBlock) {
            return res.json({
              success: true,
              custInfoBlock: custInfoBlock,
              structure: {
                type: custInfoBlock.data.type,
                name: custInfoBlock.data.name,
                hasChildren: !!custInfoBlock.data.children,
                childrenCount: custInfoBlock.data.children ? custInfoBlock.data.children.length : 0,
                hasEleArray: custInfoBlock.data.children && custInfoBlock.data.children[0] && !!custInfoBlock.data.children[0].eleArray,
                eleArrayCount: custInfoBlock.data.children && custInfoBlock.data.children[0] && custInfoBlock.data.children[0].eleArray 
                  ? custInfoBlock.data.children[0].eleArray.length : 0,
                firstLevelChildren: custInfoBlock.data.children 
                  ? custInfoBlock.data.children.map(c => ({ name: c.name, type: c.type }))
                  : [],
                eleArrayChildren: custInfoBlock.data.children && custInfoBlock.data.children[0] && custInfoBlock.data.children[0].eleArray
                  ? custInfoBlock.data.children[0].eleArray.map(c => ({ name: c.name, type: c.type }))
                  : []
              }
            });
          } else {
            return res.json({ success: false, message: 'CustInfoBlock not found in AccountCapture' });
          }
        } else {
          return res.json({ success: false, message: 'AccountCapture not found' });
        }
      } else {
        return res.json({ success: false, message: 'Partner Initiate Selling Motion not found in cache' });
      }
    } else {
      return res.json({ success: false, message: 'No cache found for org' });
    }
  } catch (error) {
    console.error('❌ [DEBUG-CUSTINFOBLOCK] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 🔍 DEBUG: Check Partner_SalesOrder fields directly
app.get('/api/debug/partner-salesorder', loginModule.requireAuth, async (req, res) => {
  try {
    const connection = omnistudioModule.createConnection(req);
    const query = `
      SELECT Id, Name, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Version__c,
             vlocity_cmt__ProcedureKey__c, vlocity_cmt__IsActive__c, vlocity_cmt__IsProcedure__c
      FROM vlocity_cmt__OmniScript__c 
      WHERE Name = 'Partner_SalesOrder'
      ORDER BY vlocity_cmt__Version__c DESC
    `;
    const result = await connection.query(query);
    res.json({
      success: true,
      query: query,
      count: result.records.length,
      records: result.records.map(r => ({
        Id: r.Id,
        Name: r.Name,
        Type: r.vlocity_cmt__Type__c,
        SubType: r.vlocity_cmt__SubType__c,
        Version: r.vlocity_cmt__Version__c,
        ProcedureKey: r.vlocity_cmt__ProcedureKey__c,
        IsActive: r.vlocity_cmt__IsActive__c,
        IsProcedure: r.vlocity_cmt__IsProcedure__c,
        MeetsLoadAllCriteria: r.vlocity_cmt__IsProcedure__c && r.vlocity_cmt__IsActive__c
      }))
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Admin Console API routes
app.get('/api/admin/system-overview', loginModule.requireAuth, (req, res) => {
  adminModule.getSystemOverview(req, res);
});

app.get('/api/admin/component-data-status', loginModule.requireAuth, (req, res) => {
  adminModule.getComponentDataStatus(req, res);
});

app.get('/api/admin/session-info', loginModule.requireAuth, (req, res) => {
  adminModule.getSessionInfo(req, res);
});

app.get('/api/admin/environment-info', loginModule.requireAuth, (req, res) => {
  adminModule.getEnvironmentInfo(req, res);
});

app.get('/api/admin/server-logs', loginModule.requireAuth, (req, res) => {
  adminModule.getServerLogs(req, res);
});

app.delete('/api/admin/cache/:orgId', loginModule.requireAuth, (req, res) => {
  adminModule.clearOrgCache(req, res);
});

app.delete('/api/admin/cache-all', loginModule.requireAuth, (req, res) => {
  adminModule.clearAllCaches(req, res);
});

// Redis Cache API routes
app.get('/api/redis/status', loginModule.requireAuth, async (req, res) => {
  try {
    const status = await redisModule.getStatus();
    res.json({
      success: true,
      redis: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get Redis status',
      error: error.message
    });
  }
});

// Get cached component data by org ID
app.get('/api/redis/component-data/:orgId', loginModule.requireAuth, async (req, res) => {
  try {
    const { orgId } = req.params;
    const cachedData = await redisModule.getCachedComponentData(orgId);
    
    if (cachedData) {
      res.json({
        success: true,
        data: cachedData,
        orgId: orgId,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        message: `No cached component data found for org ${orgId}`,
        orgId: orgId
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve cached component data',
      error: error.message
    });
  }
});

// Get all cached component data
app.get('/api/redis/component-data', loginModule.requireAuth, async (req, res) => {
  try {
    const allCachedData = await redisModule.getAllCachedComponentData();
    
    res.json({
      success: true,
      data: allCachedData,
      orgCount: Object.keys(allCachedData).length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve all cached component data',
      error: error.message
    });
  }
});

// Clear cached component data for specific org
app.delete('/api/redis/component-data/:orgId', loginModule.requireAuth, async (req, res) => {
  try {
    const { orgId } = req.params;
    const result = await redisModule.clearCachedComponentData(orgId);
    
    res.json({
      success: result,
      message: `Cached component data cleared for org ${orgId}`,
      orgId: orgId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to clear cached component data',
      error: error.message
    });
  }
});

// Clear all cached component data
app.delete('/api/redis/component-data', loginModule.requireAuth, async (req, res) => {
  try {
    const result = await redisModule.clearCachedComponentData();
    
    res.json({
      success: result,
      message: 'All cached component data cleared',
      orgId: 'all',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to clear cached component data',
      error: error.message
    });
  }
});

// Set key-value pair in Redis
app.post('/api/redis/kv', loginModule.requireAuth, async (req, res) => {
  try {
    const { key, value, expireSeconds } = req.body;
    
    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'Key is required'
      });
    }
    
    const result = await redisModule.set(key, value, expireSeconds);
    
    res.json({
      success: result,
      message: result ? 'Key-value pair stored successfully' : 'Failed to store key-value pair',
      key: key,
      hasExpiration: !!expireSeconds,
      expirationSeconds: expireSeconds,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to store key-value pair',
      error: error.message
    });
  }
});

// Get value by key from Redis
app.get('/api/redis/kv/:key', loginModule.requireAuth, async (req, res) => {
  try {
    const { key } = req.params;
    const parseJson = req.query.parseJson === 'true';
    
    const value = await redisModule.get(key, parseJson);
    
    if (value !== null) {
      res.json({
        success: true,
        key: key,
        value: value,
        parsed: parseJson,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        message: `Key '${key}' not found`,
        key: key
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve value',
      error: error.message
    });
  }
});

// Delete key from Redis
app.delete('/api/redis/kv/:key', loginModule.requireAuth, async (req, res) => {
  try {
    const { key } = req.params;
    const result = await redisModule.delete(key);
    
    res.json({
      success: result,
      message: result ? `Key '${key}' deleted successfully` : `Key '${key}' not found`,
      key: key,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete key',
      error: error.message
    });
  }
});

// Org-level settings
app.post('/api/redis/settings/org/:orgId/:settingName', loginModule.requireAuth, async (req, res) => {
  try {
    const { orgId, settingName } = req.params;
    const { value } = req.body;
    
    const result = await redisModule.setOrgSetting(orgId, settingName, value);
    
    res.json({
      success: result,
      message: result ? 'Org setting saved successfully' : 'Failed to save org setting',
      orgId: orgId,
      settingName: settingName,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to save org setting',
      error: error.message
    });
  }
});

app.get('/api/redis/settings/org/:orgId/:settingName', loginModule.requireAuth, async (req, res) => {
  try {
    const { orgId, settingName } = req.params;
    
    const value = await redisModule.getOrgSetting(orgId, settingName);
    
    if (value !== null) {
      res.json({
        success: true,
        orgId: orgId,
        settingName: settingName,
        value: value,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        message: `Org setting '${settingName}' not found for org '${orgId}'`,
        orgId: orgId,
        settingName: settingName
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve org setting',
      error: error.message
    });
  }
});

// User-level settings
app.post('/api/redis/settings/user/:userId/:settingName', loginModule.requireAuth, async (req, res) => {
  try {
    const { userId, settingName } = req.params;
    const { value } = req.body;
    
    const result = await redisModule.setUserSetting(userId, settingName, value);
    
    res.json({
      success: result,
      message: result ? 'User setting saved successfully' : 'Failed to save user setting',
      userId: userId,
      settingName: settingName,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to save user setting',
      error: error.message
    });
  }
});

app.get('/api/redis/settings/user/:userId/:settingName', loginModule.requireAuth, async (req, res) => {
  try {
    const { userId, settingName } = req.params;
    
    const value = await redisModule.getUserSetting(userId, settingName);
    
    if (value !== null) {
      res.json({
        success: true,
        userId: userId,
        settingName: settingName,
        value: value,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        message: `User setting '${settingName}' not found for user '${userId}'`,
        userId: userId,
        settingName: settingName
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user setting',
      error: error.message
    });
  }
});

// Sample event listener endpoint
app.post('/api/events', (req, res) => {
  const eventData = req.body;
  console.log('Received event:', eventData);
  
  res.json({
    success: true,
    message: 'Event received successfully',
    eventId: Date.now(),
    receivedAt: new Date().toISOString(),
    data: eventData
  });
});

// Sample events list endpoint
app.get('/api/events', (req, res) => {
  const sampleEvents = [
    {
      id: 1,
      type: 'user_login',
      timestamp: new Date().toISOString(),
      data: { userId: 'user123', email: 'user@example.com' }
    },
    {
      id: 2,
      type: 'button_click',
      timestamp: new Date().toISOString(),
      data: { buttonId: 'submit-btn', page: '/dashboard' }
    },
    {
      id: 3,
      type: 'form_submit',
      timestamp: new Date().toISOString(),
      data: { formId: 'contact-form', fields: 5 }
    }
  ];

  res.json({
    success: true,
    events: sampleEvents,
    count: sampleEvents.length
  });
});

// Debug: Cache clearing endpoint for omnistudio
app.post('/api/debug/clear-omnistudio-cache', (req, res) => {
  try {
    omnistudioModule.clearAllCaches();
    res.json({
      success: true,
      message: 'Omnistudio caches cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to clear caches',
      error: error.message
    });
  }
});

// 🧪 DEBUG: Inspect cache contents (no auth required for debugging)
const handleCacheContents = (req, res) => {
  try {
    const { componentType, searchTerm } = req.params;
    
    // Get all cache data
    const allCacheData = {};
    for (const [orgId, data] of omnistudioModule.orgComponentsDataCache.entries()) {
      allCacheData[orgId] = {
        totalComponents: data.totalComponents || 0,
        ipCount: data.integrationProcedures?.length || 0,
        osCount: data.omniscripts?.length || 0,
        dmCount: data.dataMappers?.length || 0,
        loadedAt: data.loadedAt,
        orgName: data.orgName
      };
      
      // Add component search if requested
      if (componentType && searchTerm) {
        let components = [];
        switch (componentType.toLowerCase()) {
          case 'integration-procedure':
          case 'ip':
            components = data.integrationProcedures || [];
            break;
          case 'omniscript':
          case 'os':
            components = data.omniscripts || [];
            break;
        }
        
        const matches = components.filter(comp => 
          comp.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
        
        allCacheData[orgId].searchResults = matches.map(comp => ({
          name: comp.name,
          type: comp.type,
          subType: comp.subType,
          stepsCount: comp.steps?.length || 0,
          hasExpandedChildren: comp.steps?.some(step => 
            step.blockType === 'ip-reference' && step.hasExpandedStructure
          ) || false
        }));
      }
    }
    
    res.json({
      success: true,
      cacheData: allCacheData,
      totalOrgs: Object.keys(allCacheData).length
    });
    
  } catch (error) {
    res.json({
      success: false,
      message: error.message,
      stack: error.stack
    });
  }
};

app.get('/api/debug/cache-contents/:componentType/:searchTerm', handleCacheContents);
app.get('/api/debug/cache-contents/:componentType', handleCacheContents);
app.get('/api/debug/cache-contents', handleCacheContents);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// Serve React app for all non-API routes in production
if (NODE_ENV === 'production') {
  app.get(/^(?!\/api).*$/, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
  });
}

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id, 'from:', socket.handshake.address);
  console.log('📊 Total active connections:', io.engine.clientsCount);
  activeConnections.set(socket.id, socket);

  socket.on('disconnect', (reason) => {
    console.log('🔌 Client disconnected:', socket.id, 'Reason:', reason);
    console.log('📊 Total active connections:', io.engine.clientsCount - 1);
    activeConnections.delete(socket.id);
  });

  socket.on('ping', () => {
    socket.emit('pong');
  });
});

// Cleanup function for platform event subscriptions
const cleanup = async () => {
  console.log('🛑 [SERVER] Shutdown signal received, cleaning up...');
  try {
    await platformEventsModule.cleanupSubscriptions();
    
    // Disconnect Redis
    if (redisModule && redisModule.isAvailable()) {
      console.log('🔌 [REDIS] Disconnecting Redis client...');
      await redisModule.disconnect();
    }
    
    console.log('📝 [LOGGING] Closing log file...');
    logStream.end();
  } catch (error) {
    console.error('❌ [SERVER] Error during cleanup:', error);
  }
  process.exit(0);
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup); // Handle Ctrl+C

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Server URL: http://localhost:${PORT}`);
  console.log(`💡 Environment: ${NODE_ENV}`);
  console.log(`🔌 WebSocket server ready for connections`);
  console.log(`📦 Using modular architecture:`);
  console.log(`   🔐 LoginModule initialized`);
  console.log(`   📡 PlatformEventsModule initialized`);
  console.log(`   📊 SObjectsModule initialized`);
  console.log(`   ⚙️ OrderManagementModule initialized`);
  console.log(`   🔗 OmnistudioModule initialized (with Redis integration)`);
  console.log(`   🔌 RedisModule initialized (${redisModule.isAvailable() ? 'Connected' : 'Offline'})`);
  console.log(`   👑 AdminModule initialized`);
  
  // Start React development server automatically in development mode
  if (NODE_ENV === 'development') {
    console.log(`\n🎯 Starting full-stack application...`);
    startReactDev();
    console.log(`\n✨ Access your application:`);
    console.log(`   🌐 React App: http://localhost:${CLIENT_PORT}`);
    console.log(`   🔗 API Server: http://localhost:${PORT}`);
    console.log(`   🐛 Debug Server: ws://localhost:9229 (if --inspect flag used)`);
  } else {
    console.log(`\n✨ Production app available at: http://localhost:${PORT}`);
  }
});