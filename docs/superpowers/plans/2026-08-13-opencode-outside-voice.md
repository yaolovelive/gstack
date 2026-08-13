# OpenCode Outside-Voice Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generated `/opencode` skill that provides read-only review, challenge, and resumable consult modes through a deterministic OpenCode CLI adapter.

**Architecture:** `opencode/SKILL.md.tmpl` owns user-visible mode selection, prompts, and result presentation. An executable `bin/gstack-opencode-run` owns CLI invocation, unique-title session discovery, export parsing, read-only verification, and normalized JSON statuses. Host generation installs the skill everywhere except OpenCode itself.

**Tech Stack:** Bun TypeScript executable, Bash snippets in generated skill templates, Bun test, gstack skill generator and host configuration.

## Global Constraints

- Use OpenCode's `plan` agent and never pass `--auto`.
- Treat `opencode export <session-id>` as the source of truth for response and usage data.
- Never expose credential values or complete environment contents.
- Reject exported sessions whose summary reports additions, deletions, or changed files.
- Keep deterministic gate tests offline by using a fake `opencode` executable.
- Edit `SKILL.md.tmpl`; generate `SKILL.md` through `bun run gen:skill-docs`.
- Preserve explicit user-provided model and variant values unchanged.
- The OpenCode host must skip both `codex` and `opencode` outside-voice skills.

---

## File map

- Create `bin/gstack-opencode-run`: executable adapter and export parser.
- Create `test/opencode-run.test.ts`: black-box adapter tests with a fake CLI.
- Create `opencode/SKILL.md.tmpl`: source template for the new skill.
- Generate `opencode/SKILL.md`: Claude-host output generated from the template.
- Modify `hosts/opencode.ts`: suppress recursive outside-voice skills.
- Modify `test/host-config.test.ts`: pin OpenCode host skip behavior.
- Create `test/opencode-skill.test.ts`: template behavior and generated-host tests.
- Modify `README.md`: list `/opencode` with the implementation/review skills.
- Generate host outputs under `.agents/skills/`, `.factory/skills/`, `.cursor/skills/`, and other configured generated roots as produced by the repository generator.

---

### Task 1: Deterministic OpenCode CLI adapter

**Files:**
- Create: `test/opencode-run.test.ts`
- Create: `bin/gstack-opencode-run`

**Interfaces:**
- Consumes CLI arguments: `--mode`, `--prompt-file`, `--repo`, `--timeout`, optional `--session`, `--model`, `--variant`, and `--thinking`.
- Produces one final JSON object with `status`, `session_id`, `text`, `reasoning`, `tokens`, `cost`, `provider`, `model`, `finish`, and bounded `error` fields.
- Exit code is zero only when `status` is `ok`; all expected failures still print normalized JSON.

- [ ] **Step 1: Write failing black-box tests for successful new and resumed runs**

Create a temporary fake `opencode` executable that supports `run`, `session list`, and `export`. Record received arguments in a temp file. Assert:

```ts
const result = runAdapter([
  '--mode', 'review',
  '--prompt-file', promptFile,
  '--repo', repo,
  '--model', 'openai/gpt-5.4',
  '--variant', 'high',
]);

expect(result.status).toBe('ok');
expect(result.session_id).toBe('ses_test_new');
expect(result.text).toBe('Independent finding');
expect(result.tokens).toEqual({ input: 120, output: 30, reasoning: 10, cache_read: 5, cache_write: 0 });
expect(result.cost).toBe(0.0123);
expect(result.provider).toBe('openai');
expect(result.model).toBe('gpt-5.4');
expect(readArgs()).toContain('--agent\nplan');
expect(readArgs()).not.toContain('--auto');
```

Add a resume assertion that the adapter passes `--session ses_existing` and does not require unique-title discovery.

- [ ] **Step 2: Run the adapter tests and verify RED**

Run:

```bash
bun test test/opencode-run.test.ts
```

Expected: FAIL because `bin/gstack-opencode-run` does not exist.

- [ ] **Step 3: Implement argument validation and subprocess execution**

Create `bin/gstack-opencode-run` with `#!/usr/bin/env bun`. Use `parseArgs` from `node:util`, `Bun.spawn`, and an explicit timeout. Build arguments as an array:

```ts
const args = ['run', '--agent', 'plan', '--dir', repo];
if (session) args.push('--session', session);
else args.push('--title', uniqueTitle);
if (model) args.push('--model', model);
if (variant) args.push('--variant', variant);
if (thinking) args.push('--thinking');
args.push(prompt);
```

Never use shell interpolation. Set stdin to `ignore`, capture stdout/stderr, and kill the child when the timeout fires.

