# API Logging Implementation for Agentforce

## Overview
All Agentforce API calls are now logged and visible in the "Show API Logs" panel in the Agentforce tab.

## What's Logged

### 1. Start Session API
**Logs when:** You click "🚀 Start Session"

**Request Log Contains:**
- URL: `https://api.salesforce.com/einstein/ai-agent/v1/agents/{agentId}/sessions`
- Method: `POST`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer {token}...` (truncated for security)
  - `x-salesforce-region: us-east-1`
  - `x-sfdc-tenant-id: core/prod/{orgId}`
- Payload:
  - `externalSessionKey`
  - `instanceConfig.endpoint`
  - `streamingCapabilities`
  - `bypassUser` (based on agentType: AEA=false, ASA=true)

**Response Log Contains:**
- Status: `200 OK` (or error status)
- Status Text: `OK` (or error message)
- Headers: Response headers from Salesforce
- Data:
  - `sessionId` - The actual session ID created
  - `messages[]` - Welcome messages from the agent
  - `_links` - HATEOAS links for session management

### 2. Send Message API
**Logs when:** You send a message to the agent

**Request Log Contains:**
- URL: `https://api.salesforce.com/einstein/ai-agent/v1/sessions/{sessionId}/messages`
- Method: `POST`
- Headers: Same as start session
- Payload:
  - `message.sequenceId` - Unique message ID
  - `message.type` - "Text"
  - `message.text` - Your message content
  - `variables[]` - Context variables

**Response Log Contains:**
- Status: `200 OK`
- Data:
  - `messages[]` - Agent's response messages
  - Response metadata

### 3. End Session API
**Logs when:** You click "🛑 End Session"

**Request Log Contains:**
- URL: `https://api.salesforce.com/einstein/ai-agent/v1/sessions/{sessionId}`
- Method: `DELETE`
- Headers:
  - Standard headers
  - `x-session-end-reason: UserRequest`

**Response Log Contains:**
- Status: `204 No Content` (typically)
- Confirmation of session termination

### 4. Error Responses
**Logs when:** Any API call fails

**Error Log Contains:**
- Status: HTTP error code (401, 404, 500, etc.)
- Status Text: Error description
- Data:
  - `error` - Error message
  - `details` - Detailed error from Salesforce API
  - Stack trace (if network error)

## How to View API Logs

1. Start an Agentforce session by clicking "🚀 Start Session"
2. Click "📋 Show API Logs" button
3. The logs panel will appear showing all API communications

### Log Display Features

- **Request Logs**: Blue badge, shows outbound API calls
- **Response Logs**: Green badge, shows inbound API responses
- **Error Logs**: Red badge, shows failed requests
- **Timestamps**: Each log entry shows date and time
- **Formatted JSON**: All data is pretty-printed for readability
- **Scrollable**: Logs panel scrolls independently
- **Persistent**: Logs remain available even after session ends

### Filtering Options

- **Current Session Only**: Shows logs only for the active session (default)
- **Show All Logs**: Toggle to see logs from all sessions (including past ones)
- **Refresh**: Click refresh icon to update logs

## Technical Implementation

### Backend (agentforce.js)

```javascript
// Log request before API call
const requestLog = {
  url: 'https://...',
  method: 'POST',
  headers: { ... },
  payload: { ... }
};
this.logAgentApiCommunication(sessionId, 'request', requestLog);

// Log response after API call
const responseLog = {
  status: response.status,
  statusText: response.statusText,
  headers: response.headers,
  data: response.data
};
this.logAgentApiCommunication(sessionId, 'response', responseLog);
```

### Storage

- Logs are stored in two places:
  1. `activeAgentSessions` Map - Session-specific logs (in-memory)
  2. `apiLogs` Map - Global logs across all sessions (in-memory)
- Logs persist even after session ends (for audit/debugging)
- Automatic cleanup: Limited to last 100 logs per session

### Frontend (TalkToSFDCAgentTab.js)

```javascript
// Fetch logs from backend
const response = await axios.get(
  '/api/salesforce/agentforce/filtered-logs',
  { params: { sessionId, showAll } }
);

// Display logs
{apiLogs.map(log => (
  <div className={`log-entry log-${log.type}`}>
    <div className="log-header">
      <span className="log-type">{log.type}</span>
      <span className="log-timestamp">{log.timestamp}</span>
    </div>
    <div className="log-data">
      <pre>{JSON.stringify(log.data, null, 2)}</pre>
    </div>
  </div>
))}
```

## What You Can Debug With This

1. **Session Creation Issues**
   - Check if orgId and tenantId are correct
   - Verify bypassUser is set correctly based on agentType
   - Confirm authentication token is valid
   - See the exact endpoint being called

2. **Message Delivery Problems**
   - Verify message payload format
   - Check sequenceId generation
   - See agent's raw response
   - Identify missing or malformed data

3. **Configuration Problems**
   - Verify headers are correct
   - Check if agentId is valid
   - Confirm region and tenant settings
   - See complete request/response cycle

4. **Error Diagnosis**
   - See exact error codes and messages
   - View Salesforce API error details
   - Identify authentication failures
   - Spot configuration issues

## Security Considerations

- **Access tokens are truncated** in request logs (only first 20 characters shown)
- **Full tokens are never logged** to console or stored in logs
- Logs are **in-memory only** (not persisted to disk)
- Logs are **session-specific** (users can only see their own session logs)

## Example Log Entry

```json
{
  "id": 1730140234567.8923,
  "type": "request",
  "timestamp": "2025-10-28T15:30:34.567Z",
  "data": {
    "url": "https://api.salesforce.com/einstein/ai-agent/v1/agents/0XxHo0000006y38KAA/sessions",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer 00D5e0000008cWEE...",
      "x-salesforce-region": "us-east-1",
      "x-sfdc-tenant-id": "core/prod/00D5e0000008cWEEAY"
    },
    "payload": {
      "externalSessionKey": "550e8400-e29b-41d4-a716-446655440000",
      "instanceConfig": {
        "endpoint": "https://trailsignup-a7c14218a38123.my.salesforce.com"
      },
      "streamingCapabilities": {
        "chunkTypes": ["Text"]
      },
      "bypassUser": false
    }
  }
}
```

## Benefits

✅ **Full Transparency** - See exactly what's being sent to Salesforce API  
✅ **Easy Debugging** - Quickly identify configuration or API issues  
✅ **Audit Trail** - Complete history of all API communications  
✅ **Learning Tool** - Understand how Salesforce Agent API works  
✅ **Configuration Verification** - Confirm new settings (agentType, orgId) work correctly  

## Future Enhancements

Potential improvements:
- Export logs to JSON file
- Filter by log type (request/response/error)
- Search within log content
- Persist logs to database for longer-term audit
- Add performance metrics (request duration)


