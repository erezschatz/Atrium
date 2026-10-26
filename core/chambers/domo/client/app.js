/**
 * Domo — app.js
 * Web-component based desktop shell.
 */

"use strict";

// API
const api = {
  async get(route, params = {}) {
    const url = new URL(`/api/${route}`, location.origin);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) {
      throw new Error(data.error ?? `HTTP ${r.status}`);
    }
    return data;
  },

  async post(route, body) {
    const r = await fetch(`/api/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
      throw new Error(data.error ?? `HTTP ${r.status}`);
    }
    return data;
  },

  async put(route, body) {
    const r = await fetch(`/api/${route}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    return data;
  },
};

// State
const AppState = (() => {
  const _listeners = new Map();

  return {
    home: "/",
    config: { apps: [], associations: {} },

    async init() {
      const { home } = await api.get("home");
      this.home = home;
      await this.loadConfig();
    },

    async loadConfig() {
      this.config = await api.get("config");
      this._emit("config:updated");
    },

    async saveConfig() {
      await api.put("config", this.config);
      this._emit("config:updated");
    },

    findApp(id) {
      return this.config.apps.find((a) => a.id === id) ?? null;
    },

    getAssociation(ext) {
      const id = this.config.associations[ext];
      return id ? this.findApp(id) : null;
    },

    /** Returns the added-or-existing app. */
    addApp({ name, path: appPath }) {
      const existing = this.config.apps.find((a) => a.path === appPath);
      if (existing) {
        return existing;
      }
      const app = { id: crypto.randomUUID(), name, path: appPath };
      this.config.apps.push(app);
      return app;
    },

    removeApp(id) {
      this.config.apps = this.config.apps.filter((a) => a.id !== id);
      for (const [ext, aId] of Object.entries(this.config.associations)) {
        if (aId === id) {
          delete this.config.associations[ext];
        }
      }
    },

    setAssociation(ext, appId) {
      this.config.associations[ext] = appId;
    },

    get defaultAppPath() {
      return this.config.defaultAppPath ?? "/usr/bin";
    },

    setDefaultAppPath(p) {
      this.config.defaultAppPath = p;
    },

    on(event, fn) {
      if (!_listeners.has(event)) {
        _listeners.set(event, new Set());
      }
      _listeners.get(event).add(fn);
    },
    off(event, fn) {
      _listeners.get(event)?.delete(fn);
    },
    _emit(event, data) {
      _listeners.get(event)?.forEach((fn) => fn(data));
    },
  };
})();

// Utils

function extOf(name) {
  const m = name.match(/(\.[^./\\]+)$/);
  return m ? m[1].toLowerCase() : "";
}

function baseName(p) {
  return p.replace(/\/+$/, "").split("/").pop() ?? p;
}

function parentPath(p) {
  if (p === "/") {
    return "/";
  }
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

function joinPath(base, name) {
  return base.replace(/\/+$/, "") + "/" + name;
}

function iconFor(entry) {
  if (entry.isDir) {
    return "📁";
  }
  const e = extOf(entry.name);
  if (
    [
      ".mp4",
      ".mpg",
      ".mpeg",
      ".mkv",
      ".avi",
      ".mov",
      ".webm",
      ".wmv",
      ".m4v",
      ".flv",
    ].includes(e)
  ) {
    return "🎬";
  }
  if (
    [".mp3", ".flac", ".ogg", ".wav", ".aac", ".m4a", ".opus", ".wma", ".ape"]
      .includes(e)
  ) {
    return "🎵";
  }
  if (
    [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".bmp",
      ".tiff",
      ".avif",
      ".heic",
    ].includes(e)
  ) {
    return "🖼️";
  }
  if ([".pdf"].includes(e)) {
    return "📕";
  }
  if ([".doc", ".docx", ".odt", ".rtf"].includes(e)) {
    return "📃";
  }
  if ([".txt", ".md", ".rst", ".org", ".log"].includes(e)) {
    return "📝";
  }
  if ([".epub", ".mobi", ".azw3"].includes(e)) {
    return "📖";
  }
  if (
    [
      ".js",
      ".ts",
      ".py",
      ".sh",
      ".bash",
      ".zsh",
      ".go",
      ".rs",
      ".c",
      ".cpp",
      ".h",
      ".java",
      ".rb",
      ".php",
      ".lua",
      ".ex",
      ".exs",
      ".clj",
      ".hs",
      ".ml",
      ".erl",
      ".elm",
    ].includes(e)
  ) {
    return "⚙️";
  }
  if (
    [".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".zst", ".lz4"]
      .includes(e)
  ) {
    return "📦";
  }
  if ([".json", ".yaml", ".yml", ".toml", ".xml", ".csv", ".tsv"].includes(e)) {
    return "📊";
  }
  if ([".html", ".htm", ".css", ".scss", ".less"].includes(e)) {
    return "🌐";
  }
  return "📄";
}

function formatSize(bytes) {
  if (bytes == null) {
    return "—";
  }
  if (bytes === 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1).replace(/\.0$/, "") + " KB";
  }
  if (bytes < 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " MB";
  }
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDate(ms) {
  if (ms == null) {
    return "—";
  }
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function typeOf(entry) {
  if (entry.isDir) {
    return "Folder";
  }
  const e = extOf(entry.name);
  return e ? e.slice(1).toUpperCase() : "File";
}

// Toast

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => el.classList.add("toast--show"))
  );
  setTimeout(() => {
    el.classList.remove("toast--show");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  }, 2800);
}

// Modal base class

