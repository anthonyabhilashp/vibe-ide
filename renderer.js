const ROLES = ['design', 'dev', 'review', 'test'];
const ROLE_LABELS = { design: 'Design', dev: 'Build', review: 'Review', test: 'Test' };
const terms = new Map();

const lastSelections = new Map();
let state = { slots: [], projects: {} };
let activeSlot = null;
let lastCopyAt = 0;
let lastCopyText = '';
const paneAssumedSelection = new Map();
let mouseDownPos = null;

const gridEl = document.getElementById('grid');
const addBtn = document.getElementById('add-btn');
const topbarEl = document.getElementById('topbar');

let resizeDebounceTimer;
const paneObserver = new ResizeObserver(() => {
  clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    for (const [key, val] of terms) {
      if (val.pane && val.pane.offsetParent) {
        try {
          val.fit.fit();
          window.api.resize(key, val.term.cols, val.term.rows);
        } catch (_) {}
      }
    }
  }, 60);
});

topbarEl.addEventListener('mouseenter', () => {
  gridEl.style.gridTemplateColumns = '';
  gridEl.style.gridTemplateRows = '';
});

const refreshAllReplyStates = () => {
  setTimeout(() => {
    for (const slotId of state.slots) updateReplyButtonState(slotId);
  }, 30);
};

document.addEventListener('mousedown', (e) => {
  mouseDownPos = { x: e.clientX, y: e.clientY, target: e.target };
}, true);

document.addEventListener('mouseup', (e) => {
  if (mouseDownPos) {
    const dx = Math.abs(e.clientX - mouseDownPos.x);
    const dy = Math.abs(e.clientY - mouseDownPos.y);
    const dragged = dx > 3 || dy > 3;
    const pane = mouseDownPos.target.closest && mouseDownPos.target.closest('.tab-pane');
    if (pane) {
      const role = pane.dataset.role;
      const cell = pane.closest('.cell');
      if (cell) {
        const slotId = cell.dataset.id;
        const key = ptyKey(slotId, role);
        paneAssumedSelection.set(key, dragged);
      }
    }
    mouseDownPos = null;
  }
  refreshAllReplyStates();
}, true);

document.addEventListener('keyup', refreshAllReplyStates, true);
document.addEventListener('selectionchange', refreshAllReplyStates);

document.addEventListener('copy', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) {
      lastCopyText = text;
      lastCopyAt = Date.now();
      if (activeSlot) {
        const project = state.projects[activeSlot];
        if (project) {
          const key = ptyKey(activeSlot, project.activeTab);
          lastSelections.set(key, text);
        }
      }
    }
  } catch (_) {}
  refreshAllReplyStates();
}, true);

setInterval(refreshAllReplyStates, 500);

const promptsModal = document.getElementById('prompts-modal');
const reviewArea = document.getElementById('prompts-review');
const buildArea = document.getElementById('prompts-build');
const testArea = document.getElementById('prompts-test');
const syncArea = document.getElementById('prompts-sync');
const mrDescArea = document.getElementById('prompts-mrdesc');
const deployArea = document.getElementById('prompts-deploy');
const superReviewArea = document.getElementById('prompts-superreview');
const designPromptArea = document.getElementById('prompts-design');
const ticketPromptArea = document.getElementById('prompts-ticket');

function showModalTab(name) {
  promptsModal.querySelectorAll('.modal-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  promptsModal.querySelectorAll('.modal-area').forEach((a) => a.classList.toggle('active', a.id === `prompts-${name}`));
  document.getElementById(`prompts-${name}`).focus();
}
document.querySelectorAll('.modal-tab').forEach((btn) => {
  btn.addEventListener('click', () => showModalTab(btn.dataset.tab));
});

document.getElementById('prompts-btn').addEventListener('click', async () => {
  const p = await window.api.getPrompts();
  buildArea.value = p.buildPrompt || '';
  reviewArea.value = p.reviewPrompt || '';
  testArea.value = p.testPrompt || '';
  syncArea.value = p.syncPrompt || '';
  mrDescArea.value = p.mrDescPrompt || '';
  deployArea.value = p.deployPrompt || '';
  superReviewArea.value = p.superReviewPrompt || '';
  designPromptArea.value = p.designPrompt || '';
  ticketPromptArea.value = p.ticketPrompt || '';
  promptsModal.classList.remove('hidden');
  showModalTab('design');
});
document.getElementById('prompts-cancel').addEventListener('click', () => {
  promptsModal.classList.add('hidden');
});
document.getElementById('prompts-save').addEventListener('click', async () => {
  await window.api.savePrompts({
    buildPrompt: buildArea.value,
    reviewPrompt: reviewArea.value,
    testPrompt: testArea.value,
    syncPrompt: syncArea.value,
    mrDescPrompt: mrDescArea.value,
    deployPrompt: deployArea.value,
    superReviewPrompt: superReviewArea.value,
    designPrompt: designPromptArea.value,
    ticketPrompt: ticketPromptArea.value,
  });
  promptsModal.classList.add('hidden');
});
document.getElementById('prompts-reset').addEventListener('click', async () => {
  const updated = await window.api.resetPrompts();
  buildArea.value = updated.buildPrompt || '';
  reviewArea.value = updated.reviewPrompt || '';
  testArea.value = updated.testPrompt || '';
  syncArea.value = updated.syncPrompt || '';
  mrDescArea.value = updated.mrDescPrompt || '';
  deployArea.value = updated.deployPrompt || '';
  superReviewArea.value = updated.superReviewPrompt || '';
  designPromptArea.value = updated.designPrompt || '';
  ticketPromptArea.value = updated.ticketPrompt || '';
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !promptsModal.classList.contains('hidden')) {
    promptsModal.classList.add('hidden');
  }
});
promptsModal.addEventListener('click', (e) => {
  if (e.target === promptsModal) promptsModal.classList.add('hidden');
});

const envModal = document.getElementById('env-modal');
const envArea = document.getElementById('env-area');
const envStatus = document.getElementById('env-status');
function envObjToText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return Object.keys(obj).map((k) => `${k}=${obj[k]}`).join('\n');
}
document.getElementById('env-btn').addEventListener('click', async () => {
  const vars = await window.api.getEnv();
  envArea.value = envObjToText(vars);
  envStatus.textContent = '';
  envModal.classList.remove('hidden');
  envArea.focus();
});
document.getElementById('env-cancel').addEventListener('click', () => {
  envModal.classList.add('hidden');
});
document.getElementById('env-save').addEventListener('click', async () => {
  const res = await window.api.saveEnv(envArea.value);
  const vars = (res && res.vars) || {};
  const skipped = (res && res.skipped) || [];
  const count = Object.keys(vars).length;
  if (skipped.length) {
    envStatus.style.color = '#f0a020';
    envStatus.textContent = `Saved ${count} var(s). Skipped ${skipped.length} line(s): ` +
      skipped.map((s) => `line ${s.line} — ${s.reason}`).join('; ');
    envArea.focus();
  } else {
    envStatus.style.color = '#6cd06c';
    envStatus.textContent = `Saved ${count} var(s).`;
    envModal.classList.add('hidden');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !envModal.classList.contains('hidden')) {
    envModal.classList.add('hidden');
  }
});
envModal.addEventListener('click', (e) => {
  if (e.target === envModal) envModal.classList.add('hidden');
});

