import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Config } from '../types.js';
import type { Store } from '../core/store.js';
import type { EventBus } from '../core/events.js';
import { registerBrain, removeBrainCascade } from '../config.js';

// Stateless streamable-HTTP pattern: build a fresh McpServer + transport per
// request. Sharing one McpServer across concurrent transports cross-wires
// responses (the SDK binds a server instance to a single transport).
// Sent to every client in the initialize response so a connecting agent LEARNS,
// from the handshake itself, how to declare the models it can run.
const SERVER_INSTRUCTIONS = [
  'Cowork multi-agent hub. To join as a worker and offer your models ("brains"),',
  'call register_agent ONCE and include a `brains` array — this is how you propagate',
  'your capabilities; the server auto-registers them (no config files needed):',
  '',
  '  register_agent({',
  '    platform: "claude" | "hermes" | "antigravity",',
  '    agent_name: "<short name for this machine>",',
  '    capabilities: ["<brain id>", ...],',
  '    brains: [',
  '      { id: "remote-<host>-cc-sonnet", location: "remote", exec: "claude", model: "claude-sonnet-5" },',
  '      { id: "remote-<host>-cc-opus",   location: "remote", exec: "claude", model: "claude-opus-4-8" },',
  '      { id: "remote-<host>-cc-default",location: "remote", exec: "claude", model: "" }  // account default',
  '    ]',
  '  })',
  '',
  'exec is one of: claude | hermes | agy | codex | ollama (model = an Ollama chat model) | script.',
  '',
  'Then poll list_inbox(status:"pending"), claim_task(task_id, agent_id) any task whose',
  'context.brain is one of your ids, run it locally, and complete_task(...). Call',
  'deregister_agent(agent_id) to remove your brains when you leave (they are NOT',
  'auto-removed on disconnect). A ready-made client + presets live in the repo:',
  'deploy/remote-brain-client.mjs and JOIN-AS-A-BRAIN.md.'
].join('\n');