class Modal {
  constructor(title, { wide = false } = {}) {
    this.overlay = document.createElement("div");
    this.overlay.className = "overlay";
    this.overlay.innerHTML = `
      <div class="modal${wide ? " modal--wide" : ""}">
        <div class="modal__head">
          <span class="modal__title">${title}</span>
          <button class="modal__close" title="Close">✕</button>
        </div>
        <div class="modal__body"></div>
        <div class="modal__foot"></div>
      </div>
    `;
    this.body = this.overlay.querySelector(".modal__body");
    this.foot = this.overlay.querySelector(".modal__foot");

    this.overlay.querySelector(".modal__close").addEventListener(
      "click",
      () => this.close(),
    );
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    document.body.appendChild(this.overlay);
  }

  close() {
    this.onClose?.();
    this.overlay.remove();
  }

  addBtn(label, cls, onClick) {
    const btn = document.createElement("button");
    btn.className = `btn ${cls}`;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    this.foot.appendChild(btn);
    return btn;
  }
}

// Name prompt modal

function showNamePrompt(defaultVal, onConfirm) {
  const modal = new Modal("Name this app");
  modal.body.innerHTML = `
    <div class="input-group">
      <label class="input-label">Display name</label>
      <input class="domo-input" id="name-input" value="${escHtml(defaultVal)
    }" placeholder="e.g. VLC, Firefox, Vim…">
    </div>
  `;
  const cancelBtn = modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  const okBtn = modal.addBtn("Add", "btn--primary", () => {
    const val = modal.body.querySelector("#name-input").value.trim();
    if (!val) {
      return;
    }
    modal.close();
    onConfirm(val);
  });

  requestAnimationFrame(() => {
    const inp = modal.body.querySelector("#name-input");
    inp?.focus();
    inp?.select();
    inp?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        okBtn.click();
      }
      if (e.key === "Escape") {
        cancelBtn.click();
      }
    });
  });
}

// File picker modal (browse filesystem to select a file)

function showFilePicker(
  { title = "Select file", startPath, showAll = true, onSelect },
) {
  let currentPath = startPath ?? AppState.home;
  let selectedEntry = null;

  const modal = new Modal(title, { wide: true });
  modal.body.innerHTML = `
    <div class="picker-path" id="picker-path" title="Click to type a path">${escHtml(currentPath)
    }</div>
    <input class="picker-path-input" id="picker-path-input" type="text" 
    spellcheck="false" autocomplete="off" 
    placeholder="Type a path and press Enter…">
    <div class="picker-list" id="picker-list"></div>
  `;
  const pathEl = modal.body.querySelector("#picker-path");
  const inputEl = modal.body.querySelector("#picker-path-input");
  const listEl = modal.body.querySelector("#picker-list");

  const startEditing = () => {
    inputEl.value = currentPath;
    pathEl.classList.add("is-hidden");
    inputEl.classList.add("is-visible");
    inputEl.focus();
    inputEl.select();
  };

  const stopEditing = () => {
    inputEl.classList.remove("is-visible");
    pathEl.classList.remove("is-hidden");
  };

  pathEl.addEventListener("click", startEditing);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const typed = inputEl.value.trim();
      stopEditing();
      if (typed && typed !== currentPath) {
        navigate(typed);
      }
    } else if (e.key === "Escape") {
      stopEditing();
    }
  });
  inputEl.addEventListener("blur", stopEditing);

  modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  const selectBtn = modal.addBtn("Select", "btn--primary", () => {
    if (selectedEntry) {
      onSelect(joinPath(currentPath, selectedEntry.name));
      modal.close();
    }
  });
  selectBtn.disabled = true;

  async function navigate(path) {
    currentPath = path;
    selectedEntry = null;
    selectBtn.disabled = true;
    pathEl.textContent = path;
    listEl.innerHTML = '<div class="fm-loading">Loading…</div>';

    try {
      const route = showAll ? "files-all" : "files";
      const { entries } = await api.get(route, { path });
      listEl.innerHTML = "";

      if (path !== "/") {
        const upEl = makePickerEntry(
          { name: "..", isDir: true },
          null,
          () => navigate(parentPath(path)),
        );
        listEl.appendChild(upEl);
      }

      for (const entry of entries) {
        const el = makePickerEntry(entry, null, () => {
          if (entry.isDir) {
            navigate(joinPath(path, entry.name));
          } else {
            listEl.querySelectorAll(".is-selected").forEach((e) =>
              e.classList.remove("is-selected")
            );
            el.classList.add("is-selected");
            selectedEntry = entry;
            selectBtn.disabled = false;
          }
        });
        // Double-click selects immediately
        if (!entry.isDir) {
          el.addEventListener("dblclick", () => {
            onSelect(joinPath(currentPath, entry.name));
            modal.close();
          });
        }
        listEl.appendChild(el);
      }
    } catch (e) {
      listEl.innerHTML = `<div class="fm-empty">Error: ${escHtml(e.message)
        }</div>`;
    }
  }

  function makePickerEntry(entry, _selected, onClick) {
    const el = document.createElement("div");
    el.className = "picker-entry";
    const icon = entry.name === ".." ? "📁" : iconFor(entry);
    const cls = entry.isDir ? "picker-entry__name--dir" : "";
    el.innerHTML =
      `<span>${icon}</span><span class="picker-entry__name ${cls}">${escHtml(entry.name)
      }</span>`;
    el.addEventListener("click", onClick);
    return el;
  }

  navigate(currentPath);
}

// Add-app dialog: pick an installed desktop entry, or browse the filesystem

