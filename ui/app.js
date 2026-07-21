/* ===== DISK://REAPER — frontend logic ===== */

'use strict';

const $ = (sel) => document.querySelector(sel);

const state = {
  target: null,
  scanning: false,
  drives: [],
  scanSummary: null,
  topFiles: [],
  junkFiles: [],         // [{path,name,dir,size,reason,reasonLabel}]
  junkMeta: { totalCount: 0, totalSize: 0 },
  dupGroups: [],         // [{hash,size,wasted,count,files}]
  dupMeta: { totalGroups: 0, totalWasted: 0, done: false, running: false },
  currentFolder: null,   // ответ get_folder
  selected: new Map(),   // path -> {size, isDir}
  statusTimer: null,
};

/** Журнал сессии — сбрасывается только при закрытии приложения */
const sessionLog = {
  trashed: [],   // {path,name,size,isDir,time}
  shredded: [],
};

/* ---------- утилиты ---------- */

function fmtBytes(n) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)) + ' ' + units[i];
}

function fmtNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pyApi() {
  if (!window.pywebview || !window.pywebview.api) {
    throw new Error(t('err.apiNotReady'));
  }
  return window.pywebview.api;
}

function apiReady() {
  const bridge = window.pywebview && window.pywebview.api;
  return !!(bridge && typeof bridge.get_drives === 'function');
}

