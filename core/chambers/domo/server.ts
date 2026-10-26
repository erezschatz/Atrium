import { join } from "node:path";

const HOME = Deno.env.get("HOME") ?? "/tmp";
const CONFIG_PATH = join(HOME, ".domo");

function getWaylandEnv(): Record<string, string> {
  try {
    const lines = Deno.readTextFileSync(
      join(HOME, ".config", "atrium", "wayland-display")
    ).trim().split("\n");
    return Object.fromEntries(
      lines.map(l => l.split("=") as [string, string])
    );
  } catch {
    return {};
  }
}

// Types 

interface ChamberInfo {
  domain: string;
  displayName: string;
}

let chamberList: ChamberInfo[] = [];

export function setChambers(chambers: ChamberInfo[]): void {
  chamberList = chambers;
}

interface DomoApp {
  id: string;
  name: string;
  path: string;
}

interface DomoConfig {
  apps: DomoApp[];
  associations: Record<string, string>; // ext → app id
  defaultAppPath?: string;
}

// Config

export async function readConfig(): Promise<DomoConfig> {
  try {
    return JSON.parse(await Deno.readTextFile(CONFIG_PATH));
  } catch {
    return { apps: [], associations: {}, defaultAppPath: "/usr/bin" };
  }
}

async function writeConfig(config: DomoConfig): Promise<void> {
  await Deno.writeTextFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Helpers

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

// Files on another filesystem can't be renamed into the home trash, so per the
// XDG trash spec they go to $topdir/.Trash-$uid on their own mount instead.
async function trashLocation(filePath: string): Promise<{ trashDir: string; infoPath: string }> {
  const homeTrash = join(HOME, ".local/share/Trash");
  const parent = filePath.replace(/\/+$/, "").replace(/\/[^/]+$/, "") || "/";
  const dev = (await Deno.stat(parent)).dev;
  if (dev === (await Deno.stat(HOME)).dev) {
    return { trashDir: homeTrash, infoPath: filePath };
  }
  // Walk up to the mount point (topmost ancestor on the same device)
  let topdir = parent;
  while (topdir !== "/") {
    const up = topdir.replace(/\/[^/]+$/, "") || "/";
    if ((await Deno.stat(up)).dev !== dev) {
      break;
    }
    topdir = up;
  }
  return {
    trashDir: join(topdir, `.Trash-${Deno.uid()}`),
    infoPath: filePath.slice(topdir.length).replace(/^\/+/, ""),
  };
}

// Deno.copyFile only handles files, so directories are walked by hand.
// Symlinks are recreated rather than followed.
async function copyRecursive(src: string, dest: string): Promise<void> {
  const info = await Deno.lstat(src);
  if (info.isSymlink) {
    await Deno.symlink(await Deno.readLink(src), dest);
  } else if (info.isDirectory) {
    await Deno.mkdir(dest);
    for await (const e of Deno.readDir(src)) {
      await copyRecursive(join(src, e.name), join(dest, e.name));
    }
  } else {
    await Deno.copyFile(src, dest);
  }
}

// Desktop entries

interface DesktopApp {
  name: string;
  path: string; // absolute path to the .desktop file
  comment?: string;
}

// XDG lookup order: user entries first, then system ones. The service
// environment usually lacks XDG_DATA_DIRS, so flatpak exports are added
// explicitly.
function applicationDirs(): string[] {
  const dataHome = Deno.env.get("XDG_DATA_HOME") || join(HOME, ".local/share");
  const dataDirs = (Deno.env.get("XDG_DATA_DIRS") || "/usr/local/share:/usr/share")
    .split(":").filter(Boolean);
  const dirs = [
    dataHome,
    join(HOME, ".local/share/flatpak/exports/share"),
    ...dataDirs,
    "/var/lib/flatpak/exports/share",
  ];
  return [...new Set(dirs)].map((d) => join(d, "applications"));
}

function parseDesktopEntry(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inEntry = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("[")) {
      if (inEntry) {
        break;
      }
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    const eq = line.indexOf("=");
    if (inEntry && eq > 0) {
      out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return out;
}

async function onPath(bin: string): Promise<boolean> {
  const candidates = bin.startsWith("/")
    ? [bin]
    : (Deno.env.get("PATH") ?? "/usr/bin:/bin").split(":").map((d) => join(d, bin));
  for (const c of candidates) {
    try {
      if ((await Deno.stat(c)).isFile) {
        return true;
      }
    } catch {
      // keep looking
    }
  }
  return false;
}

async function listDesktopApps(): Promise<DesktopApp[]> {
  const seen = new Set<string>(); // desktop file IDs; first one found wins
  const apps: DesktopApp[] = [];

  async function walk(root: string, dir: string) {
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(dir));
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory) {
        await walk(root, full);
        continue;
      }
      if (!e.name.endsWith(".desktop")) {
        continue;
      }
      const id = full.slice(root.length + 1).replaceAll("/", "-");
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      let entry: Record<string, string>;
      try {
        entry = parseDesktopEntry(await Deno.readTextFile(full));
      } catch {
        continue;
      }
      if (
        entry.Type !== "Application" || !entry.Name || !entry.Exec ||
        entry.NoDisplay === "true" || entry.Hidden === "true" ||
        (entry.TryExec && !(await onPath(entry.TryExec)))
      ) {
        continue;
      }
      apps.push({ name: entry.Name, path: full, comment: entry.Comment });
    }
  }

  for (const dir of applicationDirs()) {
    await walk(dir, dir);
  }
  return apps.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

