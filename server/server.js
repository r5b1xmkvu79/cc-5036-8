// Minimal static file server for the fold preview tool.
// Serves the project root; node_modules is mapped so three.js can be imported
// without a bundler.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') {
      const body = await readFile(join(root, 'web', 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(body);
      return;
    }

    // Explicit allow-list of top-level directories; everything else is served
    // from web/ (after rejecting path traversal).
    const allowedRoots = ['node_modules', 'src', 'web'];
    const top = pathname.split('/')[1];
    let filePath;
    if (allowedRoots.includes(top)) {
      filePath = normalize(join(root, pathname));
      if (!filePath.startsWith(root)) throw new Error('outside root');
    } else {
      filePath = normalize(join(root, 'web', pathname));
      if (!filePath.startsWith(join(root, 'web'))) throw new Error('outside web root');
    }
    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 not found');
  }
});

server.listen(port, () => {
  console.log(`fold preview tool: http://localhost:${port}/`);
});
