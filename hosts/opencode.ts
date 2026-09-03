import { defineHost } from './define-host';

/**
 * Claude Code tool vocabulary → OpenCode tool names, applied to generated
 * skills so instructions reference tools that actually exist on this host
 * (OpenCode: bash/read/write/edit/grep/glob/question/task/skill/webfetch/
 * websearch/todowrite — no AskUserQuestion, no ExitPlanMode tool).
 *
 * Entry ORDER matters (Object.entries applies sequentially):
 * 1. The `__AskUserQuestion` suffix is parked behind a sentinel FIRST so the
 *    global AskUserQuestion → question rewrite cannot mangle the
 *    `mcp__*__AskUserQuestion` / `mcp__conductor__AskUserQuestion` variant
 *    names (a Claude-specific mechanism the AUQ tool-resolution prose still
 *    describes); restored after the global pass.
 * 2. ExitPlanMode phrases rewrite before the bare token so sentences stay
 *    grammatical (OpenCode has no ExitPlanMode tool — plan approval is
 *    native, so the action becomes "end plan mode").
 */
const OPENCODE_TOOL_REWRITES: Record<string, string> = {
  '__AskUserQuestion': '@@GSTACK-MCP-AUQ@@',
  'ExitPlanMode is called': 'plan mode ends',
  'calling ExitPlanMode': 'ending plan mode',
  'call ExitPlanMode': 'end plan mode',
  'Call ExitPlanMode': 'End plan mode',
  'ExitPlanMode': 'ending plan mode',
  'AskUserQuestion': 'question',
  '@@GSTACK-MCP-AUQ@@': '__AskUserQuestion',
  'Skill tool': 'skill tool',
  'Agent tool': 'task tool',
  'the Bash tool': 'the bash tool',
  'the Read tool': 'the read tool',
  'the Write tool': 'the write tool',
  'the Edit tool': 'the edit tool',
  'the Grep tool': 'the grep tool',
  'the Glob tool': 'the glob tool',
  'WebSearch': 'websearch',
};

const opencode = defineHost({
  name: 'opencode',
  displayName: 'OpenCode',

  globalRoot: '.config/opencode/skills/gstack',  // XDG config dir, not ~/.opencode
  localSkillRoot: '.opencode/skills/gstack',
  hostSubdir: '.opencode',
  usesEnvVars: true,

  toolRewrites: { ...OPENCODE_TOOL_REWRITES },

  frontmatter: {
    mode: 'allowlist',
    keepFields: ['name', 'description'],
    descriptionLimit: null,
  },

  generation: {
    generateMetadata: false,
    skipSkills: ['codex', 'opencode'],
  },

  pathRewrites: [
    { from: '~/.claude/skills/gstack', to: '~/.config/opencode/skills/gstack' },
    { from: '.claude/skills/gstack', to: '.opencode/skills/gstack' },
    { from: '.claude/skills', to: '.opencode/skills' },
  ],

  suppressedResolvers: ['GBRAIN_CONTEXT_LOAD', 'GBRAIN_SAVE_RESULTS'],

  // OpenCode links a wider runtime asset set than the shared default
  // (design binary, review specialists, qa templates/references, DX hall of fame).
  runtimeRoot: {
    globalSymlinks: ['bin', 'browse/dist', 'browse/bin', 'design/dist', 'gstack-upgrade', 'ETHOS.md', 'review/specialists', 'qa/templates', 'qa/references', 'plan-devex-review/dx-hall-of-fame.md'],
    globalFiles: {
      'review': ['checklist.md', 'design-checklist.md', 'greptile-triage.md', 'TODOS-format.md'],
    },
  },
});

export default opencode;
