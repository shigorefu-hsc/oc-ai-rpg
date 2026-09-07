import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import type { App } from './app';
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
};
export async function serve(
  app: App,
  req: Request,
  ip: string,
  root: string,
  basePath = '',
): Promise<Response> {
  const path = new URL(req.url).pathname;
  let response: Response;
  if (path.startsWith('/api/')) response = await app.handle(req, ip, basePath);
  else if (!['GET', 'HEAD'].includes(req.method))
    response = new Response('Method not allowed', { status: 405 });
  else {
    const localAudio =
      app.config.local && /^\/audio\/(intro\.mp3|level\.mp3|mumble\.wav)$/.test(path);
    const rel = path === '/' ? 'index.html' : path.slice(1);
    const file = localAudio ? resolve('source', path.slice(7)) : resolve(root, rel);
    if (!localAudio && !file.startsWith(resolve(root) + '/'))
      response = new Response('Not found', { status: 404 });
    else
      try {
        let body = await readFile(file);
        if (extname(file) === '.html')
          body = Buffer.from(
            body.toString().replace('<head>', '<head><base href="' + basePath + '/">'),
          );
        response = new Response(req.method === 'HEAD' ? null : body, {
          headers: {
            'content-type': mime[extname(file)] ?? 'application/octet-stream',
            'cache-control': path.startsWith('/assets/')
              ? 'public, max-age=31536000, immutable'
              : 'no-store',
          },
        });
      } catch {
        response = new Response('Not found', { status: 404 });
      }
  }
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  if (!app.config.local) {
    response.headers.set('strict-transport-security', 'max-age=31536000');
    response.headers.set(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' https://" +
        app.config.assetBucket +
        ".s3.ap-northeast-1.amazonaws.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  }
  return response;
}
