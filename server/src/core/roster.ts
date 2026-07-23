import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { globSync } from 'glob';
import type { AgentCard } from '../types.js';

export class Roster {
  private repoPath: string;
  private agents: AgentCard[] = [];
  private divisions: any = {};
  private loaded = false;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  public loadAll(): AgentCard[] {
    if (this.loaded) return this.agents;
    
    this.agents = [];
    if (!fs.existsSync(this.repoPath)) {
      console.warn(`Agency agents repo not found at ${this.repoPath}`);
      this.loaded = true;
      return [];
    }

    const divisionsPath = path.join(this.repoPath, 'divisions.json');
    if (fs.existsSync(divisionsPath)) {
      try {
        this.divisions = JSON.parse(fs.readFileSync(divisionsPath, 'utf-8'));
      } catch (e) {
        console.error('Failed to parse divisions.json', e);
      }
    }

    // Agents live in division subdirectories; top-level *.md are repo docs
    // (README, SECURITY, CONTRIBUTING, …) and examples/ holds sample output.
    const agentFiles = globSync('*/**/*.md', {
      cwd: this.repoPath,
      ignore: ['docs/**', 'examples/**', 'scripts/**', '**/README.md']
    });
    
    for (const file of agentFiles) {
      const fullPath = path.join(this.repoPath, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = matter(content);
        
        const slug = path.basename(file, '.md');
        const division = path.dirname(file).split(path.sep)[0] || 'unknown';
        const divisionMeta = this.divisions[division] || {};
        
        const agent: AgentCard = {
          slug: parsed.data.slug || slug,
          name: parsed.data.name || slug,
          description: parsed.data.description || '',
          emoji: parsed.data.emoji,
          color: parsed.data.color,
          vibe: parsed.data.vibe,
          division: division,
          divisionLabel: divisionMeta.label || division,
          divisionIcon: divisionMeta.icon,
          sourcePath: fullPath,
          platforms: parsed.data.platforms || []
        };
        
        this.agents.push(agent);
      } catch (e) {
        console.error(`Failed to parse agent file: ${file}`, e);
      }
    }

    this.loaded = true;
    return this.agents;
  }

  public search(query: string): AgentCard[] {
    this.loadAll();
    const lowerQuery = query.toLowerCase();
    return this.agents.filter(a => 
      a.name.toLowerCase().includes(lowerQuery) || 
      a.description.toLowerCase().includes(lowerQuery)
    );
  }

  public getByDivision(division: string): AgentCard[] {
    this.loadAll();
    return this.agents.filter(a => a.division === division);
  }

  public getDivisions(): any {
    this.loadAll();
    return this.divisions;
  }

  public reload(): void {
    this.loaded = false;
    this.loadAll();
  }
}
