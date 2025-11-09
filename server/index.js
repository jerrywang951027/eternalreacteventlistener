const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./swagger');

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
const SObjectFieldSearchModule = require('./modules/sobjectFieldSearch');
const OrderManagementModule = require('./modules/orderManagement');
const OmnistudioModule = require('./modules/omnistudio');
const AdminModule = require('./modules/admin');
const RedisModule = require('./modules/redis');
const AgentforceModule = require('./modules/agentforce');
const EnvManagerModule = require('./modules/envManager');
const DataCloudModule = require('./modules/dataCloud');

const PORT = process.env.PORT || 15000;
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
const sobjectFieldSearchModule = new SObjectFieldSearchModule();
const orderManagementModule = new OrderManagementModule();
const omnistudioModule = new OmnistudioModule(redisModule);
const adminModule = new AdminModule(omnistudioModule);
const agentforceModule = new AgentforceModule();
const envManagerModule = new EnvManagerModule();
const dataCloudModule = new DataCloudModule();

// Make login module available to other modules via app.locals
app.locals.loginModule = loginModule;

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
    message: 'Welcome to Salesforce Industries Explorer API',
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
/**
 * @swagger
 * /api/auth/orgs:
 *   get:
 *     summary: Get list of available Salesforce organizations
 *     description: Retrieve the list of configured Salesforce organizations for authentication
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: List of available organizations
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: Organization ID
 *                   name:
 *                     type: string
 *                     description: Organization name
 *                   url:
 *                     type: string
 *                     description: Salesforce instance URL
 *       500:
 *         description: Server error
 */
app.get('/api/auth/orgs', (req, res) => {
  loginModule.getOrgsList(req, res);
});

/**
 * @swagger
 * /api/auth/salesforce/login:
 *   post:
 *     summary: Initiate Salesforce OAuth login
 *     description: Start the Salesforce OAuth authentication flow
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orgId
 *             properties:
 *               orgId:
 *                 type: string
 *                 description: Salesforce organization ID
 *     responses:
 *       200:
 *         description: OAuth login initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authUrl:
 *                   type: string
 *                   description: Salesforce OAuth authorization URL
 *       400:
 *         description: Bad request - missing orgId
 *       500:
 *         description: Server error
 */
app.post('/api/auth/salesforce/login', (req, res) => {
  loginModule.handleSalesforceLogin(req, res);
});

/**
 * @swagger
 * /api/auth/salesforce/callback:
 *   get:
 *     summary: Handle Salesforce OAuth callback
 *     description: Process the OAuth callback from Salesforce and complete authentication
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: OAuth authorization code from Salesforce
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: OAuth state parameter
 *     responses:
 *       200:
 *         description: Authentication successful
 *       400:
 *         description: Bad request - invalid callback parameters
 *       401:
 *         description: Authentication failed
 *       500:
 *         description: Server error
 */
app.get('/api/auth/salesforce/callback', (req, res) => {
  loginModule.handleSalesforceCallback(req, res);
});

/**
 * @swagger
 * /api/auth/user:
 *   get:
 *     summary: Get current authenticated user information
 *     description: Retrieve information about the currently authenticated user
 *     tags: [Authentication]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: User information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   description: User information
 *                 org:
 *                   type: object
 *                   description: Organization information
 *                 authenticated:
 *                   type: boolean
 *                   description: Authentication status
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/auth/user', (req, res) => {
  loginModule.getCurrentUser(req, res);
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user and destroy session
 *     description: End user session and clear authentication
 *     tags: [Authentication]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Success status
 *                 message:
 *                   type: string
 *                   description: Success message
 *       500:
 *         description: Server error
 */
app.post('/api/auth/logout', (req, res) => {
  loginModule.handleLogout(req, res, platformEventsModule.cleanupSubscriptions.bind(platformEventsModule));
});