function ptyKey(slotId, role) { return `${slotId}-${role}`; }

function shortPath(folder) {
  const home = '/Users/' + (folder.split('/Users/')[1] || '').split('/')[0];
  if (folder.startsWith(home)) return '~' + folder.slice(home.length);
  return folder;
}

const ICONS = {
  zap: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  chevronDown: '<svg class="ic" style="width:11px;height:11px;opacity:.75" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  send: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>',
  refresh: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
  fileText: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  shield: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  rocket: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>',
  download: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  trash: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  folder: '<svg class="ic" style="width:15px;height:15px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  bellOn: '<svg class="ic icon-bell-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  bellOff: '<svg class="ic icon-bell-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  x: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
};

function buildEmptyCell(id) {
  const cell = document.createElement('div');
  cell.className = 'cell empty';
  cell.dataset.id = id;
  cell.innerHTML = `
    <div class="empty-header">
      <button class="close-btn" title="Close this slot">${ICONS.x}</button>
    </div>
    <div class="empty-content">
      <button class="big-btn btn-load">${ICONS.folder} Load Existing Folder</button>
      <div class="divider">— or —</div>
      <input class="new-input" type="text" spellcheck="false" autocomplete="off"
             placeholder="New project name, press Enter">
      <div class="hint">creates folder in ~/workspace/</div>
    </div>
  `;

  cell.querySelector('.close-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    removeSlot(id);
  });
  cell.querySelector('.btn-load').addEventListener('click', async () => {
    const folder = await window.api.pickFolder();
    if (!folder) return;
    const p = await window.api.loadProject(id, folder);
    if (p) {
      state.projects[id] = p;
      render();
    }
  });
  const input = cell.querySelector('.new-input');
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const value = input.value.trim();
      if (!value) return;
      e.preventDefault();
      const p = await window.api.createProject(id, value);
      if (p) {
        state.projects[id] = p;
        render();
      }
    }
  });
  return cell;
}

function buildFilledCell(id, project) {
  const cell = document.createElement('div');
  cell.className = 'cell filled';
  cell.dataset.id = id;
  cell.dataset.role = project.activeTab || 'design';

  const tabsHtml = ROLES.map((role) => {
    const active = project.activeTab === role;
    const label = ROLE_LABELS[role] || role;
    return `
      <div class="tab role-${role} exists ${active ? 'active' : ''}" data-role="${role}" title="${label}">
        <span class="tab-label">${label}</span>
      </div>`;
  }).join('');

  cell.innerHTML = `
    <div class="cell-header">
      <div class="tab-bar">${tabsHtml}</div>
      <span class="cell-name"></span>
      <div class="cell-actions"></div>
      <button class="notify-btn" title="Notify with a chime when this cell goes idle">${ICONS.bellOn}${ICONS.bellOff}</button>
      <button class="close-btn" title="Close project (kills all its tabs)">${ICONS.x}</button>
    </div>
    <div class="cell-body"></div>
    <button class="voice-btn" title="Click to talk (auto-stops after 2s silence; click again to stop, Esc to cancel)">${ICONS.mic}</button>
  `;
  cell.querySelector('.cell-name').textContent = project.name;
  renderActions(cell, project);
  cell.querySelector('.close-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    removeSlot(id);
  });
  const voiceBtn = cell.querySelector('.voice-btn');
  voiceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleVoice(id, voiceBtn);
  });

  const notifyBtn = cell.querySelector('.notify-btn');
  if (!notifyMuted.has(id)) notifyEnabled.add(id);
  notifyBtn.classList.toggle('on', notifyEnabled.has(id));
  notifyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleNotify(id, notifyBtn);
  });
  cell.addEventListener('mouseenter', () => setActiveSlot(id));
  cell.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    setActiveSlot(id);
  });

  cell.querySelectorAll('.tab').forEach((tabEl) => {
    const role = tabEl.dataset.role;
    tabEl.addEventListener('click', async () => {
      const p = await window.api.setActiveTab(id, role);
      if (p) {
        state.projects[id] = p;
        if (!terms.has(ptyKey(id, role))) await mountTab(cell, id, p, role);
        showActiveTab(cell, p);
      }
    });
  });

  return cell;
}

