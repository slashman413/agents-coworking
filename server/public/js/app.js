class App {
  constructor() {
    this.currentView = '';
    this.api = window.api;
    this.sse = null;
    
    this.contentEl = document.getElementById('content');
    this.viewTitleEl = document.getElementById('view-title');
    this.toastContainer = document.getElementById('toast-container');
    
    this.init();
  }

  init() {
    this.setupRouter();
    this.setupSidebar();
    this.setupSSE();
    this.navigate(); // Load initial view
  }

  setupRouter() {
    window.addEventListener('hashchange', () => this.navigate());
  }

  setupSidebar() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        // Active state handled by hashchange/navigate
      });
    });
  }

  setupSSE() {
    this.sse = new window.SSEClient('/api/events', {
      onStatusChange: (status) => this.updateConnectionStatus(status),
      onMessage: (data) => {
        this.handleSSEEvent(data);
      }
    });
    this.sse.connect();
  }

  updateConnectionStatus(status) {
    const el = document.getElementById('connection-status');
    const dot = el.querySelector('.dot');
    const text = el.querySelector('span');
    
    dot.className = `dot ${status}`;
    text.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  }

  handleSSEEvent(data) {
    const eventType = data.type || 'unknown';
    
    // Show toast
    this.showToast(
      `Event: ${eventType}`,
      JSON.stringify(data.payload || data).substring(0, 100) + '...',
      'info'
    );
    
    // Auto-refresh current view if relevant
    this.renderCurrentView();
  }

  showToast(title, message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    `;
    this.toastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideIn 0.3s ease-out reverse forwards';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  navigate() {
    const hash = window.location.hash.slice(1) || 'dashboard';
    this.currentView = hash;
    
    // Update sidebar
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === hash);
    });

    // Update title
    const titles = {
      dashboard: 'Dashboard',
      agents: 'Active Agents',
      inbox: 'Inbox Queue',
      reports: 'Reports',
      roster: 'Agent Roster',
      config: 'Configuration'
    };
    this.viewTitleEl.textContent = titles[hash] || 'Dashboard';
    
    this.renderCurrentView();
  }

  async renderCurrentView() {
    this.contentEl.innerHTML = '<div class="empty-state">Loading...</div>';
    
    try {
      switch (this.currentView) {
        case 'dashboard': await this.renderDashboard(); break;
        case 'agents': await this.renderAgents(); break;
        case 'inbox': await this.renderInbox(); break;
        case 'reports': await this.renderReports(); break;
        case 'roster': await this.renderRoster(); break;
        case 'config': await this.renderConfig(); break;
        default: await this.renderDashboard(); break;
      }
    } catch (error) {
      this.contentEl.innerHTML = `
        <div class="empty-state">
          <h3>Error loading view</h3>
          <p>${error.message}</p>
        </div>
      `;
    }
  }

  async renderDashboard() {
    this.contentEl.innerHTML = `
      <div class="grid-4" style="margin-bottom: var(--space-xl)">
        <div class="card stat-card">
          <div class="stat-icon">🤖</div>
          <div>
            <div class="stat-value">12</div>
            <div class="stat-label">Active Agents</div>
          </div>
        </div>
        <div class="card stat-card">
          <div class="stat-icon">📬</div>
          <div>
            <div class="stat-value">45</div>
            <div class="stat-label">Pending Tasks</div>
          </div>
        </div>
        <div class="card stat-card">
          <div class="stat-icon">📄</div>
          <div>
            <div class="stat-value">8</div>
            <div class="stat-label">Reports Filed</div>
          </div>
        </div>
        <div class="card stat-card">
          <div class="stat-icon">👥</div>
          <div>
            <div class="stat-value">254</div>
            <div class="stat-label">Total Roster</div>
          </div>
        </div>
      </div>
      
      <div class="grid-2">
        <div class="card">
          <h3>Platform Status</h3>
          <div style="margin-top: var(--space-md)">
            <p>Claude <span class="dot connected" style="display:inline-block"></span></p>
            <p>Antigravity <span class="dot connected" style="display:inline-block"></span></p>
          </div>
        </div>
        <div class="card">
          <h3>Recent Activity</h3>
          <p style="color:var(--text-secondary); margin-top:var(--space-md)">Waiting for events...</p>
        </div>
      </div>
    `;
  }

  async renderAgents() {
    this.contentEl.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 3rem; margin-bottom: 1rem;">🤖</div>
        <h3>No agents currently active</h3>
        <p>Agents register when they connect via MCP.</p>
      </div>
    `;
  }

  async renderInbox() {
    this.contentEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom: var(--space-lg)">
        <div>
          <button class="btn pill" style="background:var(--bg-tertiary)">All</button>
          <button class="btn pill">Pending</button>
          <button class="btn pill">Claimed</button>
          <button class="btn pill">Done</button>
        </div>
        <button class="btn btn-primary">Create Task</button>
      </div>
      <div class="empty-state">
        <p>Inbox is empty.</p>
      </div>
    `;
  }

  async renderReports() {
    this.contentEl.innerHTML = `
      <div class="empty-state">
        <p>No reports filed yet.</p>
      </div>
    `;
  }

  async renderRoster() {
    this.contentEl.innerHTML = `
      <div class="empty-state">
        <p>Agent Roster will be displayed here.</p>
      </div>
    `;
  }

  async renderConfig() {
    this.contentEl.innerHTML = `
      <div class="card">
        <h3>Configuration</h3>
        <p style="color:var(--text-secondary); margin-top:var(--space-md)">Loading config...</p>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