// Platform Events Routes
/**
 * @swagger
 * /api/platform-events:
 *   get:
 *     summary: Get available platform events
 *     description: Retrieve list of available Salesforce platform events
 *     tags: [Platform Events]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Platform events retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 events:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                         description: Event name
 *                       label:
 *                         type: string
 *                         description: Event label
 *                       description:
 *                         type: string
 *                         description: Event description
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/platform-events', loginModule.requireAuth, (req, res) => {
  platformEventsModule.fetchPlatformEvents(req, res);
});

/**
 * @swagger
 * /api/platform-events/subscribe:
 *   post:
 *     summary: Subscribe to platform events
 *     description: Subscribe to one or more Salesforce platform events
 *     tags: [Platform Events]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - events
 *             properties:
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of platform event names to subscribe to
 *     responses:
 *       200:
 *         description: Subscription successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 subscriptions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       event:
 *                         type: string
 *                       status:
 *                         type: string
 *       400:
 *         description: Bad request - invalid event names
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.post('/api/platform-events/subscribe', loginModule.requireAuth, (req, res) => {
  platformEventsModule.subscribeToPlatformEvents(req, res);
});

/**
 * @swagger
 * /api/platform-events/cleanup:
 *   post:
 *     summary: Cleanup platform event subscriptions
 *     description: Manually cleanup and unsubscribe from all platform event subscriptions
 *     tags: [Platform Events]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Cleanup successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 cleanedCount:
 *                   type: number
 *                   description: Number of subscriptions cleaned up
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.post('/api/platform-events/cleanup', loginModule.requireAuth, (req, res) => {
  platformEventsModule.manualCleanup(req, res);
});

/**
 * @swagger
 * /api/platform-events/status:
 *   get:
 *     summary: Get platform event subscription status
 *     description: Retrieve the status of all active platform event subscriptions
 *     tags: [Platform Events]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Subscription status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 subscriptions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       event:
 *                         type: string
 *                       status:
 *                         type: string
 *                       subscribedAt:
 *                         type: string
 *                         format: date-time
 *                 totalCount:
 *                   type: number
 *                   description: Total number of active subscriptions
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/platform-events/status', loginModule.requireAuth, (req, res) => {
  platformEventsModule.getSubscriptionStatus(req, res);
});

// SObjects Routes
/**
 * @swagger
 * /api/sobjects/search:
 *   get:
 *     summary: Search Salesforce SObjects
 *     description: Search for Salesforce SObjects by name or label
 *     tags: [SObjects]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of results to return
 *     responses:
 *       200:
 *         description: Search results retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       label:
 *                         type: string
 *                       keyPrefix:
 *                         type: string
 *       400:
 *         description: Bad request - missing search query
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/sobjects/search', loginModule.requireAuth, (req, res) => {
  sObjectsModule.searchSObjects(req, res);
});

/**
 * @swagger
 * /api/sobjects/all:
 *   get:
 *     summary: Get all Salesforce SObjects
 *     description: Retrieve list of all available Salesforce SObjects
 *     tags: [SObjects]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: SObjects retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 sobjects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       label:
 *                         type: string
 *                       keyPrefix:
 *                         type: string
 *                       custom:
 *                         type: boolean
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/sobjects/all', loginModule.requireAuth, (req, res) => {
  sObjectsModule.fetchAllSObjects(req, res);
});

/**
 * @swagger
 * /api/sobjects/{sobjectName}/describe:
 *   get:
 *     summary: Describe a Salesforce SObject
 *     description: Get detailed metadata and field information for a specific SObject
 *     tags: [SObjects]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: sobjectName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the SObject to describe
 *     responses:
 *       200:
 *         description: SObject description retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 describe:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     label:
 *                       type: string
 *                     fields:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           label:
 *                             type: string
 *                           type:
 *                             type: string
 *       401:
 *         description: Unauthorized - user not authenticated
 *       404:
 *         description: SObject not found
 *       500:
 *         description: Server error
 */
app.get('/api/sobjects/:sobjectName/describe', loginModule.requireAuth, (req, res) => {
  sObjectsModule.describeSObject(req, res);
});

