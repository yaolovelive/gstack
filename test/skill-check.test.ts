import { describe, expect, test } from 'bun:test';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');

describe('skill:check host-aware template coverage', () => {
  test('accepts skills skipped by the primary Claude host', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'run', 'scripts/skill-check.ts'],
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    expect(output).not.toContain('claude/SKILL.md                — generated file missing');
    expect(result.exitCode).toBe(0);
  });
});
