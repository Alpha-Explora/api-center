const express = require('express');

function timestampMeta() {
  return { timestamp: new Date().toISOString() };
}

function ok(res, data, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    meta: timestampMeta(),
  });
}

function fail(res, status, code, message, details) {
  return res.status(status).json({
    success: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
    meta: timestampMeta(),
  });
}

function createSharedServiceApp({ serviceId, health = {}, jsonOptions } = {}) {
  const app = express();
  app.use(express.json(jsonOptions));
  app.get('/health', (_req, res) => ok(res, { serviceId, ...health }));
  return { app, ok, fail };
}

module.exports = { createSharedServiceApp, ok, fail };