function showAddApp(onAdded) {
  let selected = null;
  let apps = [];

  const modal = new Modal("Add application", { wide: true });
  modal.body.innerHTML = `
    <input class="domo-input" id="app-filter" type="text" spellcheck="false"
    autocomplete="off" placeholder="Filter applications…" style="margin-bottom:8px">
    <div class="picker-list" id="app-list"><div class="fm-loading">Loading…</div></div>
  `;
  const filterEl = modal.body.querySelector("#app-filter");
  const listEl = modal.body.querySelector("#app-list");

  const browseBtn = modal.addBtn(
    "Choose from file system instead",
    "btn--ghost",
    () => {
      modal.close();
      showFilePicker({
        title: "Select application",
        startPath: AppState.defaultAppPath,
        showAll: false,
        onSelect: (appPath) => {
          showNamePrompt(baseName(appPath), async (name) => {
            const app = AppState.addApp({ name, path: appPath });
            await AppState.saveConfig();
            onAdded(app);
          });
        },
      });
    },
  );
  browseBtn.style.marginRight = "auto";
  const cancelBtn = modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  const addBtn = modal.addBtn("Add", "btn--primary", () => add(selected));
  addBtn.disabled = true;

  async function add(entry) {
    if (!entry) {
      return;
    }
    modal.close();
    const app = AppState.addApp({ name: entry.name, path: entry.path });
    await AppState.saveConfig();
    onAdded(app);
  }

  function render() {
    const q = filterEl.value.trim().toLowerCase();
    const shown = q
      ? apps.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        (a.comment ?? "").toLowerCase().includes(q)
      )
      : apps;
    listEl.innerHTML = shown.length
      ? ""
      : '<div class="fm-empty">No applications found.</div>';
    for (const entry of shown) {
      const el = document.createElement("div");
      el.className = `picker-entry${entry === selected ? " is-selected" : ""}`;
      el.title = entry.comment ?? entry.path;
      el.innerHTML = `<span>🖥️</span><span class="picker-entry__name">${escHtml(entry.name)
        }</span>`;
      el.addEventListener("click", () => {
        listEl.querySelectorAll(".is-selected").forEach((e) =>
          e.classList.remove("is-selected")
        );
        el.classList.add("is-selected");
        selected = entry;
        addBtn.disabled = false;
      });
      el.addEventListener("dblclick", () => add(entry));
      listEl.appendChild(el);
    }
  }

  filterEl.addEventListener("input", render);
  filterEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addBtn.click();
    }
    if (e.key === "Escape") {
      cancelBtn.click();
    }
  });
  requestAnimationFrame(() => filterEl.focus());

  api.get("desktop-apps").then((list) => {
    apps = list;
    render();
  }).catch((e) => {
    listEl.innerHTML = `<div class="fm-empty">Error: ${escHtml(e.message)}</div>`;
  });
}

// Open-with dialog

function showOpenWith(filePath, ext, { onOpen } = {}) {
  const fileName = baseName(filePath);
  const apps = AppState.config.apps;
  const defaultApp = ext ? AppState.getAssociation(ext) : null;

  let selectedApp = defaultApp ?? null;

  const modal = new Modal("Open with…");

  const appsHtml = apps.length
    ? apps.map((a) => `
        <div class="ow-app${selectedApp?.id === a.id ? " is-selected" : ""
      }" data-id="${a.id}">
          <span>🖥️</span>
          <span>${escHtml(a.name)}</span>
          <span class="ow-app__path">${escHtml(a.path)}</span>
        </div>`).join("")
    : '<div class="fm-empty" style="padding:12px 0;font-size:12px">No apps registered yet.</div>';

  modal.body.innerHTML = `
    <div class="ow-file">
      <span>${iconFor({ name: fileName, isDir: false, isFile: true })}</span>
      <span>${escHtml(fileName)}</span>
    </div>
    <div class="ow-section">Applications</div>
    <div class="ow-app-list" id="ow-apps">${appsHtml}</div>
    <button class="btn btn--ghost ow-browse" id="ow-browse">
    📂  Browse for application…</button>
    ${ext
      ? `
    <label class="ow-remember">
      <input type="checkbox" id="ow-remember" ${defaultApp ? "checked" : ""}>
      Always open <strong>${escHtml(ext)}</strong> files with this app
    </label>`
      : ""
    }
  `;

  // App row selection
  modal.body.querySelectorAll(".ow-app").forEach((el) => {
    el.addEventListener("click", () => {
      modal.body.querySelectorAll(".ow-app").forEach((e) =>
        e.classList.remove("is-selected")
      );
      el.classList.add("is-selected");
      selectedApp = AppState.findApp(el.dataset.id);
    });
    el.addEventListener("dblclick", () => {
      selectedApp = AppState.findApp(el.dataset.id);
      doOpen();
    });
  });

  // Browse
  modal.body.querySelector("#ow-browse").addEventListener("click", () => {
    modal.close();
    showAddApp((app) => {
      selectedApp = app;
      doOpen();
    });
  });

  modal.addBtn("Cancel", "btn--ghost", () => modal.close());

  async function doOpen() {
    if (!selectedApp) {
      toast("Select an application first", "error");
      return;
    }
    const remember = modal.body.querySelector("#ow-remember")?.checked;
    if (remember && ext) {
      AppState.setAssociation(ext, selectedApp.id);
      await AppState.saveConfig();
    }
    modal.close();
    onOpen?.(selectedApp, filePath);
  }
}

// Settings modal

