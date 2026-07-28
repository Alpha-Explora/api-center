const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '../../packages/contracts/apicenter-openapi.json');
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));

const isSuccessEnvelope = (schema) =>
  schema?.type === 'object' && schema.required?.includes('success') && schema.required?.includes('data');
const isErrorEnvelope = (schema) =>
  schema?.type === 'object' && schema.required?.includes('success') && schema.required?.includes('error');

const wrapSuccess = (schema) =>
  isSuccessEnvelope(schema)
    ? schema
    : {
        type: 'object',
        required: ['success', 'data'],
        properties: { success: { const: true }, data: schema },
      };
const wrapError = (schema) =>
  isErrorEnvelope(schema)
    ? schema
    : {
        type: 'object',
        required: ['success', 'error'],
        properties: { success: { const: false }, error: schema },
      };

for (const operations of Object.values(doc.paths || {})) {
  for (const operation of Object.values(operations)) {
    if (!operation || typeof operation !== 'object') continue;
    for (const response of Object.values(operation.responses || {})) {
      const media = response.content?.['application/json'];
      if (media?.schema) media.schema = wrapSuccess(media.schema);
    }
  }
}

for (const [name, response] of Object.entries(doc.components?.responses || {})) {
  const media = response.content?.['application/json'];
  if (!media?.schema) continue;
  media.schema = name === 'Pending'
    ? { type: 'object', required: ['success', 'data'], properties: { success: { const: true }, data: { $ref: '#/components/schemas/PendingResource' } } }
    : wrapError(media.schema);
}

doc.components ||= {};
doc.components.schemas ||= {};
doc.components.schemas.SuccessEnvelope = {
  type: 'object',
  required: ['success', 'data'],
  properties: { success: { const: true }, data: {} },
};
doc.components.schemas.ErrorEnvelope = {
  type: 'object',
  required: ['success', 'error'],
  properties: {
    success: { const: false },
    error: { $ref: '#/components/schemas/Error' },
  },
};

fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');