async function mountTab(cell, slotId, project, role) {
  const key = ptyKey(slotId, role);
  if (terms.has(key)) return;

  const body = cell.querySelector('.cell-body');
  const pane = document.createElement('div');
  pane.className = 'tab-pane';
  pane.dataset.role = role;
  body.appendChild(pane);

  const term = new Terminal({
    fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.22,
    cursorBlink: true,
    theme: {
      background: '#0a0c10',
      foreground: '#e5e7eb',
      cursor: '#60a5fa',
      cursorAccent: '#0a0c10',
      selectionBackground: 'rgba(91, 140, 255, 0.28)',
      black: '#1f2430',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e5e7eb',
      brightBlack: '#6b7280',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde047',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f9fafb',
    },
    scrollback: 10000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    linkHandler: {
      activate: (_event, text) => {
        if (text) window.api.openExternal(text);
      },
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(pane);
  registerUrlLinkProvider(term);

  await new Promise((r) => requestAnimationFrame(r));
  try { fit.fit(); } catch (_) {}

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    if (event.metaKey && (event.key === 'k' || event.key === 'K')) {
      term.clear();
      try { term.write('\x1b[2J\x1b[H'); } catch (_) {}
      return false;
    }
    return true;
  });

  term.onData((data) => {
    window.api.write(key, data);
    if (data.indexOf('\r') !== -1) {
      ensureAudioCtx();
      autoEnableNotify(slotId);
    }
  });

  term.onSelectionChange(() => {
    const sel = term.getSelection();
    if (sel && sel.trim()) lastSelections.set(key, sel);
    updateReplyButtonState(slotId);
  });

  pane.addEventListener('mousedown', () => {
    setActiveSlot(slotId);
    term.focus();
  });

  terms.set(key, { term, fit, pane, slotId, role });
  paneObserver.observe(pane);

  const res = await window.api.spawn(key, term.cols, term.rows, project.folder);
  if (res) {
    const meta = cell.querySelector('.meta');
    if (project.activeTab === role && meta) {
      meta.textContent = `${shortPath(res.cwd)} · pid ${res.pid}`;
    }
  }
  window.api.resize(key, term.cols, term.rows);

  if (project.activeTab === role) {
    if (!activeSlot) setActiveSlot(slotId);
    term.focus();
  }
}

function registerUrlLinkProvider(term) {
  if (typeof term.registerLinkProvider !== 'function') return;
  const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const buf = term.buffer.active;
      const lineIdx = bufferLineNumber - 1;
      if (lineIdx < 0 || lineIdx >= buf.length) return callback(undefined);

      // Find full logical line across soft-wrapped rows
      let startRow = lineIdx;
      while (startRow > 0 && buf.getLine(startRow)?.isWrapped) startRow--;
      let endRow = lineIdx;
      while (endRow + 1 < buf.length && buf.getLine(endRow + 1)?.isWrapped) endRow++;

      const rowLengths = [];
      let fullText = '';
      for (let r = startRow; r <= endRow; r++) {
        const l = buf.getLine(r);
        if (!l) break;
        const isLast = r === endRow;
        const s = l.translateToString(isLast);
        rowLengths.push({ row: r + 1, start: fullText.length, len: s.length });
        fullText += s;
      }

      const offsetToPos = (offset) => {
        for (let i = 0; i < rowLengths.length; i++) {
          const seg = rowLengths[i];
          if (offset < seg.start + seg.len || i === rowLengths.length - 1) {
            return { x: offset - seg.start + 1, y: seg.row };
          }
        }
        return { x: 1, y: bufferLineNumber };
      };

      const links = [];
      URL_RE.lastIndex = 0;
      let m;
      while ((m = URL_RE.exec(fullText)) !== null) {
        let url = m[0];
        // Strip trailing punctuation like ':', '.', ',', ';', ')', ']'
        while (url.length > 0 && /[.,:;!?'"\]}>]/.test(url[url.length - 1])) {
          url = url.slice(0, -1);
        }
        while (url.endsWith(')') && (url.split('(').length < url.split(')').length)) {
          url = url.slice(0, -1);
        }
        if (url.length <= 8) continue;
        const startPos = offsetToPos(m.index);
        const endPos = offsetToPos(m.index + url.length - 1);
        links.push({
          range: { start: startPos, end: endPos },
          text: url,
          activate: (_e, text) => window.api.openExternal(text),
        });
      }
      callback(links.length ? links : undefined);
    },
  });
}

function setActiveSlot(slotId) {
  const same = (activeSlot === slotId);
  activeSlot = slotId;
  document.querySelectorAll('.cell').forEach((c) => c.classList.remove('focused'));
  const cell = gridEl.querySelector(`.cell[data-id="${slotId}"]`);
  if (cell) cell.classList.add('focused');
  if (!same) {
    const project = state.projects[slotId];
    if (project) {
      const key = ptyKey(slotId, project.activeTab);
      const t = terms.get(key);
      if (t) { try { t.term.focus(); } catch (_) {} }
    }
  }
  updateGridLayout();
  updateReplyButtonState(slotId);
}

function updateGridLayout() {
  const n = state.slots.length;
  if (n <= 1 || !activeSlot) {
    gridEl.style.gridTemplateColumns = '';
    gridEl.style.gridTemplateRows = '';
    return;
  }
  const activeIndex = state.slots.indexOf(activeSlot);
  if (activeIndex === -1) {
    gridEl.style.gridTemplateColumns = '';
    gridEl.style.gridTemplateRows = '';
    return;
  }
  if (n === 2) {
    gridEl.style.gridTemplateColumns = activeIndex === 0 ? '5fr 1fr' : '1fr 5fr';
    gridEl.style.gridTemplateRows = '1fr';
  } else {
    const col = activeIndex % 2;
    const row = Math.floor(activeIndex / 2);
    gridEl.style.gridTemplateColumns = col === 0 ? '4fr 1fr' : '1fr 4fr';
    gridEl.style.gridTemplateRows = row === 0 ? '4fr 1fr' : '1fr 4fr';
  }
}

function showActiveTab(cell, project) {
  cell.dataset.role = project.activeTab || 'design';
  const body = cell.querySelector('.cell-body');
  const meta = cell.querySelector('.meta');
  cell.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.role === project.activeTab && t.classList.contains('exists'));
  });
  body.querySelectorAll('.tab-pane').forEach((p) => {
    const isActive = p.dataset.role === project.activeTab;
    p.style.display = isActive ? 'block' : 'none';
  });
  renderActions(cell, project);
  const key = ptyKey(cell.dataset.id, project.activeTab);
  const t = terms.get(key);
  if (t) {
    try { t.fit.fit(); } catch (_) {}
    window.api.resize(key, t.term.cols, t.term.rows);
    t.term.focus();
    try { t.term.scrollToBottom(); } catch (_) {}
    requestAnimationFrame(() => { try { t.term.scrollToBottom(); } catch (_) {} });
    if (meta) meta.textContent = `${shortPath(project.folder)} · ${project.activeTab}`;
  }
}

function updateReplyButtonState(slotId) {
  const cell = gridEl.querySelector(`.cell[data-id="${slotId}"]`);
  if (!cell) return;
  const replyBtn = cell.querySelector('.act-reply');
  if (!replyBtn) return;
  const project = state.projects[slotId];
  if (!project) return;
  const activeKey = ptyKey(slotId, project.activeTab);
  const t = terms.get(activeKey);
  const isActiveCell = activeSlot === slotId;

  const live = (t && t.term.getSelection()) ? t.term.getSelection().trim() : '';
  const hasXtermSel = !!(t && typeof t.term.hasSelection === 'function' && t.term.hasSelection());

  let browserSel = '';
  if (isActiveCell) {
    try {
      const s = window.getSelection();
      if (s && s.toString().trim()) browserSel = s.toString().trim();
    } catch (_) {}
  }

  const recentCopy = isActiveCell && (Date.now() - lastCopyAt < 8000) && lastCopyText.trim();
  const assumed = paneAssumedSelection.get(activeKey) || false;

  const enabled = !!(live || hasXtermSel || browserSel || recentCopy || assumed);
  replyBtn.classList.toggle('has-selection', enabled);
}

