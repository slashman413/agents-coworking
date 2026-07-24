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

class App {
  constructor() {
    this.currentView = '';
    this.api = window.api;
    this.sse = null;
    this.activity = [];
    this.inboxFilter = '';

    this.contentEl = document.getElementById('content');
    this.viewTitleEl = document.getElementById('view-title');
    this.toastContainer = document.getElementById('toast-container');

    this.initTheme();
    this.init();
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
    if (!data.type || data.type === 'ping' || data.type === 'connected') return;
    this.activity.unshift(data);
    this.activity = this.activity.slice(0, 30);
    if (data.type !== 'heartbeat') {
      this.toast(data.type, this.describeEvent(data));
      this.renderCurrentView();
    }
  }

  describeEvent(e) {
    const p = e.payload || {};
    switch (e.type) {
      case 'agentRegistered': return `${p.agent?.agentName} (${p.agent?.platform}) joined`;
      case 'taskCreated': return p.task?.title;
      case 'taskClaimed': return `claimed: ${p.task?.title}`;
      case 'taskCompleted': return `done: ${p.task?.title}`;
      case 'reportFiled': return p.report?.title;
      case 'heartbeat': return `${(p.agentId || '').slice(0, 8)} → ${p.status}`;
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
      dashboard: 'Dashboard', agents: 'Active Agents', inbox: 'Task Inbox',
      reports: 'Reports', team: 'Agents', brains: 'Brains', roster: 'Agent Roster', config: 'Configuration'
    };
    this.viewTitleEl.textContent = titles[hash] || 'Dashboard';
    this.renderCurrentView();
  }

  async renderCurrentView() {
    try {
      switch (this.currentView) {
        case 'agents': await this.renderAgents(); break;
        case 'inbox': await this.renderInbox(); break;
        case 'reports': await this.renderReports(); break;
        case 'team': await this.renderTeam(); break;
        case 'brains': await this.renderBrains(); break;
        case 'roster': await this.renderRoster(); break;
        case 'config': await this.renderConfig(); break;
        default: await this.renderDashboard(); break;
      }
    } catch (error) {
      this.contentEl.innerHTML = `<div class="empty-state"><p>Error loading view: ${esc(error.message)}</p></div>`;
    }
    createIcons();
  }

  // ── Dashboard ──────────────────────────────────────────────────────────

