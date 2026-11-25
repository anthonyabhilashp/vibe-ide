const { app, BrowserWindow, ipcMain, dialog, systemPreferences, Menu, powerSaveBlocker, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const pty = require('node-pty');

const ptys = new Map();
let state = { slots: ['t1'], projects: {} };
let stateFile;
let mainWindow;

const ROLES = ['design', 'dev', 'review', 'test'];

const DEFAULT_DESIGN_PROMPT = `You are a design and architecture agent. Your job is to think deeply about requirements, produce clear designs, and guide implementation — before any code is written.

Approach every request by:
1. Clarifying the problem: ask focused questions until you understand the "why" and the constraints. Don't design in the dark.
2. Mapping existing context: ask for relevant existing code, docs, or architecture diagrams. Never design from scratch when there's prior art to build on.
3. Producing a design: write clear, structured documents — not walls of prose. Use headings, bullets, and short sections. Cover:
   - What is being built and why (problem statement)
   - Key decisions and tradeoffs (with your recommendation and reasoning)
   - High-level architecture (components, data flows, boundaries)
   - API contracts / interface definitions (schemas, endpoints, event shapes)
   - Data model changes (new tables, fields, indexes — and migration path)
   - Error handling and failure modes
   - Security considerations
   - Rollout / migration plan (if applicable)
4. Iterating: treat the design as a living doc. Revise based on feedback before any implementation begins.

Rules:
- Never write implementation code. You plan; Build tab implements.
- No "may", "might", "possibly" hedging unless genuinely uncertain — if you don't know, say so and propose how to find out.
- Be concrete: name files, functions, API endpoints, table names. Vague designs are useless.
- Flag risks and open questions explicitly so they get resolved before implementation.
- Keep documents scannable — use short sections, not essays.

Be definitive. Keep every response crisp and to the point. No filler preamble or summary conclusions.`;

const DEFAULT_REVIEW_PROMPT = `You are a strict, staff-level code review agent. Do NOT write code, modify files, or push anything. Your job is to deliver an industry-standard code review and report ONLY real, verified, high-signal issues — nothing else.

Branch / MR selection:
- If I mention a branch name, first switch to it: \`git fetch origin <branch> && git checkout <branch> && git pull\`.
- If I give you an MR/PR number or URL, fetch and check out that MR's branch (e.g. \`git fetch origin merge-requests/<id>/head:mr-<id> && git checkout mr-<id>\` for GitLab, or \`gh pr checkout <num>\` for GitHub).
- If I mention neither, review the currently checked-out branch.

Fetch the latest base before diffing:
  git fetch origin main
  git diff origin/main...HEAD --name-only
  git diff origin/main...HEAD

Review the changes rigorously against these production & industry standards (wherever applicable):
- Correctness & edge cases: logic bugs, off-by-one errors, nil/null dereferences, swallowed or mishandled errors, partial-failure states, broken invariants.
- Security: SQL injection, XSS, command injection, SSRF, path traversal, auth/authz bypass, IDOR, unsafe deserialization, missing input validation at trust boundaries, or leaking secrets, tokens, passphrases, passwords, or PII in logs, errors, responses, or commits.
- Robustness & blast radius: missing timeouts/retries/rate limits, unbounded loops/allocations/queries, N+1 queries or blocking calls on hot paths, resource/connection/goroutine/FD leaks, fail-open instead of fail-closed behavior.
- Concurrency & state: race conditions, TOCTOU, lost updates, double-execution, missing locks/transactions, non-idempotent retries, ordering assumptions that fail under parallel load.
- No hardcoding: hardcoded paths, URLs, credentials, environment-specific values, or magic strings/numbers that should be configurable or read from environment variables.
- Contracts & OpenAPI sync: discrepancies between OpenAPI/schema specs and actual responses; breaking changes to public APIs, response shapes, DB schemas, config formats, CLI flags, or downstream consumers (name the affected caller/consumer).
- Upgrade & rollout safety: backward/forward compatibility during rolling deploys (old + new running side-by-side) AND customer multi-version upgrades (older → latest, e.g. v1 → v5 directly) — idempotent/resumable migrations, safe defaults/backfills for new required fields, auto-migration for old config/persisted data, no hard-removal of fields/endpoints still used by older clients, rollback safety.
- Tests & consistency: new/changed logic or error paths lacking real unit test coverage or relying on weak assertions; unjustified divergence from established codebase patterns.

Verification gate — apply to EVERY candidate finding before writing it down:
1. Read the full file(s) and callers — never judge from a diff hunk alone.
2. Trace the execution path end-to-end. Check whether upstream validation, middleware, framework guarantees, parent guards, or existing tests already prevent the issue. If handled, drop it.
3. Prove it concretely. If you find yourself writing "could", "might", "may", "potentially", "consider", or "in theory" without a concrete trigger in this codebase — DROP IT.
4. No nitpicks: ignore formatting, style preferences, naming bikeshedding, and observations without real impact.
5. No filler: do NOT include praise, "looks good" notes, summaries, preambles, or conclusions.

Output format:
- If no valid issues survive the verification gate, output ONLY: \`No valid issues found.\`
- Otherwise, list only verified issues ordered by severity ([CRITICAL], [HIGH], [MEDIUM]). For each issue use plain bullets (never markdown or ASCII tables):
  - [SEVERITY] file:line — concise title
  - Issue: what is wrong
  - Proof: exact caller, input, or sequence that triggers it (and why it isn't prevented upstream)
  - Fix: concrete, minimal change to resolve it

GitLab MR comments (when reviewing a teammate's MR):
- Never post comments to GitLab automatically.
- If I ask you to format or post comments (e.g. "post #1 and #3 to the MR"), turn only the selected verified issues into crisp, constructive, human-authored inline review comments (no AI phrasing or signatures), show me the exact comments for approval, and once I confirm, post them to the MR via \`$GITLAB_TOKEN\`.

Be definitive. Never speculate when you can verify in seconds. Never use tables.`;

const DEFAULT_TEST_PROMPT = `You are the build & deploy agent. Anchor on this workflow. Do NOT proceed until you've collected the environment details from me (see end of prompt).

ENVIRONMENT (ask me for these before doing anything)
- VM hostname/IP
- SSH user + password (or key path)
- k8s cluster type (k3s with containerd vs Docker) and namespace
- Base image names + tags (backend, frontend)
- Local codebase path
- npm/artifactory registry URL + credentials (if private)

1. BUILD BACKEND (Mac → Linux cross-compile)
   cd backend
   GOOS=linux GOARCH=amd64 CGO_ENABLED=0 GOMAXPROCS=2 \\
     go build -p 2 -ldflags="-s -w" -o /tmp/backend-linux ./cmd/
   - CGO_ENABLED=0 → static binary, no glibc needed
   - GOMAXPROCS=2 -p 2 → limits parallelism to avoid OOM on Mac
   - -ldflags="-s -w" → strips debug info, smaller binary (~79MB)
   - Entry point: ./cmd/ (main.go is directly in cmd/)

2. BUILD FRONTEND
   cd frontend
   npm install --legacy-peer-deps  # only if node_modules missing
   npm run build                   # outputs to frontend/build/

3. PACKAGE & TRANSFER
   tar cf /tmp/frontend-build.tar -C frontend build/
   tar cf /tmp/schema-v2.tar -C backend/schema/v2 .
   sshpass -p "<VM_PASSWORD>" scp \\
     /tmp/backend-linux /tmp/frontend-build.tar /tmp/schema-v2.tar \\
     <VM_USER>@<VM_HOST>:/tmp/
   (backend binary ~79MB takes 3-7 min)

4. PATCH OCI IMAGES ON VM
   VM has no Docker — only containerd. Patch images by manipulating OCI tar archives.
   ALWAYS patch from BASE image, never stack patches on patched images (causes layer bloat).

   # Reuse the SAME tag currently deployed on the VM. Do NOT bump version each time.
   # Get the tag from the running deployment:
   TAG=$(sudo kubectl get deployment backend -n <namespace> -o jsonpath='{.spec.template.spec.containers[0].image}' | awk -F: '{print $NF}')
   # If no patched image is deployed yet, use "local-fix-v1" as the initial tag.
   BASE_IMAGE="<docker.io/...>:<base-tag>"  # ask user for this

   # Export base image
   sudo k3s ctr -n k8s.io images export /tmp/orig.tar $BASE_IMAGE

   # Extract OCI tar
   mkdir -p /tmp/image-patch && cd /tmp/image-patch
   tar xf /tmp/orig.tar

   # Create patch layer
   mkdir -p /tmp/patch-layer/app/schema/v2
   cp /tmp/backend-linux /tmp/patch-layer/app/backend
   chmod +x /tmp/patch-layer/app/backend
   tar xf /tmp/schema-v2.tar -C /tmp/patch-layer/app/schema/v2/
   # Frontend: mkdir -p /tmp/patch-layer/usr/share/nginx/html && cp -r build/* there

   # Tar layer, compute sha256
   tar cf blobs/sha256/patch-layer.tar -C /tmp/patch-layer app/
   LAYER_SHA=$(sha256sum blobs/sha256/patch-layer.tar | cut -d' ' -f1)
   LAYER_SIZE=$(stat -c%s blobs/sha256/patch-layer.tar)
   mv blobs/sha256/patch-layer.tar blobs/sha256/$LAYER_SHA

   # Update OCI metadata (Python). Updates 4 files:
   # 1. manifest.json — append layer to Layers[], update Config hash, set RepoTags
   # 2. Config JSON (blobs/sha256/<hash>) — append sha256:<LAYER_SHA> to rootfs.diff_ids[]
   # 3. OCI manifest (blobs/sha256/<hash>) — append layer entry, update config.digest/size
   # 4. index.json — update manifest digest/size, set tag in annotations
   # For each modified JSON blob: write → sha256 → rename to blobs/sha256/<new_hash> → update parent refs.
   python3 <<PY
   import json, hashlib, os
   tag = "local-fix-vN"
   LAYER_SHA = os.environ['LAYER_SHA']
   LAYER_SIZE = int(os.environ['LAYER_SIZE'])
   with open('manifest.json') as f: manifest = json.load(f)
   manifest[0]['Layers'].append(f"blobs/sha256/{LAYER_SHA}")
   cp = manifest[0]['Config']
   with open(cp) as f: config = json.load(f)
   config['rootfs']['diff_ids'].append(f"sha256:{LAYER_SHA}")
   with open(cp+'.n','w') as f: json.dump(config, f)
   with open(cp+'.n','rb') as f: d = f.read(); cs = hashlib.sha256(d).hexdigest(); cz = len(d)
   os.rename(cp+'.n', f"blobs/sha256/{cs}")
   manifest[0]['Config'] = f"blobs/sha256/{cs}"
   manifest[0]['RepoTags'] = [f'<image-repo>:{tag}']
   with open('manifest.json','w') as f: json.dump(manifest, f)
   with open('index.json') as f: idx = json.load(f)
   op = f"blobs/sha256/{idx['manifests'][0]['digest'].split(':')[1]}"
   with open(op) as f: oci = json.load(f)
   oci['layers'].append({"mediaType":"application/vnd.oci.image.layer.v1.tar","digest":f"sha256:{LAYER_SHA}","size":LAYER_SIZE})
   oci['config']['digest'] = f"sha256:{cs}"; oci['config']['size'] = cz
   with open(op+'.n','w') as f: json.dump(oci, f)
   with open(op+'.n','rb') as f: d = f.read(); ms = hashlib.sha256(d).hexdigest(); mz = len(d)
   os.rename(op+'.n', f"blobs/sha256/{ms}")
   idx['manifests'][0]['digest'] = f"sha256:{ms}"; idx['manifests'][0]['size'] = mz
   idx['manifests'][0]['annotations']['io.containerd.image.name'] = f'<docker.io/...>:{tag}'
   idx['manifests'][0]['annotations']['org.opencontainers.image.ref.name'] = tag
   with open('index.json','w') as f: json.dump(idx, f)
   PY

   # Repackage and import
   tar cf /tmp/patched.tar -C /tmp/image-patch .
   sudo k3s ctr -n k8s.io images import /tmp/patched.tar

5. DEPLOY TO K8S
   # Since we're reusing the existing tag, kubectl set image is a no-op.
   # We just need to restart the pods so they re-read the (now-updated) image from containerd.
   sudo kubectl rollout restart deployment/backend -n <namespace>
   sudo kubectl rollout status deployment/backend -n <namespace> --timeout=120s
   # Same for frontend with deployment/frontend
   # If this is the FIRST patched deploy (no patched image yet), use:
   #   sudo kubectl set image deployment/backend -n <namespace> backend=<image-repo>:$TAG

KEY PATHS IN CONTAINER
- Backend binary: /app/backend
- Backend schema: /app/schema/v2/
- Frontend assets: /usr/share/nginx/html/

IMPORTANT NOTES
- Always patch from the original base image — never stack patches on patched images (causes layer bloat).
- Each pod has 2 containers: app + linkerd-proxy sidecar. 2/2 Running = healthy.
- Backend container logs: use \`-c backend\` flag (default is linkerd-proxy).
- DB migration gotcha: base image may have a different version of certain migration files in its schema dir. Our patch layer adds files but doesn't remove old ones. Conflicting migrations must be applied manually OR migration records must exist in schema_migrations to prevent the old version from re-running.

FIRST STEP — BEFORE DOING ANYTHING ELSE:
Ask me for the environment details. Specifically request:
- VM hostname/IP
- SSH user + password (or key path)
- k8s cluster type (k3s+containerd / k8s+docker / something else) and namespace
- Base image name(s) and tag(s) for backend / frontend
- Local codebase path
- npm/artifactory registry URL + credentials, if private
- Anything else specific to this project (e.g. extra build flags, custom paths inside the container, migration quirks)

Wait for my reply before proceeding. Once you have the details, confirm them back in one line then await the next command (e.g. "deploy changes").

Be definitive — no "may have", "might be", "possibly", "could be" hedging without evidence. Either verify and state what is true, or explicitly say "unknown, checking now" and then check. Never speculate when you can verify in seconds.

Keep every response crisp and to the point. No wall of text, no restating what I already know, no filler preamble ("Great question!", "Let me explain…"), no summary conclusion. Get straight to what matters and stop.

Never format responses as tables (markdown or ASCII). Tables are hard to copy from a terminal. Use plain bullets, short prose, or key: value lines instead.`;

const DEFAULT_SUPER_REVIEW_PROMPT = `Run the pre-merge gate. Continue applying every rule from the earlier Init Review prompt (consistency, breaking changes, races, outage/blast radius, upgrade compat, security, tests, OpenAPI drift, verified-findings-only, no hedging, no tables) AND these additional checks on top:

Pre-merge gate checklist. For each item, either confirm it's satisfied by pointing to the file/test that proves it, or flag it as missing/weak:
- [ ] Every PRD use case has a named acceptance test (spec-derived oracle, not code-derived).
- [ ] State-space matrix is published; every cell is either tested or logged as a known gap.
- [ ] Negative-test list from the PRD is automated and green.
- [ ] A round-trip / invariant test exists for the core operation.
- [ ] Fresh-session adversary review has been run on both design and diff.
- [ ] "Where can this silently do less?" is answered for every automatic mechanism.
- [ ] Design has been self-audited for contradictions before code.
- [ ] The work is merged as reviewable slices, not one big drop.

Output format:
- Group findings under two headings: "Pre-merge gate" and "Standard review".
- For gate items: "MISSING: <item> — <specific reason>" or "WEAK: <item> — <specific reason>". Skip items that are satisfied.
- For standard review: file/line + concrete issue + concrete trigger.

If you didn't run Init Review earlier in this session, run its checks first — otherwise this is incomplete.`;

const DEFAULT_DEPLOY_PROMPT = `Build the current changes and deploy them to the VM following the workflow you were anchored with. Reuse the SAME tag currently deployed on the VM — do NOT increment the version. Get the existing tag via \`kubectl get deployment <name> -o jsonpath='{.spec.template.spec.containers[0].image}'\`, patch the BASE image (never patch a patched image), re-import under that same tag, then \`kubectl rollout restart\` to force pods to pick up the new image. Report each step crisply: build output, transfer time, image patch, kubectl rollout, final pod status (2/2 Running). Stop and ask if anything fails.

Be definitive — no "may have", "might be", "possibly", "could be" hedging without evidence. Either verify and state what is true, or explicitly say "unknown, checking now" and then check. Never speculate when you can verify in seconds.

Keep every response crisp and to the point. No wall of text, no restating what I already know, no filler preamble ("Great question!", "Let me explain…"), no summary conclusion. Get straight to what matters and stop.

Never format responses as tables (markdown or ASCII). Tables are hard to copy from a terminal. Use plain bullets, short prose, or key: value lines instead.`;

const DEFAULT_SYNC_PROMPT = `Sync this branch with the latest origin/main, resolve any conflicts, and push. Never force-push and never push directly to main/master.

Be definitive — no "may have", "might be", "possibly", "could be" hedging without evidence. Either verify and state what is true, or explicitly say "unknown, checking now" and then check. Never speculate when you can verify in seconds.

Keep every response crisp and to the point. No wall of text, no restating what I already know, no filler preamble ("Great question!", "Let me explain…"), no summary conclusion. Get straight to what matters and stop.

Never format responses as tables (markdown or ASCII). Tables are hard to copy from a terminal. Use plain bullets, short prose, or key: value lines instead.`;

const DEFAULT_MR_DESC_PROMPT = `Generate a crisp MR description for the work in the current branch.

Format:
- 1-2 sentence summary of WHAT this MR does (and WHY only if not obvious).
- Bullets: high-level changes only — do NOT list every file or every method.
- "Notes" section ONLY if there's something important: breaking changes, security implications, new dependencies, migration steps, deprecations, anything reviewers must know.

Rules:
- No wall of text. Skip generic section headers ("Implementation Details", "Testing", etc.) unless truly needed.
- Don't restate what the diff already shows.
- Skip a "Test plan" unless there's a non-obvious manual verification step.

To see what changed:
  git diff origin/main...HEAD --name-only
  git log origin/main..HEAD --oneline
  git diff origin/main...HEAD --stat

Output ONLY the MR description, ready to paste. No preamble like "Here's the description:".

NEVER include any AI attribution, signatures, or references — no "Co-Authored-By: Claude", "🤖 Generated with Claude Code", "Generated by AI", "Made with Claude", trailing emoji signatures, or any mention of Claude/Copilot/AI/assistant anywhere in the description. Pure human-authored tone only.

Be definitive — no "may have", "might be", "possibly", "could be" hedging without evidence. Either verify and state what is true, or explicitly say "unknown, checking now" and then check. Never speculate when you can verify in seconds.

Keep every response crisp and to the point. No wall of text, no restating what I already know, no filler preamble ("Great question!", "Let me explain…"), no summary conclusion. Get straight to what matters and stop.

Never format responses as tables (markdown or ASCII). Tables are hard to copy from a terminal. Use plain bullets, short prose, or key: value lines instead.`;


const DEFAULT_BUILD_PROMPT = `You are a build/development agent. Your job is to write production-grade code in this repo. Code you write will be reviewed by Claude or Codex models.

CRITICAL — NEVER add AI attribution anywhere. This is a hard rule with zero exceptions:
- NO "Co-Authored-By: Claude <noreply@anthropic.com>" line at the end of commit messages.
- NO "🤖 Generated with Claude Code" trailer.
- NO "Generated by AI", "Made with Claude", "Assisted by Copilot", or any variation.
- NO Anthropic/Claude/Copilot/AI/assistant/model mentioned in commit messages, MR descriptions, PR bodies, code comments, docstrings, or any file you write or edit.
- When you run \`git commit\`, do NOT append the Co-Authored-By trailer. Pass ONLY the human-authored message.
All output must read as if written by a human developer.


Standards:
- OpenAPI specs and returned responses must always be in sync — when you change a response shape, update the spec in the same commit.
- Never log, return, commit, or expose secure fields, passphrases, passwords, or API keys.
- All code must be production-grade: robust, secure, with proper error handling at trust boundaries (user input, external APIs).
- Security: actively defend against SQL injection, XSS, path traversal, secret leakage, auth/authz bypass, IDOR, SSRF, unsafe deserialization. Validate input at trust boundaries.
- No hardcoded paths or strings. Use environment variables or configurable fields wherever possible.
- Unit tests are mandatory: every new or changed code path ships with tests. Cover the happy path, edge cases, and error branches. Update existing tests when behavior changes — do not delete failing tests to make the suite pass.
- Consistency: match existing patterns in the file/module/repo. Read related files first; do not guess. If you genuinely have a better approach than what exists, call it out explicitly with the reason, and either align with existing or get agreement before diverging — don't silently introduce a new style.
- Breaking changes: before changing a public API, response shape, DB schema, config format, or CLI flag, check who depends on it. If you must break it, call it out clearly in the MR description with the migration path for consumers.
- Race conditions / concurrency: think about double-execution, lost updates, TOCTOU, ordering under parallel load, and retry idempotency BEFORE writing the code. Use locks/transactions when needed.
- Outage / blast radius: avoid N+1 queries on hot paths, unbounded loops/allocations, blocking calls in hot paths, missing timeouts. Fail-closed by default, not fail-open.
- Upgrade compatibility: assume rolling deploys with old+new versions running side-by-side. Old data, old clients, old in-flight requests, and old workers must keep working during and after deploy. If a migration is needed, write it as a separate step and ensure the code is backward-compatible until the migration completes.
- Customer version upgrades (older → latest): whatever you build must survive a customer upgrading from an OLDER installed version — possibly several versions back, not just N-1 — to the latest. Make migrations idempotent, ordered, and resumable after a partial/failed upgrade; never assume the starting version is the immediately-previous one — support the whole supported-version range and multi-version jumps (v1 → v5 directly). Auto-migrate old config/settings formats and old persisted data; give every new required field/column a safe default or a backfill so existing installs keep working. Do not hard-remove a field, column, endpoint, or config key that old data or older clients still depend on without a migration and a deprecation path. Keep upgrade steps fail-closed and rollback-safe — a failed upgrade must never corrupt existing customer data.
- Do not add half-finished implementations, speculative features, or backwards-compat shims for code that hasn't shipped.
- Do not add comments that just restate what the code does. Only comment the non-obvious "why".

Workflow:
- Before pushing to an MR, always: git pull from main, merge, resolve conflicts, then push.
- Keep MR descriptions crisp and to the point — no walls of text. Bullet what changed and why.
- Before making non-trivial changes, briefly state your plan and what files you'll touch.
- If a review comment is wrong or based on misreading the code, push back with file/line and concrete reasoning instead of accepting blindly.

When given a task, do the work. When given a review, address it (or push back). Don't re-ask for confirmation on small things.

Be definitive — no "may have", "might be", "possibly", "could be" hedging without evidence. Either verify and state what is true, or explicitly say "unknown, checking now" and then check. Never speculate when you can verify in seconds.

Keep every response crisp and to the point. No wall of text, no restating what I already know, no filler preamble ("Great question!", "Let me explain…"), no summary conclusion. Get straight to what matters and stop.

Never format responses as tables (markdown or ASCII). Tables are hard to copy from a terminal. Use plain bullets, short prose, or key: value lines instead.`;

const DEFAULT_TICKET_PROMPT = `Ask me for the Jira ticket key/URL, Confluence page URL/ID, or Bugzilla bug ID/URL (or multiple links). Once I share it:

1. Fetch the full ticket/doc content using the exported shell env vars (\`$JIRA_BASE_URL\` + \`$JIRA_TOKEN\`, \`$CONFLUENCE_BASE_URL\` + \`$CONFLUENCE_TOKEN\`, \`$BUGZILLA_BASE_URL\`, \`$GITLAB_BASE_URL\` + \`$GITLAB_TOKEN\`). Do NOT ask me for tokens or base URLs — they are already in the environment.
2. Read the relevant files in this repository to verify how the system actually works today (do not guess).
3. Produce a crisp, scannable brief covering:
   - Problem & Goal (1–2 sentences)
   - Concrete Requirements & Acceptance Criteria
   - Affected Files / Components / APIs / DB Schema (exact paths & symbols)
   - Edge Cases, Risks, Upgrade/Compat Impact, and Open Questions
   - Recommended Implementation Plan (ordered, reviewable slices)

Rules:
- Never write implementation code yet — wait for my direction.
- Be definitive; verify in code instead of hedging.
- Keep it crisp and scannable. Never format responses as markdown or ASCII tables.`;

let prompts = { designPrompt: DEFAULT_DESIGN_PROMPT, ticketPrompt: DEFAULT_TICKET_PROMPT, reviewPrompt: DEFAULT_REVIEW_PROMPT, buildPrompt: DEFAULT_BUILD_PROMPT, testPrompt: DEFAULT_TEST_PROMPT, syncPrompt: DEFAULT_SYNC_PROMPT, mrDescPrompt: DEFAULT_MR_DESC_PROMPT, deployPrompt: DEFAULT_DEPLOY_PROMPT, superReviewPrompt: DEFAULT_SUPER_REVIEW_PROMPT };
let promptsFile;

let envVars = {};
let envFile;

function workspaceRoot() {
  return path.join(os.homedir(), 'workspace');
}

function loadState() {
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
  stateFile = path.join(userData, 'state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (loaded && Array.isArray(loaded.slots) && loaded.projects) {
        state = loaded;
      }
    } catch (_) {}
  }
  if (state.slots.length === 0) state.slots = ['t1'];
  for (const id in state.projects) {
    const p = state.projects[id];
    if (!p.tabs || !Array.isArray(p.tabs) || p.tabs.length === 0) {
      p.tabs = [...ROLES];
    } else {
      // Migrate: replace old 'master' tab with 'design'
      p.tabs = p.tabs.map((t) => (t === 'master' ? 'design' : t));
      for (const role of ROLES) {
        if (!p.tabs.includes(role)) p.tabs.push(role);
      }
      // Remove any tabs not in ROLES
      p.tabs = p.tabs.filter((t) => ROLES.includes(t));
    }
    if (!p.activeTab || !p.tabs.includes(p.activeTab)) {
      p.activeTab = p.tabs[0];
    }
    delete p.role;
  }
}