const TAB_ACTIONS = {
  dev: [
    { id: 'init-build', icon: 'zap', label: 'Init Build', title: 'Send build prompt to anchor the build agent', fn: initBuild },
    { id: 'sync-main', icon: 'refresh', label: 'Sync Main', title: 'Pull origin/main, merge, resolve conflicts, push', fn: syncMain },
    { id: 'mr-desc', icon: 'fileText', label: 'MR Description', title: 'Generate a crisp MR description from current branch diff', fn: giveMrDescription },
  ],
  review: [
    { id: 'init-review', icon: 'zap', label: 'Init Review', title: 'Send review prompt to anchor the reviewer', fn: reviewNow },
    { id: 'super-review', icon: 'shield', label: 'Super Review', title: 'Run pre-merge gate on top of the standard review', fn: superReviewNow },
  ],
  test: [
    { id: 'init-test', icon: 'zap', label: 'Init Test', title: 'Anchor the test agent with the build & deploy workflow', fn: initTest },
    { id: 'deploy', icon: 'rocket', label: 'Deploy Changes', title: 'Build current changes and deploy to the VM', fn: deployChanges },
    { id: 'pull-main', icon: 'download', label: 'Pull Main', title: 'Checkout main and pull the latest code', fn: pullMain },
    { id: 'clear-branches', icon: 'trash', label: 'Clear Branches', title: 'Checkout main and delete all other local branches', fn: clearBranches },
  ],
  design: [
    { id: 'init-design', icon: 'zap', label: 'Init Design', title: 'Send design prompt to anchor the design agent', fn: initDesign },
    { id: 'load-ticket', icon: 'fileText', label: 'Load Ticket / Spec', title: 'Fetch a Jira, Confluence, or Bugzilla link and map requirements against the repo', fn: loadTicket },
  ],
};

const SEND_BUTTONS = {
  dev: { label: 'Send to Review', title: "Select Build's reply and Cmd+C, then click to send to Review", fn: sendSelectionToReview },
  review: { label: 'Send to Build', title: 'Select review text and Cmd+C, then click to send to Build', fn: sendSelectionToBuild },
};

function renderActions(cell, project) {
  const actions = cell.querySelector('.cell-actions');
  if (!actions) return;
  const slotId = cell.dataset.id;
  const role = project.activeTab;
  const tabActions = TAB_ACTIONS[role] || [];
  const sendBtn = SEND_BUTTONS[role];

  let html = '';
  if (tabActions.length > 0) {
    html += `
      <div class="actions-dropdown">
        <button class="action-btn act-toggle" title="Show actions">${ICONS.zap}<span>Actions</span>${ICONS.chevronDown}</button>
        <div class="actions-menu">
          ${tabActions.map((a) => `<button class="menu-item" data-action="${a.id}" title="${escapeHtml(a.title)}">${ICONS[a.icon] || ''}<span>${a.label}</span></button>`).join('')}
        </div>
      </div>
    `;
  }
  if (sendBtn) {
    html += `<button class="action-btn act-reply" title="${escapeHtml(sendBtn.title)}">${ICONS.send}<span>${sendBtn.label}</span></button>`;
  }
  actions.innerHTML = html;

  const toggle = actions.querySelector('.act-toggle');
  const menu = actions.querySelector('.actions-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.actions-menu.open').forEach((m) => { if (m !== menu) m.classList.remove('open'); });
      menu.classList.toggle('open');
    });
    menu.querySelectorAll('.menu-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = item.dataset.action;
        menu.classList.remove('open');
        const action = tabActions.find((a) => a.id === id);
        if (action) {
          ensureAudioCtx();
          action.fn(slotId);
        }
      });
    });
  }

  if (sendBtn) {
    const replyBtn = actions.querySelector('.act-reply');
    if (replyBtn) {
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        ensureAudioCtx();
        sendBtn.fn(slotId);
      });
    }
  }

  updateReplyButtonState(slotId);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.actions-dropdown')) {
    document.querySelectorAll('.actions-menu.open').forEach((m) => m.classList.remove('open'));
  }
});

async function withEnvHint(promptText) {
  try {
    const vars = await window.api.getEnv();
    if (!vars || typeof vars !== 'object') return promptText;
    const keys = Object.keys(vars).filter((k) => typeof vars[k] === 'string' && vars[k].trim() !== '');
    if (keys.length === 0) return promptText;
    return `${promptText}\n\nEnvironment variables already exported in this shell (use them directly via $VAR, or \`source ~/.vibe-ide/env\` if needed — never ask me for these tokens/values): ${keys.join(', ')}`;
  } catch (_) {
    return promptText;
  }
}

async function reviewNow(slotId) {
  const { reviewPrompt } = await window.api.getPrompts();
  if (!reviewPrompt || !reviewPrompt.trim()) return flashMessage(slotId, 'No review prompt set (⚙ Prompts)');
  const reviewKey = ptyKey(slotId, 'review');
  const text = await withEnvHint(reviewPrompt);
  pasteAndSubmit(reviewKey, text, { slotId, label: 'Review (prompt sent)' });
  flashTab(slotId, 'review');
}

async function superReviewNow(slotId) {
  const { superReviewPrompt } = await window.api.getPrompts();
  if (!superReviewPrompt || !superReviewPrompt.trim()) return flashMessage(slotId, 'No super review prompt set (⚙ Prompts)');
  const reviewKey = ptyKey(slotId, 'review');
  const text = await withEnvHint(superReviewPrompt);
  pasteAndSubmit(reviewKey, text, { slotId, label: 'Review (super review sent)' });
  flashTab(slotId, 'review');
}

async function sendSelectionToBuild(slotId) {
  const reviewKey = ptyKey(slotId, 'review');
  const t = terms.get(reviewKey);
  if (!t) return;

  const live = t.term.getSelection() || '';
  const cached = lastSelections.get(reviewKey) || '';
  let clip = '';
  try { clip = await navigator.clipboard.readText() || ''; } catch (_) {}
  let browserSel = '';
  try { browserSel = window.getSelection()?.toString() || ''; } catch (_) {}

  const candidates = [live, cached, clip, browserSel].filter((s) => s && s.trim());
  candidates.sort((a, b) => b.length - a.length);
  const selection = candidates[0] || '';

  const sources = `live=${live.length}, cached=${cached.length}, clip=${clip.length}, browserSel=${browserSel.length}`;
  console.log(`[vibe-ide] sendSelectionToBuild sources: ${sources}; chose ${selection.length} chars`);

  if (!selection.trim()) return flashMessage(slotId, 'Select text and press Cmd+C, then retry');

  const message = `The reviewer commented:\n\n${selection}\n\nAddress these comments. If any point is wrong or based on a misreading of the code, push back with concrete details (file/line, actual behavior, reasoning) instead of accepting blindly. Otherwise apply the fixes.`;
  const buildKey = ptyKey(slotId, 'dev');
  pasteAndSubmit(buildKey, message, { slotId, label: `Build (${selection.length} chars)` });
  flashTab(slotId, 'dev');
  lastSelections.delete(reviewKey);
  const p = await window.api.setActiveTab(slotId, 'dev');
  if (p) {
    state.projects[slotId] = p;
    const cell = gridEl.querySelector(`.cell[data-id="${slotId}"]`);
    if (cell) showActiveTab(cell, p);
  }
}

