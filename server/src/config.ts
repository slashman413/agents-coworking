import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import type { Config } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
    port: 3000,
    host: '127.0.0.1',
    corsOrigin: '*'
  },
  paths: {
    agencyAgentsRepo: './agency-agents',
    inboxDir: './inbox',
    reportsDir: './reports',
    statusDir: './.status'
  },
  platforms: [],
  services: []
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
    platforms: loadedConfig.platforms || [],
    services: loadedConfig.services || []
  };

  config.paths.agencyAgentsRepo = resolvePath(config.paths.agencyAgentsRepo);
  config.paths.inboxDir = resolvePath(config.paths.inboxDir);
  config.paths.reportsDir = resolvePath(config.paths.reportsDir);
  config.paths.statusDir = resolvePath(config.paths.statusDir);

  return config;
}
