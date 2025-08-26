# Redis Integration Documentation

## Overview

Redis integration has been successfully implemented to persist cached component data and provide system-level settings storage. The integration follows a fallback architecture where the application continues to work even if Redis is unavailable.

## Key Features

### 1. **Persistent Component Caching** 
- ✅ Component data is automatically cached in Redis with 2-day expiration
- ✅ On app restart, checks Redis first before making Salesforce calls
- ✅ Falls back to Salesforce if Redis data is missing or expired

### 2. **Connection Management**
- ✅ Local Redis server support (development)
- ✅ Heroku Redis support (production via `REDIS_URL`)
- ✅ Graceful failure handling - app works without Redis

### 3. **API Endpoints**
- ✅ Component data retrieval APIs
- ✅ Key-value storage APIs
- ✅ Org and user-level settings APIs
- ✅ Cache management APIs

## Configuration

### Environment Variables

**Development (Local Redis):**
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password (optional)
REDIS_DB=0 (optional)
```

**Production (Heroku Redis):**
```env
REDIS_URL=redis://user:pass@hostname:port (set by Heroku Redis add-on)
```

## API Endpoints

### Redis Status
- `GET /api/redis/status` - Get Redis connection status and stats

### Component Data Cache
- `GET /api/redis/component-data` - Get all cached component data
- `GET /api/redis/component-data/:orgId` - Get cached data for specific org
- `DELETE /api/redis/component-data/:orgId?` - Clear cache for org (or all if no orgId)

### Key-Value Storage
- `POST /api/redis/kv` - Set key-value pair
  ```json
  {
    "key": "mykey",
    "value": "myvalue",
    "expireSeconds": 3600
  }
  ```
- `GET /api/redis/kv/:key?parseJson=true` - Get value by key
- `DELETE /api/redis/kv/:key` - Delete key

### Org-Level Settings
- `POST /api/redis/settings/org/:orgId/:settingName` - Set org setting
- `GET /api/redis/settings/org/:orgId/:settingName` - Get org setting

### User-Level Settings
- `POST /api/redis/settings/user/:userId/:settingName` - Set user setting
- `GET /api/redis/settings/user/:userId/:settingName` - Get user setting

## How It Works

### 1. **Application Startup**
- Redis client automatically connects to local or Heroku Redis
- Connection status is logged during server initialization
- Application continues even if Redis is unavailable

### 2. **Component Data Loading Flow**

**First Time Load:**
1. Check Redis cache → Miss
2. Load from Salesforce
3. Process and expand component hierarchy
4. Store in memory cache
5. Store in Redis with 2-day expiration

**Subsequent Loads:**
1. Check Redis cache → Hit
2. Restore to memory cache
3. Return cached data (much faster)

**After App Restart:**
1. Memory cache is empty
2. API call triggers `getOrgComponentData()`
3. Memory cache miss → Check Redis
4. If Redis hit → Restore to memory
5. If Redis miss → Load from Salesforce

### 3. **Cache Expiration**
- Component data expires after 2 days (172800 seconds)
- Can be manually refreshed via `/api/omnistudio/force-reload`
- Clearing Redis cache forces fresh Salesforce load

## Architecture Benefits

### 1. **Performance**
- Eliminates slow Salesforce API calls for cached data
- Persists across application restarts
- Reduces Salesforce API consumption

### 2. **Reliability** 
- Graceful fallback when Redis unavailable
- Application never fails due to Redis issues
- Comprehensive error handling and logging

### 3. **Scalability**
- Supports multiple org data caching
- System and user-level settings storage
- Flexible key-value storage for future features

## Usage Examples

### Check Redis Status
```bash
curl -H "Authorization: Bearer <token>" \
     http://localhost:5000/api/redis/status
```

### Get Cached Component Data
```bash
curl -H "Authorization: Bearer <token>" \
     http://localhost:5000/api/redis/component-data/00D123456789ABC
```

### Store Custom Data
```bash
curl -X POST \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"key":"user_preference","value":{"theme":"dark"},"expireSeconds":86400}' \
     http://localhost:5000/api/redis/kv
```

### Set Org Setting
```bash
curl -X POST \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"value":{"autoRefresh":true,"interval":3600}}' \
     http://localhost:5000/api/redis/settings/org/00D123456789ABC/cache_settings
```

## Monitoring

The Redis integration provides comprehensive logging:

- `🔌 [REDIS] Connected to Redis server` - Connection established
- `🎯 [REDIS-HIT]` - Cache hit (data found)
- `📭 [REDIS-MISS]` - Cache miss (data not found)
- `💾 [REDIS-CACHE]` - Data cached successfully
- `🔍 [REDIS-FALLBACK]` - Fallback from memory to Redis
- `⚠️ [REDIS]` - Warnings (non-fatal)
- `❌ [REDIS]` - Errors

## Next Steps

1. **Install Redis locally** for development:
   ```bash
   # macOS
   brew install redis
   brew services start redis
   
   # Or run temporarily
   redis-server
   ```

2. **Add Heroku Redis** for production:
   ```bash
   heroku addons:create heroku-redis:mini
   ```

3. **Test the integration** by:
   - Loading component data
   - Restarting the app
   - Verifying Redis fallback works

## Troubleshooting

### Redis Connection Issues
- Check if Redis server is running
- Verify connection settings in environment variables
- Review server logs for Redis connection messages

### Cache Not Working
- Check `/api/redis/status` endpoint for connection status
- Verify Redis keys exist with `redis-cli keys "*"`
- Check expiration times with `redis-cli ttl <key>`

### Performance Issues
- Monitor Redis memory usage
- Consider increasing Redis max memory if needed
- Check network latency to Redis server

The Redis integration is now fully implemented and ready for use! 🚀