async function initBuild(slotId) {
  const { buildPrompt } = await window.api.getPrompts();
  if (!buildPrompt || !buildPrompt.trim()) return flashMessage(slotId, 'No build prompt set (⚙ Prompts)');
  const buildKey = ptyKey(slotId, 'dev');
  const text = await withEnvHint(buildPrompt);
  pasteAndSubmit(buildKey, text, { slotId, label: 'Build (prompt sent)' });
  flashTab(slotId, 'dev');
}

async function syncMain(slotId) {
  const { syncPrompt } = await window.api.getPrompts();
  if (!syncPrompt || !syncPrompt.trim()) return flashMessage(slotId, 'No sync prompt set (⚙ Prompts)');
  const buildKey = ptyKey(slotId, 'dev');
  const text = await withEnvHint(syncPrompt);
  pasteAndSubmit(buildKey, text, { slotId, label: 'Build (sync main sent)' });
  flashTab(slotId, 'dev');
}

async function giveMrDescription(slotId) {
  const { mrDescPrompt } = await window.api.getPrompts();
  if (!mrDescPrompt || !mrDescPrompt.trim()) return flashMessage(slotId, 'No MR description prompt set (⚙ Prompts)');
  const buildKey = ptyKey(slotId, 'dev');
  const text = await withEnvHint(mrDescPrompt);
  pasteAndSubmit(buildKey, text, { slotId, label: 'Build (MR description)' });
  flashTab(slotId, 'dev');
}

async function initTest(slotId) {
  const { testPrompt } = await window.api.getPrompts();
  if (!testPrompt || !testPrompt.trim()) return flashMessage(slotId, 'No test prompt set (⚙ Prompts)');
  const testKey = ptyKey(slotId, 'test');
  const text = await withEnvHint(testPrompt);
  pasteAndSubmit(testKey, text, { slotId, label: 'Test (prompt sent)' });
  flashTab(slotId, 'test');
}

async function deployChanges(slotId) {
  const { deployPrompt } = await window.api.getPrompts();
  if (!deployPrompt || !deployPrompt.trim()) return flashMessage(slotId, 'No deploy prompt set (⚙ Prompts)');
  const testKey = ptyKey(slotId, 'test');
  const text = await withEnvHint(deployPrompt);
  pasteAndSubmit(testKey, text, { slotId, label: 'Test (deploy changes)' });
  flashTab(slotId, 'test');
}

function pullMain(slotId) {
  const testKey = ptyKey(slotId, 'test');
  if (!terms.has(testKey)) return flashMessage(slotId, 'Open the Test terminal first');
  pasteAndSubmit(testKey, 'git checkout main && git pull', { slotId, label: 'Test (pull main)' });
  flashTab(slotId, 'test');
}

function clearBranches(slotId) {
  const testKey = ptyKey(slotId, 'test');
  if (!terms.has(testKey)) return flashMessage(slotId, 'Open the Test terminal first');
  const cmd = "git checkout main && for b in $(git branch --format='%(refname:short)' | grep -vx main); do git branch -D \"$b\"; done";
  pasteAndSubmit(testKey, cmd, { slotId, label: 'Test (clear branches)' });
  flashTab(slotId, 'test');
}

async function sendSelectionToReview(slotId) {
  const buildKey = ptyKey(slotId, 'dev');
  const t = terms.get(buildKey);
  if (!t) return;

  const live = t.term.getSelection() || '';
  const cached = lastSelections.get(buildKey) || '';
  let clip = '';
  try { clip = await navigator.clipboard.readText() || ''; } catch (_) {}
  let browserSel = '';
  try { browserSel = window.getSelection()?.toString() || ''; } catch (_) {}

  const candidates = [live, cached, clip, browserSel].filter((s) => s && s.trim());
  candidates.sort((a, b) => b.length - a.length);
  const selection = candidates[0] || '';

  const sources = `live=${live.length}, cached=${cached.length}, clip=${clip.length}, browserSel=${browserSel.length}`;
  console.log(`[vibe-ide] sendSelectionToReview sources: ${sources}; chose ${selection.length} chars`);

  if (!selection.trim()) return flashMessage(slotId, 'Select text and press Cmd+C, then retry');

  const message = `The build agent's reply:\n\n${selection}\n\nWeigh their pushback honestly. If they have a valid point (e.g. you misread the code, the concern doesn't apply, there's existing mitigation), acknowledge it and withdraw or revise the finding. If their reasoning is weak, reiterate the original concern with stronger evidence (file/line, attack scenario, concrete example).`;
  const reviewKey = ptyKey(slotId, 'review');
  pasteAndSubmit(reviewKey, message, { slotId, label: `Review (${selection.length} chars)` });
  flashTab(slotId, 'review');
  lastSelections.delete(buildKey);
  const p = await window.api.setActiveTab(slotId, 'review');
  if (p) {
    state.projects[slotId] = p;
    const cell = gridEl.querySelector(`.cell[data-id="${slotId}"]`);
    if (cell) showActiveTab(cell, p);
  }
}

let voiceState = {
  slotId: null,
  btn: null,
  overlay: null,
  stream: null,
  ctx: null,
  source: null,
  processor: null,
  chunks: [],
  active: false,
};
let voicePendingStopTimer = null;

const notifyEnabled = new Set();
const notifyMuted = new Set();
const notifyArmed = new Set();
const ptyActivity = new Map();
const notifyCooldown = new Map();
const NOTIFY_IDLE_MS = 30000;
const NOTIFY_COOLDOWN_MS = 60000;

document.addEventListener('mousedown', () => ensureAudioCtx(), { once: true, capture: true });
document.addEventListener('keydown', () => ensureAudioCtx(), { once: true, capture: true });

function showVoiceOverlay(cell) {
  if (!cell) return null;
  let overlay = cell.querySelector('.voice-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'voice-overlay';
  overlay.innerHTML = `
    <div class="rec-dot"></div>
    <div class="rec-body">
      <div class="rec-label">Recording</div>
      <div class="rec-text"><span class="placeholder">Listening… speak now</span></div>
    </div>
  `;
  cell.appendChild(overlay);
  return overlay;
}

function updateVoiceOverlay(overlay, finalText, interim) {
  if (!overlay) return;
  const textEl = overlay.querySelector('.rec-text');
  if (!textEl) return;
  if (!finalText && !interim) {
    textEl.innerHTML = '<span class="placeholder">Listening… speak now</span>';
    return;
  }
  const finalHtml = escapeHtml(finalText);
  const interimHtml = interim ? `<span class="interim">${escapeHtml(interim)}</span>` : '';
  textEl.innerHTML = `${finalHtml}${finalHtml && interimHtml ? ' ' : ''}${interimHtml}`;
  textEl.scrollTop = textEl.scrollHeight;
}

function removeVoiceOverlay(overlay) {
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const VOICE_SPEECH_RMS = 0.015;
const VOICE_SILENCE_STOP_MS = 2000;
const VOICE_NO_SPEECH_TIMEOUT_MS = 8000;
const VOICE_MAX_DURATION_MS = 120000;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && voiceState.active) {
    e.preventDefault();
    e.stopPropagation();
    stopVoice({ cancel: true });
  }
}, true);