/**
 * @swagger
 * /api/sobjects/{sobjectName}/query:
 *   get:
 *     summary: Query records from a Salesforce SObject
 *     description: Execute SOQL query to retrieve records from a specific SObject
 *     tags: [SObjects]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: sobjectName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the SObject to query
 *       - in: query
 *         name: fields
 *         schema:
 *           type: string
 *         description: Comma-separated list of fields to retrieve
 *       - in: query
 *         name: where
 *         schema:
 *           type: string
 *         description: WHERE clause for the SOQL query
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of records to return
 *     responses:
 *       200:
 *         description: Query executed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 records:
 *                   type: array
 *                   items:
 *                     type: object
 *                 totalSize:
 *                   type: number
 *       400:
 *         description: Bad request - invalid query parameters
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/sobjects/:sobjectName/query', loginModule.requireAuth, (req, res) => {
  sObjectsModule.querySObjectRecords(req, res);
});

/**
 * @swagger
 * /api/sobjects/execute-soql:
 *   post:
 *     summary: Execute free text SOQL query
 *     description: Execute a custom SOQL query provided by the user
 *     tags: [SObjects]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               query:
 *                 type: string
 *                 description: The SOQL query to execute
 *                 example: "SELECT Id, Name, CreatedDate FROM Account LIMIT 10"
 *     responses:
 *       200:
 *         description: Query executed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 records:
 *                   type: array
 *                   items:
 *                     type: object
 *                 totalSize:
 *                   type: integer
 *                 done:
 *                   type: boolean
 *       400:
 *         description: Bad request - invalid SOQL query
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.post('/api/sobjects/execute-soql', loginModule.requireAuth, (req, res) => {
  sObjectsModule.executeFreeSOQLQuery(req, res);
});

// SObject Field Search Routes
/**
 * @swagger
 * /api/sobjects/field-search/build-cache:
 *   post:
 *     summary: Build field metadata cache
 *     description: Build and cache field metadata for all SObjects in the org (excluding Share, Change, History, Feed suffixes)
 *     tags: [SObject Field Search]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Cache built successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 sobjectCount:
 *                   type: integer
 *                 errorCount:
 *                   type: integer
 *                 cachedAt:
 *                   type: string
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.post('/api/sobjects/field-search/build-cache', loginModule.requireAuth, (req, res) => {
  sobjectFieldSearchModule.buildFieldMetadataCache(req, res);
});

/**
 * @swagger
 * /api/sobjects/field-search/cache-status:
 *   get:
 *     summary: Check field cache status
 *     description: Check if field metadata cache exists for the current org
 *     tags: [SObject Field Search]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Cache status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 cached:
 *                   type: boolean
 *                 sobjectCount:
 *                   type: integer
 *                 cachedAt:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.get('/api/sobjects/field-search/cache-status', loginModule.requireAuth, (req, res) => {
  sobjectFieldSearchModule.getCacheStatus(req, res);
});

/**
 * @swagger
 * /api/sobjects/field-search/search:
 *   get:
 *     summary: Search SObjects by field name
 *     description: Search for SObjects that contain fields matching the query
 *     tags: [SObject Field Search]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Field name search query (minimum 2 characters)
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 sobjects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       label:
 *                         type: string
 *                       matchingFields:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             name:
 *                               type: string
 *                             label:
 *                               type: string
 *                             type:
 *                               type: string
 *                       matchCount:
 *                         type: integer
 *                 totalMatches:
 *                   type: integer
 *                 searchQuery:
 *                   type: string
 *                 cachedAt:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.get('/api/sobjects/field-search/search', loginModule.requireAuth, (req, res) => {
  sobjectFieldSearchModule.searchByFieldName(req, res);
});

/**
 * @swagger
 * /api/sobjects/field-search/clear-cache:
 *   delete:
 *     summary: Clear field metadata cache
 *     description: Clear the cached field metadata for the current org
 *     tags: [SObject Field Search]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.delete('/api/sobjects/field-search/clear-cache', loginModule.requireAuth, (req, res) => {
  sobjectFieldSearchModule.clearCache(req, res);
});

/**
 * @swagger
 * /api/sobjects/field-search/cache-data:
 *   get:
 *     summary: Get detailed field cache data
 *     description: Retrieve detailed statistics and full cache data for admin viewing
 *     tags: [SObject Field Search]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Cache data retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.get('/api/sobjects/field-search/cache-data', loginModule.requireAuth, (req, res) => {
  sobjectFieldSearchModule.getCacheData(req, res);
});

// Order Management Routes
/**
 * @swagger
 * /api/orders/search:
 *   get:
 *     summary: Search orders
 *     description: Search for orders using various criteria
 *     tags: [Order Management]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         description: Search query
 *     
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of results to return
 *     responses:
 *       200:
 *         description: Orders retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 orders:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       orderNumber:
 *                         type: string
 *                       status:
 *                         type: string
 *                       totalAmount:
 *                         type: number
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/orders/search', loginModule.requireAuth, (req, res) => {
  orderManagementModule.searchOrders(req, res);
});

/**
 * @swagger
 * /api/orders/{orderId}/items:
 *   get:
 *     summary: Get order items
 *     description: Retrieve all items for a specific order
 *     tags: [Order Management]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: Order ID
 *     responses:
 *       200:
 *         description: Order items retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       productName:
 *                         type: string
 *                       quantity:
 *                         type: number
 *                       unitPrice:
 *                         type: number
 *                       totalPrice:
 *                         type: number
 *       401:
 *         description: Unauthorized - user not authenticated
 *       404:
 *         description: Order not found
 *       500:
 *         description: Server error
 */
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
/**
 * @swagger
 * /api/omnistudio/load-all:
 *   post:
 *     summary: Load all OmniStudio components
 *     description: Load and cache all OmniStudio components from Salesforce
 *     tags: [OmniStudio]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Components loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Success status
 *                 message:
 *                   type: string
 *                   description: Success message
 *                 componentCount:
 *                   type: number
 *                   description: Number of components loaded
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.post('/api/omnistudio/load-all', loginModule.requireAuth, (req, res) => {
  omnistudioModule.loadAllComponents(req, res);
});

/**
 * @swagger
 * /api/omnistudio/load-all-components:
 *   post:
 *     summary: Load all OmniStudio components (alias for load-all)
 *     description: Load and cache all OmniStudio components from Salesforce
 *     tags: [OmniStudio]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Components loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.post('/api/omnistudio/load-all-components', loginModule.requireAuth, (req, res) => {
  omnistudioModule.loadAllComponents(req, res);
});

/**
 * @swagger
 * /api/omnistudio/global-data:
 *   get:
 *     summary: Get global OmniStudio component data
 *     description: Retrieve all cached OmniStudio component data
 *     tags: [OmniStudio]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Global component data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Component data organized by type
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/omnistudio/global-data', loginModule.requireAuth, (req, res) => {
  omnistudioModule.getGlobalComponentData(req, res);
});

/**
 * @swagger
 * /api/omnistudio/redis/toggle:
 *   post:
 *     summary: Toggle Redis functionality on/off
 *     description: Enable or disable Redis caching for OmniStudio components
 *     tags: [OmniStudio]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 description: Whether to enable Redis functionality
 *     responses:
 *       200:
 *         description: Redis status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 redisStatus:
 *                   type: object
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.post('/api/omnistudio/redis/toggle', loginModule.requireAuth, (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled parameter must be a boolean'
      });
    }
    
    const newStatus = omnistudioModule.toggleRedis(enabled);
    const redisStatus = omnistudioModule.getRedisStatus();
    
    res.json({
      success: true,
      message: `Redis functionality ${enabled ? 'enabled' : 'disabled'} successfully`,
      data: {
        redisStatus
      }
    });
  } catch (error) {
    console.error('❌ [REDIS-TOGGLE] Error toggling Redis:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle Redis: ' + error.message
    });
  }
});

/**
 * @swagger
 * /api/omnistudio/redis/status:
 *   get:
 *     summary: Get current Redis status
 *     description: Get the current Redis functionality status and availability
 *     tags: [OmniStudio]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Redis status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 redisStatus:
 *                   type: object
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/omnistudio/redis/status', loginModule.requireAuth, (req, res) => {
  try {
    const redisStatus = omnistudioModule.getRedisStatus();
    
    res.json({
      success: true,
      data: {
        redisStatus
      }
    });
  } catch (error) {
    console.error('❌ [REDIS-STATUS] Error getting Redis status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Redis status: ' + error.message
    });
  }
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

/**
 * @swagger
 * /api/omnistudio/instances:
 *   get:
 *     summary: Get OmniStudio component instances
 *     description: Retrieve list of OmniStudio component instances
 *     tags: [OmniStudio]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Component type filter (optional)
 *     responses:
 *       200:
 *         description: Component instances retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 instances:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       version:
 *                         type: string
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/omnistudio/instances', loginModule.requireAuth, (req, res) => {
  omnistudioModule.getInstances(req, res);
});

/**
 * @swagger
 * /api/omnistudio/search:
 *   get:
 *     summary: Search OmniStudio components
 *     description: Search for OmniStudio components by name or type
 *     tags: [OmniStudio]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Component type filter (optional)
 *     responses:
 *       200:
 *         description: Search results retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       score:
 *                         type: number
 *       400:
 *         description: Bad request - missing search query
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
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

// 🤖 Agentforce API endpoints
app.get('/api/salesforce/agentforce/agents', loginModule.requireAuth, async (req, res) => {
  try {
    const result = await agentforceModule.getAvailableAgents(req);
    res.json(result);
  } catch (error) {
    console.error('❌ [AGENTFORCE-ROUTE] Error in agents endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
});

app.post('/api/salesforce/agentforce/start-session', loginModule.requireAuth, async (req, res) => {
  try {
    const result = await agentforceModule.startAgentSession(req);
    res.json(result);
  } catch (error) {
    console.error('❌ [AGENTFORCE-ROUTE] Error in start-session endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
});

app.get('/api/salesforce/agentforce/config-status', loginModule.requireAuth, async (req, res) => {
  try {
    const result = await agentforceModule.getAgentConfigurationStatus(req);
    res.json(result);
  } catch (error) {
    console.error('❌ [AGENTFORCE-ROUTE] Error in config-status endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
});

app.post('/api/salesforce/agentforce/chat', loginModule.requireAuth, async (req, res) => {
  try {
    const result = await agentforceModule.sendChatMessage(req);
    res.json(result);
  } catch (error) {
    console.error('❌ [AGENTFORCE-ROUTE] Error in chat endpoint:', error);
    
    // Return detailed error information including API response if available
    const errorResponse = {
      success: false,
      message: 'Internal server error: ' + error.message,
      error: {
        message: error.message,
        stack: error.stack
      }
    };
    
    // Include Salesforce API response details if available
    if (error.response) {
      errorResponse.apiError = {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      };
    }
    
    res.status(error.response?.status || 500).json(errorResponse);
  }
});

app.delete('/api/salesforce/agentforce/end-session', loginModule.requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }
    
    const result = await agentforceModule.endAgentSession(sessionId);
    res.json(result);
  } catch (error) {
    console.error('❌ [AGENTFORCE-ROUTE] Error in end-session endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
});

app.get('/api/salesforce/agentforce/api-logs/:sessionId', loginModule.requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }
    
    const logs = agentforceModule.getAgentApiLogs(sessionId);
    res.json({
      success: true,
      logs: logs
    });
  } catch (error) {
    console.error('❌ [AGENTFORCE-ROUTE] Error in api-logs endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
});

// New endpoint for filtered logs (current session or all logs)
app.get('/api/salesforce/agentforce/filtered-logs', loginModule.requireAuth, async (req, res) => {
  try {
    const { sessionId, showAll } = req.query;
    
    let logs;
    if (showAll === 'true') {
      // Show all logs across all sessions
      logs = agentforceModule.getAllAgentApiLogs();
    } else if (sessionId) {
      // Show logs for specific session
      logs = agentforceModule.getAgentApiLogs(sessionId);
    } else {
      // Default: show logs for current active session (if any)
      logs = [];
    }
    
    res.json({
      success: true,
      logs: logs,
      filter: {
        sessionId: sessionId || null,
        showAll: showAll === 'true'
      }
    });
  } catch (error) {
    console.error('❌ [AGENTFORCE-ROUTE] Error in filtered-logs endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
});

/**
 * @swagger
 * /api/datacloud/connect:
 *   post:
 *     summary: Connect to Salesforce Data Cloud
 *     tags: [Data Cloud]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Successfully connected to Data Cloud
 *       401:
 *         description: Not authenticated with Salesforce
 *       500:
 *         description: Failed to connect to Data Cloud
 */
