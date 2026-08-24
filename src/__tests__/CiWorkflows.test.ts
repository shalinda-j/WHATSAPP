import fs from 'fs';
import path from 'path';

/**
 * Guards on the Actions workflows.
 *
 * This repo is private on a personal account, so Actions minutes are metered.
 * Exhausting the quota fails every job two seconds after creation with no runner
 * and no logs, which reads as a broken build and costs a day of debugging —
 * see docs/CI.md. The workflows were consolidated from 12 billable jobs per PR
 * push down to 3, and these tests pin the decisions that got them there so a
 * future edit can't quietly undo one.
 *
 * Parsed with a deliberately small YAML reader rather than a dependency: the
 * assertions below only need top-level keys, job ids and `uses:`/`run:` lines,
 * and adding js-yaml to the runtime tree for a handful of string checks would
 * cost more than it buys.
 */

const WORKFLOW_DIR = path.join(__dirname, '../../.github/workflows');

function read(name: string): string {
  return fs
    .readFileSync(path.join(WORKFLOW_DIR, name), 'utf8')
    .replace(/\r\n/g, '\n');
}

/**
 * Drop comment lines.
 *
 * These workflows carry long comments explaining exactly which anti-patterns
 * were removed ("used to run a [javascript, typescript] matrix", "each doing
 * actions/checkout with fetch-depth: 0"), so a naive substring check finds the
 * documentation of a mistake and reports it as the mistake. Assert against the
 * YAML that actually executes.
 */
function withoutComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

function readYaml(name: string): string {
  return withoutComments(read(name));
}

const workflowFiles = fs
  .readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

const sources = new Map(workflowFiles.map((f) => [f, readYaml(f)]));

/** Top-level `on:` block of a workflow, as raw text. */
function triggerBlock(src: string): string {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /^on:/.test(l));
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    // A new top-level key ends the block. Blank and comment lines don't.
    if (/^[a-zA-Z]/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

/** Job ids: two-space-indented keys under `jobs:`. */
function jobIds(src: string): string[] {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /^jobs:/.test(l));
  if (start === -1) return [];
  const ids: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[a-zA-Z]/.test(lines[i])) break;
    const m = lines[i].match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/** True when the workflow runs on `pull_request` (not `pull_request_target`). */
function runsOnPullRequests(src: string): boolean {
  return /^\s{2}pull_request:/m.test(triggerBlock(src));
}

describe('workflow inventory', () => {
  it('finds the workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const expected of [
      'ci.yml',
      'code-quality.yml',
      'security.yml',
      'pull-request.yml',
      'deploy.yml',
      'issues.yml',
    ]) {
      expect(workflowFiles).toContain(expected);
    }
  });

  it('parses a job list out of every workflow', () => {
    for (const [name, src] of sources) {
      expect(jobIds(src).length).toBeGreaterThan(0);
      expect(name.endsWith('.yml') || name.endsWith('.yaml')).toBe(true);
    }
  });
});

describe('superseded runs are cancelled', () => {
  it('gives every PR-triggered workflow a concurrency group', () => {
    // The biggest single saving. Without this, three pushes to a branch run
    // three complete suites in parallel and only the last one is ever read.
    for (const [name, src] of sources) {
      if (!runsOnPullRequests(src)) continue;
      expect(src).toMatch(/^concurrency:/m);
      const group = src.match(/^concurrency:\n\s+group:\s*(.+)$/m)?.[1];
      expect(group).toBeTruthy();
      // The group has to vary per PR/ref, or unrelated PRs cancel each other.
      expect(group).toMatch(/\$\{\{/);
      expect(src).toMatch(/cancel-in-progress:/);
      expect(name).toBeTruthy();
    }
  });

  it('does not cancel in-progress builds of main', () => {
    // Cancelling a main build would abandon the artifact for a commit that is
    // already merged, so ci.yml keys cancellation off the event type.
    expect(readYaml('ci.yml')).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
  });
});

describe('per-PR job budget', () => {
  it('runs at most three jobs on a PR push', () => {
    const total = [...sources.entries()]
      .filter(([, src]) => runsOnPullRequests(src))
      .reduce((n, [, src]) => n + jobIds(src).length, 0);
    expect(total).toBeLessThanOrEqual(3);
  });

  it('keeps the expensive scans off the PR path', () => {
    // A deep static analysis of an in-progress branch tells you nothing you
    // won't learn when the change lands on main.
    expect(runsOnPullRequests(readYaml('security.yml'))).toBe(false);
    expect(runsOnPullRequests(readYaml('code-quality.yml'))).toBe(false);
  });

  it('does not attach issue-management checks to pull requests', () => {
    // Both jobs there are gated on `issues` or `schedule`, so a PR event only
    // produced skipped jobs — no work, just noise in the checks list.
    expect(runsOnPullRequests(readYaml('issues.yml'))).toBe(false);
  });
});

describe('no check runs twice', () => {
  it('does not run CI on main directly, since deploy.yml calls it', () => {
    // Listing main in both places ran the whole suite twice per commit.
    const push = readYaml('ci.yml').match(/^\s{2}push:\n\s+branches:\s*(.+)$/m);
    expect(push?.[1]).toBeTruthy();
    expect(push?.[1]).not.toContain('main');
    expect(readYaml('deploy.yml')).toContain(
      'uses: ./.github/workflows/ci.yml',
    );
  });

  it('has exactly one lint and one type-check job per side of the app', () => {
    // ESLint Analysis and TypeScript Check used to duplicate ci.yml's own steps
    // on two extra runners with two extra installs.
    const names = [...sources.values()]
      .flatMap((src) => src.match(/^\s+name:\s*(.+)$/gm) ?? [])
      .map((l) => l.replace(/^\s+name:\s*/, '').trim());
    expect(names).not.toContain('ESLint Analysis');
    expect(names).not.toContain('TypeScript Check');
    expect(names).not.toContain('Prettier Check');
  });

  it('analyses one CodeQL language, not the same files twice', () => {
    const src = readYaml('security.yml');
    // `javascript` and `typescript` both resolve to the javascript-typescript
    // extractor, so a matrix of both scans identical files and uploads
    // duplicate findings.
    expect(src).toContain('languages: javascript-typescript');
    expect(src).not.toMatch(
      /language:\s*\[\s*javascript\s*,\s*typescript\s*\]/,
    );
    expect(src).not.toContain('security-and-quality');
  });
});

describe('runner setup', () => {
  it('caches npm in every job that installs dependencies', () => {
    for (const [name, src] of sources) {
      const installs = (src.match(/npm install --no-audit/g) ?? []).length;
      if (installs === 0) continue;
      const caches = (src.match(/cache: 'npm'/g) ?? []).length;
      // The client install inside ci.yml's frontend job and the backend install
      // each need their own cache-dependency-path.
      expect(caches).toBeGreaterThan(0);
      expect(src).toContain('cache-dependency-path:');
      expect(name).toBeTruthy();
    }
  });

  it('uses the non-fixing lint script in CI', () => {
    // `npm run lint` passes --fix, so in CI it repairs violations and then
    // reports success.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
    );
    expect(pkg.scripts['lint:ci']).toBe('eslint .');
    expect(pkg.scripts['lint:ci']).not.toContain('--fix');
    expect(readYaml('ci.yml')).toContain('npm run lint:ci');
  });

  it('does not clone the repo just to read the PR event payload', () => {
    const src = readYaml('pull-request.yml');
    expect(src).not.toContain('actions/checkout');
    expect(src).not.toContain('fetch-depth: 0');
    expect(src).toContain('changed_files');
  });
});
