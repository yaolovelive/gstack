# OpenCode Outside-Voice Skill Design

## Goal

Add a `/opencode` skill that lets supported gstack hosts ask OpenCode for an
independent, read-only second opinion. Match the user-facing capabilities of
the existing `/codex` skill while adapting execution and session handling to
OpenCode's CLI.

The skill supports three modes:

- `review`: review the current branch diff for correctness and production risk.
- `challenge`: look for adversarial failure modes, security gaps, races, leaks,
  and silent corruption.
- `consult`: answer a free-form codebase or plan question with resumable session
  context.

Users may override the OpenCode model and variant. The invoking host always
shows OpenCode's full response before adding its own synthesis recommendation.

## Non-goals

- Do not turn OpenCode into a gstack host; that support already exists.
- Do not run OpenCode as a persistent `opencode serve` daemon.
- Do not allow OpenCode to edit the repository.
- Do not make OpenCode call `/opencode` recursively.
- Do not redesign the existing `/codex` skill in this change.

## Architecture

Use a generated skill template plus a deterministic CLI adapter:

```text
opencode/SKILL.md.tmpl
        |
        | selects mode, builds prompt, presents output
        v
bin/gstack-opencode-run
        |
        | invokes OpenCode and resolves the created session
        v
opencode run --agent plan ...
        |
        | session ID
        v
opencode export <session-id>
        |
        | normalized result
        v
full outside-voice output + host synthesis
```

The template remains the behavioral source of truth. Generated `SKILL.md`
files must not be edited directly.

### Skill template

Create `opencode/SKILL.md.tmpl`, following the existing `/codex` interaction
model where it is user-visible:

- detect `review`, `challenge`, or `consult` mode;
- accept `--model <provider/model>` and `--variant <name>`;
- construct mode-specific prompts with the filesystem boundary;
- embed plan content when OpenCode cannot access the source path directly;
- call the adapter with a bounded timeout;
- print the complete OpenCode response in an `OPENCODE SAYS` block;
- print token, cost, provider, and model metadata when available;
- add one concrete synthesis recommendation after the verbatim response.

The skill stores the active consult session ID in
`.context/opencode-session-id`. When the file exists, consult mode offers to
continue it or start a fresh session, matching `/codex` behavior.

### CLI adapter

Create `bin/gstack-opencode-run` as the stable boundary around OpenCode CLI
differences. It accepts an explicit operation and returns one normalized JSON
object on its last output line.

The adapter responsibilities are:

1. Validate that `opencode` is installed.
2. Validate required arguments and repository path.
3. Invoke OpenCode with `--agent plan`, `--dir <repo>`, and without `--auto`.
4. Apply optional `--model`, `--variant`, and `--session` arguments.
5. Bound execution time using the same portable timeout strategy as gstack's
   Codex integration.
6. For a new session, assign a short unique `--title`, then resolve the matching
   session ID after the run.
7. Export the session with `opencode export <session-id>`.
8. Parse the export and extract assistant text, reasoning text when requested,
   token usage, cost, provider, model, finish state, and session ID.
9. Return a typed status for success, missing binary, missing credentials,
   timeout, non-zero exit, unresolved session, invalid export, or empty response.

The exported session is the source of truth. OpenCode 1.18.15 accepts
`--format json`, but local non-interactive sampling did not reliably expose the
assistant body through a captured stdout pipe. Export parsing therefore avoids
depending on terminal-rendering behavior.

The adapter must not print credential values or full environment contents.

### Read-only boundary

Every invocation uses OpenCode's `plan` agent and omits `--auto`. Prompts state
that OpenCode must inspect and report only. The adapter records the session
summary and rejects a successful result if the exported session reports file
additions, deletions, or modified files.

This combines a runtime permission boundary with post-run verification. A
prompt-only instruction is not sufficient.

### Host integration

The existing generator discovers skill templates, so adding the new template
produces host-specific output through the standard generation path.