app.post('/api/datacloud/connect', loginModule.requireAuth, (req, res) => {
  dataCloudModule.connectDataCloud(req, res);
});

/**
 * @swagger
 * /api/datacloud/query:
 *   post:
 *     summary: Execute a Data Cloud SQL query
 *     tags: [Data Cloud]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sql:
 *                 type: string
 *                 description: SQL query to execute
 *     responses:
 *       200:
 *         description: Query executed successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Not connected to Data Cloud
 *       500:
 *         description: Failed to execute query
 */
app.post('/api/datacloud/query', loginModule.requireAuth, (req, res) => {
  dataCloudModule.executeQuery(req, res);
});

/**
 * @swagger
 * /api/datacloud/v3/query:
 *   post:
 *     summary: Execute a Data Cloud SQL query using V3 API
 *     tags: [Data Cloud]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sql:
 *                 type: string
 *                 description: SQL query to execute
 *     responses:
 *       200:
 *         description: Query executed successfully using V3 endpoint
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Failed to execute query
 */
app.post('/api/datacloud/v3/query', loginModule.requireAuth, (req, res) => {
  dataCloudModule.executeV3Query(req, res);
});

/**
 * @swagger
 * /api/datacloud/rag-eval:
 *   post:
 *     summary: Evaluate RAG search results using Salesforce LLM
 *     tags: [Data Cloud]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: Fully parsed evaluation prompt with all substitutions already done (frontend handles JSONPath and placeholder replacements)
 *               model:
 *                 type: string
 *                 description: LLM model to use (sfdc_ai__DefaultGPT4Omni, sfdc_ai__DefaultOpenAIGPT4OmniMini, or sfdc_ai__DefaultVertexAIGemini25Flash001)
 *                 default: sfdc_ai__DefaultGPT4Omni
 *     responses:
 *       200:
 *         description: Evaluation completed successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Failed to evaluate
 */
