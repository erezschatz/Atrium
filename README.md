# Atrium

A unified personal application platform. 
Atrium is a single Deno process that hosts multiple apps (called **chambers**), 
each served under its own hostname. One process, one `node_modules`, one login.

```
https://atrium.local          → domo (dashboard)
https://mail.atrium.local     → mail
https://music.atrium.local    → music player
etc
```

---

## How it works

Each app exports a single handler conforming to the `Chamber` interface. 
Atrium imports them like libraries — no subprocess spawning, no port management, no PM2. 
The app never owns a server; it just answers requests.

```ts
export default {
  domain:      '',             // placeholder — set by chambers.json at registration
  displayName: 'My App',
  fetch:       app.fetch,      // (req: Request) => Response | Promise<Response>
} satisfies Chamber;
```

---

## Prerequisites

- [Deno](https://deno.com) 1.40+
- [mkcert](https://github.com/FiloSottile/mkcert) for HTTPS (required — see below)

---

## Installation

### 1. Clone and configure

```bash
git clone <repo> atrium
cd atrium
cp .env.example .env
```

Edit `.env`:

```env
ATRIUM_SECRET=replace-with-a-long-random-string
ATRIUM_USER=admin
ATRIUM_PASS=replace-with-a-strong-password
ATRIUM_DOMAIN=atrium.local
ATRIUM_PORT=443
```

`ATRIUM_SECRET` signs session tokens. Generate one with:

```bash
openssl rand -hex 32
```

### 2. Set up HTTPS with mkcert

HTTPS is not optional. 
Browsers gate several critical APIs on secure contexts — `crypto.subtle`, 
service workers, and PWA installation all fail silently over plain HTTP on non-localhost domains.

```bash
# Install mkcert (Mac)
brew install mkcert

# Install mkcert (Ubuntu/WSL)
sudo apt install mkcert

# Install the local CA into your system/browser trust store
mkcert -install

# Generate a wildcard certificate covering atrium.local and all subdomains
mkdir -p certs
mkcert -cert-file certs/cert.pem -key-file certs/key.pem "*.atrium.local" atrium.local
```

Then add the paths to `.env`:

```env
CERT_PATH=certs/cert.pem
KEY_PATH=certs/key.pem
```

Add `certs/` to `.gitignore`.

### 3. Allow Deno to bind port 443

Ports below 1024 require elevated privileges.

**Linux / WSL:**

`setcap` refuses to operate on symlinks, so resolve the real binary path first:

```bash
sudo setcap cap_net_bind_service=+ep $(readlink -f $(which deno))
```

Note: this must be re-applied whenever Deno is upgraded, since `setcap` is set on the binary itself.

**Mac:**

`setcap` does not exist on macOS. Use `pf` to forward port 443 to an unprivileged port instead:

```bash
# Forward 443 → 8443
echo "rdr pass on lo0 proto tcp from any to any port 443 -> 127.0.0.1 port 8443" \
  | sudo pfctl -ef -
```

Then set `ATRIUM_PORT=8443` in `.env`.
The OS transparently redirects 443 to it. 
This does not survive reboots; 
to make it permanent, add the rule to `/etc/pf.conf`.

Alternatively, just run Atrium on `8443` directly and access it via `https://atrium.local:8443`. 
Useful for local development where the port-forwarding ceremony isn't worth it.

### 4. Add `/etc/hosts` entries

One line per chamber, plus the root:

```
127.0.0.1   atrium.local
127.0.0.1   mail.atrium.local
127.0.0.1   music.atrium.local
```

**Tip:** if you run a local DNS resolver like `dnsmasq`, 
a single wildcard rule replaces all individual lines:

```
address=/.atrium.local/127.0.0.1
```

### 5. Run

```bash
deno task start     # production
deno task dev       # watch mode (restarts on file changes)
```

---

## Adding a chamber

### Frontend-only app (no backend)

The simplest chamber is a single `mod.ts` that points at a static frontend directory.

Create `chambers/myapp/mod.ts`:

```ts
import { makeSpaHandler } from '../../core/static.ts';
import type { Chamber } from '../../core/types.ts';

export default {
  domain:      '',             // set by chambers.json at registration
  displayName: 'My App',
  fetch: makeSpaHandler(
    Deno.env.get('MYAPP_FRONTEND') ?? new URL('frontend', import.meta.url).pathname
  ),
} satisfies Chamber;
```

Add to `.env`:

```env
MYAPP_FRONTEND=/absolute/path/to/myapp/frontend
```

`makeSpaHandler` falls back to `index.html` for any unmatched path, 
which is what you want for client-side routing. 
Use `makeStaticHandler` instead if you have a backend layer that should own the 404.

### App with a backend

Symlink the project repo as the chamber directory so Atrium imports it in-process:

```bash
ln -s /absolute/path/to/myapp chambers/myapp
```

The project repo should contain:

```
myapp/
├── mod.ts        ← Chamber export (Atrium's entry point)
├── server.ts     ← Hono router, exported as { router, loadConfig }
├── frontend/     ← static files (or symlinked)
└── ...
```

`mod.ts` wires the router and static handler together:

```ts
import path from 'node:path';
import type { Chamber } from '../../core/types.ts';
import { router, loadConfig } from './server.ts';
import { makeSpaHandler } from '../../core/static.ts';

const FRONTEND_DIR = Deno.env.get('MYAPP_FRONTEND')
  ?? path.join(import.meta.dirname!, 'frontend');

await loadConfig();

const spaHandler = makeSpaHandler(FRONTEND_DIR);

const fetch = (req: Request): Response | Promise<Response> => {
  if (new URL(req.url).pathname.startsWith('/api/')) {
    return router.fetch(req);
  }
  return spaHandler(req);
};

export default { domain: '', displayName: 'My App', fetch } satisfies Chamber;

if (import.meta.main) {
  const port = parseInt(Deno.env.get('PORT') ?? '9000', 10);
  console.log(`MyApp standalone · http://localhost:${port}`);
  Deno.serve({ port }, fetch);
}
```

The `import.meta.main` guard lets you run the chamber as a standalone server during development with no changes needed.

### Register the chamber in Atrium

Add an entry to `chambers.json` in the atrium root (create the file if it doesn't exist — it is gitignored):

```json
{
  "myapp": { "path": "/chambers/myapp/" }
}
```

The `path` is relative to the atrium root, with a leading `/`.
The optional `domain` key sets the full hostname for the chamber.
If omitted, it defaults to `<name>.<ATRIUM_DOMAIN>` (e.g. `myapp.atrium.local`).

```json
{
  "myapp":  { "path": "/chambers/myapp/" },
  "blog":   { "path": "/chambers/blog/", "domain": "blog.example.com" }
}
```

Atrium imports `mod.ts` from each path at startup.
`domo` is built-in and does not appear in `chambers.json`.

Add the relevant `/etc/hosts` (or DNS) entry and you're done.

---

## Auth

Auth is a shared-domain feature. Chambers whose hostname matches `ATRIUM_DOMAIN` or any subdomain of it are protected by Atrium's session middleware — log in once at the root domain, access all of them. The session cookie is scoped to `.ATRIUM_DOMAIN` and is inherited automatically by every subdomain.

Chambers registered on an unrelated domain (e.g. `blog.example.com`) are fully public. Atrium's middleware does not check credentials for those requests. If such a chamber needs its own auth, it handles that internally.

Sessions are signed with HMAC-SHA256 via the Web Crypto API (no external dependencies). The token expires after 7 days.

Apps that have their own auth (e.g. authenticating to a remote server) are completely independent. Their tokens live in `localStorage` on their own origin and are invisible to Atrium's middleware.

---

## Frontend CSP notes

If your app's `index.html` contains `upgrade-insecure-requests` in its Content Security Policy, remove it:

```html
<!-- Remove this directive when serving over local HTTPS -->
upgrade-insecure-requests;
```

That directive was appropriate for public internet deployment but causes the browser to rewrite all resource URLs to `https://`, which breaks local serving before mkcert is set up and can cause confusing load failures.

The `connect-src 'self' https:` directive, on the other hand, is worth keeping — it restricts API calls to same-origin and HTTPS endpoints only, which is a genuine security win once you're running over HTTPS.

---

## Dependencies

All npm/jsr dependencies are declared in `import_map.json` (gitignored — create it at the atrium root if it doesn't exist) and resolved to a single `node_modules` directory. Chambers never have their own `package.json` or install their own dependencies.

Create or edit `import_map.json`:

```json
{
  "imports": {
    "hono": "npm:hono@^4",
    "hono/": "npm:hono@^4/",
    "my-new-dep": "npm:my-new-dep@^1"
  }
}
```

`deno.json` points at this file via `"importMap": "./import_map.json"`. Deno resolves packages on first use — no install step needed.

---

## Repository layout

```
atrium/
├── atrium.ts              ← entry point; domo is registered here
├── chambers.json          ← gitignored; declare external chambers here
├── import_map.json        ← gitignored; npm/jsr dependency aliases
├── deno.json              ← tasks and compiler options
├── .env.example           ← copy to .env; never commit .env
├── certs/                 ← mkcert output; never commit
├── core/
│   ├── types.ts           ← Chamber interface
│   ├── registry.ts        ← hostname dispatch
│   ├── auth.ts            ← HMAC session middleware + login page
│   ├── static.ts          ← makeStaticHandler / makeSpaHandler
│   └── chambers/          ← built-in chambers (domo, …)
└── chambers/              ← gitignored; symlinks to your own app repos
```

`chambers/` and `chambers.json` are gitignored. The symlinks in `chambers/` point into other repositories, each with its own version control. `chambers.json` is local configuration that varies per installation.

---

## Remote deployment

Atrium is designed to run both locally and on a public server. For remote deployment, run Atrium on an unprivileged port and put a reverse proxy (nginx, Caddy) in front to terminate TLS and forward traffic. The session cookie and auth layer work identically in both environments.

Caddy example (handles certificates automatically via Let's Encrypt):

```
*.erezschatz.net {
  reverse_proxy localhost:8443
}
```

Create `/etc/systemd/system/atrium.service`:

```ini
[Unit]
Description=Atrium personal application platform
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/atrium
EnvironmentFile=/home/YOUR_USER/atrium/.env
ExecStart=/home/YOUR_USER/.deno/bin/deno run \
  --allow-net --allow-read --allow-write --allow-env --allow-sys \
  atrium.ts
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Then run:
```bash
sudo systemctl daemon-reload      # pick up the new file
sudo systemctl enable atrium      # start on boot
sudo systemctl start atrium       # start now
sudo systemctl status atrium      # verify
```
And for logs:
```bash
journalctl -u atrium -f           # follow live
journalctl -u atrium --since today  # today's logs
```