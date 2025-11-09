const swaggerJsdoc = require('swagger-jsdoc');

// Dynamically determine server URLs based on environment
const getServerUrls = () => {
  const servers = [];
  
  // Production server (Heroku)
  if (process.env.NODE_ENV === 'production') {
    // Try multiple ways to get the Heroku URL
    const herokuUrl = process.env.HEROKU_APP_URL || 
                     (process.env.HEROKU_APP_NAME ? `https://${process.env.HEROKU_APP_NAME}.herokuapp.com` : null) ||
                     'https://eternalreacteventlistener-e56f201dd67b.herokuapp.com';
    
    servers.push({
      url: herokuUrl,
      description: 'Production server (Heroku)'
    });
  }
  
  // Development server (always include for testing)
  if (process.env.NODE_ENV !== 'production') {
    servers.push({
      url: 'http://localhost:15000',
      description: 'Development server'
    });
  }
  
  return servers;
};

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Salesforce Industries Explorer API',
      description: 'Comprehensive API for Salesforce integration, OmniStudio components, Redis caching, and system administration',
      version: '1.0.0',
      contact: {
        name: 'API Support',
        email: 'support@example.com'
      },
      servers: getServerUrls()
    },
    components: {
      securitySchemes: {
        sessionAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'connect.sid'
        }
      }
    },
    security: [
      {
        sessionAuth: []
      }
    ]
  },
  apis: [
    './modules/*.js',
    './index.js'
  ]
};

const specs = swaggerJsdoc(options);

module.exports = specs;