function buildServer(config: Config, store: Store, eventBus: EventBus): McpServer {
  const server = new McpServer({
    name: config.server.name || 'Multi-Agent Cowork Server',
    version: config.server.version || '1.0.0'
  }, { instructions: SERVER_INSTRUCTIONS });

  // 1. register_agent — a connecting client may also DECLARE the brains it can
  //    run (clients-capability protocol). Each declared brain is auto-added to
  //    the registry, owned by this agent, and removed only via deregister_agent
  //    or the UI (never on heartbeat timeout).
  server.tool(
    'register_agent',
    'Register this client as a worker and OPTIONALLY declare the models it can run ' +
    'via `brains` (the clients-capability handshake). Each brain {id, location, exec, ' +
    'model, host} is auto-added to the server registry so the orchestrator can send it ' +
    'tasks; brains persist until deregister_agent. Returns the agent id (save it for ' +
    'heartbeat/claim) and registered_brains.',
    {
      platform: z.string(),
      agent_name: z.string(),
      session_id: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      current_task: z.string().optional(),
      brains: z.array(z.object({
        id: z.string(),
        location: z.enum(['local', 'remote']).default('remote'),
        exec: z.enum(['claude', 'hermes', 'agy', 'script', 'codex', 'ollama']).optional(),
        model: z.string().optional(),
        host: z.string().optional(),
        description: z.string().optional()
      })).optional()
    },
    async (args) => {
      try {
        const agent = store.registerAgent({
          platform: args.platform,
          agentName: args.agent_name,
          sessionId: args.session_id,
          capabilities: args.capabilities,
          currentTask: args.current_task
        });
        store.resetCounters(args.agent_name);   // fresh client → fresh counters
        const registered: string[] = [];
        for (const b of args.brains || []) {
          registerBrain(config, b.id, {
            description: b.description || `${b.id} (auto-registered by ${args.agent_name})`,
            location: b.location,
            ...(b.exec ? { exec: b.exec } : {}),
            ...(b.model !== undefined ? { model: b.model } : {}),
            ...(b.host ? { host: b.host } : {}),
            dynamic: true,
            registeredBy: agent.id
          });
          registered.push(b.id);
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ...agent, registered_brains: registered }) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  // 1b. deregister_agent — remove the agent AND every brain it registered,
  //     scrubbing those brains from all agent chains.
  server.tool(
    'deregister_agent',
    'Remove this worker and every brain it registered (cascading them out of all ' +
    'agent chains). Call on clean shutdown; brains are NOT auto-removed on disconnect.',
    { agent_id: z.string() },
    async (args) => {
      try {
        const brains = config.orchestration.brains || {};
        const owned = Object.keys(brains).filter(id => brains[id].registeredBy === args.agent_id);
        let scrubbed = 0;
        for (const id of owned) scrubbed += removeBrainCascade(config, id);
        const removed = store.removeAgent(args.agent_id);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, agent_removed: removed, brains_removed: owned, agents_scrubbed: scrubbed }) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  // 2. heartbeat
  server.tool(
    'heartbeat',
    {
      agent_id: z.string(),
      current_task: z.string().optional(),
      status: z.enum(['idle', 'working', 'blocked']).optional()
    },
    async (args) => {
      try {
        const agent = store.updateHeartbeat({
          agentId: args.agent_id,
          currentTask: args.current_task,
          status: args.status
        });
        if (!agent) throw new Error('Agent not found');
        return { content: [{ type: 'text', text: JSON.stringify(agent) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  // 3. get_roster
  server.tool(
    'get_roster',
    {
      platform: z.string().optional(),
      category: z.string().optional(),
      search: z.string().optional(),
      active_only: z.boolean().optional()
    },
    async (args) => {
      try {
        let agents = store.getRoster({ search: args.search, division: args.category });
        if (args.platform) {
          agents = agents.filter(a => a.platforms?.includes(args.platform!));
        }
        return { content: [{ type: 'text', text: JSON.stringify(agents) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  // 4. create_task
  server.tool(
    'create_task',
    {
      title: z.string(),
      description: z.string(),
      from_platform: z.string(),
      from_agent: z.string(),
      to_platform: z.string().optional(),
      to_agent: z.string().optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
      skill: z.string().optional(),
      context: z.record(z.any()).optional(),
      tags: z.array(z.string()).optional(),
      // Human-in-the-loop: request questions/checklist a person answers from the
      // Inbox card before/while the task runs. Their answers reach the executor
      // via context.humanInput.
      interaction: z.object({
        prompt: z.string().optional(),
        fields: z.array(z.object({
          id: z.string(),
          label: z.string(),
          type: z.enum(['text', 'textarea', 'checkbox', 'select']).optional(),
          options: z.array(z.string()).optional(),
          required: z.boolean().optional(),
          placeholder: z.string().optional()
        }))
      }).optional()
    },
    async (args) => {
      try {
        const task = store.createTask({
          title: args.title,
          description: args.description,
          from: { platform: args.from_platform, agent: args.from_agent },
          to: { platform: args.to_platform, agent: args.to_agent },
          priority: args.priority as any,
          skill: args.skill,
          context: args.context,
          tags: args.tags,
          interaction: args.interaction as any
        });
        return { content: [{ type: 'text', text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  // 5. claim_task
  server.tool(
    'claim_task',
    {
      task_id: z.string(),
      agent_id: z.string()
    },
    async (args) => {
      try {
        const task = store.claimTask({ taskId: args.task_id, agentId: args.agent_id });
        if (!task) throw new Error('Task not found');
        return { content: [{ type: 'text', text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  // 6. complete_task
  server.tool(
    'complete_task',
    {
      task_id: z.string(),
      result: z.string().optional(),
      report_path: z.string().optional()
    },
    async (args) => {
      try {
        const task = await store.completeTask({ taskId: args.task_id, result: args.result, reportPath: args.report_path });
        if (!task) throw new Error('Task not found');
        return { content: [{ type: 'text', text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  // 7. list_inbox
  server.tool(
    'list_inbox',
    {
      status: z.enum(['pending', 'claimed', 'in-progress', 'done', 'rejected']).optional(),
      platform: z.string().optional(),
      agent: z.string().optional(),
      limit: z.number().default(20)
    },
    async (args) => {
      try {
        const tasks = store.listTasks({
          status: args.status,
          platform: args.platform,
          agent: args.agent,
          limit: args.limit
        });
        return { content: [{ type: 'text', text: JSON.stringify(tasks) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  // 8. file_report
  server.tool(
    'file_report',
    {
      title: z.string(),
      type: z.string(),
      author_platform: z.string(),
      author_agent: z.string(),
      content: z.string(),
      status: z.enum(['draft', 'review', 'final']).default('draft'),
      tags: z.array(z.string()).optional(),
      task_id: z.string().optional()
    },
    async (args) => {
      try {
        const report = store.fileReport({
          title: args.title,
          type: args.type,
          author_platform: args.author_platform,
          author_agent: args.author_agent,
          content: args.content,
          status: args.status,
          tags: args.tags,
          task_id: args.task_id
        });
        return { content: [{ type: 'text', text: JSON.stringify(report) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  // 9. list_reports
  server.tool(
    'list_reports',
    {
      type: z.string().optional(),
      platform: z.string().optional(),
      limit: z.number().default(20)
    },
    async (args) => {
      try {
        const reports = store.listReports({
          type: args.type,
          platform: args.platform,
          limit: args.limit
        });
        return { content: [{ type: 'text', text: JSON.stringify(reports) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  // 10. get_dashboard
  server.tool(
    'get_dashboard',
    {},
    async () => {
      try {
        const dashboard = store.getDashboard();
        return { content: [{ type: 'text', text: JSON.stringify(dashboard) }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
  );

  server.resource(
    'status',
    'cowork://status',
    async (uri) => {
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(store.getDashboard())
        }]
      };
    }
  );

  server.resource(
    'roster',
    'cowork://roster',
    async (uri) => {
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(store.getRoster())
        }]
      };
    }
  );

  return server;
}

export function createMcpServer(config: Config, store: Store, eventBus: EventBus) {
  const handleRequest = async (req: any, res: any) => {
    const server = buildServer(config, store, eventBus);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  const handleSSE = async (req: any, res: any) => {
    await handleRequest(req, res);
  };

  return { handleRequest, handleSSE };
}