Update `hosts/opencode.ts` to skip both outside-voice wrappers:

```ts
skipSkills: ['codex', 'opencode']
```

OpenCode must not install a skill that launches OpenCode. Other supported hosts
receive `/opencode` unless their own host configuration explicitly excludes it.

The existing Codex host may install `/opencode`, allowing Codex to request an
OpenCode second opinion. Its existing self-suppression of `/codex` remains
unchanged.

## Mode behavior

### Review

Review the branch diff against the detected base branch. Request concrete,
actionable findings with file and line references. Keep OpenCode read-only and
present its full output before the invoking host assesses the findings.

Default variant: `high` when supported by the selected provider. If no variant
is configured or the provider rejects it, retry once without the default
variant. An explicit user-provided variant is never silently removed.

### Challenge

Use the same repository scope as review, with an adversarial prompt focused on
production failures, security, concurrency, resource handling, and silent data
loss. Support an optional user focus such as `security` or `performance`.

Default variant behavior matches review.

### Consult

Send a free-form question or embedded plan. Default to the user's configured
OpenCode model and variant rather than hardcoding a provider. Save the session
ID after a successful new run. Resume with `opencode run --session <id>`.

If resume fails because the session is missing or invalid, keep the saved ID,
surface the error, and offer a fresh session. Do not delete user state
automatically.

## Error handling

The adapter emits stable machine-readable statuses; the skill maps them to
actionable messages:

| Status | Skill behavior |
|---|---|
| `not_installed` | Show the OpenCode installation requirement and stop. |
| `not_configured` | Ask the user to configure a provider with OpenCode and retry. |
| `timeout` | Report the timeout and recommend reducing scope or retrying. |
| `nonzero_exit` | Show a bounded stderr excerpt without leaking credentials. |
| `session_not_found` | Explain that the run completed but its session could not be resolved. |
| `invalid_export` | Report incompatible or malformed OpenCode export data. |
| `empty_response` | Report that no assistant text was returned. |
| `write_detected` | Warn that the read-only contract was violated and do not treat the result as valid. |

Temporary files are created under gstack's resolved temporary root and cleaned
up on normal exit. Diagnostic stderr is bounded before being embedded in the
normalized result.

## Testing strategy

Follow RED-GREEN-REFACTOR for the new skill and adapter.

### RED

Add failing tests before implementation for:

- generator discovery of `opencode/SKILL.md.tmpl`;
- OpenCode host self-suppression;
- other hosts receiving the generated skill;
- adapter parsing of a representative exported session;
- assistant text, reasoning, token, cost, provider, and model extraction;
- new-session ID resolution by unique title;
- session resume arguments;
- timeout, non-zero exit, invalid export, empty response, and write detection;
- review, challenge, and consult argument mapping.

Use fixtures and a fake `opencode` executable for free deterministic tests. Do
not require a live provider in the gate suite.

### GREEN

Implement the minimum template, adapter, and host configuration necessary to
pass the failing tests. Generate host-specific skill outputs from templates.

### REFACTOR AND VERIFICATION

Run:

```bash
bun run gen:skill-docs
bun run skill:check
bun test
```

Add a bounded live smoke test only when a configured OpenCode provider is
available. The live test must use a no-tool prompt and must not be part of the
free gate suite.

## Acceptance criteria

- `/opencode review`, `/opencode challenge`, and `/opencode consult` work from
  supported non-OpenCode hosts.
- Model and variant overrides reach OpenCode unchanged.
- Consult sessions can be resumed by ID.
- OpenCode's full answer appears before host synthesis.
- Token, cost, provider, model, and session metadata appear when available.
- Missing binary, configuration, timeout, malformed export, empty response,
  and write detection have distinct actionable errors.
- The OpenCode host does not install `/opencode` or `/codex`.
- Deterministic tests do not depend on network access or paid model calls.
- Generated skill documents, skill health checks, and the free test suite pass.
