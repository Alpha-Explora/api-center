const path = require('node:path');

module.exports = {
  rootDir: path.resolve(__dirname, '../..'),
  testMatch: ['<rootDir>/packages/sdk/tests/**/*.test.ts'],
  transform: {
    '^.+\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/packages/sdk/tsconfig.test.json' }],
  },
  // Sources import siblings with .js extensions for the ES module build.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
};
