#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';

const entry = resolve(process.argv[2] ?? '');
const root = dirname(entry);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2' };
if (!(await stat(entry).catch(() => null))?.isFile() || extname(entry) !== '.html') {
  process.stderr.write('no entry page found\n');
  process.exit(2);
}
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const target = pathname === '/' ? entry : resolve(root, `.${pathname}`);
  if (target !== entry && !target.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${server.address().port}/${encodeURIComponent(basename(entry))}\n`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
