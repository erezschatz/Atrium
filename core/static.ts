import { promises as fs } from 'node:fs';
import path from 'node:path';

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
    '.txt': 'text/plain',
};

/**
 * Creates a static file handler rooted at the given directory.
 *
 * - Resolves directories to index.html
 * - Returns null if the file doesn't exist (caller decides what to do — 404 or SPA fallback)
 * - Refuses requests that escape the root
 *
 * Usage:
 *   const serve = makeStaticHandler('/path/to/frontend');
 *   const res = await serve(req);
 *   if (res) {
 *      return res;
 *   }
 */
export function makeStaticHandler(rootDir: string) {
    const root = path.resolve(rootDir);

    return async function serveStatic(req: Request): Promise<Response | null> {
        const url = new URL(req.url);
        let filePath = path.join(root, url.pathname);

        if (!filePath.startsWith(root)) {
            return new Response('Forbidden', { status: 403 });
        }

        try {
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
                filePath = path.join(filePath, 'index.html');
            }
        } catch {
            return null;
        }

        try {
            const content = new Uint8Array(await fs.readFile(filePath));
            const mimeType = MIME[path.extname(filePath)] ?? 'application/octet-stream';
            return new Response(content, { headers: { 'Content-Type': mimeType } });
        } catch {
            return null;
        }
    };
}

/**
 * Convenience wrapper for SPAs: falls back to index.html instead of null.
 * Use this when the frontend handles its own routing client-side.
 */
export function makeSpaHandler(rootDir: string) {
    const root = path.resolve(rootDir);
    const serveStatic = makeStaticHandler(root);

    return async function serveSpa(req: Request): Promise<Response> {
        const res = await serveStatic(req);
        if (res) {
            return res;
        }

        try {
            const index = await fs.readFile(path.join(root, 'index.html'), 'utf-8');
            return new Response(index, {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8'
                }
            });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    };
}