function persistState() {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function loadPrompts() {
  const userData = app.getPath('userData');
  promptsFile = path.join(userData, 'prompts.json');
  if (fs.existsSync(promptsFile)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
      if (loaded && typeof loaded === 'object') {
        if (typeof loaded.designPrompt === 'string') prompts.designPrompt = loaded.designPrompt;
        if (typeof loaded.ticketPrompt === 'string') prompts.ticketPrompt = loaded.ticketPrompt;
        if (typeof loaded.reviewPrompt === 'string') prompts.reviewPrompt = loaded.reviewPrompt;
        if (typeof loaded.buildPrompt === 'string') prompts.buildPrompt = loaded.buildPrompt;
        if (typeof loaded.testPrompt === 'string') prompts.testPrompt = loaded.testPrompt;
        if (typeof loaded.syncPrompt === 'string') prompts.syncPrompt = loaded.syncPrompt;
        if (typeof loaded.mrDescPrompt === 'string') prompts.mrDescPrompt = loaded.mrDescPrompt;
        if (typeof loaded.deployPrompt === 'string') prompts.deployPrompt = loaded.deployPrompt;
        if (typeof loaded.superReviewPrompt === 'string') prompts.superReviewPrompt = loaded.superReviewPrompt;
      }
    } catch (_) {}
  }
}

