const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'src');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
}
walk(root);
for (const file of files) {
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
}
console.log(`Checked ${files.length} JavaScript files.`);