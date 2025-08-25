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

// Global subscription management
let globalSalesforceConnection = null;

// Helper function to sync global connection across modules
function syncGlobalConnection(connection) {
  globalSalesforceConnection = connection;
  platformEventsModule.setGlobalConnection(connection);
  sObjectsModule.setGlobalConnection(connection);
  orderManagementModule.setGlobalConnection(connection);
  omnistudioModule.setGlobalConnection(connection);
}

// Initialize modules
const loginModule = new LoginModule(syncGlobalConnection);
const platformEventsModule = new PlatformEventsModule(io, platformEventSubscriptions);
const sObjectsModule = new SObjectsModule();
const orderManagementModule = new OrderManagementModule();
const omnistudioModule = new OmnistudioModule(globalSalesforceConnection);

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

app.get('/api/omnistudio/global-summary', loginModule.requireAuth, (req, res) => {
  const globalData = omnistudioModule.getGlobalComponentData();
  if (!globalData) {
    return res.status(404).json({
      success: false,
      message: 'No global component data loaded. Please call /api/omnistudio/load-all first.'
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
});

app.get('/api/omnistudio/instances', loginModule.requireAuth, (req, res) => {
  omnistudioModule.getInstances(req, res);
});

app.get('/api/omnistudio/:componentType/:instanceName/details', loginModule.requireAuth, (req, res) => {
  omnistudioModule.getInstanceDetails(req, res);
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