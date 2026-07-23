/* Cowork MCP Dashboard — data-driven views over the REST API + SSE stream */

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
  return `<span class="badge" style="background:${color}22; color:${color}; border:1px solid ${color}55; padding:2px 8px; border-radius:99px; font-size:0.75rem">${esc(text)}</span>`;
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

    this.init();
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
    // heartbeats are noisy — only re-render for real state changes
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
      reports: 'Reports', roster: 'Agent Roster', config: 'Configuration'
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
        case 'roster': await this.renderRoster(); break;
        case 'config': await this.renderConfig(); break;
        default: await this.renderDashboard(); break;
      }
    } catch (error) {
      this.contentEl.innerHTML = `<div class="empty-state"><h3>Error loading view</h3><p>${esc(error.message)}</p></div>`;
    }
  }

  // ── Dashboard ──────────────────────────────────────────────────────────

  async renderDashboard() {
    const [status, dispatcher] = await Promise.all([
      this.api.get('/status'),
      this.api.get('/dispatcher').catch(() => null)
    ]);
    const stat = (icon, value, label) => `
      <div class="card stat-card">
        <div class="stat-icon">${icon}</div>
        <div>
          <div class="stat-value">${value}</div>
          <div class="stat-label">${label}</div>
        </div>
      </div>`;
    const dot = (ok) => `<span class="dot ${ok ? 'connected' : 'disconnected'}" style="display:inline-block; margin-left:8px"></span>`;

    const platforms = Object.entries(status.platformStatus || {})
      .map(([id, on]) => `<p style="margin:6px 0">${esc(id)} ${dot(on)}</p>`).join('') || '<p>-</p>';
    const services = Object.entries(status.serviceStatus || {})
      .map(([id, on]) => `<p style="margin:6px 0">${esc(id)} ${dot(on)}</p>`).join('') || '<p>-</p>';

    const roles = dispatcher
      ? Object.entries(dispatcher.roles).map(([r, m]) =>
          `<tr><td style="padding:3px 12px 3px 0">${badge(r, '#7C3AED')}</td><td style="color:var(--text-secondary); font-size:0.85rem">${esc(m)}</td></tr>`).join('')
      : '';
    const running = dispatcher?.running?.length
      ? dispatcher.running.map(r => `<p style="margin:4px 0">${badge(r.role, '#22C55E')} <span style="font-size:0.85rem">${esc(r.taskId.slice(0, 8))} · ${timeAgo(new Date(r.startedAt).toISOString())}</span></p>`).join('')
      : '<p style="color:var(--text-secondary)">idle</p>';

    const activity = this.activity.length
      ? this.activity.slice(0, 12).map(e =>
          `<p style="margin:6px 0; font-size:0.85rem">${badge(e.type, '#0EA5E9')} ${esc(this.describeEvent(e))} <span style="color:var(--text-secondary)">${timeAgo(e.timestamp)}</span></p>`).join('')
      : '<p style="color:var(--text-secondary)">Waiting for events…</p>';

    this.contentEl.innerHTML = `
      <div class="grid-4" style="margin-bottom: var(--space-xl)">
        ${stat('🤖', status.activeAgents, 'Active Agents')}
        ${stat('📬', status.inboxSummary.pending + status.inboxSummary.inProgress,
               `Open Tasks (${status.inboxSummary.completed} done)`)}
        ${stat('📄', status.recentReports, 'Recent Reports')}
        ${stat('👥', status.rosterCount, 'Agent Roster')}
      </div>
      <div class="grid-2" style="margin-bottom: var(--space-xl)">
        <div class="card">
          <h3>⚡ Dispatcher ${dispatcher?.enabled ? badge('enabled', '#22C55E') : badge('disabled', '#EF4444')}</h3>
          <div style="margin-top: var(--space-md)"><h4 style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:6px">RUNNING NOW</h4>${running}</div>
          <div style="margin-top: var(--space-md)"><h4 style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:6px">ROLE → MODEL</h4>
            <table>${roles}</table>
          </div>
        </div>
        <div class="card">
          <h3>📡 Live Activity</h3>
          <div style="margin-top: var(--space-md); max-height:340px; overflow-y:auto">${activity}</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card"><h3>Platforms</h3><div style="margin-top: var(--space-md)">${platforms}</div></div>
        <div class="card"><h3>Services</h3><div style="margin-top: var(--space-md)">${services}</div></div>
      </div>`;
  }

  // ── Active Agents ──────────────────────────────────────────────────────

  async renderAgents() {
    const agents = await this.api.get('/agents');
    if (!agents.length) {
      this.contentEl.innerHTML = `<div class="empty-state"><div style="font-size:3rem; margin-bottom:1rem">🤖</div>
        <h3>No agents currently active</h3><p>Agents register when they connect via MCP.</p></div>`;
      return;
    }
    this.contentEl.innerHTML = `<div class="grid-3">` + agents.map(a => `
      <div class="card agent-card">
        <div class="agent-header">
          <span class="agent-title">${esc(a.agentName)}</span>
          ${badge(a.status, STATUS_COLORS[a.status] || '#94A3B8')}
        </div>
        <p style="margin:6px 0">${badge(a.platform, '#D97757')} <span style="font-size:0.8rem; color:var(--text-secondary)">${esc((a.id || '').slice(0, 8))}</span></p>
        ${a.currentTask ? `<p class="agent-task" style="font-size:0.85rem">📌 ${esc(a.currentTask)}</p>` : ''}
        ${a.capabilities?.length ? `<p style="font-size:0.8rem; color:var(--text-secondary); margin-top:6px">${a.capabilities.map(c => esc(c)).join(' · ')}</p>` : ''}
        <div class="agent-footer" style="margin-top:8px; font-size:0.8rem; color:var(--text-secondary)">
          ♥ ${timeAgo(a.lastHeartbeat)} · joined ${timeAgo(a.registeredAt)}
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
      return `<button class="btn pill" data-filter="${f}" style="${active ? 'background:var(--bg-tertiary)' : ''}">${label}</button>`;
    }).join(' ');

    const rows = tasks.length ? tasks.map(t => {
      const role = t.context?.role || (t.tags || [])[0] || '';
      return `
      <div class="card" style="margin-bottom: var(--space-md); cursor:pointer" data-task="${esc(t.id)}">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap">
          <div>
            ${badge(t.status, STATUS_COLORS[t.status] || '#94A3B8')}
            ${role ? badge(role, '#7C3AED') : ''}
            <strong style="margin-left:6px">${esc(t.title)}</strong>
          </div>
          <span style="font-size:0.8rem; color:var(--text-secondary)">${esc(t.from?.platform || '?')}/${esc(t.from?.agent || '?')} · ${timeAgo(t.createdAt)}</span>
        </div>
        <div class="task-detail" style="display:none; margin-top: var(--space-md)">
          <h4 style="font-size:0.8rem; color:var(--text-secondary)">DESCRIPTION</h4>
          <pre style="white-space:pre-wrap; font-size:0.85rem; margin:6px 0 12px">${esc(t.description)}</pre>
          ${t.result ? `<h4 style="font-size:0.8rem; color:var(--text-secondary)">RESULT</h4>
          <pre style="white-space:pre-wrap; font-size:0.85rem; margin:6px 0; max-height:400px; overflow-y:auto; background:var(--bg-tertiary); padding:10px; border-radius:8px">${esc(t.result)}</pre>` : ''}
          ${t.claimedBy ? `<p style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px">claimed by ${esc(t.claimedBy.slice(0, 8))}${t.completedAt ? ' · completed ' + timeAgo(t.completedAt) : ''}</p>` : ''}
        </div>
      </div>`;
    }).join('') : `<div class="empty-state"><p>No tasks${this.inboxFilter ? ` with status "${esc(this.inboxFilter)}"` : ''}.</p></div>`;

    this.contentEl.innerHTML = `
      <div style="margin-bottom: var(--space-lg)">${pills}</div>
      ${rows}`;

    this.contentEl.querySelectorAll('[data-filter]').forEach(b =>
      b.addEventListener('click', () => { this.inboxFilter = b.dataset.filter; this.renderInbox(); }));
    this.contentEl.querySelectorAll('[data-task]').forEach(card =>
      card.addEventListener('click', (e) => {
        if (e.target.closest('pre')) return; // allow text selection in output
        const d = card.querySelector('.task-detail');
        d.style.display = d.style.display === 'none' ? 'block' : 'none';
      }));
  }

  // ── Reports ────────────────────────────────────────────────────────────

  async renderReports() {
    const reports = await this.api.get('/reports?limit=100');
    if (!reports.length) {
      this.contentEl.innerHTML = `<div class="empty-state"><p>No reports filed yet.</p></div>`;
      return;
    }
    this.contentEl.innerHTML = reports.map(r => `
      <div class="card" style="margin-bottom: var(--space-md); cursor:pointer" data-report="${esc(r.id)}">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap">
          <div>${badge(r.type, '#0EA5E9')} ${badge(r.status, r.status === 'final' ? '#22C55E' : '#EAB308')}
            <strong style="margin-left:6px">${esc(r.title)}</strong></div>
          <span style="font-size:0.8rem; color:var(--text-secondary)">${esc(r.author?.platform || '?')}/${esc(r.author?.agent || '?')} · ${timeAgo(r.createdAt)}</span>
        </div>
        <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:6px">${esc(r.summary || '')}</p>
        <div class="report-body" style="display:none; margin-top: var(--space-md)"></div>
      </div>`).join('');

    this.contentEl.querySelectorAll('[data-report]').forEach(card =>
      card.addEventListener('click', async (e) => {
        if (e.target.closest('pre')) return;
        const body = card.querySelector('.report-body');
        if (body.style.display === 'none') {
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
      <input id="roster-search" placeholder="Search ${roster.length} agents…" style="width:100%; padding:10px 14px; margin-bottom: var(--space-lg); background:var(--bg-tertiary); border:1px solid var(--bg-tertiary); border-radius:10px; color:inherit; font:inherit">
      <div id="roster-list"></div>`;

    const listEl = this.contentEl.querySelector('#roster-list');
    const render = (filter) => {
      const f = (filter || '').toLowerCase();
      listEl.innerHTML = Object.entries(byDivision).map(([div, agents]) => {
        const hits = f ? agents.filter(a =>
          a.name.toLowerCase().includes(f) || (a.description || '').toLowerCase().includes(f)) : agents;
        if (!hits.length) return '';
        return `<h3 style="margin: var(--space-lg) 0 var(--space-md)">${esc(div)} <span style="color:var(--text-secondary); font-size:0.8rem">(${hits.length})</span></h3>
          <div class="grid-3">` + hits.map(a => `
          <div class="card agent-card">
            <div class="agent-header"><span class="agent-title">${a.emoji ? esc(a.emoji) + ' ' : ''}${esc(a.name)}</span></div>
            <p style="font-size:0.83rem; color:var(--text-secondary); margin-top:6px">${esc((a.description || '').slice(0, 140))}</p>
            ${a.vibe ? `<p style="font-size:0.8rem; font-style:italic; margin-top:6px">${esc(a.vibe)}</p>` : ''}
          </div>`).join('') + `</div>`;
      }).join('') || `<div class="empty-state"><p>No agents match.</p></div>`;
    };
    render('');
    this.contentEl.querySelector('#roster-search').addEventListener('input', (e) => render(e.target.value));
  }

  // ── Config ─────────────────────────────────────────────────────────────

  async renderConfig() {
    const config = await this.api.get('/config');
    this.contentEl.innerHTML = `
      <div class="card"><h3>Configuration <span style="font-size:0.8rem; color:var(--text-secondary)">(config.json — API key masked)</span></h3>
        <pre style="white-space:pre-wrap; font-size:0.83rem; margin-top: var(--space-md); max-height:70vh; overflow-y:auto">${esc(JSON.stringify(config, null, 2))}</pre>
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
