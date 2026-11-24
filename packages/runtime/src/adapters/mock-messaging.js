// Senders that accept every message and send nothing, for local development and tests.
const { randomUUID } = require('node:crypto');

function createMockSmsSender() {
  return {
    provider: 'mock',
    defaultSenderId: undefined,
    hasPlatformSender: () => true,
    configured: () => true,
    async send() {
      return { providerMessageId: `mock_${randomUUID().replace(/-/g, '')}`, status: 'queued' };
    },
  };
}

function createMockEmailSender() {
  return {
    provider: 'mock',
    configured: () => true,
    async send() {
      return { providerMessageId: `mock_${randomUUID().replace(/-/g, '')}` };
    },
  };
}

module.exports = { createMockSmsSender, createMockEmailSender };
