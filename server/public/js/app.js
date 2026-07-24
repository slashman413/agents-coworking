/* Cowork MCP Dashboard — Vercel-quality redesign with Lucide icons + theme toggle */

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function timeAgo(iso) {
  if (!iso) return '-';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STATUS_COLORS = {
  pending: '#EAB308', claimed: '#0EA5E9', 'in-progress': '#0EA5E9',
  done: '#22C55E', rejected: '#EF4444',
  idle: '#94A3B8', working: '#22C55E', blocked: '#EF4444'
};

function badge(text, color) {
  return `<span class="badge" style="background:${color}18; color:${color}; border:1px solid ${color}40">${esc(text)}</span>`;
}

function createIcons() {
  if (window.lucide) lucide.createIcons();
}

// Sanitized markdown render (agent output is untrusted → DOMPurify).
function md(text) {
  const raw = String(text ?? '');
  try { return window.DOMPurify.sanitize(window.marked.parse(raw)); }
  catch { return `<pre>${esc(raw)}</pre>`; }
}
// A markdown block with a Raw/Rendered toggle (delegated click handler below).
let _mdSeq = 0;
function mdViewer(text, label) {
  const id = `md${++_mdSeq}`;
  return `<div class="md-block" data-md="${id}">
    ${label ? `<div style="font-size:0.72rem;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center">
      <span>${esc(label)}</span>
      <button class="btn md-toggle" data-md-target="${id}" style="font-size:0.68rem;padding:2px 6px">Raw</button></div>` : ''}
    <div class="md-body" data-md-body="${id}" style="font-size:0.87rem; line-height:1.5">${md(text)}</div>
    <pre class="md-raw" data-md-raw="${id}" hidden style="white-space:pre-wrap; font-size:0.83rem; background:var(--bg-tertiary); padding:10px; border-radius:8px; margin:4px 0">${esc(text)}</pre>
  </div>`;
}

class App {
  constructor() {
    this.currentView = '';
    this.api = window.api;
    this.sse = null;
    this.activity = [];
    this.inboxFilter = '';
    this.agents = new Map();   // agent UUID → { name, platform } for human-readable labels
    this.chatMessages = [];    // Chat view conversation state (persists across nav within a session)
    this.chatSel = { brain: '', division: '', agent: '' };
    this.chatBusy = false;

    this.contentEl = document.getElementById('content');
    this.viewTitleEl = document.getElementById('view-title');
    this.toastContainer = document.getElementById('toast-container');

    this.initTheme();
    this.init();
    // Delegated Raw/Rendered toggle for markdown blocks.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.md-toggle');
      if (!btn) return;
      const id = btn.dataset.mdTarget;
      const body = document.querySelector(`[data-md-body="${id}"]`);
      const raw = document.querySelector(`[data-md-raw="${id}"]`);
      if (!body || !raw) return;
      const showRaw = body.style.display !== 'none';
      body.style.display = showRaw ? 'none' : '';
      raw.hidden = !showRaw;
      btn.textContent = showRaw ? 'Rendered' : 'Raw';
    });
  }

  initTheme() {
    const saved = localStorage.getItem('cowork-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const toggleIcon = document.querySelector('#theme-toggle [data-lucide]');
    if (toggleIcon) {
      toggleIcon.setAttribute('data-lucide', saved === 'dark' ? 'moon' : 'sun');
    }
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleTheme());
    }
    createIcons();
  }

  toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('cowork-theme', next);
    const toggleIcon = document.querySelector('#theme-toggle [data-lucide]');
    if (toggleIcon) {
      toggleIcon.setAttribute('data-lucide', next === 'dark' ? 'moon' : 'sun');
    }
    createIcons();
  }

  init() {
    window.addEventListener('hashchange', () => this.navigate());
    this.setupSSE();
    this.navigate();
  }

  setupSSE() {
    this.sse = new window.SSEClient('/api/events', {
      onStatusChange: (status) => this.updateConnectionStatus(status),
      onMessage: (data) => this.handleSSEEvent(data)
    });
    this.sse.connect();
  }

  updateConnectionStatus(status) {
    const el = document.getElementById('connection-status');
    if (!el) return;
    const labels = { connected: 'Live', connecting: 'Connecting...', disconnected: 'Disconnected' };
    el.innerHTML = `<div class="dot ${status}"></div><span>${labels[status] || status}</span>`;
  }

  handleSSEEvent(data) {
    // Any inbound SSE frame means the stream is live — flip the badge to "Live"
    // immediately (more reliable than relying solely on EventSource.onopen).
    this.updateConnectionStatus('connected');
    if (!data.type || data.type === 'ping' || data.type === 'connected') return;
    this.activity.unshift(data);
    this.activity = this.activity.slice(0, 30);
    if (data.type !== 'heartbeat') {
      this.toast(data.type, this.describeEvent(data));
      this.renderCurrentView();
    }
  }

  // Map an agent UUID to its human-readable name (falls back to a short id).
  agentLabel(id) {
    if (!id) return '';
    const a = this.agents.get(id);
    return a ? a.name : id.slice(0, 8);
  }

  // Refresh the UUID→name map from the full active-agent list (includes the
  // internal dispatcher/orchestrator, unlike /connections). Call before
  // rendering views that show agent ids: dashboard, inbox, connections.
  async refreshAgents() {
    try {
      const agents = await this.api.get('/agents');
      (Array.isArray(agents) ? agents : []).forEach(a => this.agents.set(a.id, { name: a.agentName, platform: a.platform }));
    } catch { /* keep whatever we have */ }
  }

  describeEvent(e) {
    const p = e.payload || {};
    switch (e.type) {
      case 'agentRegistered':
        if (p.agent?.id) this.agents.set(p.agent.id, { name: p.agent.agentName, platform: p.agent.platform });
        return `${p.agent?.agentName} (${p.agent?.platform}) joined`;
      case 'taskCreated': return p.task?.title;
      case 'taskClaimed': return `claimed by ${this.agentLabel(p.task?.claimedBy || p.agentId)}: ${p.task?.title}`;
      case 'taskCompleted': return `done: ${p.task?.title}`;
      case 'reportFiled': return p.report?.title;
      case 'heartbeat': return `${this.agentLabel(p.agentId)} → ${p.status}`;
      default: return JSON.stringify(p).slice(0, 80);
    }
  }

  toast(title, message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast-title">${esc(title)}</div><div class="toast-message">${esc(message || '')}</div>`;
    this.toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  navigate() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    this.currentView = hash;
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === hash);
    });
    const titles = {
      dashboard: 'Dashboard', chat: 'Chat', connections: 'Connections', inbox: 'Task Inbox',
      reports: 'Reports', team: 'Agents', brains: 'Brains', roster: 'Agent Roster', config: 'Configuration'
    };
    this.viewTitleEl.textContent = titles[hash] || 'Dashboard';
    this.renderCurrentView();
  }

  async renderCurrentView() {
    try {
      switch (this.currentView) {
        case 'chat': await this.renderChat(); break;
        case 'connections': await this.renderConnections(); break;
        case 'inbox': await this.renderInbox(); break;
        case 'reports': await this.renderReports(); break;
        case 'team': await this.renderTeam(); break;
        case 'brains': await this.renderBrains(); break;
        case 'roster': await this.renderRoster(); break;
        case 'config': await this.renderConfig(); break;
        default: await this.renderDashboard(); break;
      }
      // A successful data fetch proves the server is reachable — mark the badge
      // Live even if the SSE stream is slow/blocked for any reason.
      this.updateConnectionStatus('connected');
    } catch (error) {
      this.contentEl.innerHTML = `<div class="empty-state"><p>Error loading view: ${esc(error.message)}</p></div>`;
    }
    createIcons();
  }

  // ── Dashboard ──────────────────────────────────────────────────────────

  async renderDashboard() {
    const [status, dispatcher] = await Promise.all([
      this.api.get('/status'),
      this.api.get('/dispatcher').catch(() => null),
      this.refreshAgents()
    ]);
    const stat = (iconName, value, label) => `
      <div class="card stat-card">
        <div class="stat-icon"><i data-lucide="${iconName}"></i></div>
        <div>
          <div class="stat-value">${value}</div>
          <div class="stat-label">${label}</div>
        </div>
      </div>`;
    const dot = (ok) => `<span class="dot ${ok ? 'connected' : 'disconnected'}" style="display:inline-block; margin-left:6px"></span>`;

    const platforms = Object.entries(status.platformStatus || {})
      .map(([id, on]) => `<p style="margin:6px 0; font-size:0.875rem">${esc(id)} ${dot(on)}</p>`).join('') || '<p style="color:var(--text-muted)">-</p>';
    const services = Object.entries(status.serviceStatus || {})
      .map(([id, on]) => `<p style="margin:6px 0; font-size:0.875rem">${esc(id)} ${dot(on)}</p>`).join('') || '<p style="color:var(--text-muted)">-</p>';

    const roles = dispatcher
      ? Object.entries(dispatcher.agents || {}).map(([name, a]) =>
          `<tr><td style="padding:3px 12px 3px 0">${badge(name, '#7C3AED')}</td><td style="color:var(--text-secondary); font-size:0.85rem">${esc((a.brains || []).join(' → '))}</td></tr>`).join('')
      : '';
    const running = dispatcher?.running?.length
      ? dispatcher.running.map(r =>
          `<p style="margin:4px 0; font-size:0.85rem">${badge(r.role, '#22C55E')} <span style="color:var(--text-secondary)">${esc(r.taskId.slice(0, 8))} · ${timeAgo(new Date(r.startedAt).toISOString())}</span></p>`).join('')
      : '<p style="color:var(--text-muted); font-size:0.85rem">Idle</p>';

    const activity = this.activity.length
      ? this.activity.slice(0, 12).map(e =>
          `<p style="margin:6px 0; font-size:0.85rem">${badge(e.type, '#0EA5E9')} ${esc(this.describeEvent(e))} <span style="color:var(--text-muted)">${timeAgo(e.timestamp)}</span></p>`).join('')
      : '<p style="color:var(--text-muted); font-size:0.875rem">Waiting for events…</p>';

    this.contentEl.innerHTML = `
      <div class="grid-4" style="margin-bottom: var(--space-xl)">
        ${stat('bot', status.activeAgents, 'Active Agents')}
        ${stat('inbox', status.inboxSummary.pending + status.inboxSummary.inProgress,
               `Open Tasks (${status.inboxSummary.completed} done)`)}
        ${stat('file-text', status.recentReports, 'Recent Reports')}
        ${stat('users', status.rosterCount, 'Agent Roster')}
      </div>
      <div class="grid-2" style="margin-bottom: var(--space-xl)">
        <div class="card">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:var(--space-md)">
            <i data-lucide="zap" style="width:18px;height:18px;color:var(--text-muted)"></i>
            <h3 style="font-size:0.95rem">Dispatcher</h3>
            ${dispatcher?.enabled ? badge('enabled', '#22C55E') : badge('disabled', '#EF4444')}
          </div>
          <div style="margin-top: var(--space-md)">
            <h4 class="section-title">Running Now</h4>
            ${running}
          </div>
          <div style="margin-top: var(--space-md)">
            <h4 class="section-title">Role → Model</h4>
            <table class="dispatcher-table">${roles}</table>
          </div>
        </div>
        <div class="card">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:var(--space-md)">
            <i data-lucide="activity" style="width:18px;height:18px;color:var(--text-muted)"></i>
            <h3 style="font-size:0.95rem">Live Activity</h3>
          </div>
          <div style="max-height:340px; overflow-y:auto">${activity}</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card">
          <h3 style="font-size:0.95rem; margin-bottom:var(--space-md)">Platforms</h3>
          <div>${platforms}</div>
        </div>
        <div class="card">
          <h3 style="font-size:0.95rem; margin-bottom:var(--space-md)">Services</h3>
          <div>${services}</div>
        </div>
      </div>`;
  }

  // ── Active Agents ──────────────────────────────────────────────────────

  async renderConnections() {
    const { clients, counters } = await this.api.get('/connections');
    const clientCards = clients.length ? `<div class="grid-3">` + clients.map(a => `
      <div class="card agent-card">
        <div class="agent-header">
          <span class="agent-title">${esc(a.agentName)}</span>
          ${badge(a.live ? 'live' : 'stale', a.live ? '#22C55E' : '#94A3B8')}
        </div>
        <p style="margin:6px 0">${badge(a.platform, '#D97757')} ${badge(a.status, STATUS_COLORS[a.status] || '#94A3B8')}</p>
        ${a.capabilities?.length ? `<p style="font-size:0.78rem; color:var(--text-muted); margin-top:6px">${a.capabilities.map(c => esc(c)).join(' · ')}</p>` : ''}
        <div class="agent-footer">
          <span><i data-lucide="heart" style="width:12px;height:12px;vertical-align:middle;margin-right:2px"></i> ${timeAgo(a.lastHeartbeat)}</span>
          <span>joined ${timeAgo(a.registeredAt)}</span>
        </div>
      </div>`).join('') + `</div>`
      : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="plug"></i></div><h3>No live MCP clients</h3><p>External clients appear here when they register + heartbeat.</p></div>`;

    // Invocation counters: per client × per brain (ran / submitted)
    const clientsSet = new Set([...Object.keys(counters.ran || {}), ...Object.keys(counters.submitted || {})]);
    const counterRows = [...clientsSet].map(cl => {
      const ran = counters.ran?.[cl] || {}, sub = counters.submitted?.[cl] || {};
      const brains = [...new Set([...Object.keys(ran), ...Object.keys(sub)])];
      return brains.map(b => `<tr><td style="padding:2px 10px 2px 0">${esc(cl)}</td><td style="padding:2px 10px 2px 0">${badge(b, '#7C3AED')}</td><td style="text-align:right;padding-right:12px">${ran[b] || 0}</td><td style="text-align:right">${sub[b] || 0}</td></tr>`).join('');
    }).join('');

    this.contentEl.innerHTML = `
      ${clientCards}
      <div class="card" style="margin-top:var(--space-lg)">
        <h3 style="font-size:0.95rem; margin-bottom:8px">Brain invocations <span style="font-size:0.72rem;color:var(--text-muted);font-weight:400">(this session · resets on restart)</span></h3>
        ${counterRows ? `<table style="font-size:0.83rem"><thead><tr style="color:var(--text-muted);font-size:0.75rem"><th style="text-align:left">client</th><th style="text-align:left">brain</th><th style="text-align:right;padding-right:12px">ran</th><th style="text-align:right">submitted</th></tr></thead><tbody>${counterRows}</tbody></table>` : '<p style="color:var(--text-muted);font-size:0.85rem">No invocations yet.</p>'}
      </div>`;
  }

  // ── Inbox ──────────────────────────────────────────────────────────────

  // ── Chat (dispatch a task to a brain/agent and stream back its result) ─────

  async renderChat() {
    const [brains, divisions] = await Promise.all([this.api.get('/brains'), this.api.get('/roster-divisions')]);
    this._chatDivisions = divisions;
    const sel = 'padding:6px 8px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:8px;color:inherit;font-size:0.8rem';
    const brainOpts = ['<option value="">🧠 Auto (route via chain)</option>']
      .concat(Object.keys(brains).sort().map(b => `<option value="${esc(b)}">${esc(b)}</option>`)).join('');
    const divOpts = ['<option value="">— any division —</option>']
      .concat(Object.entries(divisions).sort().map(([d, i]) => `<option value="${esc(d)}">${esc(i.label || d)} (${i.agents.length})</option>`)).join('');

    this.contentEl.innerHTML = `
      <div style="display:flex;flex-direction:column;height:calc(100vh - 130px);min-height:420px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
          <select id="chat-brain" style="${sel}">${brainOpts}</select>
          <select id="chat-div" style="${sel}">${divOpts}</select>
          <select id="chat-agent" style="${sel}"><option value="">— none (chat brain directly) —</option></select>
          <button id="chat-new" class="btn" style="font-size:0.78rem;margin-left:auto">＋ New chat</button>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:8px">Each message is dispatched as a task; the reply is its result. Pick a brain (or Auto), optionally a division + roster agent — with no agent you chat the brain directly.</div>
        <div id="chat-msgs" style="flex:1;overflow-y:auto;padding:8px;border:1px solid var(--bg-tertiary);border-radius:12px;background:var(--bg-primary)"></div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <textarea id="chat-input" rows="2" placeholder="Message…  (Enter to send · Shift+Enter = newline)" style="flex:1;padding:9px 12px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:10px;color:inherit;font:inherit;font-size:0.88rem;resize:vertical"></textarea>
          <button id="chat-send" class="btn btn-primary" style="padding:0 18px">Send</button>
        </div>
      </div>`;

    const brainEl = this.contentEl.querySelector('#chat-brain');
    const divEl = this.contentEl.querySelector('#chat-div');
    const agentEl = this.contentEl.querySelector('#chat-agent');
    brainEl.value = this.chatSel.brain || '';
    divEl.value = this.chatSel.division || '';
    this.populateChatAgents(this.chatSel.division);
    agentEl.value = this.chatSel.agent || '';

    brainEl.addEventListener('change', () => { this.chatSel.brain = brainEl.value; });
    divEl.addEventListener('change', () => { this.chatSel.division = divEl.value; this.chatSel.agent = ''; this.populateChatAgents(divEl.value); });
    agentEl.addEventListener('change', () => { this.chatSel.agent = agentEl.value; });

    const input = this.contentEl.querySelector('#chat-input');
    const doSend = () => { const t = input.value.trim(); if (t && !this.chatBusy) { input.value = ''; this.sendChat(t); } };
    this.contentEl.querySelector('#chat-send').addEventListener('click', doSend);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
    this.contentEl.querySelector('#chat-new').addEventListener('click', () => { this.chatMessages = []; this.renderChatMessages(); });

    this.renderChatMessages();
    input.focus();
  }

  populateChatAgents(division) {
    const el = this.contentEl.querySelector('#chat-agent');
    if (!el) return;
    const info = division && this._chatDivisions ? this._chatDivisions[division] : null;
    const opts = info ? info.agents.slice().sort((a, b) => a.name.localeCompare(b.name))
      .map(a => `<option value="${esc(a.slug)}">${esc(a.name)}</option>`).join('') : '';
    el.innerHTML = '<option value="">— none (chat brain directly) —</option>' + opts;
    el.disabled = !info;
  }

  chatBubble(m) {
    const user = m.role === 'user';
    const body = user ? esc(m.content).replace(/\n/g, '<br>')
      : (m.pending ? '<span style="opacity:.6">▋ thinking…</span>' : md(m.content || '(no output)'));
    const meta = m.meta ? `<div style="font-size:0.66rem;opacity:.6;margin-bottom:3px">${esc(m.meta)}</div>` : '';
    return `<div style="display:flex;justify-content:${user ? 'flex-end' : 'flex-start'};margin:8px 0">
      <div class="md-block" style="max-width:80%;padding:9px 12px;border-radius:12px;overflow-x:auto;font-size:0.88rem;line-height:1.5;background:${user ? '#7C3AED' : 'var(--bg-secondary)'};color:${user ? '#fff' : 'inherit'}">${meta}${body}</div>
    </div>`;
  }

  renderChatMessages() {
    const box = this.contentEl.querySelector('#chat-msgs');
    if (!box) return;
    box.innerHTML = this.chatMessages.length
      ? this.chatMessages.map(m => this.chatBubble(m)).join('')
      : '<div style="color:var(--text-muted);text-align:center;margin-top:40px;font-size:0.85rem">Start a conversation — your message is dispatched to the selected brain/agent and the reply is the task result.</div>';
    box.scrollTop = box.scrollHeight;
  }

  buildChatDescription() {
    const done = this.chatMessages.filter(m => !m.pending);
    if (done.length <= 1) return done[done.length - 1]?.content || '';
    return done.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  }

  async sendChat(text) {
    this.chatBusy = true;
    const { brain, division, agent } = this.chatSel;
    const context = {};
    if (brain) context.brain = brain;
    if (agent) context.agent = agent; else if (division) context.division = division;
    const target = agent || (division ? `division:${division}` : (brain || 'auto'));
    this.chatMessages.push({ role: 'user', content: text });
    const ph = { role: 'assistant', content: '', pending: true, meta: `↳ ${target}${brain && agent ? ' · ' + brain : ''}` };
    this.chatMessages.push(ph);
    this.renderChatMessages();
    try {
      const task = await this.api.post('/inbox', {
        title: text.slice(0, 60) || 'chat',
        description: this.buildChatDescription(),
        from: { platform: 'chat', agent: 'dashboard' },
        context, tags: ['chat']
      });
      const done = await this.pollChatTask(task.id);
      const c = done.context || {};
      const ranAgent = c.ranAgent ? (c.ranDivision ? `${c.ranDivision}/${c.ranAgent}` : c.ranAgent) : '';
      const ranBrain = c.ranBrain || c.brain || brain || '';
      ph.pending = false;
      ph.content = done.status === 'done' ? (done.result || '(no output)')
        : `⚠️ task ${done.status}${done.result ? ': ' + done.result : ''}`;
      ph.meta = [ranAgent, ranBrain].filter(Boolean).join(' · ') || null;
    } catch (e) {
      ph.pending = false; ph.content = `⚠️ ${e.message}`;
    } finally {
      this.chatBusy = false;
      this.renderChatMessages();
    }
  }

  async pollChatTask(id, timeoutMs = 300000) {
    const start = Date.now();
    for (;;) {
      await new Promise(r => setTimeout(r, 2000));
      let t;
      try { t = await this.api.get(`/inbox/${encodeURIComponent(id)}`); } catch { t = null; }
      if (t && (t.status === 'done' || t.status === 'rejected')) return t;
      if (Date.now() - start > timeoutMs) return { status: 'timed-out', result: '(no response within 5 min)', context: {} };
    }
  }

  async renderInbox() {
    const q = this.inboxFilter ? `?status=${this.inboxFilter}&limit=100` : '?limit=100';
    const [tasks] = await Promise.all([this.api.get(`/inbox${q}`), this.refreshAgents()]);
    const pills = ['', 'pending', 'in-progress', 'done'].map(f => {
      const label = f === '' ? 'All' : f;
      const active = this.inboxFilter === f;
      return `<button class="btn pill" data-filter="${f}" style="${active ? 'background:var(--bg-tertiary); border-color:var(--border-hover); color:var(--text-primary)' : ''}">${esc(label)}</button>`;
    }).join(' ');

    const rows = tasks.length ? tasks.map(t => {
      const c = t.context || {};
      // Which agent + brain ran it (item 5), or the requested assignment.
      const agentLabel = c.ranAgent ? (c.ranDivision ? `${c.ranDivision} / ${c.ranAgent}` : c.ranAgent)
        : (c.division ? `${c.division} / ${c.agent || '?'}` : (c.agent || c.role || ''));
      const brainLabel = c.ranBrain || c.brain || '';
      const arts = Array.isArray(t.artifacts) ? t.artifacts : [];
      return `
      <div class="card task-card" style="margin-bottom: var(--space-md)" data-task="${esc(t.id)}">
        <div class="task-card-header">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
            ${badge(t.status, STATUS_COLORS[t.status] || '#94A3B8')}
            ${agentLabel ? badge(agentLabel, '#7C3AED') : ''}
            ${brainLabel ? badge(brainLabel, '#0EA5E9') : ''}
            <strong style="margin-left:4px; font-size:0.9rem">${esc(t.title)}</strong>
          </div>
          <span class="task-meta">${esc(t.from?.platform || '?')}/${esc(t.from?.agent || '?')} · ${timeAgo(t.createdAt)}</span>
        </div>
        ${arts.length ? `<div class="task-artifacts" style="display:flex; flex-wrap:wrap; align-items:center; gap:4px; padding:6px 0 2px">
          <span style="font-size:0.72rem; color:var(--text-muted); margin-right:2px; text-transform:uppercase; letter-spacing:.03em">Artifacts</span>
          ${arts.map(f => `<a href="/api/artifacts/${encodeURIComponent(t.id)}/${encodeURIComponent(f)}" download class="btn" style="font-size:0.78rem;margin:0;display:inline-flex;align-items:center;gap:4px"><i data-lucide="download" style="width:12px;height:12px"></i>${esc(f)}</a>`).join('')}</div>` : ''}
        <div class="task-detail">
          ${mdViewer(t.description, 'DESCRIPTION')}
          ${t.result ? `<div style="margin-top:12px">${mdViewer(t.result, 'RESULT')}</div>` : ''}
          ${t.claimedBy ? `<p style="font-size:0.8rem; color:var(--text-muted); margin-top:8px">Claimed by ${esc(this.agentLabel(t.claimedBy))}${t.completedAt ? ' · completed ' + timeAgo(t.completedAt) : ''}</p>` : ''}
        </div>
      </div>`;
    }).join('') : `<div class="empty-state"><p>No tasks${this.inboxFilter ? ` with status "${esc(this.inboxFilter)}"` : ''}.</p></div>`;

    this.contentEl.innerHTML = `
      <div style="margin-bottom: var(--space-lg); display:flex; gap:8px">${pills}</div>
      ${rows}`;

    this.contentEl.querySelectorAll('[data-filter]').forEach(b =>
      b.addEventListener('click', () => { this.inboxFilter = b.dataset.filter; this.renderInbox(); }));
    this.contentEl.querySelectorAll('[data-task]').forEach(card =>
      card.addEventListener('click', (e) => {
        if (e.target.closest('pre, .md-block, a, button')) return;   // don't toggle when interacting with content
        const d = card.querySelector('.task-detail');
        d.style.display = d.style.display === 'none' || !d.style.display ? 'block' : 'none';
        createIcons();
      }));
  }

  // ── Reports ────────────────────────────────────────────────────────────

  async renderReports() {
    const reports = await this.api.get('/reports?limit=100');
    if (!reports.length) {
      this.contentEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon"><i data-lucide="file-text"></i></div>
          <h3>No reports filed yet</h3>
          <p>Reports appear here when agents submit them.</p>
        </div>`;
      return;
    }
    this.contentEl.innerHTML = reports.map(r => `
      <div class="card task-card" style="margin-bottom: var(--space-md)" data-report="${esc(r.id)}">
        <div class="task-card-header">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
            ${badge(r.type, '#0EA5E9')}
            ${badge(r.status, r.status === 'final' ? '#22C55E' : '#EAB308')}
            <strong style="margin-left:4px; font-size:0.9rem">${esc(r.title)}</strong>
          </div>
          <span class="task-meta">${esc(r.author?.platform || '?')}/${esc(r.author?.agent || '?')} · ${timeAgo(r.createdAt)}</span>
        </div>
        <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:6px">${esc(r.summary || '')}</p>
        <div class="report-body" style="display:none; margin-top: var(--space-md)"></div>
      </div>`).join('');

    this.contentEl.querySelectorAll('[data-report]').forEach(card =>
      card.addEventListener('click', async (e) => {
        if (e.target.closest('pre, .md-block, a, button')) return;
        const body = card.querySelector('.report-body');
        if (body.style.display === 'none' || !body.style.display) {
          if (!body.dataset.loaded) {
            const full = await this.api.get(`/reports/${card.dataset.report}`);
            body.innerHTML = mdViewer(full.content || full.summary || '', 'REPORT');
            body.dataset.loaded = '1';
            createIcons();
          }
          body.style.display = 'block';
        } else {
          body.style.display = 'none';
        }
      }));
  }

  // ── Roster ─────────────────────────────────────────────────────────────

  async renderRoster() {
    const roster = await this.api.get('/roster');
    const byDivision = {};
    for (const a of roster) (byDivision[a.divisionLabel || a.division || 'other'] ||= []).push(a);

    this.contentEl.innerHTML = `
      <input id="roster-search" class="roster-search" placeholder="Search ${roster.length} agents…">
      <div id="roster-list"></div>`;

    const listEl = this.contentEl.querySelector('#roster-list');
    const render = (filter) => {
      const f = (filter || '').toLowerCase();
      listEl.innerHTML = Object.entries(byDivision).map(([div, agents]) => {
        const hits = f ? agents.filter(a =>
          a.name.toLowerCase().includes(f) || (a.description || '').toLowerCase().includes(f)) : agents;
        if (!hits.length) return '';
        return `<h3 style="margin: var(--space-lg) 0 var(--space-md); font-size:0.95rem">${esc(div)} <span style="color:var(--text-muted); font-size:0.8rem; font-weight:400">(${hits.length})</span></h3>
          <div class="grid-3">` + hits.map(a => `
          <div class="card agent-card">
            <div class="agent-header">
              <span class="agent-title">${a.emoji ? esc(a.emoji) + ' ' : ''}${esc(a.name)}</span>
            </div>
            <p style="font-size:0.83rem; color:var(--text-secondary); margin-top:6px">${esc((a.description || '').slice(0, 140))}</p>
            ${a.vibe ? `<p style="font-size:0.8rem; font-style:italic; color:var(--text-muted); margin-top:6px">${esc(a.vibe)}</p>` : ''}
          </div>`).join('') + `</div>`;
      }).join('') || `<div class="empty-state"><p>No agents match.</p></div>`;
      createIcons();
    };
    render('');
    this.contentEl.querySelector('#roster-search').addEventListener('input', (e) => render(e.target.value));
  }

  // ── Agents: special executors + roster divisions (with brain chains) ───────

  async renderTeam() {
    const [special, brains, chains, divisions] = await Promise.all([
      this.api.get('/agents-config'), this.api.get('/brains'), this.api.get('/chains'), this.api.get('/roster-divisions')
    ]);
    const opts = Object.keys(brains).map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
    const chip = (b, i, ctx) => {
      const known = !!brains[b];
      return `<span class="chip" data-ctx="${ctx}" data-brain="${esc(b)}" style="display:inline-flex;align-items:center;gap:5px;background:${known ? '#7C3AED18' : '#EF444418'};border:1px solid ${known ? '#7C3AED40' : '#EF444440'};color:${known ? '#7C3AED' : '#EF4444'};padding:2px 7px;border-radius:8px;font-size:0.77rem;margin:2px">
        <b style="opacity:.6">${i + 1}</b> ${esc(b)}${known ? '' : ' ⚠'}
        <a data-act="up" style="cursor:pointer">▲</a><a data-act="down" style="cursor:pointer">▼</a><a data-act="rm" style="cursor:pointer">✕</a></span>`;
    };
    const chainRow = (arr, ctx) => `<div style="margin:4px 0">${(arr || []).map((b, i) => chip(b, i, ctx)).join('') || '<span style="color:var(--text-muted);font-size:0.8rem">none</span>'}</div>
      <select data-add="${ctx}" style="padding:4px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:8px;color:inherit;font-size:0.78rem"><option value="">+ add brain…</option>${opts}</select>`;

    const specialCards = Object.entries(special).map(([n, a]) => `
      <div class="card" style="margin-bottom:var(--space-md)">
        <div style="display:flex;justify-content:space-between;align-items:center"><strong>${esc(n)}</strong>${badge('special', '#0EA5E9')}</div>
        <p style="font-size:0.8rem;color:var(--text-muted);margin:4px 0">${esc(a.description || '')}</p>
        ${chainRow(a.brains, 'agent:' + n)}
      </div>`).join('');

    const divCards = Object.entries(divisions).sort().map(([d, info]) => {
      const override = chains.divisionChains?.[d];
      return `<div class="card" style="margin-bottom:var(--space-md)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>${esc(info.label || d)}</strong>
          <span style="font-size:0.75rem;color:var(--text-muted)">${info.agents.length} agents${override ? '' : ' · uses default chain'}</span>
        </div>
        ${override ? chainRow(override, 'div:' + d) + `<a data-reset="${esc(d)}" style="cursor:pointer;font-size:0.72rem;color:var(--text-muted)">↺ reset to default</a>`
          : `<div style="margin:4px 0;font-size:0.8rem;color:var(--text-muted)">${(chains.defaultChain || []).join(' → ') || '(no default)'}</div>
             <select data-add="div:${esc(d)}" style="padding:4px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:8px;color:inherit;font-size:0.78rem"><option value="">+ override with…</option>${opts}</select>`}
      </div>`;
    }).join('');

    this.contentEl.innerHTML = `
      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:var(--space-md)">The orchestrator routes each task to a specialist in one of these divisions; the specialist runs on its division's chain (or the global default). Special executors run directly. Changes save instantly.</p>
      <h3 style="font-size:0.9rem;margin:var(--space-md) 0 6px">Special executors</h3>${specialCards}
      <h3 style="font-size:0.9rem;margin:var(--space-lg) 0 6px">Divisions <span style="font-size:0.72rem;color:var(--text-muted);font-weight:400">(brain chain override per division)</span></h3>${divCards}`;

    const save = async (ctx, arr) => {
      if (ctx.startsWith('agent:')) { const n = ctx.slice(6); await this.api.put(`/agents-config/${encodeURIComponent(n)}`, { description: special[n].description, brains: arr }); }
      else { const dv = ctx.slice(4); await this.api.put(`/chains/division/${encodeURIComponent(dv)}`, { brains: arr }); }
      await this.renderTeam();
    };
    const chainOf = (ctx) => ctx.startsWith('agent:') ? (special[ctx.slice(6)].brains || []).slice() : (chains.divisionChains?.[ctx.slice(4)] || []).slice();

    this.contentEl.querySelectorAll('.chip a').forEach(el => el.addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); const ctx = c.dataset.ctx; const brain = c.dataset.brain; const act = e.target.dataset.act;
      const arr = chainOf(ctx); const i = arr.indexOf(brain);
      if (act === 'rm') arr.splice(i, 1);
      else if (act === 'up' && i > 0) { arr.splice(i, 1); arr.splice(i - 1, 0, brain); }
      else if (act === 'down' && i < arr.length - 1) { arr.splice(i, 1); arr.splice(i + 1, 0, brain); }
      else return;
      save(ctx, arr);
    }));
    this.contentEl.querySelectorAll('[data-add]').forEach(sel => sel.addEventListener('change', (e) => {
      const ctx = e.target.dataset.add; const b = e.target.value; if (!b) return;
      const arr = chainOf(ctx); if (!arr.includes(b)) arr.push(b);
      save(ctx, arr);
    }));
    this.contentEl.querySelectorAll('[data-reset]').forEach(a => a.addEventListener('click', () => save('div:' + a.dataset.reset, [])));
  }

  // ── Brains (model × platform × location registry) ──────────────────────

  async renderBrains() {
    const [brains, chains] = await Promise.all([this.api.get('/brains'), this.api.get('/chains')]);
    // Default fallback chain — drag to reorder; saves on drop.
    const chainChips = (chains.defaultChain || []).map(b => {
      const known = !!brains[b];
      return `<span class="dchip" draggable="true" data-brain="${esc(b)}" style="display:inline-flex;align-items:center;gap:6px;cursor:grab;background:${known ? '#7C3AED18' : '#EF444418'};border:1px solid ${known ? '#7C3AED40' : '#EF444440'};color:${known ? '#7C3AED' : '#EF4444'};padding:4px 9px;border-radius:8px;font-size:0.8rem;margin:3px">
        <i data-lucide="grip-vertical" style="width:12px;height:12px;opacity:.5"></i>${esc(b)}${known ? '' : ' ⚠'}
        <a data-rm="${esc(b)}" style="cursor:pointer">✕</a></span>`;
    }).join('') || '<span style="color:var(--text-muted);font-size:0.8rem">empty — add a brain below</span>';
    const notInChain = Object.keys(brains).filter(b => !(chains.defaultChain || []).includes(b));
    const defaultChainCard = `
      <div class="card" style="margin-bottom:var(--space-lg)">
        <div style="font-size:0.9rem;font-weight:600">Default fallback chain <span style="font-size:0.72rem;color:var(--text-muted);font-weight:400">— drag to reorder; roster agents use this unless their division overrides it</span></div>
        <div id="dchain" style="margin:8px 0;min-height:34px">${chainChips}</div>
        <select id="dchain-add" style="padding:5px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:8px;color:inherit;font-size:0.8rem"><option value="">+ add to chain…</option>${notInChain.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}</select>
      </div>`;
    const row = (id, b) => `
      <div class="card" style="margin-bottom:var(--space-md)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>${esc(id)}</strong>
          ${badge(b.location, b.location === 'remote' ? '#EAB308' : '#22C55E')}
          ${b.dynamic ? badge('auto', '#0EA5E9') : ''}
          <button class="btn" data-act="del-brain" data-id="${esc(id)}" style="font-size:0.75rem;margin-left:auto">Deregister</button>
        </div>
        <p style="font-size:0.82rem;color:var(--text-secondary);margin:4px 0">${esc(b.description || '')}</p>
        <div style="font-size:0.78rem;color:var(--text-muted)">${esc(b.exec || '')}${b.model ? ' · ' + esc(b.model) : ''}${b.host ? ' · host ' + esc(b.host) : ''}</div>
      </div>`;
    const fld = (id, ph) => `<input id="nb-${id}" placeholder="${ph}" style="padding:6px 8px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:8px;color:inherit;font-size:0.8rem">`;
    this.contentEl.innerHTML = `
      <div class="card" style="margin-bottom:var(--space-lg)">
        <div style="font-size:0.85rem;font-weight:600;margin-bottom:6px">Register / update a brain</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px">
          ${fld('id', 'id (e.g. remote-laptop-cc-sonnet)')}
          <select id="nb-location" style="padding:6px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:8px;color:inherit;font-size:0.8rem"><option value="local">local</option><option value="remote">remote</option></select>
          <select id="nb-exec" style="padding:6px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:8px;color:inherit;font-size:0.8rem"><option value="claude">claude</option><option value="hermes">hermes</option><option value="agy">agy</option><option value="script">script</option></select>
          ${fld('model', 'model id')}
          ${fld('host', 'host (remote only)')}
          ${fld('desc', 'description')}
        </div>
        <button class="btn btn-primary" id="nb-save" style="margin-top:8px;font-size:0.8rem">Save brain</button>
      </div>
      ${defaultChainCard}
      ${Object.entries(brains).map(([id, b]) => row(id, b)).join('') || '<div class="empty-state"><p>No brains registered.</p></div>'}`;

    if (window.lucide) window.lucide.createIcons();

    // ── Default chain: drag-to-reorder + add/remove, persisted on change ──────
    const saveDefault = async (arr) => {
      try { await this.api.put('/chains/default', { brains: arr }); this.renderBrains(); }
      catch (e) { this.toast('error', e.message); }
    };
    const dchain = this.contentEl.querySelector('#dchain');
    if (dchain) {
      let dragged = null;
      dchain.querySelectorAll('.dchip').forEach(c => {
        c.addEventListener('dragstart', () => { dragged = c; c.style.opacity = '.4'; });
        c.addEventListener('dragend', () => { c.style.opacity = ''; dragged = null; });
        c.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (!dragged || dragged === c) return;
          const chips = [...dchain.querySelectorAll('.dchip')];
          if (chips.indexOf(dragged) < chips.indexOf(c)) c.after(dragged); else c.before(dragged);
        });
      });
      dchain.addEventListener('drop', (e) => {
        e.preventDefault();
        saveDefault([...dchain.querySelectorAll('.dchip')].map(c => c.dataset.brain));
      });
      dchain.querySelectorAll('[data-rm]').forEach(a => a.addEventListener('click', () => {
        saveDefault([...dchain.querySelectorAll('.dchip')].filter(c => c.dataset.brain !== a.dataset.rm).map(c => c.dataset.brain));
      }));
    }
    this.contentEl.querySelector('#dchain-add')?.addEventListener('change', (e) => {
      const b = e.target.value; if (!b) return;
      saveDefault([...(chains.defaultChain || []), b]);
    });

    this.contentEl.querySelector('#nb-save').addEventListener('click', async () => {
      const g = id => this.contentEl.querySelector(`#nb-${id}`).value.trim();
      const id = g('id'); if (!id) { this.toast('error', 'brain id required'); return; }
      try {
        await this.api.put(`/brains/${encodeURIComponent(id)}`, {
          description: g('desc') || id, location: this.contentEl.querySelector('#nb-location').value,
          exec: this.contentEl.querySelector('#nb-exec').value, model: g('model'), host: g('host') || undefined
        });
        this.toast('brain saved', id); this.renderBrains();
      } catch (e) { this.toast('error', e.message); }
    });
    this.contentEl.querySelectorAll('[data-act="del-brain"]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.id;
      if (!confirm(`Deregister brain "${id}"? It will be removed from every agent's chain.`)) return;
      const r = await this.api.del(`/brains/${encodeURIComponent(id)}`);
      this.toast('brain removed', `${id} (scrubbed from ${r.agents_scrubbed} agent chain(s))`);
      this.renderBrains();
    }));
  }

  // ── Config ─────────────────────────────────────────────────────────────

  async renderConfig() {
    const config = await this.api.get('/config');
    this.contentEl.innerHTML = `
      <div class="card">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:var(--space-md)">
          <i data-lucide="settings" style="width:18px;height:18px;color:var(--text-muted)"></i>
          <h3 style="font-size:0.95rem">Configuration</h3>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:400">(config.json — API keys masked)</span>
        </div>
        <pre style="white-space:pre-wrap; font-size:0.83rem; max-height:70vh; overflow-y:auto">${esc(JSON.stringify(config, null, 2))}</pre>
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
