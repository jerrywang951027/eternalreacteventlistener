const swaggerJsdoc = require('swagger-jsdoc');

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
      servers: [
        {
          url: 'http://localhost:5000',
          description: 'Development server'
        }
      ]
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
