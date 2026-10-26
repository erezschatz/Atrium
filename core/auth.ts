const COOKIE_NAME = 'atrium_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthConfig {
  secret: string;
  username: string;
  password: string;
  domain: string; // e.g. "atrium.local" — used for cookie domain + redirects
  port: number;
}

/**
 * Middleware entry point
 * 
 * Returns a Response to send immediately (redirect / login page / error),
 * or null to let the request continue to the registry.
 */
export async function authMiddleware(
  req: Request,
  config: AuthConfig
): Promise<Response | null> {
  const url = new URL(req.url);

  // Chambers on unrelated domains are public — auth is a shared-domain feature.
  const hostname = url.hostname;
  if (hostname !== config.domain && !hostname.endsWith(`.${config.domain}`)) {
    return null;
  }

  if (url.pathname === '/login') {
    if (req.method === 'POST') {
      return handleLoginSubmit(req, config);
    }

    return serveLoginPage(false, url.searchParams.get('next') ?? '');
  }

  // PWA assets must be accessible before auth so browsers can install/update
  if (isPublicAsset(url.pathname)) {
    return null;
  }

  const token = parseCookie(req, COOKIE_NAME);
  if (token && await verifySession(token, config.secret)) {
    return null;
  }

  const { scheme, host } = externalBase(req, config);

  // For browser navigations, redirect to login. For fetch/XHR (API calls),
  // return 401 so the injected script can redirect without a cross-origin 302.
  if (isNavigationRequest(req)) {
    const nextUrl = req.url.replace(/^https?:/, `${scheme}:`);
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${scheme}://${host}/login?next=${encodeURIComponent(nextUrl)}`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response(null, {
    status: 401,
    headers: { 'X-Atrium-Login-Required': '1', 'Cache-Control': 'no-store' },
  });
}

function isNavigationRequest(req: Request): boolean {
  const mode = req.headers.get('sec-fetch-mode');
  if (mode !== null) {
    return mode === 'navigate';
  }
  // Fallback for older browsers / proxies that strip Sec-Fetch-* headers
  return (req.headers.get('accept') ?? '').startsWith('text/html');
}

function isPublicAsset(pathname: string): boolean {
  return /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf)$/i.test(pathname) ||
    ['/manifest.json', '/sw.js', '/service-worker.js'].includes(pathname);
}

function hostWithPort(domain: string, port: number, scheme = 'https'): string {
  const defaultPort = scheme === 'https' ? 443 : 80;
  return port === defaultPort ? domain : `${domain}:${port}`;
}

// When behind a reverse proxy (Caddy, nginx), X-Forwarded-Proto is set and
// the internal port should not appear in external-facing URLs.
function externalBase(req: Request, config: AuthConfig): {
  scheme: string;
  host: string
} {
  const proxied = req.headers.get('x-forwarded-proto');
  const scheme = proxied ?? new URL(req.url).protocol.slice(0, -1);
  const host = proxied ? config.domain : hostWithPort(config.domain, config.port, scheme);
  return { scheme, host };
}

function isValidNext(next: string, domain: string): boolean {
  try {
    const hostname = new URL(next).hostname;
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

// Login form submission

async function handleLoginSubmit(req: Request, config: AuthConfig): Promise<Response> {
  let username: string | undefined;
  let password: string | undefined;

  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const body = await req.formData();
    username = body.get('username')?.toString();
    password = body.get('password')?.toString();
  }

  const postUrl = new URL(req.url);
  const next = postUrl.searchParams.get('next') ?? '';
  const { scheme, host } = externalBase(req, config);

  if (username === config.username && password === config.password) {
    const { token, expires } = await createSession(config.secret);
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    const redirectTo = isValidNext(next, config.domain)
      ? next
      : `${scheme}://${host}/`;
    const cookieParts = [
      `${COOKIE_NAME}=${token}`,
      `Domain=.${config.domain}`,
      `Path=/`,
      `HttpOnly`,
      `SameSite=Lax`,
      `Max-Age=${maxAge}`,
    ];
    if (scheme === 'https') {
      cookieParts.push('Secure');
    }
    // Non-HttpOnly cookie so client-side JS can read expiry for proactive redirect
    const expiresCookieParts = [
      `atrium_expires=${expires}`,
      `Domain=.${config.domain}`,
      `Path=/`,
      `SameSite=Lax`,
      `Max-Age=${maxAge}`,
    ];
    if (scheme === 'https') {
      expiresCookieParts.push('Secure');
    }
    const headers = new Headers({ 'Location': redirectTo });
    headers.append('Set-Cookie', cookieParts.join('; '));
    headers.append('Set-Cookie', expiresCookieParts.join('; '));
    return new Response(null, { status: 302, headers });
  }

  return serveLoginPage(true, next);
}

// Session tokens — signed with HMAC-SHA256 via WebCrypto (no external deps)
// Token format: "<expiry_ms>.<base64url_signature>"

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function createSession(secret: string): Promise<{ token: string; expires: string }> {
  const key = await importKey(secret);
  const expires = (Date.now() + SESSION_TTL_MS).toString();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(expires));
  const sigB64 = toBase64Url(new Uint8Array(sig));
  return { token: `${expires}.${sigB64}`, expires };
}

