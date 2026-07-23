import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import type { Config } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// src/ and dist/ both sit one level under server/, so ../../ is the repo root
// (where config.json lives) from either runtime.
const rootDir = path.resolve(__dirname, '../../');

function expandHome(filepath: string): string {
  if (filepath.startsWith('~')) {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

function resolvePath(filepath: string): string {
  const expanded = expandHome(filepath);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(rootDir, expanded);
}

const defaultConfig: Config = {
  server: {
    port: 4200,
    host: '127.0.0.1',
    name: 'cowork-mcp',
    version: '1.0.0',
    apiKey: null,
    corsOrigin: '*'
  },
  paths: {
    agencyAgents: '../agency-agents',
    inbox: './inbox',
    reports: './reports',
    skills: './skills',
    status: './.status',
    decisions: './decisions'
  },
  platforms: {},
  services: {},
  inbox: {
    autoArchiveDays: 30,
    maxRetries: 3
  },
  orchestration: {
    enabled: false,
    maxConcurrent: 2,
    pollIntervalMs: 5000,
    taskTimeoutMs: 1800000,
    defaultRole: 'generalist',
    roles: {}
  }
};

export function loadConfig(): Config {
  const configPath = path.resolve(rootDir, 'config.json');
  let loadedConfig: Partial<Config> = {};

  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      loadedConfig = JSON.parse(fileContent);
    } catch (error) {
      console.error(`Error parsing config.json at ${configPath}:`, error);
    }
  } else {
    console.warn(`Config file not found at ${configPath}, using defaults.`);
  }

  const config: Config = {
    server: { ...defaultConfig.server, ...(loadedConfig.server || {}) },
    paths: { ...defaultConfig.paths, ...(loadedConfig.paths || {}) },
    platforms: loadedConfig.platforms || {},
    services: loadedConfig.services || {},
    inbox: { ...defaultConfig.inbox, ...(loadedConfig.inbox || {}) },
    orchestration: {
      ...defaultConfig.orchestration,
      ...(loadedConfig.orchestration || {}),
      roles: loadedConfig.orchestration?.roles || {}
    }
  };

  // COWORK_API_KEY env var overrides config (keeps the secret out of git)
  if (process.env.COWORK_API_KEY) {
    config.server.apiKey = process.env.COWORK_API_KEY;
  }
  if (process.env.COWORK_PORT) {
    const p = parseInt(process.env.COWORK_PORT, 10);
    if (Number.isFinite(p) && p > 0) config.server.port = p;
  }

  for (const key of Object.keys(config.paths) as (keyof Config['paths'])[]) {
    config.paths[key] = resolvePath(config.paths[key]);
  }

  return config;
}
