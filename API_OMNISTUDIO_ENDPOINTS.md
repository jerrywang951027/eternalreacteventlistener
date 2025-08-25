# Omnistudio API Endpoints

## Overview
This document describes the available API endpoints for accessing Omnistudio component data.

## Authentication
All endpoints require Salesforce authentication via the login flow.

---

## Endpoints

### 1. Load All Components
**POST** `/api/omnistudio/load-all`

Loads all Omnistudio components globally with hierarchical relationships.

**Response:**
```json
{
  "success": true,
  "message": "All components loaded successfully",
  "summary": {
    "integrationProcedures": 45,
    "omniscripts": 32,
    "dataMappers": 18,
    "totalComponents": 95,
    "hierarchicalRelationships": 12
  }
}
```

---

### 2. Get Full Global Data
**GET** `/api/omnistudio/global-data`

Returns the complete global component data with full details.

**Response:**
```json
{
  "success": true,
  "data": {
    "integrationProcedures": [...],
    "omniscripts": [...],
    "dataMappers": [...],
    "hierarchy": {...},
    "loadedAt": "2024-01-15T10:30:00.000Z",
    "totalComponents": 95
  }
}
```

---

### 3. Get Global Summary (NEW)
**GET** `/api/omnistudio/global-summary`

Returns a comprehensive summary of all Omnistudio components with metadata.

**Response:**
```json
{
  "success": true,
  "summary": {
    "loadedAt": "2024-01-15T10:30:00.000Z",
    "totalComponents": 95,
    "counts": {
      "integrationProcedures": 45,
      "omniscripts": 32,
      "dataMappers": 18
    },
    "hierarchyRelationships": 12,
    "components": {
      "integrationProcedures": [
        {
          "id": "a0X...",
          "name": "Partner_SalesOrder",
          "type": "Partner",
          "subType": "SalesOrder",
          "version": 18,
          "uniqueId": "Partner_SalesOrder",
          "stepsCount": 15,
          "childComponents": 2,
          "hasBlockStructure": true
        }
      ],
      "omniscripts": [
        {
          "id": "a0X...",
          "name": "Customer_Registration",
          "type": "Customer",
          "subType": "Registration", 
          "version": 5,
          "uniqueId": "Customer_Registration",
          "stepsCount": 8,
          "childComponents": 0,
          "hasBlockStructure": false
        }
      ],
      "dataMappers": [
        {
          "id": "a0X...",
          "name": "AccountMapper",
          "type": "Extract",
          "description": "Maps account data from Salesforce",
          "uniqueId": "AccountMapper",
          "configItemsCount": 12
        }
      ]
    }
  },
  "timestamp": "2024-01-15T10:35:22.123Z"
}
```

---

### 4. Get Instances (Filtered)
**GET** `/api/omnistudio/instances?componentType={type}&searchTerm={term}`

Returns filtered instances of a specific component type.

**Parameters:**
- `componentType`: integration-procedure | omniscript | data-mapper
- `searchTerm` (optional): Filter by name prefix

**Response:**
```json
{
  "success": true,
  "componentType": "integration-procedure",
  "instances": [...],
  "total": 45,
  "searchTerm": "Partner"
}
```

---

### 5. Get Instance Details
**GET** `/api/omnistudio/{componentType}/{instanceName}/details`

Returns detailed information for a specific component instance.

**Parameters:**
- `componentType`: integration-procedure | omniscript | data-mapper
- `instanceName`: The name of the component instance (URL encoded)

**Response:**
```json
{
  "success": true,
  "componentType": "integration-procedure",
  "instanceName": "Partner_SalesOrder",
  "details": {
    "name": "Partner_SalesOrder",
    "id": "a0X...",
    "componentType": "integration-procedure",
    "summary": {
      "type": "Partner",
      "subType": "SalesOrder",
      "version": 18,
      "childrenCount": 15,
      "steps": [...],
      "hierarchy": [...],
      "blockStructure": [...]
    }
  }
}
```

---

## Usage Examples

### JavaScript/Frontend
```javascript
// Load all components
const response = await axios.post('/api/omnistudio/load-all');

// Get summary data
const summary = await axios.get('/api/omnistudio/global-summary');
console.log(`Total components: ${summary.data.summary.totalComponents}`);

// Get filtered instances
const instances = await axios.get('/api/omnistudio/instances', {
  params: {
    componentType: 'integration-procedure',
    searchTerm: 'Partner'
  }
});
```

### cURL
```bash
# Load all components
curl -X POST http://localhost:5000/api/omnistudio/load-all \
  -H "Content-Type: application/json" \
  --cookie-jar cookies.txt

# Get summary
curl http://localhost:5000/api/omnistudio/global-summary \
  --cookie cookies.txt

# Get instances
curl "http://localhost:5000/api/omnistudio/instances?componentType=integration-procedure&searchTerm=Partner" \
  --cookie cookies.txt
```

---

## Features

### Hierarchical Relationships
The global data includes hierarchical relationships between components:
- Integration Procedure → Integration Procedure
- Integration Procedure → Omniscript  
- Omniscript → Omniscript
- Omniscript → Integration Procedure

Up to 4 levels of nesting are supported.

### Block Structure Analysis
Components are analyzed for special block types:
- **Conditional Blocks** - Decision logic branches
- **Loop Blocks** - Iterative processing  
- **Cache Blocks** - Performance optimization

### Performance
- Global loading happens once after login
- Subsequent queries use cached data
- Individual API fallbacks for basic functionality

---

## Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Not authenticated with Salesforce"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "No global component data loaded. Please call /api/omnistudio/load-all first."
}
```

### 500 Server Error
```json
{
  "success": false,
  "message": "Failed to load components: [error details]"
}
```