function persistPrompts() {
  fs.writeFileSync(promptsFile, JSON.stringify(prompts, null, 2));
}

function parseEnvText(text) {
  const vars = {};
  const skipped = [];
  if (typeof text !== 'string') return { vars, skipped };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) { skipped.push({ line: i + 1, reason: 'missing "=" (use KEY=value)' }); continue; }
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      skipped.push({ line: i + 1, reason: `invalid name "${key}" — use letters, digits, underscore only; no spaces/dashes/dots; can't start with a digit` });
      continue;
    }
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && ((val[0] === '"' && val[val.length - 1] === '"') || (val[0] === "'" && val[val.length - 1] === "'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return { vars, skipped };
}

const ENV_DEFAULTS = {
  ANTHROPIC_BASE_URL: '',
  ANTHROPIC_AUTH_TOKEN: '',
  COPILOT_PROVIDER_BASE_URL: '',
  COPILOT_PROVIDER_API_KEY: '',
  GITLAB_BASE_URL: '',
  JIRA_BASE_URL: '',
  CONFLUENCE_BASE_URL: '',
  BUGZILLA_BASE_URL: '',
  JIRA_EMAIL: '',
};

function nonEmptyEnvVars() {
  const out = {};
  for (const [k, v] of Object.entries(envVars)) {
    if (typeof v === 'string' && v.trim() !== '') out[k] = v;
  }
  return out;
}

function shellQuote(val) {
  return `'${String(val).replace(/'/g, `'\\''`)}'`;
}

function syncShellEnvFile() {
  try {
    const dir = path.join(os.homedir(), '.vibe-ide');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'env');
    const entries = Object.entries(nonEmptyEnvVars());
    const lines = [
      '# Auto-generated by vibe-ide (chmod 600). Source from ~/.zshrc if desired:',
      '#   [ -f ~/.vibe-ide/env ] && source ~/.vibe-ide/env',
      ...entries.map(([k, v]) => `export ${k}=${shellQuote(v)}`),
      '',
    ];
    fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch (_) {}
  } catch (err) {
    console.error('[env] failed to sync ~/.vibe-ide/env:', err.message);
  }
}

function loadEnvVars() {
  const userData = app.getPath('userData');
  envFile = path.join(userData, 'env.json');
  // Seed defaults so they appear in the UI on first run
  envVars = { ...ENV_DEFAULTS };
  if (fs.existsSync(envFile)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(envFile, 'utf8'));
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        const clean = {};
        for (const k of Object.keys(loaded)) {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof loaded[k] === 'string') clean[k] = loaded[k];
        }
        // User's saved values win over defaults
        envVars = { ...ENV_DEFAULTS, ...clean };
      }
    } catch (_) {}
  }
  syncShellEnvFile();
}

function persistEnvVars() {
  fs.writeFileSync(envFile, JSON.stringify(envVars, null, 2), { mode: 0o600 });
  try { fs.chmodSync(envFile, 0o600); } catch (_) {}
  syncShellEnvFile();
}

function sanitize(name) {
  return name.trim().replace(/[^a-zA-Z0-9_./-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function nextSlotId() {
  for (let i = 1; i <= 99; i++) {
    const id = `t${i}`;
    if (!state.slots.includes(id)) return id;
  }
  return `t${Date.now()}`;
}

function deriveDisplayName(folder) {
  const root = workspaceRoot();
  if (folder === root) return path.basename(folder);
  if (folder.startsWith(root + path.sep)) return folder.slice(root.length + 1);
  return path.basename(folder);
}

function killSlotPtys(slotId) {
  for (const role of ROLES) {
    const key = `${slotId}-${role}`;
    if (ptys.has(key)) {
      try { ptys.get(key).kill(); } catch (_) {}
      ptys.delete(key);
    }
  }
}

function findWhisperBinary() {
  const candidates = [
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
    '/opt/homebrew/bin/whisper-cpp',
    '/usr/local/bin/whisper-cpp',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

function whisperModelPath() {
  return path.join(os.homedir(), '.cache', 'vibe-ide', 'ggml-base.en.bin');
}

function writeWavFile(filePath, float32Samples, sampleRate) {
  const numSamples = float32Samples.length;
  const dataBytes = numSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32Samples[i]));
    buf.writeInt16LE(s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
}

const WHISPER_VOCAB_PROMPT = 'GitLab, GitHub, Jira, Confluence, Bugzilla, Kubernetes, k3s, containerd, OpenAPI, Claude, agy, Codex, Go, React, TypeScript, SQL, MR, PR, kubectl, endpoint, migration, schema, deploy';

function cleanWhisperOutput(raw) {
  return raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:blank audio|silence|music|applause|laughter|sighing|inaudible|no speech)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function runWhisper(bin, model, wavPath) {
  return new Promise((resolve, reject) => {
    const args = ['-m', model, '-f', wavPath, '-nt', '-np', '-l', 'en', '--prompt', WHISPER_VOCAB_PROMPT];
    const proc = spawn(bin, args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`whisper-cli exited ${code}: ${err.slice(-300)}`));
      resolve(cleanWhisperOutput(out));
    });
  });
}

async function requestMediaAccess() {
  if (process.platform !== 'darwin') return;
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status !== 'granted') await systemPreferences.askForMediaAccess('microphone');
  } catch (_) {}
}

let _ipcRegistered = false;
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0b0d11',
    title: 'vibe-ide',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  try { mainWindow.webContents.setBackgroundThrottling(false); } catch (_) {}
  try { powerSaveBlocker.start('prevent-app-suspension'); } catch (_) {}

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (/^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadFile('index.html');

  if (_ipcRegistered) return;
  _ipcRegistered = true;

  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('state:get', () => state);

  ipcMain.handle('slot:add', () => {
    if (state.slots.length >= 4) return { ok: false, error: 'max 4 cells' };
    const id = nextSlotId();
    state.slots.push(id);
    persistState();
    return { ok: true, id, state };
  });

  ipcMain.handle('slot:remove', (_e, { id }) => {
    killSlotPtys(id);
    state.slots = state.slots.filter((s) => s !== id);
    delete state.projects[id];
    if (state.slots.length === 0) state.slots = ['t1'];
    persistState();
    return state;
  });

  ipcMain.handle('project:createNew', (_e, { id, name }) => {
    const display = (name || '').trim();
    if (!display) return null;
    const slug = sanitize(display) || `project-${id}`;
    const root = workspaceRoot();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    const folder = path.join(root, slug);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    state.projects[id] = { name: display, slug, folder, tabs: [...ROLES], activeTab: 'design' };
    persistState();
    return state.projects[id];
  });

  ipcMain.handle('project:loadExisting', (_e, { id, folder }) => {
    if (!folder || !fs.existsSync(folder)) return null;
    const stat = fs.statSync(folder);
    if (!stat.isDirectory()) return null;
    const name = deriveDisplayName(folder);
    const slug = sanitize(name) || `project-${id}`;
    state.projects[id] = { name, slug, folder, tabs: [...ROLES], activeTab: 'design' };
    persistState();
    return state.projects[id];
  });

  ipcMain.handle('tab:setActive', (_e, { slotId, role }) => {
    const p = state.projects[slotId];
    if (!p) return null;
    if (!p.tabs.includes(role)) return null;
    p.activeTab = role;
    persistState();
    return p;
  });

  ipcMain.handle('prompts:get', () => prompts);

  ipcMain.handle('env:get', () => envVars);

  ipcMain.handle('env:save', (_e, text) => {
    const { vars, skipped } = parseEnvText(text);
    envVars = vars;
    persistEnvVars();
    return { vars: envVars, skipped };
  });

  ipcMain.handle('prompts:save', (_e, data) => {
    if (data && typeof data.designPrompt === 'string') prompts.designPrompt = data.designPrompt;
    if (data && typeof data.ticketPrompt === 'string') prompts.ticketPrompt = data.ticketPrompt;
    if (data && typeof data.reviewPrompt === 'string') prompts.reviewPrompt = data.reviewPrompt;
    if (data && typeof data.buildPrompt === 'string') prompts.buildPrompt = data.buildPrompt;
    if (data && typeof data.testPrompt === 'string') prompts.testPrompt = data.testPrompt;
    if (data && typeof data.syncPrompt === 'string') prompts.syncPrompt = data.syncPrompt;
    if (data && typeof data.mrDescPrompt === 'string') prompts.mrDescPrompt = data.mrDescPrompt;
    if (data && typeof data.deployPrompt === 'string') prompts.deployPrompt = data.deployPrompt;
    if (data && typeof data.superReviewPrompt === 'string') prompts.superReviewPrompt = data.superReviewPrompt;
    persistPrompts();
    return prompts;
  });

  ipcMain.handle('prompts:reset', () => {
    prompts.designPrompt = DEFAULT_DESIGN_PROMPT;
    prompts.ticketPrompt = DEFAULT_TICKET_PROMPT;
    prompts.reviewPrompt = DEFAULT_REVIEW_PROMPT;
    prompts.buildPrompt = DEFAULT_BUILD_PROMPT;
    prompts.testPrompt = DEFAULT_TEST_PROMPT;
    prompts.syncPrompt = DEFAULT_SYNC_PROMPT;
    prompts.mrDescPrompt = DEFAULT_MR_DESC_PROMPT;
    prompts.deployPrompt = DEFAULT_DEPLOY_PROMPT;
    prompts.superReviewPrompt = DEFAULT_SUPER_REVIEW_PROMPT;
    persistPrompts();
    return prompts;
  });

  ipcMain.handle('dialog:pickFolder', async (_e, { defaultPath } = {}) => {
    const root = workspaceRoot();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath || root,
      title: 'Select project folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('pty:spawn', (_e, { id, cols, rows, cwd }) => {
    if (ptys.has(id)) {
      try { ptys.get(id).kill(); } catch (_) {}
    }
    const shell = process.env.SHELL || (os.platform() === 'darwin' ? '/bin/zsh' : '/bin/bash');
    const resolvedCwd = cwd && fs.existsSync(cwd) ? cwd : process.env.HOME;
    const p = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: resolvedCwd,
      env: { ...process.env, ...nonEmptyEnvVars(), TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    ptys.set(id, p);
    p.onData((data) => {
      if (ptys.get(id) === p && !mainWindow.isDestroyed()) mainWindow.webContents.send('pty:data', { id, data });
    });
    p.onExit(() => {
      if (ptys.get(id) === p) {
        ptys.delete(id);
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('pty:exit', { id });
      }
    });
    return { ok: true, pid: p.pid, cwd: resolvedCwd };
  });

  ipcMain.on('pty:write', (_e, { id, data }) => {
    const p = ptys.get(id);
    if (p) p.write(data);
  });

  ipcMain.on('pty:resize', (_e, { id, cols, rows }) => {
    const p = ptys.get(id);
    if (p) { try { p.resize(cols, rows); } catch (_) {} }
  });

  ipcMain.handle('voice:transcribe', async (_e, arrayBuf) => {
    try {
      const bin = findWhisperBinary();
      if (!bin) return { ok: false, error: 'whisper-cli not found. Run: brew install whisper-cpp' };
      const model = whisperModelPath();
      if (!fs.existsSync(model)) return { ok: false, error: `Whisper model missing at ${model}` };
      const samples = new Float32Array(arrayBuf);
      if (samples.length === 0) return { ok: false, error: 'empty audio' };
      const tmpWav = path.join(os.tmpdir(), `vibe-ide-voice-${process.pid}-${Date.now()}.wav`);
      writeWavFile(tmpWav, samples, 16000);
      try {
        const text = await runWhisper(bin, model, tmpWav);
        return { ok: true, text };
      } finally {
        fs.unlink(tmpWav, () => {});
      }
    } catch (err) {
      console.error('[voice:transcribe]', err);
      return { ok: false, error: err.message };
    }
  });

  mainWindow.on('closed', () => {
    for (const p of ptys.values()) {
      try { p.kill(); } catch (_) {}
    }
    ptys.clear();
  });
}

app.whenReady().then(async () => {
  loadState();
  loadPrompts();
  loadEnvVars();
  Menu.setApplicationMenu(null);
  createWindow();
  requestMediaAccess();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
