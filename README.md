# Eternal React Event Listener

A full stack React and Node.js application for eternal event listening.

## Project Structure

```
eternalreacteventlistener/
├── client/          # React frontend
├── server/          # Express.js backend
├── package.json     # Root package.json with unified scripts
└── README.md        # This file
```

## Prerequisites

- Node.js (v16 or higher)
- npm

## Quick Start

### Install all dependencies
```bash
npm run install-all
```

### 🚀 **Unified Development (Recommended)**
```bash
npm run dev
```

**This single command will:**
- ✅ Start Node.js server on `http://localhost:5000`
- ✅ Automatically start React dev server on `http://localhost:3000`  
- ✅ Enable WebSocket connections between client and server
- ✅ Set up hot reloading for both frontend and backend
- ✅ Configure CORS for seamless API communication

### 🐛 **Debug Mode**
```bash
npm run debug
```

Starts both client and server with Node.js debugger enabled on `ws://localhost:9229`

### 🏗️ **Production Build & Start**
```bash
npm run build
```

Builds React app and starts production server serving the built files

### 🔧 **Legacy Mode (Manual Control)**
```bash
# If you want to control client and server separately
npm run legacy:dev  # Runs both with concurrently (old method)
npm run legacy:server  # Server only
npm run legacy:client   # Client only
```

## API Endpoints

The backend server provides the following endpoints:

- `GET /` - Welcome message
- `GET /api/health` - Health check
- `GET /api/events` - Get sample events list
- `POST /api/events` - Submit new events

## Features

- ✅ React 19.1.1 frontend
- ✅ Express.js backend with CORS enabled
- ✅ Development proxy configuration
- ✅ Concurrent development workflow
- ✅ Sample event listener endpoints
- ✅ Error handling and 404 routes
- ✅ Environment variables support

## Development Workflow

1. Run `npm run dev` to start both applications
2. React app will open at `http://localhost:3000`
3. Backend API is available at `http://localhost:5000`
4. React app can make API calls to `/api/*` routes (proxied to backend)
5. Hot reloading enabled for both frontend and backend

## Salesforce Integration Features

### 🔐 **Authentication**
- Salesforce OAuth 2.0 integration
- Support for Production, Sandbox, and Custom orgs
- Session-based authentication with secure cookies

### 📡 **Platform Event Listening**
- Real-time platform event subscription using Salesforce Streaming API
- Automatic discovery of all platform events in connected org
- WebSocket connection for instant event delivery to frontend

### 🎨 **User Interface**
- Modern React dashboard with real-time event display
- Rolling event feed with timestamps and formatted data
- Connection status indicators and org information display

## Salesforce Setup Requirements

### 1. Create a Connected App in Salesforce

1. **Navigate to Setup** → Apps → App Manager → New Connected App
2. **Basic Information:**
   - Connected App Name: `Eternal React Event Listener`
   - API Name: `Eternal_React_Event_Listener`
   - Contact Email: Your email address

3. **API (Enable OAuth Settings):**
   - ✅ Enable OAuth Settings
   - **Callback URL:** `http://localhost:5000/api/auth/salesforce/callback`
   - **Selected OAuth Scopes:**
     - Access and manage your data (api)
     - Perform requests on your behalf at any time (refresh_token, offline_access)

4. **Save** and copy the **Consumer Key** and **Consumer Secret**

### 2. Environment Configuration

Create a `.env` file in the `server` directory:

```bash
# Server Configuration
PORT=5000
NODE_ENV=development
SESSION_SECRET=your-super-secret-session-key-here

# Salesforce OAuth Configuration
SALESFORCE_CLIENT_ID=your-consumer-key-from-connected-app
SALESFORCE_CLIENT_SECRET=your-consumer-secret-from-connected-app
SALESFORCE_REDIRECT_URI=http://localhost:5000/api/auth/salesforce/callback
```

### 3. Platform Events Setup (Optional)

To test platform events, create sample platform events in your Salesforce org:

1. **Setup** → Platform Events
2. **New Platform Event** (e.g., `Test_Event__e`)
3. Add custom fields as needed
4. Save and activate

## Usage Instructions

### 1. Start the Application
```bash
npm run dev
```

**You'll see:**
```
🚀 Server running on port 5000
🔌 WebSocket server ready for connections
🎯 Starting full-stack application...
🚀 Starting React development server...
[React] Compiled successfully!
📱 React app available at http://localhost:3000

✨ Access your application:
   🌐 React App: http://localhost:3000
   🔗 API Server: http://localhost:5000
```

### 2. Login Process
1. Open `http://localhost:3000` (automatically opens)
2. Select your org type (Production/Sandbox/Custom)
3. For custom, enter: `https://8x82--jinwandev8.sandbox.my.salesforce.com`
4. Click "Connect to Salesforce"
5. Complete OAuth in the popup window
6. You'll be redirected to the dashboard

### 3. Platform Event Listening
1. Dashboard shows all platform events in your org
2. Click "Start Listening" to subscribe to all events
3. Trigger platform events in Salesforce (via Process Builder, Flow, Apex, etc.)
4. Events appear in real-time in the rolling feed

## API Endpoints

### Authentication
- `POST /api/auth/salesforce/login` - Initiate Salesforce login
- `GET /api/auth/salesforce/callback` - OAuth callback handler
- `GET /api/auth/user` - Get current user info
- `POST /api/auth/logout` - Logout and clear session

### Platform Events
- `GET /api/platform-events` - Get available platform events
- `POST /api/platform-events/subscribe` - Subscribe to all platform events

### WebSocket Events
- `platformEvent` - Real-time platform event data

## Architecture

```
┌─────────────────┐    WebSocket    ┌──────────────────┐
│   React Client  │ ←──────────────→ │   Node.js Server│
└─────────────────┘                  └──────────────────┘
                                              │
                                              │ jsforce
                                              │ Streaming API
                                              ▼
                                    ┌──────────────────┐
                                    │   Salesforce Org │
                                    └──────────────────┘
```

## Troubleshooting

### Common Issues

1. **"Authentication failed"**
   - Verify Connected App Consumer Key/Secret in `.env`
   - Check callback URL matches exactly
   - Ensure Connected App is activated

2. **"No platform events found"**
   - Create custom platform events in your org
   - Standard platform events may not be visible via API

3. **"Connection failed"**
   - Check if both client and server are running
   - Verify CORS settings and proxy configuration

### Debug Tips

- Check browser console for WebSocket connection status
- Server logs show Salesforce API calls and platform event subscriptions
- Use Salesforce Debug Logs to verify platform event publishing
