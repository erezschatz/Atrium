# Domo
*どうも* — Atrium's built-in reception and desktop shell

## What it does

- **Chamber list** — shows all registered Atrium chambers as launch tiles on the root domain
- **File manager** — navigates the server filesystem, remembers last path
- **App launcher** — sidebar list of registered desktop apps; "+ Add App" lists installed `.desktop` entries (XDG `applications` dirs, incl. flatpak) by name, with a file-system fallback for bare executables. Desktop entries launch via `gio launch`
- **File associations** — first time you open a `.mpg`, Domo asks which app; saves the mapping to `~/.domo`
- **"Open with…"** — explicit picker always available on hover; can override defaults per file

## Layout

```
domo/
├── mod.ts               ← Chamber export (Atrium entry point)
├── server.ts            ← API route handler (no server — Atrium owns the server)
└── client/
    ├── index.html
    ├── app.js           ← all web components
    ├── style.css
    ├── manifest.json
    ├── sw.js
    └── icon.svg
```

## Config file

`~/.domo` — plain JSON, written by the UI:

```json
{
  "apps": [
    { "id": "uuid", "name": "VLC", "path": "/usr/share/applications/vlc.desktop" },
    { "id": "uuid", "name": "Vim", "path": "/usr/bin/vim" }
  ],
  "associations": {
    ".mp4": "uuid",
    ".mkv": "uuid"
  }
}
```

## Running

### Inside Atrium (normal)

Domo is built-in — it starts automatically with Atrium and needs no separate configuration.

### Standalone (development)

```sh
DOMO_PORT=8585 deno run --allow-all mod.ts
# open http://localhost:8585
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/chambers` | List of all registered chambers |
| GET | `/api/home` | Server `$HOME` path |
| GET | `/api/files?path=…` | Directory listing (dotfiles hidden) |
| GET | `/api/files-all?path=…` | Directory listing (dotfiles visible, for app picker) |
| POST | `/api/exec` | Launch an app (`{ appPath, filePath? }`) |
| GET | `/api/config` | Read `~/.domo` |
| PUT | `/api/config` | Write `~/.domo` |
| POST | `/api/trash` | Move file to XDG trash (`{ filePath }`) |
| POST | `/api/copy` | Copy file into directory (`{ filePath, destDir }`) |
| POST | `/api/move` | Move file into directory (`{ filePath, destDir }`) |

## Usage

| Action | What happens |
|---|---|
| Click a **folder** | Navigate into it |
| Click `..` | Go up one level |
| Click a **file** | Open with default app; shows Open With dialog if none set |
| Hover a file → **"open with…"** | Always shows app picker, lets you override |
| Click an **app** in sidebar | Launch app with no file argument |
| **Add App** button | Browse filesystem to pick an executable, name it |
| Sidebar **✕** button | Remove app and its associations |

## Notes

- Apps are launched detached (`proc.unref()`); the server doesn't wait on them
- Files starting with `.` are hidden in the file manager but visible in the app picker
- `localStorage` persists: last visited path
- `~/.domo` persists: app list, file type associations
- The file picker for selecting executables starts at `/usr/bin` by default
