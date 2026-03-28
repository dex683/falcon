/* ===================================================================
   app.js — Disaster Image Labeler client logic
   =================================================================== */

'use strict';

// ── State ───────────────────────────────────────────────────────────────────
let currentFilter  = 'all';
let currentViewer  = -1;  // index into ALL_IMAGES
let labelsMap      = { ...LABELS_MAP };
let visibleIndices = [];  // indices of cards currently visible

// ── Folder Loading ───────────────────────────────────────────────────────────
async function setFolder() {
  const folder = document.getElementById('folderInput').value.trim();
  const errEl  = document.getElementById('folderError');
  errEl.classList.add('hidden');

  if (!folder) {
    showError(errEl, 'Please enter a folder path.');
    return;
  }

  const btn = document.getElementById('loadBtn');
  btn.textContent = 'Loading…';
  btn.disabled = true;

  const resp = await fetch('/set_folder', {
    method: 'POST',
    body: new URLSearchParams({ folder }),
  });
  const data = await resp.json();
  btn.textContent = 'Load Images';
  btn.disabled = false;

  if (data.success) {
    window.location.reload();
  } else {
    showError(errEl, data.error || 'Unknown error');
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Quick-label (from card) ──────────────────────────────────────────────────
async function quickLabel(filename, label, _unused) {
  const card = findCard(filename);
  await applyLabel(filename, label, card);
}

// ── Viewer ───────────────────────────────────────────────────────────────────
function openViewer(index) {
  currentViewer = index;
  renderViewer();
  document.getElementById('viewerOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeViewer() {
  document.getElementById('viewerOverlay').classList.add('hidden');
  document.body.style.overflow = '';
  currentViewer = -1;
}

function renderViewer() {
  const img    = ALL_IMAGES[currentViewer];
  const lbl    = labelsMap[img] || '';
  const total  = ALL_IMAGES.length;

  document.getElementById('viewerImg').src       = `/image/${encodeURIComponent(img)}`;
  document.getElementById('viewerImg').alt       = img;
  document.getElementById('viewerFilename').textContent = img;
  document.getElementById('viewerCounter').textContent  = `${currentViewer + 1} / ${total}`;

  document.getElementById('viewerPrev').disabled = currentViewer === 0;
  document.getElementById('viewerNext').disabled = currentViewer === total - 1;

  // Highlight selected label button
  LABEL_LIST.forEach(l => {
    const btn = document.getElementById(`vlBtn_${l}`);
    btn.classList.toggle('vl-selected', l === lbl);
    btn.style.setProperty('--vl-color', LABEL_COLORS[l]);
  });
}

function navigateViewer(dir) {
  const next = currentViewer + dir;
  if (next < 0 || next >= ALL_IMAGES.length) return;
  currentViewer = next;
  renderViewer();
}

async function setViewerLabel(label) {
  const filename = ALL_IMAGES[currentViewer];
  const card = findCard(filename);
  await applyLabel(filename, label, card);
  renderViewer();
}

async function clearViewerLabel() {
  const filename = ALL_IMAGES[currentViewer];
  const resp = await fetch(`/unlabel/${encodeURIComponent(filename)}`, { method: 'POST' });
  const data = await resp.json();
  if (data.success) {
    delete labelsMap[filename];
    updateCardUI(findCard(filename), filename, '');
    updateStats(data.stats);
    renderViewer();
    showToast('Label cleared', 'info');
    applyFilters();
  }
}

// ── Core label logic ─────────────────────────────────────────────────────────
async function applyLabel(filename, label, card) {
  const resp = await fetch(`/label/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  const data = await resp.json();
  if (data.success) {
    labelsMap[filename] = label;
    updateCardUI(card, filename, label);
    updateStats(data.stats);

    const color = LABEL_COLORS[label];
    showToast(`✓ ${label.charAt(0).toUpperCase() + label.slice(1)}`, 'success', color);
    applyFilters();
  }
}

function findCard(filename) {
  return document.querySelector(`.image-card[data-filename="${CSS.escape(filename)}"]`);
}

function updateCardUI(card, filename, label) {
  if (!card) return;
  card.dataset.label = label;
  card.classList.toggle('labeled', !!label);

  const badge = card.querySelector('.card-badge');
  if (badge) {
    if (label) {
      badge.textContent  = label.charAt(0).toUpperCase() + label.slice(1);
      badge.style.background = LABEL_COLORS[label];
      badge.className    = 'card-badge';
    } else {
      badge.textContent  = 'Unlabeled';
      badge.style.background = '';
      badge.className    = 'card-badge card-badge-unlabeled';
    }
  }

  // Update quick-label buttons
  card.querySelectorAll('.ql-btn').forEach(btn => {
    const lbl = btn.getAttribute('data-label') || btn.title.toLowerCase();
    btn.classList.toggle('ql-active', lbl === label);
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats(stats) {
  document.getElementById('statTotal').textContent    = stats.total;
  document.getElementById('statLabeled').textContent  = stats.labeled;
  document.getElementById('statUnlabeled').textContent = stats.unlabeled;
  LABEL_LIST.forEach(l => {
    const el = document.getElementById(`statCount_${l}`);
    if (el) el.textContent = stats.counts[l];
  });
  document.getElementById('progressFill').style.width = stats.percent + '%';
  document.getElementById('progressPct').textContent  = stats.percent + '%';

  const ps = document.getElementById('progressSection');
  if (ps) ps.style.display = '';
}

// ── Filter / Search ───────────────────────────────────────────────────────────
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  applyFilters();
}

function applyFilters() {
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const cards  = document.querySelectorAll('.image-card');
  let visible  = 0;

  cards.forEach(card => {
    const fname = card.dataset.filename.toLowerCase();
    const lbl   = card.dataset.label || '';

    let show = true;
    if (currentFilter === 'unlabeled') show = !lbl;
    else if (currentFilter !== 'all')  show = lbl === currentFilter;
    if (search && !fname.includes(search)) show = false;

    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  const vc = document.getElementById('visibleCount');
  if (vc) vc.textContent = `${visible} image${visible !== 1 ? 's' : ''}`;
}

// ── Export ────────────────────────────────────────────────────────────────────
function openExportModal() {
  document.getElementById('exportResult').classList.add('hidden');
  document.getElementById('exportOverlay').classList.remove('hidden');
}
function closeExportModal() {
  document.getElementById('exportOverlay').classList.add('hidden');
}

async function doExport() {
  const fmt  = document.querySelector('input[name="exportFmt"]:checked')?.value || 'csv';
  const resp = await fetch('/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: fmt }),
  });
  const data = await resp.json();
  const resultEl = document.getElementById('exportResult');
  if (data.success) {
    resultEl.innerHTML = `✅ Exported <strong>${data.count}</strong> images to:<br><code>${data.path}</code>`;
    resultEl.classList.remove('hidden');
    showToast(`Exported ${data.count} images!`, 'success');
  } else {
    resultEl.innerHTML = `❌ ${data.error}`;
    resultEl.style.background = 'rgba(239,68,68,0.1)';
    resultEl.style.borderColor = 'rgba(239,68,68,0.3)';
    resultEl.style.color = '#f87171';
    resultEl.classList.remove('hidden');
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────
async function confirmReset() {
  if (!confirm('Clear ALL labels? This cannot be undone.')) return;
  const resp = await fetch('/reset', { method: 'POST' });
  const data = await resp.json();
  if (data.success) {
    labelsMap = {};
    document.querySelectorAll('.image-card').forEach(card => {
      updateCardUI(card, card.dataset.filename, '');
    });
    showToast('All labels cleared', 'info');
    // Refresh stats from server
    const s = await fetch('/api/state').then(r => r.json());
    updateStats(s.stats);
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'info', color = null) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast show ${type}`;
  if (color) el.style.borderColor = color + '66';
  else        el.style.borderColor = '';

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ── Keyboard Navigation ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Only handle shortcuts when viewer is open OR when not in an input field
  const inInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);

  if (currentViewer >= 0) {
    // Viewer is open
    switch (e.key) {
      case 'Escape':       closeViewer(); break;
      case 'ArrowLeft':    navigateViewer(-1); break;
      case 'ArrowRight':   navigateViewer(1); break;
      case '1': setViewerLabel(LABEL_LIST[0]); break;
      case '2': setViewerLabel(LABEL_LIST[1]); break;
      case '3': setViewerLabel(LABEL_LIST[2]); break;
      case '4': setViewerLabel(LABEL_LIST[3]); break;
    }
  } else if (!inInput) {
    if (e.key === 'Enter') {
      const fi = document.getElementById('folderInput');
      if (document.activeElement === fi) setFolder();
    }
  }
});

// ── Enter key on folder input ─────────────────────────────────────────────────
document.getElementById('folderInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') setFolder();
});

// ── Init ──────────────────────────────────────────────────────────────────────
applyFilters();