app.post('/api/datacloud/rag-eval', loginModule.requireAuth, (req, res) => {
  dataCloudModule.evaluateRagResults(req, res);
});

/**
 * @swagger
 * /api/datacloud/v3/metadata:
 *   get:
 *     summary: Get Data Cloud metadata using V3 API
 *     tags: [Data Cloud]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *           enum: [DataLakeObject, DataModel]
 *         required: true
 *         description: Entity type to retrieve metadata for
 *     responses:
 *       200:
 *         description: Metadata retrieved successfully using V3 endpoint
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Failed to fetch metadata
 */
app.get('/api/datacloud/v3/metadata', loginModule.requireAuth, (req, res) => {
  dataCloudModule.getV3Metadata(req, res);
});

/**
 * @swagger
 * /api/datacloud/metadata:
 *   get:
 *     summary: Get Data Cloud metadata for entity types
 *     tags: [Data Cloud]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *           enum: [DataLakeObject, DataModel]
 *         required: true
 *         description: Entity type to retrieve metadata for
 *     responses:
 *       200:
 *         description: Metadata retrieved successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Not connected to Data Cloud
 *       500:
 *         description: Failed to fetch metadata
 */
app.get('/api/datacloud/metadata', loginModule.requireAuth, (req, res) => {
  dataCloudModule.getMetadata(req, res);
});