function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function toggleVoice(slotId, btn) {
  if (voiceState.active && voiceState.slotId === slotId) { stopVoice(); return; }
  if (voiceState.active) stopVoice({ cancel: true });
  startVoice(slotId, btn);
}

function resetVoiceState() {
  if (voiceState.timer) clearInterval(voiceState.timer);
  voiceState = {
    slotId: null, btn: null, overlay: null,
    stream: null, ctx: null, source: null, processor: null,
    chunks: [], active: false,
    startedAt: 0, heardSpeech: false, lastSpeechAt: 0, timer: null,
  };
}

async function startVoice(slotId, btn) {
  if (voiceState.active) return;
  const cell = gridEl.querySelector(`.cell[data-id="${slotId}"]`);
  const overlay = showVoiceOverlay(cell);
  const now = Date.now();
  voiceState = {
    slotId, btn, overlay,
    stream: null, ctx: null, source: null, processor: null,
    chunks: [], active: true,
    startedAt: now, heardSpeech: false, lastSpeechAt: now, timer: null,
  };
  if (btn) { btn.classList.add('recording'); btn.title = 'Click to stop & send (or pause 2s, Esc to cancel)'; }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    if (!voiceState.active) { stream.getTracks().forEach((t) => t.stop()); return; }

    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    voiceState.startedAt = Date.now();
    voiceState.lastSpeechAt = voiceState.startedAt;

    processor.onaudioprocess = (e) => {
      if (!voiceState.active) return;
      const samples = new Float32Array(e.inputBuffer.getChannelData(0));
      voiceState.chunks.push(samples);

      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      const t = Date.now();

      if (rms >= VOICE_SPEECH_RMS) {
        if (!voiceState.heardSpeech) {
          voiceState.heardSpeech = true;
          const textEl = voiceState.overlay && voiceState.overlay.querySelector('.rec-text');
          if (textEl) textEl.innerHTML = '<span class="placeholder">speaking… pause 2s or click to send · Esc to cancel</span>';
        }
        voiceState.lastSpeechAt = t;
      } else if (voiceState.heardSpeech && (t - voiceState.lastSpeechAt >= VOICE_SILENCE_STOP_MS)) {
        stopVoice();
        return;
      } else if (!voiceState.heardSpeech && (t - voiceState.startedAt >= VOICE_NO_SPEECH_TIMEOUT_MS)) {
        stopVoice({ cancel: true, reason: 'No speech detected' });
        return;
      }

      if (t - voiceState.startedAt >= VOICE_MAX_DURATION_MS) {
        stopVoice();
      }
    };
    source.connect(processor);
    processor.connect(ctx.destination);

    voiceState.stream = stream;
    voiceState.ctx = ctx;
    voiceState.source = source;
    voiceState.processor = processor;
    voiceState.timer = setInterval(() => {
      if (!voiceState.active || !voiceState.overlay) return;
      const label = voiceState.overlay.querySelector('.rec-label');
      if (label) label.textContent = `Recording · ${formatElapsed(Date.now() - voiceState.startedAt)}`;
    }, 250);

    const textEl = overlay && overlay.querySelector('.rec-text');
    if (textEl) textEl.innerHTML = '<span class="placeholder">listening… speak now (auto-stops after 2s silence · Esc to cancel)</span>';
    console.log('[voice] capture started, sampleRate=', ctx.sampleRate);
  } catch (err) {
    console.log('[voice] mic error', err);
    flashMessage(slotId, `Mic error: ${err.message}`);
    if (btn) btn.classList.remove('recording');
    removeVoiceOverlay(overlay);
    resetVoiceState();
  }
}

async function stopVoice(opts = {}) {
  if (!voiceState.active) return;
  voiceState.active = false;
  const { slotId, btn, overlay, chunks, stream, ctx, source, processor, heardSpeech } = voiceState;
  resetVoiceState();

  try { if (processor) processor.disconnect(); } catch (_) {}
  try { if (source) source.disconnect(); } catch (_) {}
  try { if (ctx) await ctx.close(); } catch (_) {}
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) {}

  if (btn) {
    btn.classList.remove('recording');
    btn.title = 'Click to talk (auto-stops after 2s silence; click again to stop, Esc to cancel)';
  }

  if (opts.cancel) {
    removeVoiceOverlay(overlay);
    if (opts.reason) flashMessage(slotId, opts.reason);
    return;
  }

  const totalLen = chunks.reduce((a, c) => a + c.length, 0);
  if (totalLen === 0 || !heardSpeech) {
    removeVoiceOverlay(overlay);
    return;
  }

  const merged = new Float32Array(totalLen);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }

  if (overlay) {
    const label = overlay.querySelector('.rec-label');
    const textEl = overlay.querySelector('.rec-text');
    if (label) label.textContent = 'Transcribing';
    if (textEl) textEl.innerHTML = '<span class="placeholder">running whisper.cpp…</span>';
  }

  try {
    const res = await window.api.transcribe(merged.buffer);
    removeVoiceOverlay(overlay);
    if (res && res.ok && res.text && res.text.trim()) {
      const project = state.projects[slotId];
      if (project) {
        const key = ptyKey(slotId, project.activeTab);
        pasteAndSubmit(key, res.text.trim(), { slotId, label: `Voice (${res.text.trim().length} chars)` });
      }
    } else if (res && !res.ok) {
      flashMessage(slotId, res.error || 'transcription failed');
    }
  } catch (err) {
    console.log('[voice] transcribe error', err);
    flashMessage(slotId, `Transcribe failed: ${err.message}`);
    removeVoiceOverlay(overlay);
  }
}

function pasteIntoActive(slotId, text) {
  const project = state.projects[slotId];
  if (!project) return;
  const key = ptyKey(slotId, project.activeTab);
  if (!terms.has(key)) return;
  const safe = text.replace(/\r/g, '');
  const BRACKET_START = '\x1b[200~';
  const BRACKET_END = '\x1b[201~';
  window.api.write(key, BRACKET_START + safe + BRACKET_END);
  const t = terms.get(key);
  if (t) { try { t.term.focus(); } catch (_) {} }
}

