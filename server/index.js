const express = require('express');
const cors = require('cors');
const session = require('express-session');
const jsforce = require('jsforce');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

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
  if (process.env.HEROKU_APP_URL) {
    allowedOrigins.push(process.env.HEROKU_APP_URL);
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

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Authentication Routes
app.post('/api/auth/salesforce/login', (req, res) => {
  const { orgType, customUrl } = req.body;
  
  let loginUrl;
  switch (orgType) {
    case 'production':
      loginUrl = 'https://login.salesforce.com';
      break;
    case 'sandbox':
      loginUrl = 'https://test.salesforce.com';
      break;
    case 'custom':
      loginUrl = customUrl;
      break;
    default:
      return res.status(400).json({ success: false, message: 'Invalid org type' });
  }

  // Create OAuth2 connection
  const oauth2 = new jsforce.OAuth2({
    clientId: process.env.SALESFORCE_CLIENT_ID,
    clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
    redirectUri: process.env.SALESFORCE_REDIRECT_URI || 'http://localhost:5000/api/auth/salesforce/callback',
    loginUrl: loginUrl
  });

  req.session.oauth2 = oauth2;
  req.session.orgType = orgType;
  req.session.loginUrl = loginUrl;

  const authUrl = oauth2.getAuthorizationUrl({
    scope: 'api',
    state: 'mystate'
  });

  res.json({ success: true, authUrl });
});

app.get('/api/auth/salesforce/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!req.session.oauth2) {
    return res.redirect('http://localhost:3000?error=session_expired');
  }

  try {
    const conn = new jsforce.Connection({
      oauth2: req.session.oauth2
    });

    const userInfo = await conn.authorize(code);
    
    // Store connection info in session
    req.session.salesforce = {
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      instanceUrl: conn.instanceUrl,
      organizationId: userInfo.organizationId,
      userId: userInfo.id,
      orgType: req.session.orgType
    };

    // Redirect to success page
    res.redirect('http://localhost:3000?auth=success');
  } catch (error) {
    console.error('Salesforce auth error:', error);
    res.redirect('http://localhost:3000?error=auth_failed');
  }
});

app.get('/api/auth/user', (req, res) => {
  if (req.session.salesforce) {
    res.json({
      success: true,
      user: {
        userId: req.session.salesforce.userId,
        organizationId: req.session.salesforce.organizationId,
        instanceUrl: req.session.salesforce.instanceUrl,
        orgType: req.session.salesforce.orgType
      }
    });
  } else {
    res.status(401).json({ success: false, message: 'Not authenticated' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Platform Events Routes
app.get('/api/platform-events', async (req, res) => {
  if (!req.session.salesforce) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const conn = new jsforce.Connection({
      oauth2: req.session.oauth2,
      accessToken: req.session.salesforce.accessToken,
      instanceUrl: req.session.salesforce.instanceUrl
    });

    // Query for Platform Event definitions
    const result = await conn.sobject('EntityDefinition').find({
      QualifiedApiName: { $like: '%__e' },
      IsCustomizable: true
    }, 'QualifiedApiName, Label, DeveloperName');

    res.json({
      success: true,
      platformEvents: result || []
    });
  } catch (error) {
    console.error('Error fetching platform events:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch platform events' });
  }
});

app.post('/api/platform-events/subscribe', async (req, res) => {
  if (!req.session.salesforce) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const conn = new jsforce.Connection({
      oauth2: req.session.oauth2,
      accessToken: req.session.salesforce.accessToken,
      instanceUrl: req.session.salesforce.instanceUrl
    });

    // Get all platform events
    const platformEventsResult = await conn.sobject('EntityDefinition').find({
      QualifiedApiName: { $like: '%__e' },
      IsCustomizable: true
    }, 'QualifiedApiName, Label');

    const platformEvents = platformEventsResult || [];
    const subscriptions = [];

    // Subscribe to each platform event
    for (const event of platformEvents) {
      const eventName = event.QualifiedApiName;
      const channel = `/event/${eventName}`;
      
      try {
        const subscription = conn.streaming.topic(channel).subscribe((message) => {
          console.log('📨 Received platform event:', eventName, message);
          console.log('📡 Broadcasting to', io.engine.clientsCount, 'connected clients');
          
          // Emit to all connected clients
          const eventData = {
            eventName,
            eventLabel: event.Label,
            message,
            timestamp: new Date().toISOString()
          };
          
          io.emit('platformEvent', eventData);
          console.log('✅ Event broadcasted:', eventData);
        });

        subscriptions.push({
          eventName,
          eventLabel: event.Label,
          channel,
          subscription
        });

        // Store subscription for cleanup later
        platformEventSubscriptions.set(eventName, subscription);
      } catch (subError) {
        console.error(`Error subscribing to ${eventName}:`, subError);
      }
    }

    res.json({
      success: true,
      message: `Subscribed to ${subscriptions.length} platform events`,
      subscriptions: subscriptions.map(s => ({
        eventName: s.eventName,
        eventLabel: s.eventLabel,
        channel: s.channel
      }))
    });

  } catch (error) {
    console.error('Error subscribing to platform events:', error);
    res.status(500).json({ success: false, message: 'Failed to subscribe to platform events' });
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
process.on('SIGTERM', () => {
  console.log('Cleaning up platform event subscriptions...');
  platformEventSubscriptions.forEach((subscription, eventName) => {
    try {
      subscription.cancel();
      console.log(`Unsubscribed from ${eventName}`);
    } catch (error) {
      console.error(`Error unsubscribing from ${eventName}:`, error);
    }
  });
  platformEventSubscriptions.clear();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Server URL: http://localhost:${PORT}`);
  console.log(`💡 Environment: ${NODE_ENV}`);
  console.log(`🔌 WebSocket server ready for connections`);
  
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
