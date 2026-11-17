// Serves the JATL repo on http://localhost:5174 with the mock data service in place of data-service.js.
// The real database is never contacted. Run: node tests/mock/serve.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/data-service.js') p = '/tests/mock/mock-data-service.js';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(5174, '127.0.0.1', () => console.log('JATL mock on http://localhost:5174'));
