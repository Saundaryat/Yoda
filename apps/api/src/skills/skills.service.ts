import { Injectable } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loadConfig } from '../config.js';

export interface Skill {
  name: string;
  description: string;
  /** Full SKILL.md, frontmatter included: exactly what gets copied into a run's Hermes home. */
  content: string;
}

/** The skill library: `<SKILLS_DIR>/<name>/SKILL.md`, in Hermes's own SKILL.md format. */
@Injectable()
export class SkillsService {
  private readonly dir = loadConfig().SKILLS_DIR;

  list(): Skill[] {
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.read(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): Skill | undefined {
    return this.list().find((skill) => skill.name === name);
  }

  private read(folder: string): Skill {
    const content = readFileSync(join(this.dir, folder, 'SKILL.md'), 'utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? '';
    const meta = (parse(frontmatter) ?? {}) as { name?: string; description?: string };
    return { name: meta.name ?? folder, description: meta.description ?? '', content };
  }
}
