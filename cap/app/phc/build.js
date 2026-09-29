const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const output = path.join(root, 'dist');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === 'build.js' || entry.name === 'package.json') continue;
  fs.cpSync(path.join(root, entry.name), path.join(output, entry.name), { recursive: true });
}