function setApiStatus(text, kind) {
  const el = $('#api-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'api-status' + (kind ? ' ' + kind : '');
}

/* ---------- статусная строка (эффект печати) ---------- */

function setStatus(text) {
  const el = $('#status-text');
  clearInterval(state.statusTimer);
  let i = 0;
  el.textContent = '';
  state.statusTimer = setInterval(() => {
    if (i >= text.length) { clearInterval(state.statusTimer); return; }
    el.textContent += text[i++];
  }, 18);
}

/* ---------- toast ---------- */

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

/* ---------- matrix rain ---------- */

function startMatrix() {
  const canvas = $('#matrix');
  const ctx = canvas.getContext('2d');
  const chars = 'アイウエオカキクケコサシスセソ0123456789ABCDEF$#@%&';
  const fontSize = 14;
  let cols = 0;
  let drops = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = Math.floor(canvas.width / fontSize);
    drops = Array(cols).fill(0).map(() => Math.floor(Math.random() * -50));
  }
  window.addEventListener('resize', resize);
  resize();

  setInterval(() => {
    ctx.fillStyle = 'rgba(5, 8, 10, 0.1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#42b86a';
    ctx.font = fontSize + 'px monospace';
    for (let i = 0; i < cols; i++) {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(ch, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  }, 66);
}

/* ---------- панель статистики в шапке ---------- */

function shortPath(path, max = 42) {
  if (!path) return '—';
  if (path.length <= max) return path;
  const head = Math.ceil(max * 0.35);
  const tail = max - head - 1;
  return path.slice(0, head) + '…' + path.slice(-tail);
}

function driveForTarget(path) {
  if (!path || !state.drives.length) return null;
  const upper = path.toUpperCase();
  return state.drives.find((d) => upper.startsWith(d.path.toUpperCase())) || null;
}

function updateHeaderStats() {
  const targetEl = $('#hs-target');
  if (targetEl) {
    targetEl.textContent = shortPath(state.target);
    targetEl.title = state.target || '';
  }

  const drive = driveForTarget(state.target);
  const freeEl = $('#hs-free');
  const barEl = $('#hs-disk-bar');
  const pctEl = $('#hs-disk-pct');
  if (drive) {
    if (freeEl) freeEl.textContent = fmtBytes(drive.free) + ' / ' + fmtBytes(drive.total);
    const pct = drive.total ? Math.round((drive.used / drive.total) * 100) : 0;
    if (barEl) {
      barEl.style.width = pct + '%';
      barEl.classList.toggle('hot', pct > 88);
    }
    if (pctEl) pctEl.textContent = t('hs.pctUsed', { pct });
  } else {
    if (freeEl) freeEl.textContent = '—';
    if (barEl) barEl.style.width = '0%';
    if (pctEl) pctEl.textContent = '—';
  }

  const scanEl = $('#hs-scan');
  const filesEl = $('#hs-files');
  const sizeEl = $('#hs-size');
  if (state.scanning) {
    if (scanEl) scanEl.textContent = t('hs.scanning');
    if (filesEl) filesEl.textContent = $('#live-files')?.textContent || '0';
    if (sizeEl) sizeEl.textContent = $('#live-size')?.textContent || '0 B';
  } else if (state.scanSummary) {
    const s = state.scanSummary;
    if (scanEl) {
      scanEl.textContent = s.cancelled
        ? t('hs.aborted', { s: s.elapsed.toFixed(1) })
        : s.elapsed.toFixed(1) + 's';
    }
    if (filesEl) filesEl.textContent = fmtNum(s.files);
    if (sizeEl) sizeEl.textContent = fmtBytes(s.size);
  } else {
    if (scanEl) scanEl.textContent = '—';
    if (filesEl) filesEl.textContent = '—';
    if (sizeEl) sizeEl.textContent = '—';
  }

  const junkEl = $('#hs-junk');
  const dupEl = $('#hs-dup');
  if (junkEl) {
    junkEl.textContent = state.junkMeta.totalCount
      ? fmtBytes(state.junkMeta.totalSize) + ' · ' + fmtNum(state.junkMeta.totalCount)
      : '—';
  }
  if (dupEl) {
    dupEl.textContent = state.dupMeta.totalGroups
      ? t('hs.dupShort', {
          size: fmtBytes(state.dupMeta.totalWasted),
          n: fmtNum(state.dupMeta.totalGroups),
        })
      : '—';
  }
}

/* ---------- диски ---------- */

function renderDrivesList(drives) {
  state.drives = drives || [];
  const box = $('#drives');
  if (!box) return;
  box.innerHTML = '';
  for (const d of drives) {
    const pct = d.total ? Math.round((d.used / d.total) * 100) : 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'drive';
    btn.dataset.path = d.path;
    btn.innerHTML =
      '<div class="drive-top">' +
        '<span class="drive-letter">[' + esc(d.letter) + ':\\]</span>' +
        '<span class="drive-free">' + t('drive.free', { size: fmtBytes(d.free) }) + '</span>' +
      '</div>' +
      '<div class="drive-bar"><div class="drive-bar-fill' + (pct > 88 ? ' hot' : '') +
        '" style="width:' + pct + '%"></div></div>';
    btn.addEventListener('click', () => selectTarget(d.path, btn));
    box.appendChild(btn);
  }
}

async function loadDrives() {
  try {
    renderDrivesList(await pyApi().get_drives());
  } catch (err) {
    toast(t('err.loadDrives'), true);
    console.error(err);
  }
}

function selectTarget(path, driveBtn) {
  state.target = path;
  document.querySelectorAll('.drive').forEach((b) => b.classList.remove('selected'));
  if (driveBtn) driveBtn.classList.add('selected');
  $('#target-path').textContent = path;
  const input = $('#target-input');
  if (input) input.value = path;
  $('#btn-scan').disabled = state.scanning;
  setStatus(t('status.target', { path }));
  updateHeaderStats();
}

/* ---------- сканирование ---------- */

async function startScan() {
  if (!state.target || state.scanning) return;
  const res = await pyApi().start_scan(state.target);
  if (!res.ok) { toast(res.error || t('err.startScan'), true); return; }

  state.scanning = true;
  state.scanSummary = null;
  clearSelection();
  state.topFiles = [];
  state.junkFiles = [];
  state.junkMeta = { totalCount: 0, totalSize: 0 };
  state.dupGroups = [];
  state.dupMeta = { totalGroups: 0, totalWasted: 0, done: false, running: false };
  state.currentFolder = null;
  renderTopFiles();
  renderJunk();
  renderDuplicates();
  $('#folders-tbody').innerHTML =
    '<tr><td colspan="5" class="empty">// ' + t('empty.scanning') + '</td></tr>';
  $('#breadcrumb').innerHTML = '';
  $('#stats-content').innerHTML = '<div class="empty">// ' + t('empty.scanning') + '</div>';
  $('#file-filter').disabled = true;
  $('#file-filter').value = '';
  $('#junk-filter').disabled = true;
  $('#junk-filter').value = '';
  $('#dup-status').textContent = '// ' + t('dup.waitScan');

  $('#btn-scan').classList.add('hidden');
  $('#btn-abort').classList.remove('hidden');
  $('#scan-summary').classList.add('hidden');
  $('#scan-live').classList.remove('hidden');
  setStatus(t('status.scanning', { path: state.target }));
  updateHeaderStats();
}

function abortScan() {
  pyApi().cancel_scan();
  setStatus(t('status.abort'));
}

/* вызывается из Python */
Object.assign(window.App, {
  onBridgeReady() {
    tryBootApi();
  },

  applyDrives(drives) {
    if (Array.isArray(drives)) renderDrivesList(drives);
    tryBootApi();
  },

  onElevated(elevated) {
    if (elevated && window.__APP_READY) {
      setApiStatus(t('api.readyAdmin'), 'ready');
    }
  },

  onWindowMaximized(maximized) {
    syncMaximizeButton(maximized);
  },

  onProgress(d) {
    if (d.phase === 'duplicates') {
      const pct = d.dup_total
        ? Math.round((d.dup_checked / d.dup_total) * 100)
        : 0;
      $('#dup-status').textContent = '// ' + t('dup.progress', {
        checked: fmtNum(d.dup_checked),
        total: fmtNum(d.dup_total),
        pct,
        groups: fmtNum(d.dup_groups || 0),
      });
      if (d.dup_groups) {
        $('#badge-dup').textContent = d.dup_groups;
        $('#badge-dup').classList.toggle('has-items', d.dup_groups > 0);
      }
      return;
    }
    $('#live-files').textContent = fmtNum(d.files);
    $('#live-dirs').textContent = fmtNum(d.dirs);
    $('#live-size').textContent = fmtBytes(d.size);
    $('#live-errors').textContent = fmtNum(d.errors);
    $('#live-elapsed').textContent = d.elapsed.toFixed(1) + 's';
    $('#live-current').textContent = d.current || '';
    updateHeaderStats();
  },

  async onScanDone(summary) {
    state.scanning = false;
    state.scanSummary = summary;
    $('#btn-abort').classList.add('hidden');
    $('#btn-scan').classList.remove('hidden');
    $('#btn-scan').disabled = false;
    $('#scan-live').classList.add('hidden');
    $('#scan-summary').classList.remove('hidden');
    $('#sum-files').textContent = fmtNum(summary.files);
    $('#sum-dirs').textContent = fmtNum(summary.dirs);
    $('#sum-size').textContent = fmtBytes(summary.size);
    $('#sum-elapsed').textContent = summary.elapsed.toFixed(1) + 's';

    setStatus(summary.cancelled
      ? t('status.scanAborted', { size: fmtBytes(summary.size) })
      : t('status.scanDone', { files: fmtNum(summary.files), size: fmtBytes(summary.size) }));

    state.topFiles = await pyApi().get_top_files(300);
    $('#file-filter').disabled = false;
    renderTopFiles();
    await openFolder(summary.root);
    await renderStats();

    const junk = await pyApi().get_junk(300);
    state.junkFiles = junk.files || [];
    state.junkMeta = {
      totalCount: junk.totalCount || 0,
      totalSize: junk.totalSize || 0,
    };
    $('#junk-filter').disabled = false;
    renderJunk();

    if (summary.cancelled) {
      $('#dup-status').textContent = '// ' + t('dup.scanAborted');
    } else {
      state.dupMeta.running = true;
      $('#dup-status').textContent = '// ' + t('dup.running');
    }
    updateHeaderStats();
  },

  onDupScanDone(data) {
    state.dupGroups = data.groups || [];
    state.dupMeta = {
      totalGroups: data.totalGroups || 0,
      totalWasted: data.totalWasted || 0,
      done: true,
      running: false,
    };
    renderDuplicates();
    updateHeaderStats();
    setStatus(t('status.dupDone', {
      groups: fmtNum(data.totalGroups),
      size: fmtBytes(data.totalWasted),
    }));
  },
});

/* ---------- вкладка TOP файлов ---------- */

function filteredTopFiles() {
  const q = $('#file-filter').value.trim().toLowerCase();
  if (!q) return state.topFiles.slice(0, 100);
  return state.topFiles.filter((f) =>
    f.name.toLowerCase().includes(q) ||
    f.ext === q ||
    f.ext === '.' + q.replace(/^\./, '')
  ).slice(0, 100);
}

function renderTopFiles() {
  const tbody = $('#files-tbody');
  const files = filteredTopFiles();
  if (!files.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">// ' +
      (state.topFiles.length ? t('empty.notFound') : t('empty.noData')) +
      '</td></tr>';
    $('#files-check-all').checked = false;
    return;
  }
  const maxSize = files[0].size || 1;
  tbody.innerHTML = files.map((f, idx) => {
    const checked = state.selected.has(f.path);
    const pct = Math.max(1, Math.round((f.size / maxSize) * 100));
    return '<tr class="' + (checked ? 'checked' : '') + '" data-path="' + esc(f.path) + '">' +
      '<td class="col-check"><input type="checkbox" class="row-check"' +
        (checked ? ' checked' : '') + '></td>' +
      '<td class="col-num">' + (idx + 1) + '</td>' +
      '<td class="name" title="' + esc(f.name) + '">' + esc(f.name) + '</td>' +
      '<td class="path" title="' + esc(f.dir) + '">' + esc(f.dir) + '</td>' +
      '<td class="col-size">' + fmtBytes(f.size) + '</td>' +
      '<td class="col-bar"><div class="sizebar"><div class="sizebar-fill" style="width:' +
        pct + '%"></div></div></td>' +
      '<td class="col-act"><button class="act-btn btn-explorer">DIR</button></td>' +
    '</tr>';
  }).join('');
  syncCheckAll();
}

/* ---------- вкладка папок ---------- */

async function openFolder(path) {
  const data = await pyApi().get_folder(path);
  if (!data) return;
  state.currentFolder = data;
  renderBreadcrumb(data);
  renderFolder(data);
}

function renderBreadcrumb(data) {
  const box = $('#breadcrumb');
  const root = data.root;
  const rel = data.path.startsWith(root) ? data.path.slice(root.length) : data.path;
  const parts = rel.split(/[\\/]/).filter(Boolean);

  let html = '<span class="crumb' + (parts.length ? '' : ' last') +
    '" data-path="' + esc(root) + '">' + esc(root) + '</span>';
  let acc = root.replace(/[\\/]+$/, '');
  parts.forEach((part, i) => {
    acc += '\\' + part;
    const last = i === parts.length - 1;
    html += '<span class="crumb-sep">&gt;</span>' +
      '<span class="crumb' + (last ? ' last' : '') + '" data-path="' + esc(acc) + '">' +
      esc(part) + '</span>';
  });
  html += '<span class="crumb-sep">::</span><span style="color:var(--green)">' +
    fmtBytes(data.size) + '</span>';
  box.innerHTML = html;
}

function renderFolder(data) {
  const tbody = $('#folders-tbody');
  const rows = [];
  const maxSize = Math.max(
    data.dirs.length ? data.dirs[0].size : 0,
    data.files.length ? data.files[0].size : 0, 1);

  if (data.parent) {
    rows.push('<tr class="up-row" data-up="' + esc(data.parent) + '">' +
      '<td class="col-check"></td>' +
      '<td class="name"><span class="dir-link">' + t('folder.back') + '</span></td>' +
      '<td class="col-size"></td><td class="col-bar"></td><td class="col-act"></td></tr>');
  }

  for (const d of data.dirs) {
    const checked = state.selected.has(d.path);
    const pct = Math.max(1, Math.round((d.size / maxSize) * 100));
    rows.push('<tr class="' + (checked ? 'checked' : '') + '" data-path="' + esc(d.path) +
      '" data-dir="1">' +
      '<td class="col-check"><input type="checkbox" class="row-check"' +
        (checked ? ' checked' : '') + '></td>' +
      '<td class="name"><span class="dir-link" data-open="' + esc(d.path) + '">▸ ' +
        esc(d.name) + '</span></td>' +
      '<td class="col-size">' + fmtBytes(d.size) + '</td>' +
      '<td class="col-bar"><div class="sizebar"><div class="sizebar-fill" style="width:' +
        pct + '%"></div></div></td>' +
      '<td class="col-act"><button class="act-btn btn-explorer">DIR</button></td>' +
    '</tr>');
  }

  for (const f of data.files) {
    const checked = state.selected.has(f.path);
    const pct = Math.max(1, Math.round((f.size / maxSize) * 100));
    rows.push('<tr class="' + (checked ? 'checked' : '') + '" data-path="' + esc(f.path) + '">' +
      '<td class="col-check"><input type="checkbox" class="row-check"' +
        (checked ? ' checked' : '') + '></td>' +
      '<td class="name" title="' + esc(f.name) + '">' + esc(f.name) + '</td>' +
      '<td class="col-size">' + fmtBytes(f.size) + '</td>' +
      '<td class="col-bar"><div class="sizebar"><div class="sizebar-fill" style="width:' +
        pct + '%"></div></div></td>' +
      '<td class="col-act"><button class="act-btn btn-explorer">DIR</button></td>' +
    '</tr>');
  }

  tbody.innerHTML = rows.length ? rows.join('')
    : '<tr><td colspan="5" class="empty">// ' + t('empty.emptyFolder') + '</td></tr>';
}

/* ---------- вкладка статистики ---------- */

async function renderStats() {
  const data = await pyApi().get_stats();
  const box = $('#stats-content');
  const s = data.summary;
  if (!s.files && !s.size) {
    box.innerHTML = '<div class="empty">// ' + t('empty.noData') + '</div>';
    return;
  }
  const maxCat = data.categories.length ? data.categories[0].size : 1;

  let html =
    '<div class="stats-summary">' +
      '<div class="stat-card"><div class="value">' + fmtBytes(s.size) +
        '</div><div class="caption">' + t('stats.total') + '</div></div>' +
      '<div class="stat-card"><div class="value">' + fmtNum(s.files) +
        '</div><div class="caption">' + t('stats.files') + '</div></div>' +
      '<div class="stat-card"><div class="value">' + fmtNum(s.dirs) +
        '</div><div class="caption">' + t('stats.dirs') + '</div></div>' +
      '<div class="stat-card"><div class="value">' + fmtNum(s.errors) +
        '</div><div class="caption">' + t('stats.errors') + '</div></div>' +
    '</div>';

  for (const c of data.categories) {
    const pct = Math.max(1, Math.round((c.size / maxCat) * 100));
    const share = s.size ? ((c.size / s.size) * 100).toFixed(1) : '0.0';
    html += '<div class="cat-row">' +
      '<div class="cat-head">' +
        '<span class="cat-name">' + esc(c.label) + '</span>' +
        '<span class="cat-meta">' + t('stats.catMeta', {
          size: fmtBytes(c.size),
          count: fmtNum(c.count),
          share,
        }) + '</span>' +
      '</div>' +
      '<div class="cat-bar"><div class="cat-bar-fill" style="width:' + pct + '%"></div></div>' +
    '</div>';
  }
  box.innerHTML = html;
}

/* ---------- вкладка мусора ---------- */

function filteredJunkFiles() {
  const q = ($('#junk-filter') && $('#junk-filter').value.trim().toLowerCase()) || '';
  if (!q) return state.junkFiles;
  return state.junkFiles.filter((f) =>
    f.name.toLowerCase().includes(q) ||
    I18n.junkLabel(f.reason).toLowerCase().includes(q) ||
    f.reason === q ||
    f.path.toLowerCase().includes(q)
  );
}

function renderJunk() {
  const tbody = $('#junk-tbody');
  const files = filteredJunkFiles();
  const meta = state.junkMeta;

  $('#junk-count').textContent = fmtNum(meta.totalCount);
  $('#junk-size').textContent = fmtBytes(meta.totalSize);
  $('#badge-junk').textContent = meta.totalCount;
  $('#badge-junk').classList.toggle('has-items', meta.totalCount > 0);

  if (!files.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">// ' +
      (meta.totalCount ? t('empty.notFoundFilter') : t('empty.noData')) +
      '</td></tr>';
    updateHeaderStats();
    return;
  }

  tbody.innerHTML = files.map((f) => {
    const checked = state.selected.has(f.path);
    return '<tr class="' + (checked ? 'checked' : '') + '" data-path="' + esc(f.path) + '">' +
      '<td class="col-check"><input type="checkbox" class="row-check"' +
        (checked ? ' checked' : '') + '></td>' +
      '<td><span class="junk-tag junk-' + esc(f.reason) + '">' + esc(I18n.junkLabel(f.reason)) + '</span></td>' +
      '<td class="name" title="' + esc(f.name) + '">' + esc(f.name) + '</td>' +
      '<td class="path" title="' + esc(f.dir) + '">' + esc(f.dir) + '</td>' +
      '<td class="col-size">' + fmtBytes(f.size) + '</td>' +
      '<td class="col-act"><button class="act-btn btn-explorer">DIR</button></td>' +
    '</tr>';
  }).join('');
  updateHeaderStats();
}

function normPath(p) {
  return String(p).replace(/\//g, '\\').toLowerCase();
}

function refreshDupMeta() {
  state.dupMeta.totalGroups = state.dupGroups.length;
  state.dupMeta.totalWasted = state.dupGroups.reduce((sum, g) => sum + (g.wasted || 0), 0);
}

function renderDuplicates(data) {
  if (data) {
    state.dupGroups = data.groups || state.dupGroups;
    state.dupMeta = {
      totalGroups: data.totalGroups ?? state.dupMeta.totalGroups,
      totalWasted: data.totalWasted ?? state.dupMeta.totalWasted,
      done: data.done ?? state.dupMeta.done,
      running: data.running ?? state.dupMeta.running,
    };
  }

  const tbody = $('#dup-tbody');
  const meta = state.dupMeta;
  const groups = state.dupGroups;

  $('#dup-groups').textContent = fmtNum(meta.totalGroups);
  $('#dup-wasted').textContent = fmtBytes(meta.totalWasted);
  $('#badge-dup').textContent = meta.totalGroups;
  $('#badge-dup').classList.toggle('has-items', meta.totalGroups > 0);

  if (meta.running && !meta.done) {
    $('#dup-status').textContent = '// ' + t('dup.running');
  } else if (meta.done && !meta.totalGroups) {
    $('#dup-status').textContent = '// ' + t('dup.none');
  } else if (meta.done) {
    $('#dup-status').textContent = '// ' + t('dup.found', { n: fmtNum(meta.totalGroups) });
  } else {
    $('#dup-status').textContent = '// ' + t('dup.hintDefault');
  }

  if (!groups.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">// ' +
      (meta.running ? t('empty.dupSearching') : t('empty.noData')) +
      '</td></tr>';
    updateHeaderStats();
    return;
  }

  const rows = [];
  groups.forEach((g, gi) => {
    rows.push('<tr class="dup-group-header">' +
      '<td colspan="6">' +
        '<span class="dup-group-title">' + t('dup.groupTitle', { n: gi + 1 }) + '</span> ' +
        '<span class="dup-group-meta">' + t('dup.groupMeta', {
          size: fmtBytes(g.size),
          count: g.count,
          wasted: fmtBytes(g.wasted),
          hash: esc(g.hash),
        }) + '</span>' +
      '</td></tr>');
    g.files.forEach((f, fi) => {
      const checked = state.selected.has(f.path);
      rows.push('<tr class="' + (checked ? 'checked' : '') + ' dup-file-row" data-path="' +
        esc(f.path) + '">' +
        '<td class="col-check"><input type="checkbox" class="row-check"' +
          (checked ? ' checked' : '') + '></td>' +
        '<td class="dup-copy-label">' + (fi === 0 ? t('dup.original') : t('dup.copy', { n: fi })) + '</td>' +
        '<td class="name" title="' + esc(f.name) + '">' + esc(f.name) + '</td>' +
        '<td class="path" title="' + esc(f.dir) + '">' + esc(f.dir) + '</td>' +
        '<td class="col-size">' + fmtBytes(g.size) + '</td>' +
        '<td class="col-act"><button class="act-btn btn-explorer">DIR</button></td>' +
      '</tr>');
    });
  });
  tbody.innerHTML = rows.join('');
  updateHeaderStats();
}

/* ---------- выбор объектов ---------- */

function toggleSelect(path, size, isDir, on) {
  if (on) state.selected.set(path, { size, isDir });
  else state.selected.delete(path);
  updateSelectionUI();
}

function setRowSelected(tr, on, skipUpdate = false) {
  if (!tr || !tr.dataset.path) return;
  const path = tr.dataset.path;
  const cb = tr.querySelector('.row-check');
  if (!cb || cb.checked === on) return;
  cb.checked = on;
  tr.classList.toggle('checked', on);
  const info = findSize(path);
  if (on) state.selected.set(path, info);
  else state.selected.delete(path);
  if (!skipUpdate) updateSelectionUI();
}

const dragSelect = {
  pending: false,
  active: false,
  mode: true,       // true = выделить, false = снять
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  startTr: null,
  tbody: null,
  scrollRaf: null,
};

const SCROLL_ZONE = 52;
const SCROLL_MAX_SPEED = 20;

function getScrollWrap(tbody) {
  return tbody ? tbody.closest('.table-wrap') : null;
}

function endDragSelect() {
  if (dragSelect.scrollRaf) {
    cancelAnimationFrame(dragSelect.scrollRaf);
    dragSelect.scrollRaf = null;
  }
  document.querySelectorAll('.table-wrap.drag-scroll-zone').forEach((el) => {
    el.classList.remove('drag-scroll-zone', 'drag-scroll-up', 'drag-scroll-down');
  });
  // одиночный клик по строке (без перетаскивания)
  if (dragSelect.pending && !dragSelect.active && dragSelect.startTr) {
    setRowSelected(dragSelect.startTr, dragSelect.mode);
  } else if (dragSelect.active) {
    updateSelectionUI();
  }
  dragSelect.pending = false;
  dragSelect.active = false;
  dragSelect.startTr = null;
  dragSelect.tbody = null;
  document.body.classList.remove('drag-selecting', 'drag-select-add', 'drag-select-remove');
}

function isDragSelectBlocked(target) {
  return !!target.closest('.btn-explorer, [data-open], .dir-link, .row-check, .up-row');
}

function beginDragSelect() {
  dragSelect.pending = false;
  dragSelect.active = true;
  document.body.classList.add('drag-selecting');
  document.body.classList.add(dragSelect.mode ? 'drag-select-add' : 'drag-select-remove');
  if (dragSelect.startTr) {
    setRowSelected(dragSelect.startTr, dragSelect.mode, true);
  }
  startDragScrollLoop();
}

function applyDragSelectAtPoint(x, y) {
  if (!dragSelect.active || !dragSelect.tbody) return;
  const el = document.elementFromPoint(x, y);
  const tr = el && el.closest('tr[data-path]');
  if (tr && dragSelect.tbody.contains(tr)) {
    setRowSelected(tr, dragSelect.mode, true);
  }
}

function performAutoScroll(x, y) {
  const wrap = getScrollWrap(dragSelect.tbody);
  if (!wrap) return 0;

  const rect = wrap.getBoundingClientRect();
  let speed = 0;

  wrap.classList.remove('drag-scroll-up', 'drag-scroll-down');

  if (y < rect.top + SCROLL_ZONE) {
    const dist = y <= rect.top ? SCROLL_ZONE : (rect.top + SCROLL_ZONE) - y;
    speed = -SCROLL_MAX_SPEED * (dist / SCROLL_ZONE);
    wrap.classList.add('drag-scroll-zone', 'drag-scroll-up');
  } else if (y > rect.bottom - SCROLL_ZONE) {
    const dist = y >= rect.bottom ? SCROLL_ZONE : y - (rect.bottom - SCROLL_ZONE);
    speed = SCROLL_MAX_SPEED * (dist / SCROLL_ZONE);
    wrap.classList.add('drag-scroll-zone', 'drag-scroll-down');
  } else {
    wrap.classList.remove('drag-scroll-zone');
  }

  if (speed !== 0) {
    wrap.scrollTop += speed;
  }
  return speed;
}

function startDragScrollLoop() {
  if (dragSelect.scrollRaf) return;
  const tick = () => {
    if (!dragSelect.active) {
      dragSelect.scrollRaf = null;
      return;
    }
    performAutoScroll(dragSelect.lastX, dragSelect.lastY);
    applyDragSelectAtPoint(dragSelect.lastX, dragSelect.lastY);
    dragSelect.scrollRaf = requestAnimationFrame(tick);
  };
  dragSelect.scrollRaf = requestAnimationFrame(tick);
}

function bindDragSelect(tbody) {
  tbody.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (isDragSelectBlocked(e.target)) return;
    const tr = e.target.closest('tr[data-path]');
    if (!tr) return;

    const cb = tr.querySelector('.row-check');
    dragSelect.pending = true;
    dragSelect.active = false;
    dragSelect.mode = !(cb && cb.checked); // выбранная строка → снимаем, иначе ставим
    dragSelect.startX = e.clientX;
    dragSelect.startY = e.clientY;
    dragSelect.startTr = tr;
    dragSelect.tbody = tbody;
  });
}

function initDragSelect() {
  bindDragSelect($('#files-tbody'));
  bindDragSelect($('#folders-tbody'));
  bindDragSelect($('#junk-tbody'));
  bindDragSelect($('#dup-tbody'));

  document.addEventListener('mousemove', (e) => {
    if (!dragSelect.pending && !dragSelect.active) return;
    if (!(e.buttons & 1)) {
      endDragSelect();
      return;
    }

    dragSelect.lastX = e.clientX;
    dragSelect.lastY = e.clientY;

    if (dragSelect.pending && !dragSelect.active) {
      const dx = Math.abs(e.clientX - dragSelect.startX);
      const dy = Math.abs(e.clientY - dragSelect.startY);
      if (dx < 5 && dy < 5) return;
      beginDragSelect();
    }

    if (!dragSelect.active || !dragSelect.tbody) return;

    performAutoScroll(e.clientX, e.clientY);
    applyDragSelectAtPoint(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', endDragSelect);
  window.addEventListener('blur', endDragSelect);
}

function clearSelection() {
  state.selected.clear();
  document.querySelectorAll('.row-check').forEach((cb) => { cb.checked = false; });
  document.querySelectorAll('tr.checked').forEach((tr) => tr.classList.remove('checked'));
  updateSelectionUI();
}

function updateSelectionUI() {
  let total = 0;
  for (const v of state.selected.values()) total += v.size;
  $('#sel-count').textContent = state.selected.size;
  $('#sel-size').textContent = fmtBytes(total);
  const has = state.selected.size > 0;
  $('#btn-trash').disabled = !has;
  $('#btn-shred').disabled = !has;
  $('#btn-clear-sel').disabled = !has;
  const selInfo = $('#sel-info');
  if (selInfo) selInfo.classList.toggle('has-selection', has);
  syncCheckAll();
}

function syncCheckAll() {
  const rows = document.querySelectorAll('#files-tbody .row-check');
  const all = rows.length > 0 &&
    Array.from(rows).every((cb) => cb.checked);
  $('#files-check-all').checked = all;
}

/* достать размер строки из state по пути */
function findSize(path) {
  const f = state.topFiles.find((x) => x.path === path);
  if (f) return { size: f.size, isDir: false };
  const j = state.junkFiles.find((x) => x.path === path);
  if (j) return { size: j.size, isDir: false };
  for (const g of state.dupGroups) {
    const df = g.files.find((x) => x.path === path);
    if (df) return { size: g.size, isDir: false };
  }
  if (state.currentFolder) {
    const d = state.currentFolder.dirs.find((x) => x.path === path);
    if (d) return { size: d.size, isDir: true };
    const fl = state.currentFolder.files.find((x) => x.path === path);
    if (fl) return { size: fl.size, isDir: false };
  }
  return { size: 0, isDir: false };
}

function syncMainTableChecks() {
  document.querySelectorAll('tr[data-path]').forEach((tr) => {
    const path = tr.dataset.path;
    const cb = tr.querySelector('.row-check');
    if (!cb) return;
    const on = state.selected.has(path);
    cb.checked = on;
    tr.classList.toggle('checked', on);
  });
  updateSelectionUI();
}

function getSelectedItems() {
  return Array.from(state.selected.entries())
    .map(([path, info]) => ({
      path,
      name: path.replace(/[/\\]+$/, '').split(/[\\/]/).pop() || path,
      size: info.size,
      isDir: info.isDir,
    }))
    .sort((a, b) => b.size - a.size);
}

function getModalCheckedPaths() {
  return Array.from(document.querySelectorAll('#modal-checklist .modal-check:checked'))
    .map((cb) => cb.dataset.path);
}

function renderModalChecklist(items) {
  return (
    '<label class="modal-check-all">' +
      '<input type="checkbox" id="modal-check-all" checked>' +
      '<span>' + t('modal.selectAll') + '</span>' +
    '</label>' +
    '<div id="modal-checklist" class="modal-checklist">' +
      items.map((item) =>
        '<div class="modal-check-item">' +
          '<label class="modal-check-row" title="' + esc(item.path) + '">' +
            '<input type="checkbox" class="modal-check" data-path="' + esc(item.path) + '" checked>' +
            '<span class="modal-check-type' + (item.isDir ? ' dir' : '') + '">' +
              (item.isDir ? 'DIR' : 'FILE') + '</span>' +
            '<span class="modal-check-name">' + esc(item.name) + '</span>' +
            '<span class="modal-check-size">' + fmtBytes(item.size) + '</span>' +
          '</label>' +
          '<div class="modal-check-path">' + esc(item.path) + '</div>' +
        '</div>'
      ).join('') +
    '</div>'
  );
}

function updateModalSummary(mode) {
  const checks = document.querySelectorAll('#modal-checklist .modal-check');
  let count = 0;
  let total = 0;
  checks.forEach((cb) => {
    if (cb.checked) {
      count += 1;
      const info = state.selected.get(cb.dataset.path);
      if (info) total += info.size;
    }
  });
  const summary = $('#modal-summary');
  if (mode === 'review') {
    summary.innerHTML = t('modal.summaryReview', {
      count,
      total: checks.length,
      size: fmtBytes(total),
    });
  } else {
    summary.innerHTML = t('modal.summaryDelete', {
      count,
      total: checks.length,
      size: fmtBytes(total),
    });
  }
  const confirmBtn = $('#modal-confirm');
  if (confirmBtn) confirmBtn.disabled = mode !== 'review' && count === 0;
  const checkAll = $('#modal-check-all');
  if (checkAll) {
    checkAll.checked = count === checks.length && count > 0;
    checkAll.indeterminate = count > 0 && count < checks.length;
  }
}

function bindModalChecklistEvents(mode) {
  const checkAll = $('#modal-check-all');
  const list = $('#modal-checklist');
  checkAll.addEventListener('change', (e) => {
    const on = e.target.checked;
    list.querySelectorAll('.modal-check').forEach((cb) => { cb.checked = on; });
    updateModalSummary(mode);
  });
  list.addEventListener('change', (e) => {
    if (e.target.classList.contains('modal-check')) updateModalSummary(mode);
  });
}

function applyModalSelectionToState() {
  document.querySelectorAll('#modal-checklist .modal-check').forEach((cb) => {
    if (!cb.checked) state.selected.delete(cb.dataset.path);
  });
  syncMainTableChecks();
}

function openSelectionModal(mode) {
  const items = getSelectedItems();
  if (!items.length) return;

  const permanent = mode === 'shred';
  const isReview = mode === 'review';
  const titles = {
    trash: t('modal.trash'),
    shred: t('modal.shred'),
    review: t('modal.review'),
  };

  const modalPanel = document.querySelector('#modal .modal');
  modalPanel.classList.toggle('modal-review', isReview);
  modalPanel.classList.toggle('modal-trash', mode === 'trash');
  modalPanel.classList.toggle('modal-shred', permanent);

  $('#modal-title').textContent = titles[mode];

  const hint = isReview
    ? t('modal.hintReview')
    : permanent
      ? '<div class="warn">' + t('modal.warnShred') + '</div>'
      : '<div class="modal-hint">' + t('modal.hintTrash') + '</div>';

  $('#modal-body').innerHTML =
    (isReview ? '<div class="modal-hint">' + hint + '</div>' : hint) +
    '<div id="modal-summary" class="modal-summary"></div>' +
    renderModalChecklist(items);

  bindModalChecklistEvents(mode);
  updateModalSummary(mode);

  const modal = $('#modal');
  const confirmBtn = $('#modal-confirm');
  const cancelBtn = $('#modal-cancel');

  confirmBtn.className = 'btn ' + (
    isReview ? 'btn-primary' : permanent ? 'btn-danger' : 'btn-warn'
  );
  confirmBtn.textContent = isReview ? t('modal.apply') : permanent ? t('modal.shredBtn') : t('modal.trashBtn');

  confirmBtn.onclick = async () => {
    if (isReview) {
      applyModalSelectionToState();
      modal.classList.add('hidden');
      setStatus(t('status.selectionUpdated', { n: state.selected.size }));
      return;
    }
    const paths = getModalCheckedPaths();
    if (!paths.length) return;
    modal.classList.add('hidden');
    await executeDelete(paths, permanent);
  };

  cancelBtn.onclick = () => modal.classList.add('hidden');
  modal.classList.remove('hidden');
}

function showDeleteModal(permanent) {
  openSelectionModal(permanent ? 'shred' : 'trash');
}

function formatLogTime() {
  const d = new Date();
  return d.toLocaleTimeString(I18n.localeTag(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function recordDeletion(items, permanent) {
  const list = permanent ? sessionLog.shredded : sessionLog.trashed;
  const time = formatLogTime();
  for (const item of items) {
    list.unshift({ ...item, time });
  }
  renderSessionLogs();
}

function sumLogSize(items) {
  return items.reduce((acc, it) => acc + (it.size || 0), 0);
}

function renderLogTable(tbodyId, items, emptyText) {
  const tbody = $(tbodyId);
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">' + emptyText + '</td></tr>';
    return;
  }
  tbody.innerHTML = items.map((it) =>
    '<tr>' +
      '<td class="col-time">' + esc(it.time || '—') + '</td>' +
      '<td class="col-type">' + (it.isDir ? 'DIR' : 'FILE') + '</td>' +
      '<td class="name" title="' + esc(it.name) + '">' + esc(it.name) + '</td>' +
      '<td class="path" title="' + esc(it.path) + '">' + esc(it.path) + '</td>' +
      '<td class="col-size">' + fmtBytes(it.size) + '</td>' +
    '</tr>'
  ).join('');
}

function renderSessionLogs() {
  const trashCount = sessionLog.trashed.length;
  const shredCount = sessionLog.shredded.length;
  const trashSize = sumLogSize(sessionLog.trashed);
  const shredSize = sumLogSize(sessionLog.shredded);

  $('#trash-log-count').textContent = fmtNum(trashCount);
  $('#trash-log-size').textContent = fmtBytes(trashSize);
  $('#shred-log-count').textContent = fmtNum(shredCount);
  $('#shred-log-size').textContent = fmtBytes(shredSize);

  $('#badge-trash').textContent = trashCount;
  $('#badge-shred').textContent = shredCount;
  $('#badge-trash').classList.toggle('has-items', trashCount > 0);
  $('#badge-shred').classList.toggle('has-items', shredCount > 0);

  renderLogTable('#trash-log-tbody', sessionLog.trashed, '// ' + t('empty.log'));
  renderLogTable('#shred-log-tbody', sessionLog.shredded, '// ' + t('empty.log'));
}

async function executeDelete(paths, permanent) {
  setStatus(t('status.deleting', {
    action: t(permanent ? 'status.actionShred' : 'status.actionTrash'),
    n: paths.length,
  }));
  const res = await pyApi().delete_items(paths, permanent);

  if (res.deleted.length) {
    recordDeletion(res.deleted, permanent);
    const deletedPaths = res.deleted.map((d) => d.path);
    const deletedNorm = new Set(deletedPaths.map(normPath));
    const isDeleted = (path) => {
      const np = normPath(path);
      if (deletedNorm.has(np)) return true;
      for (const d of deletedPaths) {
        const prefix = normPath(d) + '\\';
        if (np.startsWith(prefix)) return true;
      }
      return false;
    };
    state.topFiles = state.topFiles.filter((f) => !isDeleted(f.path));
    for (const p of deletedPaths) state.selected.delete(p);
    state.junkFiles = state.junkFiles.filter((f) => !isDeleted(f.path));
    state.dupGroups = state.dupGroups.map((g) => {
      const files = g.files.filter((f) => !isDeleted(f.path));
      if (files.length < 2) return null;
      return {
        ...g,
        files,
        count: files.length,
        wasted: g.size * (files.length - 1),
      };
    }).filter(Boolean);
    refreshDupMeta();
  }

  renderTopFiles();
  renderJunk();
  renderDuplicates();
  updateSelectionUI();
  if (state.currentFolder) {
    await openFolder(state.currentFolder.path).catch(() => {});
  }
  await renderStats();
  try {
    const junk = await pyApi().get_junk(300);
    state.junkFiles = junk.files || [];
    state.junkMeta = {
      totalCount: junk.totalCount || 0,
      totalSize: junk.totalSize || 0,
    };
    renderJunk();
    const dup = await pyApi().get_duplicates(80);
    renderDuplicates(dup);
  } catch (_) { /* partial refresh ok */ }

  const freed = sumLogSize(res.deleted);
  if (res.failed.length) {
    toast(t('toast.deletedPartial', {
      ok: res.deleted.length,
      fail: res.failed.length,
      err: res.failed[0].error,
    }), true);
  } else if (permanent) {
    toast(t('toast.shredded', { n: res.deleted.length, size: fmtBytes(freed) }));
  } else {
    toast(t('toast.trashed', { n: res.deleted.length, size: fmtBytes(freed) }));
  }
  setStatus(t('status.deleteDone', { ok: res.deleted.length, fail: res.failed.length }));
}

/* ---------- события ---------- */

let windowMaximized = false;

function syncMaximizeButton(maximized) {
  windowMaximized = !!maximized;
  const btnMax = $('#btn-win-max');
  if (!btnMax) return;
  btnMax.textContent = maximized ? '❐' : '□';
  btnMax.title = maximized ? t('titlebar.restore') : t('titlebar.max');
  btnMax.classList.toggle('titlebar-btn-maximized', !!maximized);
}

async function syncMaximizeFromApi() {
  if (!apiReady()) return;
  try {
    const r = await pyApi().window_is_maximized();
    syncMaximizeButton(r.maximized);
  } catch (_) { /* ignore */ }
}

function bindTitlebar() {
  const btnMin = $('#btn-win-min');
  const btnMax = $('#btn-win-max');
  const btnClose = $('#btn-win-close');
  const drag = document.querySelector('.titlebar-drag');
  if (!btnMin || !btnMax || !btnClose) return;

  btnMin.addEventListener('click', () => {
    if (apiReady()) pyApi().window_minimize().catch(() => {});
  });

  btnClose.addEventListener('click', () => {
    if (apiReady()) pyApi().window_close().catch(() => {});
  });

  async function toggleMaximize() {
    if (!apiReady()) return;
    try {
      const r = await pyApi().window_toggle_maximize();
      syncMaximizeButton(r.maximized);
    } catch (_) { /* ignore */ }
  }

  btnMax.addEventListener('click', toggleMaximize);
  if (drag) drag.addEventListener('dblclick', toggleMaximize);
}

let folderDialogBusy = false;

function bindEvents() {
  bindTitlebar();

  const btnLang = $('#btn-lang');
  if (btnLang) {
    btnLang.addEventListener('click', () => I18n.toggle());
  }

  I18n.onChange(refreshUiOnLangChange);

  $('#btn-browse').addEventListener('click', async () => {
    if (folderDialogBusy) return;
    folderDialogBusy = true;
    $('#btn-browse').disabled = true;
    try {
      setStatus(t('status.folderOpen'));
      const path = await pyApi().choose_folder();
      if (path) {
        selectTarget(path, null);
      } else {
        setStatus(t('status.folderCancel'));
      }
    } catch (err) {
      toast(t('err.folderDialog'), true);
      setStatus(t('status.folderError'));
      console.error(err);
    } finally {
      folderDialogBusy = false;
      $('#btn-browse').disabled = false;
    }
  });

  $('#btn-set-target').addEventListener('click', () => {
    const path = $('#target-input').value.trim();
    if (path) selectTarget(path, null);
  });

  $('#target-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const path = e.target.value.trim();
      if (path) selectTarget(path, null);
    }
  });

  $('#btn-scan').addEventListener('click', startScan);
  $('#btn-abort').addEventListener('click', abortScan);

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      $('#tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  $('#file-filter').addEventListener('input', renderTopFiles);
  $('#junk-filter').addEventListener('input', renderJunk);

  $('#files-check-all').addEventListener('change', (e) => {
    const on = e.target.checked;
    document.querySelectorAll('#files-tbody tr[data-path]').forEach((tr) => {
      const path = tr.dataset.path;
      const cb = tr.querySelector('.row-check');
      cb.checked = on;
      tr.classList.toggle('checked', on);
      const info = findSize(path);
      if (on) state.selected.set(path, info);
      else state.selected.delete(path);
    });
    updateSelectionUI();
  });

  // делегирование кликов по таблицам
  for (const id of ['#files-tbody', '#folders-tbody', '#junk-tbody', '#dup-tbody']) {
    $(id).addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;

      if (tr.dataset.up) { await openFolder(tr.dataset.up); return; }

      const open = e.target.closest('[data-open]');
      if (open) { await openFolder(open.dataset.open); return; }

      if (e.target.closest('.btn-explorer')) {
        await pyApi().open_in_explorer(tr.dataset.path);
        return;
      }

      // клик по чекбоксу (mousedown для него заблокирован в drag-select)
      if (e.target.closest('.row-check') && tr.dataset.path) {
        const cb = tr.querySelector('.row-check');
        const info = findSize(tr.dataset.path);
        tr.classList.toggle('checked', cb.checked);
        if (cb.checked) state.selected.set(tr.dataset.path, info);
        else state.selected.delete(tr.dataset.path);
        updateSelectionUI();
      }
    });
  }

  initDragSelect();

  $('#btn-clear-sel').addEventListener('click', clearSelection);
  $('#btn-trash').addEventListener('click', () => showDeleteModal(false));
  $('#btn-shred').addEventListener('click', () => showDeleteModal(true));

  $('#sel-info').addEventListener('click', () => {
    if (state.selected.size > 0) openSelectionModal('review');
  });

  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') $('#modal').classList.add('hidden');
  });
}

/* ---------- init ---------- */

async function refreshUiOnLangChange() {
  syncMaximizeButton(windowMaximized);
  updateHeaderStats();
  if (state.drives.length) renderDrivesList(state.drives);
  renderTopFiles();
  renderJunk();
  renderDuplicates();
  renderSessionLogs();
  if (state.currentFolder) {
    renderBreadcrumb(state.currentFolder);
    renderFolder(state.currentFolder);
  } else if (state.scanning) {
    $('#folders-tbody').innerHTML =
      '<tr><td colspan="5" class="empty">// ' + t('empty.scanning') + '</td></tr>';
  } else if (!state.scanSummary) {
    $('#folders-tbody').innerHTML =
      '<tr><td colspan="5" class="empty">// ' + t('empty.noData') + '</td></tr>';
  }
  if (state.scanning) {
    $('#stats-content').innerHTML =
      '<div class="empty">// ' + t('empty.scanning') + '</div>';
  } else if (!state.scanSummary) {
    $('#stats-content').innerHTML =
      '<div class="empty">// ' + t('empty.noData') + '</div>';
  } else {
    await renderStats().catch(() => {});
  }
  if (window.__APP_READY) {
    const apiEl = $('#api-status');
    if (apiEl && apiEl.classList.contains('ready')) {
      const isAdmin = apiEl.textContent.includes('ADMIN');
      setApiStatus(isAdmin ? t('api.readyAdmin') : t('api.ready'), 'ready');
    }
  }
}

function initUi() {
  if (window.__UI_READY) return;
  window.__UI_READY = true;
  startMatrix();
  bindEvents();
  renderSessionLogs();
  updateHeaderStats();
  setStatus(t('status.loaded'));
}

function tryBootApi() {
  initUi();
  if (window.__APP_READY) return;
  if (!apiReady()) return;
  window.__APP_READY = true;
  loadDrives();
  syncMaximizeFromApi();
  setApiStatus(t('api.ready'), 'ready');
  pyApi().is_elevated().then((elevated) => {
    if (elevated) setApiStatus(t('api.readyAdmin'), 'ready');
  }).catch(() => {});
  setStatus(t('status.online'));
}

function bootApi() {
  setApiStatus(t('api.connecting'));
  if (window.__PYWEBVIEW_READY) tryBootApi();
  window.addEventListener('pywebviewready', tryBootApi);
  let attempts = 0;
  const timer = setInterval(() => {
    if (apiReady()) {
      clearInterval(timer);
      tryBootApi();
    } else if (++attempts > 600) {
      clearInterval(timer);
      setApiStatus(t('api.failed'), 'error');
      toast(t('err.apiTimeout'), true);
    }
  }, 100);
}

initUi();
bootApi();
