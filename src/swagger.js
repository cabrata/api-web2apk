const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Web2APK Builder API',
      version: '1.0.0',
      description:
        'API untuk mengkonversi website menjadi aplikasi Android (APK & AAB). Kirim URL website, kustomisasi tampilan, dan dapatkan file APK/AAB yang siap di-install.',
      contact: {
        name: 'Web2APK',
      },
    },
    servers: [
      {
        url: '/',
        description: 'Current server',
      },
    ],
    tags: [
      {
        name: 'Build',
        description: 'Build & download Android apps',
      },
      {
        name: 'Jobs',
        description: 'Monitor build jobs',
      },
    ],
  },
  apis: ['./src/server.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