/**
 * @swagger
 * /api/datacloud/status:
 *   get:
 *     summary: Get Data Cloud connection status
 *     tags: [Data Cloud]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Connection status retrieved
 */
app.get('/api/datacloud/status', loginModule.requireAuth, (req, res) => {
  dataCloudModule.getConnectionStatus(req, res);
});

/**
 * @swagger
 * /api/datacloud/disconnect:
 *   post:
 *     summary: Disconnect from Data Cloud
 *     tags: [Data Cloud]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Successfully disconnected
 */
app.post('/api/datacloud/disconnect', loginModule.requireAuth, (req, res) => {
  dataCloudModule.disconnectDataCloud(req, res);
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
/**
 * @swagger
 * /api/admin/system-overview:
 *   get:
 *     summary: Get system overview
 *     description: Retrieve comprehensive system overview including performance metrics
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: System overview retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 system:
 *                   type: object
 *                   properties:
 *                     uptime:
 *                       type: string
 *                     memory:
 *                       type: object
 *                     cpu:
 *                       type: object
 *                     connections:
 *                       type: number
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/admin/system-overview', loginModule.requireAuth, (req, res) => {
  adminModule.getSystemOverview(req, res);
});

/**
 * @swagger
 * /api/admin/redis-status:
 *   get:
 *     summary: Get Redis status
 *     description: Retrieve Redis configuration and connection status
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Redis status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     redis:
 *                       type: object
 *                     environment:
 *                       type: object
 *                     recommendations:
 *                       type: object
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/admin/redis-status', loginModule.requireAuth, (req, res) => {
  adminModule.getRedisStatus(req, res);
});

/**
 * @swagger
 * /api/admin/component-data-status:
 *   get:
 *     summary: Get component data status
 *     description: Retrieve status information about cached component data
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Component data status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: object
 *                   properties:
 *                     totalComponents:
 *                       type: number
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *                     cacheSize:
 *                       type: string
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.get('/api/admin/component-data-status', loginModule.requireAuth, (req, res) => {
  adminModule.getComponentDataStatus(req, res);
});

app.get('/api/admin/session-info', loginModule.requireAuth, (req, res) => {
  adminModule.getSessionInfo(req, res);
});

app.get('/api/admin/current-org-info', loginModule.requireAuth, (req, res) => {
  adminModule.getCurrentOrgInfo(req, res);
});

app.get('/api/admin/environment-info', loginModule.requireAuth, (req, res) => {
  adminModule.getEnvironmentInfo(req, res);
});

app.get('/api/admin/server-logs', loginModule.requireAuth, (req, res) => {
  adminModule.getServerLogs(req, res);
});

// Environment Manager API routes
/**
 * @swagger
 * /api/admin/env/orgs:
 *   get:
 *     summary: Get all organizations from .env file
 *     description: Retrieve list of all configured organizations from .env file
 *     tags: [Environment Management]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Organizations retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.get('/api/admin/env/orgs', loginModule.requireAuth, (req, res) => {
  envManagerModule.getOrgs(req, res);
});

/**
 * @swagger
 * /api/admin/env/orgs:
 *   put:
 *     summary: Update organizations in .env file
 *     description: Update all organizations in .env file (creates backup)
 *     tags: [Environment Management]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orgs:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Organizations updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.put('/api/admin/env/orgs', loginModule.requireAuth, (req, res) => {
  envManagerModule.updateOrgs(req, res);
});

/**
 * @swagger
 * /api/admin/env/orgs:
 *   post:
 *     summary: Add a new organization
 *     description: Add a new organization to .env file (creates backup)
 *     tags: [Environment Management]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               org:
 *                 type: object
 *     responses:
 *       200:
 *         description: Organization added successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.post('/api/admin/env/orgs', loginModule.requireAuth, (req, res) => {
  envManagerModule.addOrg(req, res);
});

/**
 * @swagger
 * /api/admin/env/orgs/{index}:
 *   delete:
 *     summary: Delete an organization
 *     description: Delete an organization from .env file (creates backup)
 *     tags: [Environment Management]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: index
 *         required: true
 *         schema:
 *           type: integer
 *         description: Organization index
 *     responses:
 *       200:
 *         description: Organization deleted successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Organization not found
 *       500:
 *         description: Server error
 */
app.delete('/api/admin/env/orgs/:index', loginModule.requireAuth, (req, res) => {
  envManagerModule.deleteOrg(req, res);
});

/**
 * @swagger
 * /api/admin/env/backups:
 *   get:
 *     summary: Get list of .env backup files
 *     description: Retrieve list of all .env backup files
 *     tags: [Environment Management]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Backup list retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.get('/api/admin/env/backups', loginModule.requireAuth, (req, res) => {
  envManagerModule.getBackups(req, res);
});

// Get backup file content
app.get('/api/admin/env/backups/:filename', loginModule.requireAuth, (req, res) => {
  envManagerModule.getBackupContent(req, res);
});

// Delete backup files
app.delete('/api/admin/env/backups', loginModule.requireAuth, (req, res) => {
  envManagerModule.deleteBackups(req, res);
});

// Get current .env content
app.get('/api/admin/env/current', loginModule.requireAuth, (req, res) => {
  envManagerModule.getCurrentEnvContent(req, res);
});

/**
 * @swagger
 * /api/admin/cache/{orgId}:
 *   delete:
 *     summary: Clear organization cache
 *     description: Clear all cached data for a specific organization
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *         description: Organization ID
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.delete('/api/admin/cache/:orgId', loginModule.requireAuth, (req, res) => {
  adminModule.clearOrgCache(req, res);
});

/**
 * @swagger
 * /api/admin/cache-all:
 *   delete:
 *     summary: Clear all caches
 *     description: Clear all cached data for all organizations
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: All caches cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 clearedCount:
 *                   type: number
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
app.delete('/api/admin/cache-all', loginModule.requireAuth, (req, res) => {
  adminModule.clearAllCaches(req, res);
});

// Redis Cache API routes
/**
 * @swagger
 * /api/redis/status:
 *   get:
 *     summary: Get Redis connection status
 *     description: Check if Redis server is connected and available
 *     tags: [Redis]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Redis status information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Success status
 *                 redis:
 *                   type: object
 *                   description: Redis connection details
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Response timestamp
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/redis/component-data/{orgId}:
 *   get:
 *     summary: Get cached component data for a specific org
 *     description: Retrieve cached OmniStudio component data for a specific Salesforce org
 *     tags: [Redis]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org ID
 *     responses:
 *       200:
 *         description: Cached component data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 orgId:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized - user not authenticated
 *       404:
 *         description: No cached data found for the org
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/redis/kv:
 *   post:
 *     summary: Set a key-value pair in Redis
 *     description: Store a key-value pair in Redis with optional expiration
 *     tags: [Redis]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - key
 *               - value
 *             properties:
 *               key:
 *                 type: string
 *                 description: Redis key
 *               value:
 *                 type: string
 *                 description: Value to store
 *               expireSeconds:
 *                 type: number
 *                 description: Expiration time in seconds (optional)
 *     responses:
 *       200:
 *         description: Key-value pair stored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 key:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Bad request - missing required fields
 *       401:
 *         description: Unauthorized - user not authenticated
 *       500:
 *         description: Server error
 */
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
        
        const matches = components.filter(comp => {
          if (componentType.toLowerCase() === 'integration-procedure' || componentType.toLowerCase() === 'ip') {
            // For IPs, search by BOTH name AND procedureKey for flexibility
            const searchLower = searchTerm.toLowerCase();
            const nameMatch = comp.name && comp.name.toLowerCase().includes(searchLower);
            const procedureKeyMatch = comp.procedureKey && comp.procedureKey.toLowerCase().includes(searchLower);
            return nameMatch || procedureKeyMatch;
          } else {
            // For other components, search by name
            return comp.name.toLowerCase().includes(searchTerm.toLowerCase());
          }
        });
        
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

// Serve Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Salesforce Industries Explorer API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    tryItOutEnabled: true,
    requestInterceptor: (request) => {
      // Add credentials for authenticated requests
      request.credentials = 'include';
      return request;
    }
  }
}));

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
  console.log(`   🔍 SObjectFieldSearchModule initialized`);
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