function showSettings() {
  const modal = new Modal("Settings");
  modal.body.innerHTML = `
    <div class="input-group">
      <label class="input-label">Default app browse path</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="domo-input" id="setting-apppath" value="${escHtml(AppState.defaultAppPath)
    }" spellcheck="false" autocomplete="off">
        <button class="btn btn--ghost btn--sm" id="setting-browse" title="Browse">📂</button>
      </div>
      <span style="font-size:11px;color:var(--text-dim);margin-top:3px">
        Starting folder when browsing for an application to register.
      </span>
    </div>
  `;

  modal.body.querySelector("#setting-browse").addEventListener("click", () => {
    modal.close();
    showFilePicker({
      title: "Choose default app folder",
      startPath: AppState.defaultAppPath,
      showAll: true,
      onSelect: (p) => {
        // user selected a file — use its directory
        const dir = p.replace(/\/[^/]+$/, "") || "/";
        AppState.setDefaultAppPath(dir);
        AppState.saveConfig();
        toast("Default app path updated", "success");
      },
    });
  });

  modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  modal.addBtn("Save", "btn--primary", async () => {
    const val = modal.body.querySelector("#setting-apppath").value.trim();
    if (!val) {
      return;
    }
    AppState.setDefaultAppPath(val);
    await AppState.saveConfig();
    modal.close();
    toast("Settings saved", "success");
  });

  requestAnimationFrame(() => {
    const inp = modal.body.querySelector("#setting-apppath");
    inp?.focus();
    inp?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        modal.foot.querySelector(".btn--primary")?.click();
      }
      if (e.key === "Escape") {
        modal.close();
      }
    });
  });
}

async function execApp(app, filePath = null) {
  try {
    await api.post("exec", { appPath: app.path, filePath });
    toast(
      `↗ ${app.name}${filePath ? ` · ${baseName(filePath)}` : ""}`,
      "success",
    );
  } catch (e) {
    toast(`Exec failed: ${e.message}`, "error");
  }
}

function openFile(filePath) {
  const ext = extOf(baseName(filePath));
  const app = AppState.getAssociation(ext);
  if (app) {
    execApp(app, filePath);
  } else {
    showOpenWith(filePath, ext, { onOpen: (a, fp) => execApp(a, fp) });
  }
}

// Entry context menu (•••)

function showEntryMenu(anchorEl, filePath, otherPath, refreshSrc, refreshDest, { selection, isDir = false } = {}) {
  document.querySelector(".fm-ctx-menu")?.remove();

  const isBatch = !isDir && selection && selection.size > 1 && selection.has(filePath);
  const batchPaths = isBatch ? [...selection] : null;

  const menu = document.createElement("div");
  menu.className = "fm-ctx-menu";

  const mkItem = (label, action, { danger = false, disabled = false } = {}) => {
    const btn = document.createElement("button");
    btn.className = "fm-ctx-item" + (danger ? " fm-ctx-item--danger" : "");
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener("click", () => { menu.remove(); action(); });
    menu.appendChild(btn);
  };

  if (isBatch) {
    const label = document.createElement("div");
    label.className = "fm-ctx-label";
    label.textContent = `${batchPaths.length} files selected`;
    menu.appendChild(label);

    const sep = document.createElement("div");
    sep.className = "fm-ctx-sep";
    menu.appendChild(sep);

    mkItem("Copy to other panel", () => showBatchCopyConfirm(batchPaths, otherPath, refreshDest), {
      disabled: !otherPath,
    });
    mkItem("Move to other panel", () => showBatchMoveConfirm(batchPaths, otherPath, () => { refreshSrc(); refreshDest?.(); }), {
      disabled: !otherPath,
    });
    mkItem("Delete", () => showBatchDeleteConfirm(batchPaths, refreshSrc), { danger: true });
  } else if (isDir) {
    mkItem("Move", () => showMoveConfirm(filePath, otherPath, () => { refreshSrc(); refreshDest?.(); }), {
      disabled: !otherPath,
    });
    mkItem("Rename", () => startInlineRename(anchorEl.closest(".fm-entry"), filePath, refreshSrc));
    mkItem("Delete", () => showDeleteConfirm(filePath, refreshSrc), { danger: true });
  } else {
    mkItem("Open with…", () =>
      showOpenWith(filePath, extOf(baseName(filePath)), {
        onOpen: (app, f) => execApp(app, f),
      })
    );

    const sep = document.createElement("div");
    sep.className = "fm-ctx-sep";
    menu.appendChild(sep);

    mkItem("Copy", () => showCopyConfirm(filePath, otherPath, refreshDest), {
      disabled: !otherPath,
    });
    mkItem("Move", () => showMoveConfirm(filePath, otherPath, () => { refreshSrc(); refreshDest?.(); }), {
      disabled: !otherPath,
    });
    mkItem("Rename", () => startInlineRename(anchorEl.closest(".fm-entry"), filePath, refreshSrc));
    mkItem("Delete", () => showDeleteConfirm(filePath, refreshSrc), { danger: true });
  }

  document.body.appendChild(menu);

  const rect = anchorEl.getBoundingClientRect();
  const menuW = 160;
  let left = rect.right - menuW;
  if (left < 4) {
    left = 4;
  }
  let top = rect.bottom + 2;
  if (top + 150 > globalThis.innerHeight) {
    top = rect.top - 150;
  }
  menu.style.left = left + "px";
  menu.style.top = top + "px";

  const close = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("pointerdown", close, true);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
}

function showDeleteConfirm(filePath, onDeleted) {
  const name = baseName(filePath);
  const modal = new Modal("Delete file");
  modal.body.innerHTML = `
    <p style="padding:8px 0">Move <strong>${escHtml(name)}</strong> to trash?</p>
  `;
  modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  modal.addBtn("Delete", "btn--danger", async () => {
    modal.close();
    try {
      await api.post("trash", { filePath });
      toast(`"${name}" moved to trash`, "success");
      onDeleted?.();
    } catch (e) {
      toast(`Delete failed: ${e.message}`, "error");
    }
  });
}

