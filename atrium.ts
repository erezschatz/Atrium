/**
 * atrium.ts — Entry point. The only file that boots a server.
 *
 */
import { createRegistry } from './core/registry.ts';
import { authMiddleware, sessionCheckScript, type AuthConfig } from './core/auth.ts';
import type { Chamber } from './core/types.ts';

// Chambers

import domo, { setChambers } from './core/chambers/domo/mod.ts';

// Config — declared early so chamber loading can reference DOMAIN.

const DOMAIN = Deno.env.get('ATRIUM_DOMAIN') ?? 'atrium.local';
const PORT = parseInt(Deno.env.get('ATRIUM_PORT') ?? '443', 10);

const chambers: Chamber[] = [{ ...domo, domain: DOMAIN }];

// Load additional chambers declared in chambers.json.
// Format: { "<name>": { "path": "/chambers/<name>/", "domain": "optional.full.hostname" } }
// Paths are relative to the atrium root. If domain is omitted, defaults to "<name>.<DOMAIN>".
// Chambers on the Atrium domain are protected by auth; chambers on other domains are public.
try {
  const chambersJsonUrl = new URL('./chambers.json', import.meta.url);
  const chambersConfig: Record<string, { path: string; domain?: string }> = JSON.parse(
    await Deno.readTextFile(chambersJsonUrl.pathname),
  );
  for (const [name, entry] of Object.entries(chambersConfig)) {
    const modUrl = new URL('.' + entry.path + 'mod.ts', import.meta.url).href;
    const mod = await import(modUrl);
    const domain = entry.domain ?? `${name}.${DOMAIN}`;
    chambers.push({ ...mod.default as Chamber, domain });
  }
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) {
    throw e;
  }
}

setChambers(chambers.filter((c) => c.domain !== DOMAIN));

const CERT_PATH = Deno.env.get('CERT_PATH');
const KEY_PATH = Deno.env.get('KEY_PATH');
const tlsOptions = CERT_PATH && KEY_PATH
  ? { cert: Deno.readTextFileSync(CERT_PATH), key: Deno.readTextFileSync(KEY_PATH) }
  : {};

const auth: AuthConfig = {
  secret: Deno.env.get('ATRIUM_SECRET') ?? (() => {
    throw new Error('ATRIUM_SECRET env var is required');
  })(),
  username: Deno.env.get('ATRIUM_USER') ?? 'admin',
  password: Deno.env.get('ATRIUM_PASS') ?? (() => {
    throw new Error('ATRIUM_PASS env var is required');
  })(),
  domain: DOMAIN,
  port: PORT,
};

// Server

const registry = createRegistry(chambers);

console.log(`Atrium running on port ${PORT} — https://${DOMAIN}/`);
console.log(`Chambers: ${chambers.map((c) => c.domain).join(', ')}`);

Deno.serve({ port: PORT, ...tlsOptions }, async (req) => {
  const authResponse = await authMiddleware(req, auth);
  if (authResponse) {
    return authResponse;
  }

  const response = await registry.dispatch(req);

  const ct = response.headers.get('content-type') ?? '';
  if (!ct.includes('text/html')) {
    return response;
  }

  const body = await response.text();
  const script = sessionCheckScript(req, auth);
  // Inject into <head> so fetch/XHR interceptors are installed before chamber JS runs.
  const injected = body.includes('</head>')
    ? body.replace('</head>', script + '</head>')
    : body.includes('</body>')
      ? body.replace('</body>', script + '</body>')
      : body + script;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(injected, { status: response.status, headers });
});
