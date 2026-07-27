const path = require('node:path');

module.exports = {
  rootDir: path.resolve(__dirname, '../..'),
  testMatch: ['<rootDir>/packages/sdk/tests/**/*.test.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/packages/sdk/tsconfig.test.json' }],
  },
  testEnvironment: 'node',
};
