import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve('dist');
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const fileFor = (url) => {
  const path = normalize(decodeURIComponent(url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path.endsWith('/') ? join(path, 'index.html') : path);
  return file.startsWith(ROOT) ? file : null;
};

createServer((req, res) => {
  const file = fileFor(req.url || '/');
  let size = 0;
  try {
    const stats = file ? statSync(file) : null;
    if (!stats || !stats.isFile()) {
      throw new Error('not found');
    }
    size = stats.size;
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    // Some e-reader browsers do not draw the page until the response ends. A known length and a closed connection end it clearly.
    'Content-Length': size,
    Connection: 'close',
  });
  createReadStream(file).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => `http://${item.address}:${PORT}/`);
  console.log(`Serving dist/ at http://localhost:${PORT}/`);
  addresses.forEach((address) => console.log(`On your network (for an e-reader): ${address}`));
});
