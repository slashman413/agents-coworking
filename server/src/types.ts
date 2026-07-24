export interface PlatformConfig {
  enabled: boolean;
  agentsDir?: string;
  skillsDir?: string;
  color?: string;
}

export interface ServiceConfig {
  url: string;
  enabled: boolean;
}

export interface RoleConfig {
  /** claude/hermes/agy spawn an LLM CLI; script runs an arbitrary command
   *  (e.g. a media pipeline) with the task passed via COWORK_TASK_* env vars. */
  exec: 'claude' | 'hermes' | 'agy' | 'script';
  model: string;
  /** argv for exec:script roles (the command + args to run). */
  command?: string[];
  /** Role to hand the task to after a failed attempt (see Dispatcher handover). */
  fallback?: string;
}

export interface ClassifierConfig {
  /** When true, the dispatcher uses an LLM to assign a role to any pending
   *  task that has no role/tag/skill match, so free-text tasks never stall. */
  enabled: boolean;
  exec: 'claude' | 'hermes' | 'agy';
  model: string;
  /** Role used when the LLM's answer doesn't match a configured role. */
  fallbackRole: string;
  /** Per-classification wall-clock budget (ms). */
  timeoutMs: number;
}

export interface OrchestrationConfig {
  enabled: boolean;
  maxConcurrent: number;
  pollIntervalMs: number;
  taskTimeoutMs: number;
  defaultRole: string;
  roles: Record<string, RoleConfig>;
  /** LLM classifier that assigns roles to roleless tasks. */
  classifier?: ClassifierConfig;
  /** Reclaim in-progress tasks whose claiming agent is gone after this many
   *  ms (0 disables). Rescues work orphaned by a crashed/exited agent. */
  staleClaimMs?: number;
}

export interface Config {
  server: {
    port: number;
    host: string;
    name: string;
    version: string;
    apiKey: string | null;
    corsOrigin: string;
  };
  paths: {
    agencyAgents: string;
    inbox: string;
    reports: string;
    skills: string;
    status: string;
    decisions: string;
  };
  platforms: Record<string, PlatformConfig>;
  services: Record<string, ServiceConfig>;
  inbox: {
    autoArchiveDays: number;
    maxRetries: number;
  };
  orchestration: OrchestrationConfig;
}

export interface AgentCard {
  slug: string;
  name: string;
  description: string;
  emoji?: string;
  color?: string;
  vibe?: string;
  division?: string;
  divisionLabel?: string;
  divisionIcon?: string;
  sourcePath: string;
  platforms?: string[];
}

export interface ActiveAgent {
  id: string;
  platform: string;
  agentName: string;
  sessionId?: string;
  capabilities?: string[];
  currentTask?: string;
  status: 'idle' | 'working' | 'blocked';
  registeredAt: string;
  lastHeartbeat: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  from: {
    platform: string;
    agent: string;
  };
  to: {
    platform?: string;
    agent?: string;
  };
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'pending' | 'claimed' | 'in-progress' | 'done' | 'rejected';
  skill?: string;
  context?: Record<string, any>;
  tags?: string[];
  createdAt: string;
  claimedAt?: string;
  claimedBy?: string;
  completedAt?: string;
  result?: string;
  reportPath?: string;
}

export interface Report {
  id: string;
  title: string;
  type: string;
  author: {
    platform: string;
    agent: string;
  };
  createdAt: string;
  status: 'draft' | 'review' | 'final';
  tags?: string[];
  filePath: string;
  summary?: string;
}

export interface DashboardData {
  activeAgents: number;
  inboxSummary: {
    pending: number;
    inProgress: number;
    completed: number;
  };
  recentReports: number;
  platformStatus: Record<string, boolean>;
  serviceStatus: Record<string, boolean>;
  rosterCount: number;
  uptime: number;
}

export interface CoworkEventPayloads {
  agentRegistered: { agent: ActiveAgent };
  taskCreated: { task: Task };
  taskClaimed: { task: Task; agentId: string };
  taskCompleted: { task: Task };
  reportFiled: { report: Report };
  heartbeat: { agentId: string; status: string; currentTask?: string };
}

export type CoworkEventType = keyof CoworkEventPayloads;

export interface CoworkEvent<T extends CoworkEventType> {
  type: T;
  payload: CoworkEventPayloads[T];
  timestamp: string;
}