function showCopyConfirm(filePath, destDir, onCopied) {
  const name = baseName(filePath);
  const modal = new Modal("Copy file");
  modal.body.innerHTML = `
    <p style="padding:8px 0">
      Copy <strong>${escHtml(name)}</strong> to
      <code style="font-family:var(--mono);font-size:11px">${escHtml(destDir)}</code>?
    </p>
  `;
  modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  modal.addBtn("Copy", "btn--primary", async () => {
    modal.close();
    try {
      await api.post("copy", { filePath, destDir });
      toast(`Copied "${name}"`, "success");
      onCopied?.();
    } catch (e) {
      toast(`Copy failed: ${e.message}`, "error");
    }
  });
}

function showMoveConfirm(filePath, destDir, onMoved) {
  const name = baseName(filePath);
  const modal = new Modal("Move file");
  modal.body.innerHTML = `
    <p style="padding:8px 0">
      Move <strong>${escHtml(name)}</strong> to
      <code style="font-family:var(--mono);font-size:11px">${escHtml(destDir)}</code>?
    </p>
  `;
  modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  modal.addBtn("Move", "btn--primary", async () => {
    modal.close();
    try {
      await api.post("move", { filePath, destDir });
      toast(`Moved "${name}"`, "success");
      onMoved?.();
    } catch (e) {
      toast(`Move failed: ${e.message}`, "error");
    }
  });
}

function showNewFolderPrompt(dirPath, onCreated) {
  const modal = new Modal("New folder");
  modal.body.innerHTML = `
    <div class="input-group">
      <label class="input-label">Folder name</label>
      <input class="domo-input" id="folder-name-input" value="untitled folder"
      spellcheck="false" autocomplete="off" placeholder="e.g. Documents">
      <span style="font-size:11px;color:var(--text-dim);margin-top:3px">
        Created in <code style="font-family:var(--mono)">${escHtml(dirPath)}</code>
      </span>
    </div>
  `;

  const cancelBtn = modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  const okBtn = modal.addBtn("Create", "btn--primary", async () => {
    const name = modal.body.querySelector("#folder-name-input").value.trim();
    if (!name) {
      return;
    }
    modal.close();
    try {
      await api.post("mkdir", { dirPath, name });
      toast(`Created "${name}"`, "success");
      onCreated?.();
    } catch (e) {
      toast(`Create folder failed: ${e.message}`, "error");
    }
  });

  requestAnimationFrame(() => {
    const inp = modal.body.querySelector("#folder-name-input");
    inp?.focus();
    inp?.select();
    inp?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        okBtn.click();
      }
      if (e.key === "Escape") {
        cancelBtn.click();
      }
    });
  });
}

function startInlineRename(rowEl, filePath, onDone) {
  const nameSpan = rowEl.querySelector(".fm-entry__name");
  if (!nameSpan) {
    return;
  }

  const currentName = baseName(filePath);
  const input = document.createElement("input");
  input.className = "fm-rename-input";
  input.value = currentName;

  let committed = false;

  nameSpan.replaceWith(input);
  input.focus();

  // Select name without extension so typing replaces just the stem
  const dotIdx = currentName.lastIndexOf(".");
  if (dotIdx > 0) {
    input.setSelectionRange(0, dotIdx);
  } else {
    input.select();
  }

  const cancel = () => {
    if (committed) {
      return;
    }
    committed = true;
    input.replaceWith(nameSpan);
  };

  const confirm = async () => {
    if (committed) {
      return;
    }
    committed = true;
    const newName = input.value.trim();
    input.replaceWith(nameSpan);
    if (!newName || newName === currentName) {
      return;
    }
    try {
      await api.post("rename", { filePath, newName });
      toast(`Renamed to "${newName}"`, "success");
      onDone();
    } catch (e) {
      toast(`Rename failed: ${e.message}`, "error");
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); confirm();
    }
    else if (e.key === "Escape") {
      cancel();
    }
  });
  input.addEventListener("blur", cancel);
}

function showBatchDeleteConfirm(filePaths, onDone) {
  const modal = new Modal("Delete files");
  modal.body.innerHTML = `
    <p style="padding:8px 0">Move <strong>${filePaths.length} files</strong> to trash?</p>
    <ul class="batch-list">
      ${filePaths.map((fp) => `<li>${escHtml(baseName(fp))}</li>`).join("")}
    </ul>
  `;
  modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  modal.addBtn("Delete all", "btn--danger", async () => {
    modal.close();
    let failed = 0;
    for (const fp of filePaths) {
      try { await api.post("trash", { filePath: fp }); } catch { failed++; }
    }
    toast(
      failed > 0
        ? `${filePaths.length - failed} moved to trash, ${failed} failed`
        : `${filePaths.length} files moved to trash`,
      failed > 0 ? "error" : "success",
    );
    onDone?.();
  });
}

function showBatchCopyConfirm(filePaths, destDir, onDone) {
  const modal = new Modal("Copy files");
  modal.body.innerHTML = `
    <p style="padding:8px 0">Copy <strong>${filePaths.length} files</strong> to
    <code style="font-family:var(--mono);font-size:11px">${escHtml(destDir)}</code>?</p>
    <ul class="batch-list">
      ${filePaths.map((fp) => `<li>${escHtml(baseName(fp))}</li>`).join("")}
    </ul>
  `;
  modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  modal.addBtn("Copy all", "btn--primary", async () => {
    modal.close();
    let failed = 0;
    for (const fp of filePaths) {
      try { await api.post("copy", { filePath: fp, destDir }); } catch { failed++; }
    }
    toast(
      failed > 0
        ? `${filePaths.length - failed} copied, ${failed} failed`
        : `${filePaths.length} files copied`,
      failed > 0 ? "error" : "success",
    );
    onDone?.();
  });
}

