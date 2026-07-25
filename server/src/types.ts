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
  exec: 'claude' | 'hermes' | 'agy' | 'script' | 'codex' | 'ollama';
  model: string;
  /** argv for exec:script roles (the command + args to run). */
  command?: string[];
  /** Delegate execution to a named brain (see BrainConfig) instead of the
   *  inline exec/model above. */
  brain?: string;
  /** Role to hand the task to after a failed attempt (see Dispatcher handover). */
  fallback?: string;
}

/**
 * A "brain" is a concrete execution identity — a specific model on a specific
 * platform at a specific location. Aliased (e.g. `local-ha-qwen35b`,
 * `remote-aicodegen-cc-fable`) so the orchestrator can target one directly via
 * a task's `context.brain`. LOCAL brains are spawned by the dispatcher; REMOTE
 * brains are left in the inbox for that remote MCP client to claim itself.
 */
export interface BrainConfig {
  /** Human description shown to the orchestrator so it can choose. */
  description: string;
  location: 'local' | 'remote';
  /** local brains: how to run them. */
  exec?: 'claude' | 'hermes' | 'agy' | 'script' | 'codex' | 'ollama';
  model?: string;
  command?: string[];
  /** remote brains: which machine/client (informational + claim-routing hint). */
  host?: string;
  /** Brain alias to hand off to after a failed attempt. */
  fallback?: string;
  /** True when auto-registered by a connecting MCP client (vs configured by
   *  hand). Persisted, and only removed via explicit deregister or the UI —
   *  never on heartbeat timeout. */
  dynamic?: boolean;
  /** Agent id of the client that registered this brain (for explicit deregister). */
  registeredBy?: string;
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

/**
 * An agent is a named worker with a capability + an ORDERED list of brains.
 * brains[0] is tried first; on failure the dispatcher hands the task to
 * brains[1], then brains[2], … (the list is the fallback chain). Editable live
 * from the dashboard's Agents view.
 */
export interface AgentConfig {
  description: string;
  brains: string[];
}

export interface OrchestrationConfig {
  enabled: boolean;
  maxConcurrent: number;
  pollIntervalMs: number;
  taskTimeoutMs: number;
  defaultRole: string;
  /** The global default brain fallback chain (ordered brain ids). Used by any
   *  roster-agent task whose division has no override. Drag-sortable in the UI. */
  defaultChain?: string[];
  /** Per-division overrides of the default chain (division id -> brain ids). */
  divisionChains?: Record<string, string[]>;
  /** Special (non-roster) executor agents: orchestrator (router/decomposer),
   *  video (LTX pipeline), generalist (fallback). Each has its own brain chain. */
  agents: Record<string, AgentConfig>;
  /** Grace period before a task on a REMOTE brain in a chain auto-advances to
   *  the next brain if no client has claimed it (ms; 0 disables). */
  remoteGraceMs?: number;
  /** Legacy role map (pre-agents). Read only if an agent of the same name is
   *  absent; kept so old configs keep working. */
  roles?: Record<string, RoleConfig>;
  /** Named execution identities (model×platform×location) the orchestrator can
   *  target via a task's context.brain. */
  brains?: Record<string, BrainConfig>;
  /** LLM classifier that assigns roles to roleless tasks. */
  classifier?: ClassifierConfig;
  /** Reclaim in-progress tasks whose claiming agent is gone after this many
   *  ms (0 disables). Rescues work orphaned by a crashed/exited agent. */
  staleClaimMs?: number;
  /** Safety bound on an orchestrated workflow run: the max number of steps the
   *  orchestrator may dispatch before the run is force-finished (prevents a
   *  runaway decision loop). Default 12. */
  maxWorkflowSteps?: number;
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
    status: string;
    decisions: string;
    /** Dir of declarative workflow templates (workflows/*.json). */
    workflows: string;
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
  /** Filenames collected from the task's artifacts dir (downloadable when done). */
  artifacts?: string[];
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

/**
 * One node of a declarative workflow: a task template. `key` is a stable,
 * template-local id used to wire `dependsOn` edges (resolved to real task ids at
 * expansion time). Exactly the fields a task needs, minus the runtime plumbing.
 */
export interface WorkflowStep {
  /** Unique-within-the-workflow node id. Referenced by other steps' dependsOn. */
  key: string;
  /** Task title. `{{param}}` placeholders are filled from run params. */
  title?: string;
  /** Task description (the standalone brief the executing agent sees). */
  description?: string;
  /** Pin a specific roster/special agent (context.agent). Omit to let the router pick. */
  agent?: string;
  /** Pin a division (context.division) so the router only chooses within it. */
  division?: string;
  /** Pin an exact brain (context.brain). */
  brain?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  /** Step keys (NOT task ids) this step waits for — the DAG edges. */
  dependsOn?: string[];
}

/**
 * A reusable, version-controlled pipeline. Loaded from workflows/<id>.json.
 *
 * Two execution modes:
 *   - `dag` (default): the steps form a static DAG wired by `dependsOn`. The whole
 *     graph is expanded into inbox tasks up front and the dispatcher walks it in
 *     dependency order. Deterministic — same template + params → same shape.
 *   - `orchestrated`: the steps are a LIBRARY of candidate moves. Nothing is
 *     expanded up front; instead, after each step finishes, the orchestrator brain
 *     reads the goal + results so far and DECIDES which step to run next (or that
 *     the goal is met). Adaptive — the path taken depends on what came back.
 */
export interface WorkflowDef {
  id: string;
  /** Human label + one-liner shown in the UI. */
  name?: string;
  description?: string;
  /** `dag` (static, pre-expanded) or `orchestrated` (adaptive). Default `dag`. */
  mode?: 'dag' | 'orchestrated';
  /** Orchestrated mode only: the objective the orchestrator drives toward when
   *  deciding the next step. `{{param}}` placeholders are filled from run params. */
  goal?: string;
  /** Named params required at run time; referenced as {{name}} in steps/goal. */
  params?: string[];
  steps: WorkflowStep[];
}

/**
 * One orchestrator decision in an adaptive run: the step it chose to run next
 * (or `null` = the run is complete), the task that decision created, and a short
 * rationale pulled from the orchestrator's reply — the audit trail the UI renders
 * as a decision log so the adaptive path is fully traceable.
 */
export interface WorkflowDecision {
  stepKey: string | null;
  reason?: string;
  taskId?: string;
  decidedAt: string;
}

/**
 * Persistent state for an ORCHESTRATED run. DAG runs need no record (they are
 * reconstructed from task context), but an adaptive run's goal and decision
 * history live nowhere else, so they are written to workflow-runs/<runId>.json.
 */
export interface WorkflowRunRecord {
  runId: string;
  workflowId: string;
  mode: 'orchestrated';
  goal?: string;
  params: Record<string, string>;
  status: 'running' | 'done' | 'failed';
  history: WorkflowDecision[];
  createdAt: string;
  updatedAt: string;
}

/** A live/finished run: the tasks one expansion produced, grouped for the UI. */
export interface WorkflowRun {
  runId: string;
  workflowId: string;
  createdAt: string;
  tasks: Task[];
  status: 'running' | 'done' | 'failed';
  /** `orchestrated` runs carry their mode, goal, and decision log; DAG runs omit these. */
  mode?: 'dag' | 'orchestrated';
  goal?: string;
  history?: WorkflowDecision[];
}

export type CoworkEventType = keyof CoworkEventPayloads;

export interface CoworkEvent<T extends CoworkEventType> {
  type: T;
  payload: CoworkEventPayloads[T];
  timestamp: string;
}