- [ ] **Step 4: Implement unique-title discovery and export parsing**

For new runs, generate `gstack-opencode-${process.pid}-${Date.now().toString(36)}`. Parse `opencode session list` rows and require exactly one matching title. Then run `opencode export <id>` and strip any preamble before the first `{`.

Select the final completed assistant message, concatenate its `text` parts, and concatenate `reasoning` parts only when requested. Normalize token fields from the exported session info:

```ts
tokens: {
  input: info.tokens?.input ?? 0,
  output: info.tokens?.output ?? 0,
  reasoning: info.tokens?.reasoning ?? 0,
  cache_read: info.tokens?.cache?.read ?? 0,
  cache_write: info.tokens?.cache?.write ?? 0,
}
```

Return `write_detected` when `summary.additions`, `summary.deletions`, or `summary.files` is non-zero.

- [ ] **Step 5: Add failing error-contract tests**

Cover exact statuses:

```ts
expect(runMissingBinary().status).toBe('not_installed');
expect(runTimeout().status).toBe('timeout');
expect(runNonzero('authentication required').status).toBe('not_configured');
expect(runNonzero('unexpected failure').status).toBe('nonzero_exit');
expect(runWithoutMatchingSession().status).toBe('session_not_found');
expect(runMalformedExport().status).toBe('invalid_export');
expect(runEmptyAssistant().status).toBe('empty_response');
expect(runWithFileSummary().status).toBe('write_detected');
```

Assert the `error` field is bounded and never contains a planted credential value.

- [ ] **Step 6: Run tests, implement minimal status mapping, and verify GREEN**

Run:

```bash
bun test test/opencode-run.test.ts
```

Expected: PASS with no live OpenCode or network dependency.

- [ ] **Step 7: Commit the adapter**

```bash
git add bin/gstack-opencode-run test/opencode-run.test.ts
git commit -m "feat: add deterministic opencode runner"
```

---

### Task 2: Host recursion protection and generator coverage

**Files:**
- Modify: `hosts/opencode.ts`
- Modify: `test/host-config.test.ts`
- Create: `test/opencode-skill.test.ts`

**Interfaces:**
- Consumes `HostConfig.generation.skipSkills` in the existing generator.
- Produces OpenCode host behavior that excludes `codex` and `opencode`, while non-OpenCode hosts may generate `opencode`.

- [ ] **Step 1: Add failing host-config assertions**

Add:

```ts
test('OpenCode suppresses recursive outside-voice skills', () => {
  expect(opencode.generation.skipSkills).toEqual(['codex', 'opencode']);
});
```

In `test/opencode-skill.test.ts`, invoke the generator into temporary directories and assert the OpenCode output has neither skill while Codex output contains `gstack-opencode` and still excludes `gstack-codex`.

- [ ] **Step 2: Run targeted tests and verify RED**

Run:

```bash
bun test test/host-config.test.ts test/opencode-skill.test.ts
```

Expected: FAIL because the OpenCode host only skips `codex` and the skill template does not exist.

- [ ] **Step 3: Update the OpenCode host skip list**

Change:

```ts
generation: {
  generateMetadata: false,
  skipSkills: ['codex', 'opencode'],
},
```

- [ ] **Step 4: Keep the template-existence assertion failing for Task 3**

Run the targeted tests. Expect the host-config assertion to pass while template/output assertions remain RED because `opencode/SKILL.md.tmpl` is not present.

- [ ] **Step 5: Commit recursion protection**

```bash
git add hosts/opencode.ts test/host-config.test.ts test/opencode-skill.test.ts
git commit -m "test: define opencode skill host boundaries"
```

---

### Task 3: Full `/opencode` review, challenge, and consult skill

**Files:**
- Create: `opencode/SKILL.md.tmpl`
- Generate: `opencode/SKILL.md`
- Modify: `test/opencode-skill.test.ts`

**Interfaces:**
- Consumes `bin/gstack-opencode-run` normalized JSON.
- Produces `/opencode review [focus] [--model provider/model] [--variant name]`, `/opencode challenge [focus] [...]`, and `/opencode consult <question> [...]`.
- Persists successful consult session IDs at `.context/opencode-session-id`.

- [ ] **Step 1: Add failing structural tests for all modes and contracts**

Assert the template and generated skill contain:

```ts
expect(skill).toContain('## Review Mode');
expect(skill).toContain('## Challenge Mode');
expect(skill).toContain('## Consult Mode');
expect(skill).toContain('.context/opencode-session-id');
expect(skill).toContain('gstack-opencode-run');
expect(skill).toContain('OPENCODE SAYS');
expect(skill).toContain('Recommendation:');
expect(skill).toContain('--model');
expect(skill).toContain('--variant');
expect(skill).toContain('write_detected');
```