function showBatchMoveConfirm(filePaths, destDir, onDone) {
  const modal = new Modal("Move files");
  modal.body.innerHTML = `
    <p style="padding:8px 0">Move <strong>${filePaths.length} files</strong> to
    <code style="font-family:var(--mono);font-size:11px">${escHtml(destDir)}</code>?</p>
    <ul class="batch-list">
      ${filePaths.map((fp) => `<li>${escHtml(baseName(fp))}</li>`).join("")}
    </ul>
  `;
  modal.addBtn("Cancel", "btn--ghost", () => modal.close());
  modal.addBtn("Move all", "btn--primary", async () => {
    modal.close();
    let failed = 0;
    for (const fp of filePaths) {
      try { await api.post("move", { filePath: fp, destDir }); } catch { failed++; }
    }
    toast(
      failed > 0
        ? `${filePaths.length - failed} moved, ${failed} failed`
        : `${filePaths.length} files moved`,
      failed > 0 ? "error" : "success",
    );
    onDone?.();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// <domo-chambers>
class DomoChambers extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = `
      <div class="sidebar-section">
        <span class="panel-section-label">Atrium</span>
        <button class="panel-toggle" title="Collapse">−</button>
      </div>
      <div class="chambers-list" id="chambers-list">
        <div class="fm-loading">…</div>
      </div>
    `;
    if (localStorage.getItem("domo:collapsed:chambers") === "1") {
      this.classList.add("is-collapsed");
      const btn = this.querySelector(".panel-toggle");
      btn.textContent = "+";
      btn.title = "Expand";
    }
    this.querySelector(".panel-toggle").addEventListener("click", () => {
      const collapsed = this.classList.toggle("is-collapsed");
      localStorage.setItem("domo:collapsed:chambers", collapsed ? "1" : "0");
      const btn = this.querySelector(".panel-toggle");
      btn.textContent = collapsed ? "+" : "−";
      btn.title = collapsed ? "Expand" : "Collapse";
    });
    try {
      const chambers = await api.get("chambers");
      const listEl = this.querySelector("#chambers-list");
      if (chambers.length === 0) {
        listEl.innerHTML = '<div class="sidebar-empty">No chambers yet.</div>';
        return;
      }
      listEl.innerHTML = chambers.map((c) => {
        const url = `${location.protocol}//${c.domain}/`;
        return `<div class="chamber-row" data-url="${escHtml(url)}">
          <span class="chamber-row__name">${escHtml(c.displayName)}</span>
          <a class="chamber-row__ext" href="${escHtml(url)
          }" target="_blank" rel="noopener" title="Open in new tab">☍</a>
        </div>`;
      }).join("");
      listEl.querySelectorAll(".chamber-row").forEach((row) => {
        row.addEventListener("click", (e) => {
          if (e.target.closest(".chamber-row__ext")) {
            return;
          }
          location.href = row.dataset.url;
        });
      });
    } catch (e) {
      this.querySelector("#chambers-list").innerHTML =
        `<div class="sidebar-empty" style="color:var(--danger)">${escHtml(e.message)
        }</div>`;
    }
  }
}

customElements.define("domo-chambers", DomoChambers);

// <domo-sidebar>
class DomoSidebar extends HTMLElement {
  connectedCallback() {
    this._onConfig = () => this._render();
    AppState.on("config:updated", this._onConfig);
    if (localStorage.getItem("domo:collapsed:sidebar") === "1") {
      this.classList.add("is-collapsed");
    }
    this._render();
  }

  disconnectedCallback() {
    AppState.off("config:updated", this._onConfig);
  }

  _render() {
    const apps = AppState.config.apps;
    const collapsed = this.classList.contains("is-collapsed");
    this.innerHTML = `
      <div class="sidebar-section">
        <span class="panel-section-label">Apps</span>
        <button class="panel-toggle" title="${collapsed ? "Expand" : "Collapse"
      }">${collapsed ? "+" : "−"}</button>
      </div>
      <div class="sidebar-list">
        ${apps.length === 0
        ? '<div class="sidebar-empty">No apps yet.<br>Add an app below, or pick one when opening a file.</div>'
        : apps.map((a) => `
            <div class="app-row" data-id="${a.id}" title="${escHtml(a.path)}">
              <span class="app-row__icon">🖥️</span>
              <span class="app-row__name">${escHtml(a.name)}</span>
              <button class="app-row__rm" data-id="${a.id}" title="Remove">✕</button>
            </div>`).join("")
      }
      </div>
      <div class="sidebar-footer">
        <button class="btn btn--ghost btn--sm btn--full" id="add-app-btn">+ Add App</button>
      </div>
    `;

    this.querySelector(".panel-toggle").addEventListener("click", () => {
      const isCollapsed = this.classList.toggle("is-collapsed");
      localStorage.setItem("domo:collapsed:sidebar", isCollapsed ? "1" : "0");
      const btn = this.querySelector(".panel-toggle");
      btn.textContent = isCollapsed ? "+" : "−";
      btn.title = isCollapsed ? "Expand" : "Collapse";
    });

    this.querySelectorAll(".app-row").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".app-row__rm")) {
          return;
        }
        const app = AppState.findApp(el.dataset.id);
        if (app) {
          execApp(app, null);
        }
      });
    });

    this.querySelectorAll(".app-row__rm").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const app = AppState.findApp(btn.dataset.id);
        if (!app) {
          return;
        }
        if (
          !confirm(
            `Remove "${app.name}" from Domo?\n\nThis also clears its file type associations.`,
          )
        ) {
          return;
        }
        AppState.removeApp(app.id);
        await AppState.saveConfig();
      });
    });

    this.querySelector("#add-app-btn").addEventListener("click", () => {
      showAddApp((app) => toast(`Added ${app.name}`, "success"));
    });
  }
}