async function verifySession(token: string, secret: string): Promise<boolean> {
  try {
    const dot = token.indexOf('.');
    if (dot === -1) {
      return false;
    }
    const expires = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    if (Date.now() > parseInt(expires, 10)) {
      return false;
    }

    const key = await importKey(secret);
    const sig = fromBase64Url(sigB64);
    return await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(expires));
  } catch {
    return false;
  }
}

// Helpers

function parseCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) {
      continue;}
    const key = part.slice(0, eqIdx).trim();
    if (key === name) {
      return part.slice(eqIdx + 1).trim();}
  }
  return null;
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array<ArrayBuffer> {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const binary = atob(padded);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

// Session-expiry check script — injected into every HTML response by atrium.ts.
// Reads the non-HttpOnly atrium_expires cookie and redirects to login when it
// is missing (cleared on a different device) or has expired.
export function sessionCheckScript(req: Request, config: AuthConfig): string {
  const { scheme, host } = externalBase(req, config);
  const loginBase = `${scheme}://${host}/login`;
  return `<script>(function(){` +
    `var L='${loginBase}';` +
    `var going=false;` +
    `function go(){if(going)return;going=true;location.replace(L+'?next='+encodeURIComponent(location.href));}` +
    // Timer-based check: redirect proactively when the session cookie says it expires
    `var m=document.cookie.match(/(?:^|;\\s*)atrium_expires=([^;]*)/);` +
    `var e=m?+m[1]:0;` +
    `if(!e||Date.now()>=e){go();return;}` +
    `setTimeout(go,e-Date.now());` +
    // Intercept fetch: redirect on any 401 that Atrium issued (not a chamber's own 401)
    `var _f=window.fetch;` +
    `window.fetch=function(){` +
    `return _f.apply(this,arguments).then(function(r){` +
    `if(r.status===401&&r.headers.get('x-atrium-login-required'))go();` +
    `return r;` +
    `});` +
    `};` +
    // Intercept XHR for the same reason
    `var _o=XMLHttpRequest.prototype.open;` +
    `XMLHttpRequest.prototype.open=function(){` +
    `this.addEventListener('load',function(){` +
    `if(this.status===401&&this.getResponseHeader('x-atrium-login-required'))go();` +
    `});` +
    `return _o.apply(this,arguments);` +
    `};` +
    `})();</script>`;
}

// Login page

function serveLoginPage(failed: boolean, next = ''): Response {
  const action = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atrium</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;
      background: #f0f0f0;
      color: #333;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #fff;
      border: 1px solid #d8d8d8;
      border-radius: 6px;
      padding: 2.5rem 2.75rem;
      width: 360px;
    }
    .wordmark {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #111;
      margin-bottom: 0.35rem;
    }
    .tagline {
      font-size: 0.72rem;
      color: #999;
      letter-spacing: 0.04em;
      margin-bottom: 2.25rem;
    }
    .error {
      font-size: 0.78rem;
      color: #c0392b;
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      font-size: 0.72rem;
      color: #888;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-bottom: 0.4rem;
    }
    input {
      width: 100%;
      background: #fafafa;
      border: 1px solid #d0d0d0;
      border-radius: 3px;
      color: #333;
      font-family: inherit;
      font-size: 0.9rem;
      padding: 0.55rem 0.75rem;
      margin-bottom: 1.25rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #aaa; }
    button {
      width: 100%;
      background: #f5f5f5;
      border: 1px solid #d0d0d0;
      border-radius: 3px;
      color: #333;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.85rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 0.6rem;
      margin-top: 0.25rem;
      transition: background 0.15s, border-color 0.15s;
    }
    button:hover { background: #eaeaea; border-color: #bbb; }
  </style>
</head>
<body>
  <div class="card">
    <div class="wordmark">Atrium</div>
    <div class="tagline">Personal application platform</div>
    ${failed ? '<div class="error">Invalid credentials.</div>' : ''}
    <form method="POST" action="${action}">
      <label for="u">Username</label>
      <input id="u" name="username" type="text" autocomplete="username" autofocus />
      <label for="p">Password</label>
      <input id="p" name="password" type="password" autocomplete="current-password" />
      <button type="submit">Enter</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: failed ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
