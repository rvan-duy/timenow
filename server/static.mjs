import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { AppError } from './workspace.mjs';

const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff'};

export async function serveStatic(req,res,pathname,directory) {
  if (!['GET','HEAD'].includes(req.method)) throw new AppError(405,'Method not allowed.');
  let path;
  try { path = decodeURIComponent(pathname); } catch { throw new AppError(400,'Invalid path.'); }
  const root = resolve(directory);
  const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(root + sep) || path.includes('\0') || path.split(/[\\/]/).some(part => part.startsWith('.'))) throw new AppError(404,'File not found.');
  let body;
  try { body = await readFile(file); } catch (error) {
    if (['ENOENT','EISDIR','ENOTDIR'].includes(error.code)) throw new AppError(404,'File not found.');
    throw error;
  }
  res.setHeader('Content-Type',types[extname(file)] || 'application/octet-stream');
  res.setHeader('Content-Length',body.length);
  res.setHeader('Cache-Control',path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.writeHead(200);
  res.end(req.method === 'HEAD' ? undefined : body);
}
