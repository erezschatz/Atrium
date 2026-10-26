# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
deno task start   # run production (reads .env manually via --allow-env)
deno task dev     # watch mode, restarts on file changes; auto-reads .env via --env flag
```

Type-check: `deno check atrium.ts`

Note: `deno task dev` is missing `--allow-write`, so Domo's config write endpoint fails in watch mode. `deno task start` has the full permission set.

To add a dependency, edit `import_map.json` (not `deno.json` — `deno.json` points at the import map via `"importMap": "./import_map.json"`). Never run `npm install`. Deno resolves on first use.

## Architecture

Atrium is a single Deno process that routes requests to multiple apps (**chambers**) by hostname. There is no subprocess spawning — chambers are imported as libraries and called as plain fetch handlers.

**Request flow:**
```
Deno.serve → authMiddleware → registry.dispatch → chamber.fetch
```

HTML responses get an inline `<script>` injected before `</head>` (`sessionCheckScript`) that reads the non-HttpOnly `atrium_expires` cookie and redirects to login when it expires or is missing.

**Core files:**
- `atrium.ts` — entry point; registers chambers, holds `DOMAIN`/`PORT`/TLS config; injects session check script into HTML responses
- `core/registry.ts` — maps full hostnames → chambers, dispatches via `new URL(req.url).hostname` (not `req.headers.get('host')`, which is null in HTTP/2 TLS)
- `core/auth.ts` — HMAC-SHA256 session middleware; login page; `?next=` redirect after login; `Secure` cookie only set when scheme is `https`; bypasses auth for PWA assets (`/manifest.json`, `/sw.js`, images, fonts); bypasses auth entirely for requests whose hostname is not `ATRIUM_DOMAIN` or a subdomain of it
- `core/static.ts` — `makeStaticHandler` (returns `null` on miss) and `makeSpaHandler` (falls back to `index.html`)
- `core/types.ts` — `Chamber` interface: `{ domain, displayName, fetch }`

**Domo (reception):** `core/chambers/domo/` is the built-in dashboard chamber. Its `domain` is set to `ATRIUM_DOMAIN` by `atrium.ts` at startup (chambers always export `domain: ""` as a placeholder — the real value comes from `chambers.json` or, for Domo, from `ATRIUM_DOMAIN`). `atrium.ts` calls `setChambers(chambers)` after building the list — this is how Domo learns about all registered chambers to display them in the dashboard. Domo also handles file browsing (`GET /api/files`), app launching (`POST /api/exec`), and trash/copy/move operations. Its config lives at `~/.domo`.

**Adding a chamber:** Create `chambers.json` at the atrium root (gitignored) and add an entry:

```json
{
  "myapp": { "path": "/chambers/myapp/" }
}
```

The `path` is relative to the atrium root. The optional `domain` field sets the full hostname for the chamber. If omitted, it defaults to `<name>.<ATRIUM_DOMAIN>` (e.g. `myapp.atrium.local`). Atrium imports `mod.ts` from that path at startup. Symlink the chamber's repo into `chambers/` so Atrium can import it in-process. Do not edit `atrium.ts` directly — only `domo` is hardcoded there.

**Auth and domains:** Auth is a shared-domain feature. A chamber whose `domain` is `ATRIUM_DOMAIN` or a subdomain of it is protected by Atrium's session middleware (cookie scoped to `.ATRIUM_DOMAIN` covers all subdomains automatically). A chamber on an unrelated domain (e.g. `blog.example.com`) is fully public — Atrium's auth middleware passes through without checking credentials. Such chambers are responsible for their own auth if they need it.

**Chamber conventions:**
- `mod.ts` exports a `Chamber` satisfying object as default with `domain: ""` (placeholder — overridden by atrium.ts at registration)
- Chambers with a backend use Hono and split routes (`/api/*` → Hono, everything else → `makeSpaHandler`)
- `if (import.meta.main)` block allows a chamber to be run standalone during development
- `chambers/` directory is gitignored; live chambers are symlinks to their own repos

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ATRIUM_SECRET` | yes | Signs session tokens (HMAC-SHA256) |
| `ATRIUM_PASS` | yes | Login password |
| `ATRIUM_USER` | no | Login username (default: `admin`) |
| `ATRIUM_DOMAIN` | no | Base domain (default: `atrium.local`) |
| `ATRIUM_PORT` | no | Port (default: `443`) |
| `CERT_PATH` | no | Path to TLS cert file (PEM); if set with `KEY_PATH`, Deno serves HTTPS directly |
| `KEY_PATH` | no | Path to TLS private key (PEM) |

Without `CERT_PATH`/`KEY_PATH`, Deno serves plain HTTP — intended for running behind nginx/Caddy which handles TLS termination. Generated URLs always use `https://`. When behind a reverse proxy, `X-Forwarded-Proto` is detected and the internal port is omitted from external-facing URLs.

## TLS / port notes

Port 443 requires elevated privileges on Linux. Apply with:
```bash
sudo setcap cap_net_bind_service=+ep $(readlink -f $(which deno))
```
Must be re-applied after each Deno upgrade. On Mac, use `pf` port forwarding or run on `ATRIUM_PORT=8443`.

For wildcard local HTTPS:
```bash
mkcert -cert-file certs/cert.pem -key-file certs/key.pem "*.atrium.local" atrium.local
```
Then set `CERT_PATH=certs/cert.pem` and `KEY_PATH=certs/key.pem` in `.env`.

DNS must be configured per-subdomain in `/etc/hosts` (or via a wildcard dnsmasq rule: `address=/.atrium.local/127.0.0.1`).