function pasteAndSubmit(targetKey, text, opts = {}) {
  if (!terms.has(targetKey)) return;
  const t = terms.get(targetKey);
  try { t.term.focus(); } catch (_) {}
  const safe = text.replace(/\r/g, '').replace(/\n+$/, '');
  console.log(`[paste] -> ${targetKey} len=${safe.length}, first40="${safe.slice(0, 40)}"`);
  const BRACKET_START = '\x1b[200~';
  const BRACKET_END = '\x1b[201~';
  window.api.write(targetKey, BRACKET_START + safe + BRACKET_END);
  setTimeout(() => {
    console.log(`[paste] -> ${targetKey} CR @ 1200ms`);
    window.api.write(targetKey, '\r');
  }, 1200);
  setTimeout(() => {
    console.log(`[paste] -> ${targetKey} CR @ 2200ms`);
    window.api.write(targetKey, '\r');
  }, 2200);
  if (opts.slotId && opts.label) {
    const preview = safe.replace(/\s+/g, ' ').trim().slice(0, 100);
    flashMessage(opts.slotId, `→ ${opts.label}: ${preview}${safe.length > 100 ? '…' : ''}`, 4000);
  }
  if (opts.slotId) autoEnableNotify(opts.slotId);
}

function autoEnableNotify(slotId) {
  if (!slotId) return;
  notifyArmed.add(slotId);
  if (notifyMuted.has(slotId)) return;
  notifyEnabled.add(slotId);
  notifyCooldown.delete(slotId);
  const cell = gridEl.querySelector(`.cell[data-id="${slotId}"]`);
  const bell = cell && cell.querySelector('.notify-btn');
  if (bell) bell.classList.add('on');
  for (const role of ROLES) {
    const key = ptyKey(slotId, role);
    const act = ptyActivity.get(key) || { lastDataAt: Date.now(), hadBurst: false };
    ptyActivity.set(key, act);
  }
}

function flashTab(slotId, role) {
  const cell = gridEl.querySelector(`.cell[data-id="${slotId}"]`);
  if (!cell) return;
  const tab = cell.querySelector(`.tab[data-role="${role}"]`);
  if (!tab) return;
  tab.classList.remove('flash');
  void tab.offsetWidth;
  tab.classList.add('flash');
  setTimeout(() => tab.classList.remove('flash'), 700);
}

const flashTimers = new Map();
function flashMessage(slotId, msg, duration = 1800) {
  const cell = gridEl.querySelector(`.cell[data-id="${slotId}"]`);
  if (!cell) return;
  const nameEl = cell.querySelector('.cell-name');
  if (!nameEl) return;
  if (flashTimers.has(slotId)) clearTimeout(flashTimers.get(slotId));
  nameEl.textContent = msg;
  nameEl.style.color = '#f80';
  flashTimers.set(slotId, setTimeout(() => {
    flashTimers.delete(slotId);
    const project = state.projects[slotId];
    nameEl.textContent = project ? project.name : '';
    nameEl.style.color = '';
  }, duration));
}

async function ensureTabsMounted(cell, project) {
  for (const role of project.tabs) {
    await mountTab(cell, cell.dataset.id, project, role);
  }
  showActiveTab(cell, project);
}


function refit() {
  for (const { term, fit, pane } of terms.values()) {
    if (!pane.offsetParent) continue;
    try {
      fit.fit();
      window.api.resize(ptyKeyFromTermEntry(term, fit, pane), term.cols, term.rows);
    } catch (_) {}
  }
}

async function initDesign(slotId) {
  const { designPrompt } = await window.api.getPrompts();
  if (!designPrompt || !designPrompt.trim()) return flashMessage(slotId, 'No design prompt set (Prompts)');
  const designKey = ptyKey(slotId, 'design');
  const text = await withEnvHint(designPrompt);
  pasteAndSubmit(designKey, text, { slotId, label: 'Design (prompt sent)' });
  flashTab(slotId, 'design');
}

async function loadTicket(slotId) {
  const { ticketPrompt } = await window.api.getPrompts();
  if (!ticketPrompt || !ticketPrompt.trim()) return flashMessage(slotId, 'No ticket/spec prompt set (Prompts)');
  const designKey = ptyKey(slotId, 'design');
  const text = await withEnvHint(ticketPrompt);
  pasteAndSubmit(designKey, text, { slotId, label: 'Design (ticket/spec)' });
  flashTab(slotId, 'design');
}

function ptyKeyFromTermEntry(term, fit, pane) {
  for (const [key, val] of terms) {
    if (val.term === term) return key;
  }
  return null;
}

function updateChrome() {
  const counter = document.getElementById('slot-counter');
  if (counter) {
    const atCap = state.slots.length >= 4;
    counter.textContent = `${state.slots.length}/4 cells`;
    counter.style.color = atCap ? '#f88' : '#666';
  }
  addBtn.disabled = state.slots.length >= 4;
  const shouldShowClose = state.slots.length > 1;
  for (const btn of gridEl.querySelectorAll('.cell > .cell-header > .close-btn, .cell > .empty-header > .close-btn')) {
    btn.style.visibility = shouldShowClose ? 'visible' : 'hidden';
  }
}

function render() {
  const currentIds = new Set(state.slots);

  for (const cell of Array.from(gridEl.querySelectorAll('.cell'))) {
    const id = cell.dataset.id;
    if (!currentIds.has(id)) {
      cell.remove();
      for (const role of ROLES) {
        const key = ptyKey(id, role);
        const t = terms.get(key);
        if (t) { try { t.term.dispose(); } catch (_) {} terms.delete(key); }
      }
    }
  }

  for (let i = 0; i < state.slots.length; i++) {
    const id = state.slots[i];
    const project = state.projects[id];
    const shouldBeFilled = !!project;
    let existing = gridEl.querySelector(`.cell[data-id="${id}"]`);

    if (!existing) {
      const cell = shouldBeFilled ? buildFilledCell(id, project) : buildEmptyCell(id);
      gridEl.appendChild(cell);
      existing = cell;
      if (shouldBeFilled) {
        ensureTabsMounted(cell, project);
      } else {
        setTimeout(() => cell.querySelector('.new-input')?.focus(), 30);
      }
    } else {
      const isFilled = existing.classList.contains('filled');
      if (shouldBeFilled && !isFilled) {
        const cell = buildFilledCell(id, project);
        existing.replaceWith(cell);
        existing = cell;
        ensureTabsMounted(cell, project);
      } else if (!shouldBeFilled && isFilled) {
        const cell = buildEmptyCell(id);
        existing.replaceWith(cell);
        existing = cell;
        for (const role of ROLES) {
          const key = ptyKey(id, role);
          const t = terms.get(key);
          if (t) { try { t.term.dispose(); } catch (_) {} terms.delete(key); }
        }
      } else if (shouldBeFilled && isFilled) {
        // Filled-to-filled: project may have new/removed tabs.
        // Rebuild header so the tab bar reflects current state.
        const newCell = buildFilledCell(id, project);
        // Move existing tab-panes (with their xterm DOM) into newCell's body
        const newBody = newCell.querySelector('.cell-body');
        const oldBody = existing.querySelector('.cell-body');
        if (oldBody) {
          for (const pane of Array.from(oldBody.querySelectorAll('.tab-pane'))) {
            const role = pane.dataset.role;
            if (project.tabs.includes(role)) {
              newBody.appendChild(pane);
            } else {
              const key = ptyKey(id, role);
              const t = terms.get(key);
              if (t) { try { t.term.dispose(); } catch (_) {} terms.delete(key); }
            }
          }
        }
        // Rebind pane mousedown handlers (since we moved DOM but kept term refs)
        for (const pane of Array.from(newBody.querySelectorAll('.tab-pane'))) {
          const role = pane.dataset.role;
          const key = ptyKey(id, role);
          const entry = terms.get(key);
          if (entry) {
            // remove old listener if any (idempotent enough — DOM kept)
            pane.onmousedown = () => {
              document.querySelectorAll('.cell').forEach((c) => c.classList.remove('focused'));
              newCell.classList.add('focused');
              entry.term.focus();
            };
            entry.pane = pane;
          }
        }
        existing.replaceWith(newCell);
        existing = newCell;
        ensureTabsMounted(newCell, project);
      }
    }

    if (gridEl.children[i] !== existing) {
      gridEl.insertBefore(existing, gridEl.children[i] || null);
    }
  }

  const n = state.slots.length;
  gridEl.className = `grid-${Math.min(n, 4)}`;
  if (!activeSlot || !state.slots.includes(activeSlot)) {
    activeSlot = state.slots[0] || null;
  }
  updateGridLayout();
  if (activeSlot) {
    const cell = gridEl.querySelector(`.cell[data-id="${activeSlot}"]`);
    if (cell) cell.classList.add('focused');
  }
  updateChrome();
  setTimeout(refit, 30);
}