customElements.define("domo-sidebar", DomoSidebar);

// <domo-files>
class DomoFiles extends HTMLElement {
  constructor() {
    super();
    this._path = null;
    this._entries = [];
    this._sortCol = null;
    this._sortDir = "asc";
    this._selection = new Set();
  }

  connectedCallback() {
    // Set up scaffold (once; navigation only updates the list region)
    this.innerHTML = `
      <div class="fm-toolbar">
        <button class="btn btn--ghost btn--icon btn--sm" id="fm-up"   
        title="Up">↑</button>
        <button class="btn btn--ghost btn--icon btn--sm" id="fm-home" 
        title="Home">⌂</button>
        <span class="fm-breadcrumb" id="fm-path" title="Click to type a path">
        </span>
        <input class="fm-path-input" id="fm-path-input" type="text" 
        spellcheck="false" autocomplete="off" 
        placeholder="Type a path and press Enter">
        <button class="btn btn--ghost btn--icon btn--sm" id="fm-refresh"
        title="Refresh">⟳</button>
        <button class="btn btn--ghost btn--icon btn--sm" id="fm-newfolder"
        title="New folder">+</button>
      </div>
      <div class="fm-col-heads" id="fm-col-heads">
        <div></div>
        <div class="fm-col-head" data-col="name">Name <span class="fm-sort-icon"></span></div>
        <div class="fm-col-head" data-col="size">Size <span class="fm-sort-icon"></span></div>
        <div class="fm-col-head" data-col="type">Type <span class="fm-sort-icon"></span></div>
        <div class="fm-col-head" data-col="date">Modified <span class="fm-sort-icon"></span></div>
        <div></div>
      </div>
      <div class="fm-list" id="fm-list"></div>
      <div class="fm-statusbar">
        <span id="fm-status"></span>
      </div>
    `;

    const pathEl = this.querySelector("#fm-path");
    const inputEl = this.querySelector("#fm-path-input");

    const startEditing = () => {
      inputEl.value = this._path ?? "";
      pathEl.classList.add("is-hidden");
      inputEl.classList.add("is-visible");
      inputEl.focus();
      inputEl.select();
    };

    const stopEditing = () => {
      inputEl.classList.remove("is-visible");
      pathEl.classList.remove("is-hidden");
    };

    pathEl.addEventListener("click", startEditing);

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const typed = inputEl.value.trim();
        stopEditing();
        if (typed && typed !== this._path) {
          this._navigate(typed);
        }
      } else if (e.key === "Escape") {
        stopEditing();
      }
    });

    inputEl.addEventListener("blur", stopEditing);

    this.querySelector("#fm-up").addEventListener("click", () => {
      if (this._path) {
        this._navigate(parentPath(this._path));
      }
    });
    this.querySelector("#fm-home").addEventListener("click", () => {
      this._navigate(AppState.home);
    });
    this.querySelector("#fm-refresh").addEventListener("click", () => {
      if (this._path) {
        this._navigate(this._path);
      }
    });
    this.querySelector("#fm-newfolder").addEventListener("click", () => {
      if (this._path) {
        showNewFolderPrompt(this._path, () => this._navigate(this._path));
      }
    });

    this.querySelectorAll(".fm-col-head").forEach((head) => {
      head.addEventListener("click", () => this._handleSort(head.dataset.col));
    });

    const slot = this.dataset.slot || "left";
    const lastPath = localStorage.getItem(`domo:lastPath:${slot}`);
    this._navigate(lastPath || AppState.home);
  }

  async _navigate(path) {
    this._path = path;
    const slot = this.dataset.slot || "left";
    localStorage.setItem(`domo:lastPath:${slot}`, path);

    const pathEl = this.querySelector("#fm-path");
    if (pathEl) {
      pathEl.textContent = path;
    }
    const listEl = this.querySelector("#fm-list");
    const statusEl = this.querySelector("#fm-status");
    listEl.innerHTML = '<div class="fm-loading">Loading…</div>';

    try {
      const { entries } = await api.get("files", { path });
      this._entries = entries;
      this._selection.clear();
      this._renderEntries();
      this._updateStatus();
    } catch (e) {
      listEl.innerHTML =
        `<div class="fm-empty">Cannot read directory.<br><small>${escHtml(e.message)
        }</small></div>`;
      statusEl.textContent = "";
    }
  }

  _getOtherPanel() {
    const slot = this.dataset.slot || "left";
    const other = slot === "left" ? "right" : "left";
    return document.querySelector(`domo-files[data-slot="${other}"]`);
  }

  _getOtherPath() {
    return this._getOtherPanel()?._path ?? null;
  }

  _updateStatus() {
    const statusEl = this.querySelector("#fm-status");
    if (!statusEl) {
      return;
    }
    const count = this._entries.length;
    const sel = this._selection.size;
    statusEl.textContent = sel > 0
      ? `${sel} selected  ·  ${count} item${count !== 1 ? "s" : ""}  ·  ${this._path}`
      : `${count} item${count !== 1 ? "s" : ""}  ·  ${this._path}`;
  }

  _makeRow(entry, isUp) {
    const el = document.createElement("div");
    el.className = "fm-entry";

    const icon = isUp ? "📁" : iconFor(entry);
    const nameCls = isUp
      ? "fm-entry__name--up"
      : entry.isDir
        ? "fm-entry__name--dir"
        : "fm-entry__name--file";

    el.innerHTML = `
      <span class="fm-entry__icon">${icon}</span>
      <span class="fm-entry__name ${nameCls}">${escHtml(entry.name)}</span>
      <span class="fm-entry__size">${isUp ? "" : formatSize(entry.size)}</span>
      <span class="fm-entry__type">${isUp ? "" : escHtml(typeOf(entry))}</span>
      <span class="fm-entry__date">${isUp ? "" : formatDate(entry.mtime)}</span>
      ${!isUp ? `<button class="fm-entry__menu" title="Actions">•••</button>` : ""}
    `;

    if (isUp) {
      el.addEventListener(
        "click",
        () => this._navigate(parentPath(this._path)),
      );
    } else if (entry.isDir) {
      const fp = joinPath(this._path, entry.name);
      el.addEventListener("click", (e) => {
        if (e.target.closest(".fm-entry__menu")) {
          return;
        }
        this._navigate(fp);
      });
      el.querySelector(".fm-entry__menu")?.addEventListener("click", (e) => {
        e.stopPropagation();
        showEntryMenu(
          e.currentTarget,
          fp,
          this._getOtherPath(),
          () => this._navigate(this._path),
          () => {
            const op = this._getOtherPanel();
            if (op?._path) {
              op._navigate(op._path);
            }
          },
          { isDir: true },
        );
      });
    } else {
      const fp = joinPath(this._path, entry.name);
      if (this._selection.has(fp)) {
        el.classList.add("is-selected");
      }
      el.addEventListener("click", (e) => {
        if (e.target.closest(".fm-entry__menu")) {
          return;
        }
        if (this._selection.has(fp)) {
          this._selection.delete(fp);
          el.classList.remove("is-selected");
        } else {
          this._selection.add(fp);
          el.classList.add("is-selected");
        }
        this._updateStatus();
      });
      el.addEventListener("dblclick", (e) => {
        if (e.target.closest(".fm-entry__menu")) {
          return;
        }
        openFile(fp);
      });
      // ••• actions menu
      el.querySelector(".fm-entry__menu")?.addEventListener("click", (e) => {
        e.stopPropagation();
        showEntryMenu(
          e.currentTarget,
          fp,
          this._getOtherPath(),
          () => this._navigate(this._path),
          () => {
            const op = this._getOtherPanel();
            if (op?._path) {
              op._navigate(op._path);
            }
          },
          { selection: this._selection },
        );
      });
    }

    return el;
  }

  _handleSort(col) {
    if (this._sortCol !== col) {
      this._sortCol = col;
      this._sortDir = "asc";
    } else if (this._sortDir === "asc") {
      this._sortDir = "desc";
    } else {
      this._sortCol = null;
      this._sortDir = "asc";
    }
    this._renderEntries();
  }

  _sortedEntries(entries) {
    if (!this._sortCol) {
      return entries;
    }
    const col = this._sortCol;
    const dir = this._sortDir === "asc" ? 1 : -1;
    return [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) {
        return a.isDir ? -1 : 1;
      }
      let cmp = 0;
      if (col === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (col === "size") {
        cmp = (a.size ?? -1) - (b.size ?? -1);
      } else if (col === "type") {
        cmp = typeOf(a).localeCompare(typeOf(b));
      } else if (col === "date") {
        cmp = (a.mtime ?? 0) - (b.mtime ?? 0);
      }
      return cmp * dir;
    });
  }

  _updateSortHeaders() {
    this.querySelectorAll(".fm-col-head").forEach((h) => {
      const col = h.dataset.col;
      const icon = h.querySelector(".fm-sort-icon");
      h.classList.toggle("is-sorted", col === this._sortCol);
      if (icon) {
        icon.textContent = col === this._sortCol
          ? (this._sortDir === "asc" ? "↑" : "↓")
          : "";
      }
    });
  }

  _renderEntries() {
    const listEl = this.querySelector("#fm-list");
    if (!listEl) {
      return;
    }
    this._updateSortHeaders();
    listEl.innerHTML = "";
    if (this._path !== "/") {
      listEl.appendChild(
        this._makeRow(
          { name: "..", isDir: true, isFile: false, size: null, mtime: null },
          true,
        ),
      );
    }
    for (const entry of this._sortedEntries(this._entries)) {
      listEl.appendChild(this._makeRow(entry, false));
    }
  }
}