Also assert the frontmatter name is `opencode`, the description triggers on OpenCode second-opinion/review/challenge/consult requests, and the skill states that the response is shown verbatim before synthesis.

- [ ] **Step 2: Run targeted tests and verify RED**

Run:

```bash
bun test test/opencode-skill.test.ts
```

Expected: FAIL because the template is absent.

- [ ] **Step 3: Create the minimal skill template preamble and argument routing**

Use only `name` and `description` frontmatter. Define exact parsing rules:

```text
review      -> Review Mode
challenge   -> Challenge Mode
consult     -> Consult Mode
no mode     -> consult unless a current diff exists and the user explicitly asks for review
```

Forward an explicit `--model` and `--variant` unchanged. Use `high` only as an implicit review/challenge variant and retry without it only when OpenCode rejects that implicit value.

- [ ] **Step 4: Implement prompt construction and adapter invocation**

Every prompt begins with the filesystem boundary and read-only instruction. Review and challenge detect the base branch and request `git diff origin/<base>`. Consult embeds plan contents when a plan file is selected rather than sending an inaccessible external path.

Write the prompt to a temporary file under `TMP_ROOT`, then invoke:

```bash
"$GSTACK_ROOT/bin/gstack-opencode-run" \
  --mode "$MODE" \
  --prompt-file "$PROMPT_FILE" \
  --repo "$REPO_ROOT" \
  --timeout 600 \
  ${SESSION_ARGS[@]} ${MODEL_ARGS[@]} ${VARIANT_ARGS[@]}
```

The template instructs the host to parse the final JSON line, present `text` and optional `reasoning` verbatim, then print metadata and one specific recommendation.

- [ ] **Step 5: Implement consult continuation and error presentation**

If `.context/opencode-session-id` exists, ask whether to continue or start fresh. Save a new ID only after `status: ok`. Map every adapter status from the design to a distinct actionable message; never delete a failed saved session automatically.

- [ ] **Step 6: Generate skill output and verify targeted GREEN**

Run:

```bash
bun run gen:skill-docs
bun test test/opencode-skill.test.ts test/host-config.test.ts
```

Expected: PASS. Confirm `opencode/SKILL.md` has the generated-file header.

- [ ] **Step 7: Commit the skill**

```bash
git add opencode/SKILL.md.tmpl opencode/SKILL.md test/opencode-skill.test.ts hosts/opencode.ts
git add .agents/skills .factory/skills .cursor/skills .opencode/skills 2>/dev/null || true
git commit -m "feat: add opencode outside-voice skill"
```

---

### Task 4: Documentation and repository-wide verification

**Files:**
- Modify: `README.md`
- Modify only if generator output requires it: generated host skill files.

**Interfaces:**
- Produces user-visible discovery of `/opencode` and verified repository state.

- [ ] **Step 1: Add a failing documentation assertion**

In `test/opencode-skill.test.ts`, assert the implementation/review table in `README.md` contains `/opencode` and describes it as an OpenCode second opinion.

- [ ] **Step 2: Run the assertion and verify RED**

Run:

```bash
bun test test/opencode-skill.test.ts
```

Expected: FAIL because README lists `/codex` but not `/opencode`.

- [ ] **Step 3: Add the README catalog entry**

Add beside `/codex`:

```markdown
| `/opencode` | Second opinion via OpenCode. Review, challenge, or consult modes. |
```

- [ ] **Step 4: Regenerate and run all required checks**

Run:

```bash
bun run gen:skill-docs
bun run skill:check
bun test
```

Expected: all commands exit zero. Inspect `git diff --check` and confirm no generated file was edited by hand.

- [ ] **Step 5: Run a bounded optional live smoke test**

When `command -v opencode` succeeds and `opencode auth list` reports at least one provider, run the adapter against a temporary no-tool prompt with a 90-second timeout. Verify `status: ok`, non-empty text, a session ID, and zero changed files. Do not make this a gate test.

- [ ] **Step 6: Commit documentation and generated output**

```bash
git add README.md opencode/SKILL.md
git add .agents/skills .factory/skills .cursor/skills .opencode/skills 2>/dev/null || true
git commit -m "docs: document opencode outside voice"
```

- [ ] **Step 7: Final evidence review**

Run:

```bash
git status --short
git log -5 --oneline
```

Report the exact verification commands and results. Do not claim completion if any required check is failing.
