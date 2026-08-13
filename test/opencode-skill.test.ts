import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const TEMPLATE = path.join(ROOT, 'opencode', 'SKILL.md.tmpl');
const GENERATED = path.join(ROOT, 'opencode', 'SKILL.md');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

describe('/opencode outside-voice skill', () => {
  test('ships a generated skill from a template', () => {
    expect(fs.existsSync(TEMPLATE)).toBe(true);
    expect(fs.existsSync(GENERATED)).toBe(true);
    expect(read(GENERATED)).toContain('AUTO-GENERATED from SKILL.md.tmpl');
  });

  test('has strict frontmatter optimized for second-opinion discovery', () => {
    const template = read(TEMPLATE);
    const end = template.indexOf('\n---', 4);
    const frontmatter = Bun.YAML.parse(template.slice(4, end));
    expect(frontmatter.name).toBe('opencode');
    expect(frontmatter.description).toContain('OpenCode');
    expect(frontmatter.description).toContain('second-opinion');
    expect(frontmatter.description).toContain('review');
    expect(frontmatter.description).toContain('challenge');
    expect(frontmatter.description).toContain('consult');
  });

  test('defines full review, challenge, and resumable consult behavior', () => {
    const skill = read(TEMPLATE);
    expect(skill).toContain('## Review Mode');
    expect(skill).toContain('## Challenge Mode');
    expect(skill).toContain('## Consult Mode');
    expect(skill).toContain('.context/opencode-session-id');
    expect(skill).toContain('gstack-opencode-run');
    expect(skill).toContain('--model');
    expect(skill).toContain('--variant');
    expect(skill).toContain('--session');
    expect(skill).toContain('OPENCODE SAYS');
    expect(skill).toContain('Recommendation:');
  });

  test('preserves read-only and verbatim-output contracts', () => {
    const skill = read(TEMPLATE);
    expect(skill).toContain('read-only');
    expect(skill).toContain('full output verbatim');
    expect(skill).toContain('before synthesis');
    expect(skill).toContain('write_detected');
    expect(skill).toContain('not_installed');
    expect(skill).toContain('not_configured');
    expect(skill).toContain('timeout');
    expect(skill).toContain('session_not_found');
    expect(skill).toContain('invalid_export');
    expect(skill).toContain('empty_response');
  });

  test('generates for Codex but not recursively for OpenCode', () => {
    expect(fs.existsSync(path.join(ROOT, '.agents', 'skills', 'gstack-opencode', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, '.opencode', 'skills', 'gstack-opencode', 'SKILL.md'))).toBe(false);
  });
});
