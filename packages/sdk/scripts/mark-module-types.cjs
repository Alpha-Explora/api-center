// Marks each build output with its module format so Node loads dist/esm as ES modules and
// dist/cjs as CommonJS, whatever the package's own "type" is.
const fs = require('node:fs');
const path = require('node:path');
const dist = path.join(__dirname, '..', 'dist');
fs.writeFileSync(path.join(dist, 'esm', 'package.json'), JSON.stringify({ type: 'module' }) + '\n');
fs.writeFileSync(path.join(dist, 'cjs', 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