async function removeSlot(id) {
  state = await window.api.removeSlot(id);
  render();
}

addBtn.addEventListener('click', async () => {
  const res = await window.api.addSlot();
  if (res && res.ok) {
    state = res.state;
    render();
  }
});

window.api.onData(({ id, data }) => {
  const t = terms.get(id);
  if (t) t.term.write(data);


  const act = ptyActivity.get(id) || { lastDataAt: 0, hadBurst: false };
  act.lastDataAt = Date.now();
  act.hadBurst = true;
  ptyActivity.set(id, act);
});

function scrollVisibleTermsToBottom() {
  for (const [, t] of terms) {
    if (t.pane && t.pane.offsetParent && t.pane.style.display !== 'none') {
      try { t.term.scrollToBottom(); } catch (_) {}
    }
  }
}
window.addEventListener('focus', () => requestAnimationFrame(scrollVisibleTermsToBottom));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) requestAnimationFrame(scrollVisibleTermsToBottom);
});

let sharedAudioCtx = null;

function ensureAudioCtx() {
  if (sharedAudioCtx) {
    if (sharedAudioCtx.state === 'suspended') { try { sharedAudioCtx.resume(); } catch (_) {} }
    return sharedAudioCtx;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { console.log('[notify] no AudioContext available'); return null; }
    sharedAudioCtx = new Ctx();
    console.log('[notify] AudioContext created, state=', sharedAudioCtx.state);
    if (sharedAudioCtx.state === 'suspended') { try { sharedAudioCtx.resume(); } catch (_) {} }
    return sharedAudioCtx;
  } catch (err) {
    console.log('[notify] AudioContext error', err);
    return null;
  }
}

function toggleNotify(slotId, btn) {
  if (notifyEnabled.has(slotId)) {
    notifyEnabled.delete(slotId);
    notifyMuted.add(slotId);
    btn.classList.remove('on');
  } else {
    notifyMuted.delete(slotId);
    notifyEnabled.add(slotId);
    btn.classList.add('on');
    ensureAudioCtx();
    for (const role of ROLES) {
      const key = ptyKey(slotId, role);
      const act = ptyActivity.get(key) || { lastDataAt: Date.now(), hadBurst: false };
      ptyActivity.set(key, act);
    }
  }
}

function playDing(volume) {
  const ctx = ensureAudioCtx();
  if (!ctx) { console.log('[notify] playDing: no context'); return; }
  const vol = typeof volume === 'number' ? volume : 0.55;
  try {
    const playTone = (freq, startAt, durMs, peakVol) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startAt);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(peakVol, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0005, startAt + durMs / 1000);
      osc.start(startAt);
      osc.stop(startAt + durMs / 1000 + 0.02);
    };
    const t0 = ctx.currentTime;
    // First arpeggio: A5 → C#6 → E6 (A major triad, ascending)
    playTone(880,  t0 + 0.00, 180, vol);
    playTone(1109, t0 + 0.13, 180, vol);
    playTone(1318, t0 + 0.26, 350, vol);
    // Pause, then emphasis pair: E6 → E6
    playTone(1318, t0 + 0.75, 200, vol * 0.85);
    playTone(1318, t0 + 1.00, 380, vol);
    console.log('[notify] playDing fired (chord chime), ctx.state=', ctx.state);
  } catch (err) {
    console.log('[notify] playDing error', err);
  }
}

setInterval(() => {
  if (notifyEnabled.size === 0) return;
  const now = Date.now();
  for (const slotId of notifyEnabled) {
    const project = state.projects[slotId];
    if (!project) continue;
    if (!notifyArmed.has(slotId)) continue;
    const lastFire = notifyCooldown.get(slotId) || 0;
    if (now - lastFire < NOTIFY_COOLDOWN_MS) continue;
    let anyBurst = false;
    let allIdle = true;
    for (const role of ROLES) {
      const key = ptyKey(slotId, role);
      const act = ptyActivity.get(key);
      if (!act) continue;
      if (act.hadBurst) anyBurst = true;
      if (now - act.lastDataAt < NOTIFY_IDLE_MS) allIdle = false;
    }
    if (anyBurst && allIdle) {
      playDing();
      notifyCooldown.set(slotId, now);
      notifyArmed.delete(slotId);
      for (const role of ROLES) {
        const key = ptyKey(slotId, role);
        const act = ptyActivity.get(key);
        if (act) act.hadBurst = false;
      }
      const cell = gridEl.querySelector(`.cell[data-id="${slotId}"]`);
      const btn = cell && cell.querySelector('.notify-btn');
      if (btn) {
        btn.classList.add('firing');
        setTimeout(() => btn.classList.remove('firing'), 1300);
      }
      if (cell) {
        cell.classList.add('notify-firing');
        const onDismissClick = () => {
          cell.classList.remove('notify-firing');
          cell.removeEventListener('mousedown', onDismissClick);
          notifyCooldown.delete(slotId);
        };
        cell.addEventListener('mousedown', onDismissClick);
      }
    }
  }
}, 1000);

window.api.onExit(({ id }) => {
  const t = terms.get(id);
  if (t) t.term.write('\r\n\x1b[31m[process exited]\x1b[0m\r\n');
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(refit, 60);
});

(async () => {
  state = await window.api.getState();
  render();
})();