// Router

export async function handleApi(req: Request, url: URL): Promise<Response> {
  const route = url.pathname.slice(5); // strip /api/
  const method = req.method;

  // GET /api/chambers
  if (route === "chambers" && method === "GET") {
    return json(chamberList);
  }

  // GET /api/home
  if (route === "home" && method === "GET") {
    return json({ home: HOME });
  }

  // GET /api/desktop-apps
  if (route === "desktop-apps" && method === "GET") {
    return json(await listDesktopApps());
  }

  // GET /api/files?path=...
  if (route === "files" && method === "GET") {
    const dirPath = url.searchParams.get("path") ?? HOME;
    try {
      const entries: {
        name: string;
        isDir: boolean;
        isFile: boolean;
        size: number | null;
        mtime: number | null;
      }[] = [];
      for await (const e of Deno.readDir(dirPath)) {
        if (e.name.startsWith(".") && !e.name.startsWith("..")) {
          continue;
        }
        let size: number | null = null;
        let mtime: number | null = null;
        try {
          const info = await Deno.stat(join(dirPath, e.name));
          if (e.isFile) {
            size = info.size;
          }
          mtime = info.mtime ? info.mtime.getTime() : null;
        } catch { /* symlink or permission error */ }
        entries.push({ name: e.name, isDir: e.isDirectory, isFile: e.isFile, size, mtime });
      }
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) {
          return a.isDir ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      return json({ path: dirPath, entries });
    } catch (e) {
      return err(String(e));
    }
  }

  // GET /api/files-all?path=...  (includes dotfiles, for app picker)
  if (route === "files-all" && method === "GET") {
    const dirPath = url.searchParams.get("path") ?? HOME;
    try {
      const entries: { name: string; isDir: boolean; isFile: boolean }[] = [];
      for await (const e of Deno.readDir(dirPath)) {
        entries.push({ name: e.name, isDir: e.isDirectory, isFile: e.isFile });
      }
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) {
          return a.isDir ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      return json({ path: dirPath, entries });
    } catch (e) {
      return err(String(e));
    }
  }

  // POST /api/exec
  if (route === "exec" && method === "POST") {
    let body: { appPath: string; filePath?: string | null };
    try {
      body = await req.json();
    } catch {
      return err("Invalid JSON body");
    }
    const { appPath, filePath } = body;
    if (!appPath) {
      return err("appPath is required");
    }
    // Desktop entries go through gio, which handles Exec= field codes,
    // Terminal=true and the like.
    const [command, args]: [string, string[]] = appPath.endsWith(".desktop")
      ? ["gio", ["launch", appPath, ...(filePath ? [filePath] : [])]]
      : [appPath, filePath ? [filePath] : []];
    const spawn = (command: string, cmdArgs: string[]) => {
      const proc = new Deno.Command(command, {
        args: cmdArgs,
        stdout: "null",
        stderr: "null",
        stdin: "null",
        env: {
          ...Deno.env.toObject(),
          ...getWaylandEnv(),
        },
      }).spawn();
      proc.unref();
    };
    try {
      // Launch in its own systemd scope so the app leaves Atrium's cgroup
      // and survives restarts of atrium.service.
      try {
        spawn("systemd-run", [
          "--user", "--scope", "--collect", "--quiet", "--slice=app.slice",
          "--", command, ...args,
        ]);
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
        spawn(command, args);
      }
      return json({ ok: true });
    } catch (e) {
      return err(String(e));
    }
  }

  // GET /api/config
  if (route === "config" && method === "GET") {
    return json(await readConfig());
  }

  // PUT /api/config
  if (route === "config" && method === "PUT") {
    let config: DomoConfig;
    try {
      config = await req.json();
    } catch {
      return err("Invalid JSON body");
    }
    await writeConfig(config);
    return json({ ok: true });
  }

  // POST /api/trash  — moves a file to the XDG trash
  if (route === "trash" && method === "POST") {
    let body: { filePath: string };
    try {
      body = await req.json();
    } catch {
      return err("Invalid JSON body");
    }
    const { filePath } = body;
    if (!filePath) {
      return err("filePath is required");
    }
    try {
      const { trashDir, infoPath } = await trashLocation(filePath);
      const trashFiles = join(trashDir, "files");
      const trashInfo = join(trashDir, "info");
      await Deno.mkdir(trashFiles, { recursive: true });
      await Deno.mkdir(trashInfo, { recursive: true });
      const base = filePath.replace(/\/+$/, "").split("/").pop() ?? "file";
      let destName = base;
      let n = 1;
      // Avoid collision in trash
      while (true) {
        try { await Deno.stat(join(trashFiles, destName)); destName = `${base}.${n++}`; } catch { break; }
      }
      await Deno.rename(filePath, join(trashFiles, destName));
      const info = `[Trash Info]\nPath=${infoPath}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`;
      await Deno.writeTextFile(join(trashInfo, destName + ".trashinfo"), info);
      return json({ ok: true });
    } catch (e) {
      return err(String(e));
    }
  }

  // POST /api/copy  — copies a file into a destination directory
  if (route === "copy" && method === "POST") {
    let body: { filePath: string; destDir: string };
    try {
      body = await req.json();
    } catch {
      return err("Invalid JSON body");
    }
    const { filePath, destDir } = body;
    if (!filePath || !destDir) {
      return err("filePath and destDir are required");
    }
    try {
      const src = filePath.replace(/\/+$/, "");
      const name = src.split("/").pop() ?? "file";
      if ((destDir.replace(/\/+$/, "") + "/").startsWith(src + "/")) {
        return err("Cannot copy a folder into itself");
      }
      await copyRecursive(src, join(destDir, name));
      return json({ ok: true });
    } catch (e) {
      return err(String(e));
    }
  }

  // POST /api/move  — moves a file into a destination directory
  if (route === "move" && method === "POST") {
    let body: { filePath: string; destDir: string };
    try {
      body = await req.json();
    } catch {
      return err("Invalid JSON body");
    }
    const { filePath, destDir } = body;
    if (!filePath || !destDir) {
      return err("filePath and destDir are required");
    }
    try {
      const src = filePath.replace(/\/+$/, "");
      const name = src.split("/").pop() ?? "file";
      const dest = join(destDir, name);
      if ((destDir.replace(/\/+$/, "") + "/").startsWith(src + "/")) {
        return err("Cannot move a folder into itself");
      }
      try {
        await Deno.rename(src, dest);
      } catch (e) {
        if (!(e instanceof Error && e.message.includes("os error 18"))) {
          throw e;
        }
        // Cross-device: fallback to copy + delete
        await copyRecursive(src, dest);
        await Deno.remove(src, { recursive: true });
      }
      return json({ ok: true });
    } catch (e) {
      return err(String(e));
    }
  }

  // POST /api/mkdir  — creates a directory inside a parent directory
  if (route === "mkdir" && method === "POST") {
    let body: { dirPath: string; name: string };
    try {
      body = await req.json();
    } catch {
      return err("Invalid JSON body");
    }
    const { dirPath, name } = body;
    if (!dirPath || !name) {
      return err("dirPath and name are required");
    }
    if (name.includes("/") || name.includes("\\")) {
      return err("name must not contain path separators");
    }
    if (name === "." || name === "..") {
      return err("Invalid folder name");
    }
    try {
      await Deno.mkdir(join(dirPath, name));
      return json({ ok: true });
    } catch (e) {
      if (e instanceof Deno.errors.AlreadyExists) {
        return err(`"${name}" already exists`);
      }
      return err(String(e));
    }
  }

  // POST /api/rename  — renames a file or directory in-place
  if (route === "rename" && method === "POST") {
    let body: { filePath: string; newName: string };
    try {
      body = await req.json();
    } catch {
      return err("Invalid JSON body");
    }
    const { filePath, newName } = body;
    if (!filePath || !newName) {
      return err("filePath and newName are required");
    }
    if (newName.includes("/") || newName.includes("\\")) {
      return err("newName must not contain path separators");
    }
    try {
      const dir = filePath.replace(/\/[^/]+$/, "") || "/";
      await Deno.rename(filePath, join(dir, newName));
      return json({ ok: true });
    } catch (e) {
      return err(String(e));
    }
  }

  return err("Not found", 404);
}