customElements.define("domo-files", DomoFiles);

// <domo-shell>
class DomoShell extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = `<div class="fm-loading" style="padding:60px 0">
      Initialising…</div>`;
    try {
      await AppState.init();
    } catch (e) {
      this.innerHTML = `
        <div class="fm-empty" style="padding:60px 24px">
          <strong>Cannot reach Domo server.</strong><br>
          <small style="color:var(--text-dim)">${escHtml(e.message)}</small>
        </div>`;
      return;
    }

    this.innerHTML = `
      <div class="domo-titlebar">
        <span class="domo-titlebar__logo">🏠</span>
        <span class="domo-titlebar__name">Domo</span>
        <span class="domo-titlebar__sub">どうも</span>
        <span class="domo-titlebar__spacer"></span>
        <span class="domo-titlebar__clock" id="titlebar-clock"></span>
        <button class="btn btn--ghost btn--icon btn--sm" id="titlebar-settings" 
        title="Settings">⚙</button>
      </div>
      <div class="domo-body">
        <domo-chambers></domo-chambers>
        <domo-sidebar></domo-sidebar>
        <domo-files data-slot="left"></domo-files>
        <domo-files data-slot="right"></domo-files>
      </div>
    `;
    this.querySelector("#titlebar-settings").addEventListener(
      "click",
      showSettings,
    );

    const clockEl = this.querySelector("#titlebar-clock");
    const tick = () => {
      const now = new Date();
      clockEl.textContent = now.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }) +
        "  " +
        now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
    };
    tick();
  }
}

customElements.define("domo-shell", DomoShell);

// Service Worker registration

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { });
}
