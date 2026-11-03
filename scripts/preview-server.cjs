const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../iot.aitalim.com/iot.aitalim.com');
http.createServer((request, response) => {
  const pathname = decodeURIComponent(request.url.split('?')[0]);
  const file = path.normalize(path.join(root, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(root)) return response.writeHead(403).end();
  fs.readFile(file, (error, data) => {
    if (error) return response.writeHead(404).end('Not found');
    response.end(data);
  });
}).listen(4173, () => console.log('Preview: http://127.0.0.1:4173'));
