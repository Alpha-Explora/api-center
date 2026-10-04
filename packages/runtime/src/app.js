const express = require('express');

function timestampMeta() {
  return { timestamp: new Date().toISOString() };
}

function createSuccessResponse(data, status = 200) {
  return {
    status,
    body: {
    success: true,
    data,
    meta: timestampMeta(),
    },
  };
}

function createFailureResponse(status, code, message, details) {
  return {
    status,
    body: {
      success: false,
      error: { code, message, ...(details === undefined ? {} : { details }) },
      meta: timestampMeta(),
    },
  };
}

function ok(res, data, status = 200) {
  const response = createSuccessResponse(data, status);
  return res.status(response.status).json(response.body);
}

function fail(res, status, code, message, details) {
  const response = createFailureResponse(status, code, message, details);
  return res.status(response.status).json(response.body);
}

function createSharedServiceApp({ serviceId, health = {}, jsonOptions } = {}) {
  const app = express();
  app.use(express.json(jsonOptions));
  app.get('/health', (_req, res) => ok(res, { serviceId, ...health }));
  return { app, ok, fail };
}

module.exports = { createSharedServiceApp, createSuccessResponse, createFailureResponse, ok, fail };
