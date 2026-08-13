import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const ADAPTER = path.join(ROOT, 'bin', 'gstack-opencode-run');
const tempDirs: string[] = [];

type AdapterResult = {
  status: string;
  session_id?: string;
  text?: string;
  reasoning?: string;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache_read: number;
    cache_write: number;
  };
  cost?: number;
  provider?: string;
  model?: string;
  finish?: string;
  error?: string;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeHarness(scenario = 'ok') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-opencode-test-'));
  tempDirs.push(dir);
  const binDir = path.join(dir, 'bin');
  const stateDir = path.join(dir, 'state');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(binDir);
  fs.mkdirSync(stateDir);
  fs.mkdirSync(repo);
  const promptFile = path.join(dir, 'prompt.txt');
  fs.writeFileSync(promptFile, 'Inspect only and report findings.');

  const fake = path.join(binDir, 'opencode');
  fs.writeFileSync(fake, `#!/usr/bin/env bash
set -eu
cmd="\${1:-}"
shift || true
case "$cmd" in
  run)
    printf '%s\\n' "$@" > "$FAKE_OPENCODE_STATE/args"
    title=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--title" ]; then title="$2"; break; fi
      shift
    done
    [ -z "$title" ] || printf '%s' "$title" > "$FAKE_OPENCODE_STATE/title"
    case "$FAKE_OPENCODE_SCENARIO" in
      timeout) exec sleep 5 ;;
      auth) echo 'authentication required for provider token=planted-secret' >&2; exit 1 ;;
      nonzero) echo 'unexpected provider failure' >&2; exit 7 ;;
    esac
    ;;
  session)
    [ "\${1:-}" = "list" ] || exit 2
    echo 'Session ID                      Title                             Updated'
    if [ "$FAKE_OPENCODE_SCENARIO" != "missing-session" ] && [ -f "$FAKE_OPENCODE_STATE/title" ]; then
      printf 'ses_test_new  %s  now\\n' "$(cat "$FAKE_OPENCODE_STATE/title")"
    fi
    ;;
  export)
    if [ "$FAKE_OPENCODE_SCENARIO" = "malformed" ]; then
      echo 'Exporting session: ses_test_new'
      echo 'not json'
      exit 0
    fi
    summary='{"additions":0,"deletions":0,"files":0}'
    [ "$FAKE_OPENCODE_SCENARIO" != "write" ] || summary='{"additions":1,"deletions":0,"files":1}'
    parts='[{"type":"reasoning","text":"Independent reasoning"},{"type":"text","text":"Independent finding"}]'
    [ "$FAKE_OPENCODE_SCENARIO" != "empty" ] || parts='[{"type":"step-finish","reason":"stop"}]'
    echo 'Exporting session: ses_test_new'
    printf '{"info":{"id":"ses_test_new","summary":%s,"cost":0.0123,"tokens":{"input":120,"output":30,"reasoning":10,"cache":{"read":5,"write":0}},"model":{"providerID":"openai","id":"gpt-5.4"}},"messages":[{"info":{"role":"assistant","finish":"stop","time":{"completed":2}},"parts":%s}]}\\n' "$summary" "$parts"
    ;;
  auth)
    echo 'OpenCode Zen api'
    ;;
  *) exit 2 ;;
esac
`);
  fs.chmodSync(fake, 0o755);

  return { dir, binDir, stateDir, repo, promptFile, scenario };
}

function runAdapter(
  harness: ReturnType<typeof makeHarness>,
  extraArgs: string[] = [],
  timeoutMs = 10_000,
): { exitCode: number; result: AdapterResult; stdout: string; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: [
      process.execPath,
      ADAPTER,
      '--mode', 'review',
      '--prompt-file', harness.promptFile,
      '--repo', harness.repo,
      '--timeout', harness.scenario === 'timeout' ? '1' : '30',
      ...extraArgs,
    ],
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${harness.binDir}:${process.env.PATH ?? ''}`,
      GSTACK_OPENCODE_BIN: path.join(harness.binDir, 'opencode'),
      FAKE_OPENCODE_STATE: harness.stateDir,
      FAKE_OPENCODE_SCENARIO: harness.scenario,
    },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs,
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  const lastLine = stdout.trim().split('\n').at(-1) ?? '';
  return {
    exitCode: proc.exitCode,
    result: JSON.parse(lastLine) as AdapterResult,
    stdout,
    stderr,
  };
}

describe('gstack-opencode-run', () => {
  test('runs a new read-only plan-agent session and normalizes its export', () => {
    const harness = makeHarness();
    const { exitCode, result } = runAdapter(harness, [
      '--model', 'openai/gpt-5.4',
      '--variant', 'high',
      '--thinking',
    ]);

    expect(exitCode).toBe(0);
    expect(result).toEqual({
      status: 'ok',
      session_id: 'ses_test_new',
      text: 'Independent finding',
      reasoning: 'Independent reasoning',
      tokens: { input: 120, output: 30, reasoning: 10, cache_read: 5, cache_write: 0 },
      cost: 0.0123,
      provider: 'openai',
      model: 'gpt-5.4',
      finish: 'stop',
    });

    const args = fs.readFileSync(path.join(harness.stateDir, 'args'), 'utf8').split('\n');
    expect(args).toContain('--agent');
    expect(args).toContain('plan');
    expect(args).toContain('--dir');
    expect(args).toContain(harness.repo);
    expect(args).toContain('--model');
    expect(args).toContain('openai/gpt-5.4');
    expect(args).toContain('--variant');
    expect(args).toContain('high');
    expect(args).toContain('--thinking');
    expect(args).not.toContain('--auto');
  });

  test('resumes an explicit session without creating a titled session', () => {
    const harness = makeHarness();
    const { result } = runAdapter(harness, ['--session', 'ses_existing']);
    expect(result.status).toBe('ok');
    expect(result.session_id).toBe('ses_test_new');
    const args = fs.readFileSync(path.join(harness.stateDir, 'args'), 'utf8').split('\n');
    expect(args).toContain('--session');
    expect(args).toContain('ses_existing');
    expect(args).not.toContain('--title');
  });

  for (const [scenario, status] of [
    ['timeout', 'timeout'],
    ['auth', 'not_configured'],
    ['nonzero', 'nonzero_exit'],
    ['missing-session', 'session_not_found'],
    ['malformed', 'invalid_export'],
    ['empty', 'empty_response'],
    ['write', 'write_detected'],
  ] as const) {
    test(`returns ${status} for ${scenario}`, () => {
      const harness = makeHarness(scenario);
      const { exitCode, result } = runAdapter(harness);
      expect(exitCode).not.toBe(0);
      expect(result.status).toBe(status);
      if (scenario === 'auth') expect(result.error).not.toContain('planted-secret');
      expect((result.error ?? '').length).toBeLessThanOrEqual(1000);
    });
  }

  test('returns not_installed when opencode is absent from PATH', () => {
    const harness = makeHarness();
    fs.rmSync(path.join(harness.binDir, 'opencode'));
    const { result } = runAdapter(harness);
    expect(result.status).toBe('not_installed');
  });
});