  async renderDashboard() {
    const [status, dispatcher] = await Promise.all([
      this.api.get('/status'),
      this.api.get('/dispatcher').catch(() => null)
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
      ? Object.entries(dispatcher.roles).map(([r, m]) =>
          `<tr><td style="padding:3px 12px 3px 0">${badge(r, '#7C3AED')}</td><td style="color:var(--text-secondary); font-size:0.85rem">${esc(m)}</td></tr>`).join('')
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

  async renderAgents() {
    const agents = await this.api.get('/agents');
    if (!agents.length) {
      this.contentEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon"><i data-lucide="bot"></i></div>
          <h3>No agents currently active</h3>
          <p>Agents register when they connect via MCP.</p>
        </div>`;
      return;
    }
    this.contentEl.innerHTML = `<div class="grid-3">` + agents.map(a => `
      <div class="card agent-card">
        <div class="agent-header">
          <span class="agent-title">${esc(a.agentName)}</span>
          ${badge(a.status, STATUS_COLORS[a.status] || '#94A3B8')}
        </div>
        <p style="margin:6px 0">
          ${badge(a.platform, '#D97757')}
          <span style="font-size:0.8rem; color:var(--text-muted); margin-left:4px">${esc((a.id || '').slice(0, 8))}</span>
        </p>
        ${a.currentTask ? `<p class="agent-task"><i data-lucide="pushpin" style="width:12px;height:12px;flex-shrink:0"></i> ${esc(a.currentTask)}</p>` : ''}
        ${a.capabilities?.length ? `<p style="font-size:0.8rem; color:var(--text-muted); margin-top:6px">${a.capabilities.map(c => esc(c)).join(' · ')}</p>` : ''}
        <div class="agent-footer">
          <span><i data-lucide="heart" style="width:12px;height:12px;vertical-align:middle;margin-right:2px"></i> ${timeAgo(a.lastHeartbeat)}</span>
          <span>joined ${timeAgo(a.registeredAt)}</span>
        </div>
      </div>`).join('') + `</div>`;
  }

  // ── Inbox ──────────────────────────────────────────────────────────────

  async renderInbox() {
    const q = this.inboxFilter ? `?status=${this.inboxFilter}&limit=100` : '?limit=100';
    const tasks = await this.api.get(`/inbox${q}`);
    const pills = ['', 'pending', 'in-progress', 'done'].map(f => {
      const label = f === '' ? 'All' : f;
      const active = this.inboxFilter === f;
      return `<button class="btn pill" data-filter="${f}" style="${active ? 'background:var(--bg-tertiary); border-color:var(--border-hover); color:var(--text-primary)' : ''}">${esc(label)}</button>`;
    }).join(' ');

    const rows = tasks.length ? tasks.map(t => {
      const role = t.context?.role || (t.tags || [])[0] || '';
      return `
      <div class="card task-card" style="margin-bottom: var(--space-md)" data-task="${esc(t.id)}">
        <div class="task-card-header">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap">
            ${badge(t.status, STATUS_COLORS[t.status] || '#94A3B8')}
            ${role ? badge(role, '#7C3AED') : ''}
            <strong style="margin-left:4px; font-size:0.9rem">${esc(t.title)}</strong>
          </div>
          <span class="task-meta">${esc(t.from?.platform || '?')}/${esc(t.from?.agent || '?')} · ${timeAgo(t.createdAt)}</span>
        </div>
        <div class="task-detail">
          <h4>Description</h4>
          <pre style="background:var(--bg-tertiary); padding:10px; border-radius:8px">${esc(t.description)}</pre>
          ${t.result ? `<div style="margin-top:12px"><h4>Result</h4>
          <pre style="background:var(--bg-tertiary); padding:10px; border-radius:8px; max-height:400px; overflow-y:auto">${esc(t.result)}</pre></div>` : ''}
          ${t.claimedBy ? `<p style="font-size:0.8rem; color:var(--text-muted); margin-top:8px">Claimed by ${esc(t.claimedBy.slice(0, 8))}${t.completedAt ? ' · completed ' + timeAgo(t.completedAt) : ''}</p>` : ''}
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
        if (e.target.closest('pre')) return;
        const d = card.querySelector('.task-detail');
        d.style.display = d.style.display === 'none' || !d.style.display ? 'block' : 'none';
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
        if (e.target.closest('pre')) return;
        const body = card.querySelector('.report-body');
        if (body.style.display === 'none' || !body.style.display) {
          if (!body.dataset.loaded) {
            const full = await this.api.get(`/reports/${card.dataset.report}`);
            body.innerHTML = `<pre style="white-space:pre-wrap; font-size:0.85rem; max-height:500px; overflow-y:auto; background:var(--bg-tertiary); padding:10px; border-radius:8px">${esc(full.content || full.summary || '')}</pre>`;
            body.dataset.loaded = '1';
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

  // ── Agents (worker profiles + ordered brain chains) ────────────────────

  async renderTeam() {
    const [agents, brains] = await Promise.all([this.api.get('/agents-config'), this.api.get('/brains')]);
    const optionList = Object.keys(brains).map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');

    // Every chain mutation persists immediately, then re-renders from server.
    const saveChain = async (name, agent) => { await this.api.put(`/agents-config/${encodeURIComponent(name)}`, agent); await this.renderTeam(); };

    const card = (name, a) => {
      const chips = (a.brains || []).map((b, i) => {
        const known = !!brains[b];
        return `<span class="chip" data-agent="${esc(name)}" data-brain="${esc(b)}" style="display:inline-flex;align-items:center;gap:5px;background:${known ? '#7C3AED18' : '#EF444418'};border:1px solid ${known ? '#7C3AED40' : '#EF444440'};color:${known ? '#7C3AED' : '#EF4444'};padding:2px 7px;border-radius:8px;font-size:0.78rem;margin:2px">
          <b style="opacity:.6">${i + 1}</b> ${esc(b)}${known ? '' : ' ⚠dead'}
          <a data-act="up" style="cursor:pointer">▲</a><a data-act="down" style="cursor:pointer">▼</a><a data-act="rm" style="cursor:pointer">✕</a>
        </span>`;
      }).join('') || '<span style="color:var(--text-muted);font-size:0.8rem">no brains — add one →</span>';
      return `<div class="card" style="margin-bottom:var(--space-md)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>${esc(name)}</strong>
          <button class="btn" data-act="del-agent" data-agent="${esc(name)}" style="font-size:0.75rem">Delete</button>
        </div>
        <input data-desc="${esc(name)}" value="${esc(a.description || '')}" placeholder="description"
          style="width:100%;margin:6px 0;padding:6px 8px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:8px;color:inherit;font:inherit;font-size:0.83rem">
        <div style="margin:6px 0">${chips}</div>
        <select data-addbrain="${esc(name)}" style="padding:5px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:8px;color:inherit;font-size:0.8rem"><option value="">+ add brain…</option>${optionList}</select>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px">Runs top → bottom; a failed task hands over to the next brain automatically.</div>
      </div>`;
    };

    this.contentEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-lg);gap:8px;flex-wrap:wrap">
        <p style="font-size:0.85rem;color:var(--text-secondary)">Each agent runs its brains in order; a failed task auto-hands-over to the next and files a report. Changes save instantly.</p>
        <div style="display:flex;gap:6px">
          <input id="new-agent-name" placeholder="new agent name" style="padding:6px 8px;background:var(--bg-tertiary);border:1px solid var(--bg-tertiary);border-radius:8px;color:inherit;font-size:0.8rem">
          <button class="btn btn-primary" id="add-agent" style="font-size:0.8rem">+ Agent</button>
        </div>
      </div>
      ${Object.entries(agents).map(([n, a]) => card(n, a)).join('') || '<div class="empty-state"><p>No agents configured.</p></div>'}`;

    this.contentEl.querySelectorAll('.chip a').forEach(el => el.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip'); const name = chip.dataset.agent; const brain = chip.dataset.brain;
      const a = agents[name]; const arr = a.brains; const i = arr.indexOf(brain); const act = e.target.dataset.act;
      if (act === 'rm') arr.splice(i, 1);
      else if (act === 'up' && i > 0) { arr.splice(i, 1); arr.splice(i - 1, 0, brain); }
      else if (act === 'down' && i < arr.length - 1) { arr.splice(i, 1); arr.splice(i + 1, 0, brain); }
      else return;
      saveChain(name, a);
    }));
    this.contentEl.querySelectorAll('[data-addbrain]').forEach(sel => sel.addEventListener('change', (e) => {
      const name = e.target.dataset.addbrain; const b = e.target.value; if (!b) return;
      const a = agents[name]; if (!a.brains.includes(b)) a.brains.push(b);
      saveChain(name, a);
    }));
    this.contentEl.querySelectorAll('[data-desc]').forEach(inp => inp.addEventListener('change', (e) => {
      const name = e.target.dataset.desc; agents[name].description = e.target.value;
      this.api.put(`/agents-config/${encodeURIComponent(name)}`, agents[name]).then(() => this.toast('saved', name));
    }));
    this.contentEl.querySelectorAll('[data-act="del-agent"]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Delete agent "${b.dataset.agent}"?`)) return;
      await this.api.del(`/agents-config/${encodeURIComponent(b.dataset.agent)}`); await this.renderTeam();
    }));
    this.contentEl.querySelector('#add-agent')?.addEventListener('click', async () => {
      const name = this.contentEl.querySelector('#new-agent-name').value.trim(); if (!name) return;
      await this.api.put(`/agents-config/${encodeURIComponent(name)}`, { description: name, brains: [] }); await this.renderTeam();
    });
  }

  // ── Brains (model × platform × location registry) ──────────────────────

  async renderBrains() {
    const brains = await this.api.get('/brains');
    const row = (id, b) => `
      <div class="card" style="margin-bottom:var(--space-md)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>${esc(id)}</strong>
          ${badge(b.location, b.location === 'remote' ? '#EAB308' : '#22C55E')}
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
      ${Object.entries(brains).map(([id, b]) => row(id, b)).join('') || '<div class="empty-state"><p>No brains registered.</p></div>'}`;

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
