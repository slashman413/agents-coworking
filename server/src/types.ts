export interface PlatformConfig {
  id: string;
  type: string;
  enabled: boolean;
  apiKey?: string;
  metadata?: Record<string, any>;
}

export interface ServiceConfig {
  id: string;
  type: string;
  enabled: boolean;
  url?: string;
  apiKey?: string;
}

export interface Config {
  server: {
    port: number;
    host: string;
    corsOrigin: string;
  };
  paths: {
    agencyAgentsRepo: string;
    inboxDir: string;
    reportsDir: string;
    statusDir: string;
  };
  platforms: PlatformConfig[];
  services: ServiceConfig[];
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
