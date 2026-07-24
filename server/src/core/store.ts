import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import { globSync } from 'glob';
import type { Config, ActiveAgent, Task, Report, DashboardData, AgentCard } from '../types.js';
import type { EventBus } from './events.js';
import { Roster } from './roster.js';

export class Store {
  private config: Config;
  private eventBus: EventBus;
  private roster: Roster;
  private activeAgents = new Map<string, ActiveAgent>();
  private startTime = Date.now();

  constructor(config: Config, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
    this.roster = new Roster(config.paths.agencyAgents);
  }

  public initialize(): void {
    const dirs = [
      this.config.paths.inbox,
      this.config.paths.reports,
      this.config.paths.status,
      this.config.paths.skills,
      this.config.paths.decisions
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.roster.loadAll();
    this.loadActiveAgents();
  }

  private loadActiveAgents(): void {
    const agentsFile = path.join(this.config.paths.status, 'agents.json');
    if (fs.existsSync(agentsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
        if (Array.isArray(data)) {
          for (const agent of data) {
            this.activeAgents.set(agent.id, agent);
          }
        }
      } catch (e) {
        console.error('Failed to load active agents', e);
      }
    }
  }

  private saveActiveAgents(): void {
    const agentsFile = path.join(this.config.paths.status, 'agents.json');
    const data = Array.from(this.activeAgents.values());
    fs.writeFileSync(agentsFile, JSON.stringify(data, null, 2));
  }

  public registerAgent(params: { platform: string; agentName: string; sessionId?: string; capabilities?: string[]; currentTask?: string }): ActiveAgent {
    const id = uuidv4();
    const now = new Date().toISOString();
    const agent: ActiveAgent = {
      id,
      platform: params.platform,
      agentName: params.agentName,
      sessionId: params.sessionId,
      capabilities: params.capabilities || [],
      currentTask: params.currentTask,
      status: 'idle',
      registeredAt: now,
      lastHeartbeat: now
    };
    
    this.activeAgents.set(id, agent);
    this.saveActiveAgents();
    this.eventBus.emitAgentRegistered(agent);
    
    return agent;
  }

  public updateHeartbeat(params: { agentId: string; status?: 'idle' | 'working' | 'blocked'; currentTask?: string }): ActiveAgent | null {
    const agent = this.activeAgents.get(params.agentId);
    if (!agent) return null;
    
    agent.lastHeartbeat = new Date().toISOString();
    if (params.status) agent.status = params.status;
    if (params.currentTask !== undefined) agent.currentTask = params.currentTask;
    
    this.saveActiveAgents();
    this.eventBus.emitHeartbeat(agent.id, agent.status, agent.currentTask);
    
    return agent;
  }

  public getActiveAgents(filters?: { platform?: string; status?: string }): ActiveAgent[] {
    let agents = Array.from(this.activeAgents.values());
    if (filters?.platform) {
      agents = agents.filter(a => a.platform === filters.platform);
    }
    if (filters?.status) {
      agents = agents.filter(a => a.status === filters.status);
    }
    return agents;
  }

  public removeAgent(id: string): boolean {
    const existed = this.activeAgents.delete(id);
    if (existed) this.saveActiveAgents();
    return existed;
  }

  public removeStaleAgents(timeoutMs: number): void {
    const now = Date.now();
    let changed = false;
    for (const [id, agent] of this.activeAgents.entries()) {
      if (now - new Date(agent.lastHeartbeat).getTime() > timeoutMs) {
        this.activeAgents.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.saveActiveAgents();
    }
  }

  public createTask(params: Omit<Task, 'id' | 'status' | 'createdAt'>): Task {
    const id = uuidv4();
    const task: Task = {
      ...params,
      id,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    
    const taskPath = path.join(this.config.paths.inbox, `${id}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    
    this.eventBus.emitTaskCreated(task);
    return task;
  }

  public claimTask(params: { taskId: string; agentId: string }): Task | null {
    const task = this.getTask(params.taskId);
    if (!task) return null;
    // Atomic compare-and-set: only a pending task can be claimed. The server is
    // single-process, so claimTask runs to completion without interleaving —
    // this makes concurrent claims (many remote clients on one brain) safe:
    // the first wins, the rest get null. Re-claim by the same agent is allowed.
    if (task.status !== 'pending' && task.claimedBy !== params.agentId) return null;

    task.status = 'in-progress';
    task.claimedAt = new Date().toISOString();
    task.claimedBy = params.agentId;
    
    const taskPath = path.join(this.config.paths.inbox, `${task.id}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    
    this.eventBus.emitTaskClaimed(task, params.agentId);
    return task;
  }

  public completeTask(params: { taskId: string; result?: string; reportPath?: string }): Task | null {
    const task = this.getTask(params.taskId);
    if (!task) return null;
    
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    if (params.result) task.result = params.result;
    if (params.reportPath) task.reportPath = params.reportPath;
    
    const taskPath = path.join(this.config.paths.inbox, `${task.id}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    
    this.eventBus.emitTaskCompleted(task);
    return task;
  }

  /** Persist arbitrary task mutations (handover, retries). */
  public saveTask(task: Task): void {
    const taskPath = path.join(this.config.paths.inbox, `${task.id}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
  }

  public getTask(id: string): Task | null {
    const taskPath = path.join(this.config.paths.inbox, `${id}.json`);
    if (fs.existsSync(taskPath)) {
      try {
        return JSON.parse(fs.readFileSync(taskPath, 'utf-8')) as Task;
      } catch (e) {
        console.error(`Failed to parse task ${id}`, e);
      }
    }
    return null;
  }

  public listTasks(filters?: { status?: string; platform?: string; agent?: string; limit?: number }): Task[] {
    const taskFiles = globSync('*.json', { cwd: this.config.paths.inbox });
    let tasks: Task[] = [];
    
    for (const file of taskFiles) {
      try {
        const fullPath = path.join(this.config.paths.inbox, file);
        const task = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as Task;
        tasks.push(task);
      } catch (e) {
        // ignore bad files
      }
    }
    
    // Sort by created desc
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    if (filters?.status) tasks = tasks.filter(t => t.status === filters.status);
    // Guard t.to / t.from — task files are plain JSON on disk and may be malformed
    if (filters?.platform) tasks = tasks.filter(t => t.to?.platform === filters.platform || (!t.to?.platform && t.from?.platform === filters.platform));
    if (filters?.agent) tasks = tasks.filter(t => t.to?.agent === filters.agent || t.claimedBy === filters.agent);
    
    if (filters?.limit && filters.limit > 0) {
      tasks = tasks.slice(0, filters.limit);
    }
    
    return tasks;
  }

  public fileReport(params: { title: string; type: string; author_platform: string; author_agent: string; content: string; status?: 'draft' | 'review' | 'final'; tags?: string[] }): Report {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    const frontmatter = {
      id,
      title: params.title,
      type: params.type,
      author: {
        platform: params.author_platform,
        agent: params.author_agent
      },
      createdAt: now,
      status: params.status || 'draft',
      tags: params.tags || []
    };
    
    // Serialize frontmatter separately and append the body verbatim.
    // matter.stringify(content, …) PARSES the content for an existing
    // frontmatter block first — agent output that happens to start with
    // `---` (but isn't valid YAML) threw YAMLException and lost the report.
    const fmBlock = matter.stringify('', frontmatter).trimEnd();
    const fileContent = `${fmBlock}\n\n${params.content}\n`;
    const fileName = `${id}.md`;
    const filePath = path.join(this.config.paths.reports, fileName);
    
    fs.writeFileSync(filePath, fileContent);
    
    const report: Report = {
      id,
      title: params.title,
      type: params.type,
      author: frontmatter.author,
      createdAt: now,
      status: frontmatter.status as any,
      tags: frontmatter.tags,
      filePath,
      summary: params.content.substring(0, 200) + (params.content.length > 200 ? '...' : '')
    };
    
    this.eventBus.emitReportFiled(report);
    return report;
  }

  public getReport(id: string): (Report & { content?: string }) | null {
    const filePath = path.join(this.config.paths.reports, `${id}.md`);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = matter(content);
        return {
          ...parsed.data,
          filePath,
          summary: parsed.content.substring(0, 200) + (parsed.content.length > 200 ? '...' : ''),
          content: parsed.content
        } as Report & { content: string };
      } catch (e) {
        console.error(`Failed to parse report ${id}`, e);
      }
    }
    return null;
  }

  public listReports(filters?: { type?: string; platform?: string; limit?: number }): Report[] {
    const reportFiles = globSync('*.md', { cwd: this.config.paths.reports });
    let reports: Report[] = [];
    
    for (const file of reportFiles) {
      try {
        const fullPath = path.join(this.config.paths.reports, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = matter(content);
        reports.push({
          ...parsed.data,
          filePath: fullPath,
          summary: parsed.content.substring(0, 200) + (parsed.content.length > 200 ? '...' : '')
        } as Report);
      } catch (e) {
        // ignore bad files
      }
    }
    
    reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    if (filters?.type) reports = reports.filter(r => r.type === filters.type);
    if (filters?.platform) reports = reports.filter(r => r.author?.platform === filters.platform);
    
    if (filters?.limit && filters.limit > 0) {
      reports = reports.slice(0, filters.limit);
    }
    
    return reports;
  }

  public getRoster(filters?: { search?: string; division?: string }): AgentCard[] {
    if (filters?.search) {
      return this.roster.search(filters.search);
    }
    if (filters?.division) {
      return this.roster.getByDivision(filters.division);
    }
    return this.roster.loadAll();
  }

  public getDivisions(): any {
    return this.roster.getDivisions();
  }

  public getDashboard(): DashboardData {
    const activeAgents = this.activeAgents.size;
    const tasks = this.listTasks();
    const pending = tasks.filter(t => t.status === 'pending').length;
    const inProgress = tasks.filter(t => t.status === 'in-progress' || t.status === 'claimed').length;
    const completed = tasks.filter(t => t.status === 'done').length;
    
    const recentReports = this.listReports({ limit: 5 }).length;
    
    const platformStatus: Record<string, boolean> = {};
    for (const [id, p] of Object.entries(this.config.platforms)) {
      platformStatus[id] = p.enabled;
    }

    const serviceStatus: Record<string, boolean> = {};
    for (const [id, s] of Object.entries(this.config.services)) {
      serviceStatus[id] = s.enabled;
    }
    
    return {
      activeAgents,
      inboxSummary: {
        pending,
        inProgress,
        completed
      },
      recentReports,
      platformStatus,
      serviceStatus,
      rosterCount: this.roster.loadAll().length,
      uptime: Math.floor((Date.now() - this.startTime) / 1000)
    };
  }
}
