#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('yaml');

const root = path.resolve(__dirname, '../..');
const contracts = [
  ['contracts/public/apicenter.openapi.yaml', 'packages/contracts/apicenter-openapi.json'],
  ['contracts/public/apicenter.asyncapi.yaml', 'packages/contracts/apicenter-asyncapi.json'],
];

for (const [source, destination] of contracts) {
  const sourcePath = path.join(root, source);
  const destinationPath = path.join(root, destination);
  const document = parse(fs.readFileSync(sourcePath, 'utf8'));
  fs.writeFileSync(destinationPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

console.log('Generated pinned APICenter public contract JSON artifacts.');
