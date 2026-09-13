
# Build Directive — Config Drift Detector

> Rank **#2** in the Unbuilt VS Code Tools roadmap. This directive is written for an AI coding agent (Claude Code, Copilot agent mode, or a human following along) to execute directly. The `config-drift-detector/` folder next to this file already contains a working scaffold — activation, side-panel dashboard, command registration, and a Language Model Tool stub — generated per the shared conventions in `../AGENTS.md`. Everything marked `TODO` below is the real remaining work.

## 1. Objective

Build a normalized key/value inventory per environment from .env files, Kubernetes ConfigMaps/Secrets (structure only), and per-environment Terraform tfvars, then diff across environments to surface keys that are missing, renamed, or type-mismatched — the class of bug that causes 'works in staging, breaks in prod'.

## 2. Why this doesn't already exist

Secret managers store values per environment but never diff structure across them. Infra-as-code linters validate syntax, not cross-environment parity. Nobody owns catching 'this key exists in staging and was never added to prod.'

## 3. VS Code surfaces this extension uses

- **Activity bar view container**: `config-drift-detectorContainer` (icon: `git-compare`)
- **Side panel dashboard**: `config-drift-detectorView`, a `WebviewViewProvider` — see `src/dashboardProvider.ts`
- **Commands**: `configDrift.scan`, `configDrift.viewReport`, `configDrift.jumpToSource`, `configDrift.ignoreKey`
- **Language Model Tool**: `config_drift_scan` — see `src/lmTool.ts` and `contributes.languageModelTools` in `package.json`. This is what lets Copilot Chat, Claude Code, or any other MCP/agent-aware surface invoke this extension's core action conversationally instead of the user hunting for the right command.

## 4. Dashboard (side panel) spec

The sidebar webview is the primary UI. It must show, at minimum, the buttons below plus a status/summary area above them (current scan state, last-run timestamp, or a short result summary — specifics depend on the feature, see phase notes).

| Button | Command | Behavior |
|---|---|---|
| **Scan Environments** | `configDrift.scan` | Discovers environment definitions (by filename convention and folder structure) and builds the normalized key inventory per environment. |
| **View Drift Report** | `configDrift.viewReport` | Renders a sortable table: key, present-in, missing-from, type-mismatch flag, with severity coloring. |
| **Jump to Source** | `configDrift.jumpToSource` | Opens the exact file and line where a selected key is defined in a chosen environment. |
| **Ignore Key** | `configDrift.ignoreKey` | Adds a key to a checked-in allowlist (.configdrift-ignore) for intentionally environment-specific values, e.g. a staging-only debug flag. |

Buttons call `vscode.commands.executeCommand`, not the tool logic directly — keep exactly one implementation of the core logic (a plain TypeScript service module with no VS Code imports) called from three places: the command handler, the dashboard's message handler, and the Language Model Tool's `invoke`. Do not fork the logic across these three entry points.

## 5. Implementation phases

1. **Environment discovery** — Detect environment groupings by convention: `.env.development` / `.env.staging` / `.env.production` siblings; a `k8s/overlays/<env>/` or `deploy/<env>/` folder layout (common with Kustomize); or a `terraform/environments/<env>/*.tfvars` layout. Let the user confirm/adjust the detected mapping in a QuickPick before the first scan.
2. **Parsing** — `.env*`: parse with `dotenv.parse` (never `require` the file, to avoid executing anything). k8s: `yaml.loadAll` each manifest, walk `spec.template.spec.containers[].env` and `envFrom` plus standalone ConfigMap/Secret `data`/`stringData` keys — record key names and a redacted type descriptor only, never the underlying secret value. Terraform: parse `.tfvars` as HCL; since a full HCL parser is heavy, start with a regex-based top-level `key = value` extractor (sufficient for flat tfvars) and note in the code that nested/module-scoped variables are a known v2 gap.
3. **Normalization & diff** — Build `Map<environment, Map<key, {type, sourceFile, line}>>`. Compute the union of all keys, then for each key compute which environments have it, flag `missing` where not universal, and flag `type-mismatch` where present but with a differently-shaped value (e.g. one environment has a numeric string, another a boolean-looking string) — this is a heuristic signal, not a hard type system, and should be labeled as such in the UI.
4. **Ignore list** — Respect a checked-in `.configdrift-ignore` (one key per line, optionally scoped as `KEY@environment`) so intentionally environment-specific keys stop being reported without needing to be silenced every scan.
5. **Dashboard wiring** — WebviewView table with columns Key / Present in / Missing from / Flag, sortable by severity, each row clickable to jump to source, with an inline 'ignore' action.
6. **Language Model Tool** — Register `config_drift_scan` so an agent can be asked 'why does staging behave differently from prod' and get the structural diff directly.
7. **Tests** — Fixture-based tests with three synthetic environments containing a deliberately missing key, a deliberately mismatched type, and a correctly-ignored key, asserting the report matches exactly.

## 6. Suggested dependencies

`dotenv`, `yaml`, `js-yaml`, `fast-glob`, `diff`

Install as regular `dependencies` (already stubbed into `package.json` — replace the `"latest"` version pins with the actual resolved versions once installed, per the pinning convention in `AGENTS.md`).

## 7. Edge cases & safety notes

- Never read or display actual secret values — only key names, source location, and a coarse type descriptor (string/number-looking/boolean-looking/empty).
- A key intentionally present only in one environment (e.g. `LOCAL_DEBUG=true`) is expected — the ignore list exists specifically so this doesn't become permanent noise.
- Large repos with hundreds of k8s manifests — cap initial scan scope to configured `deploy/`-style folders and let the user widen it, rather than walking the entire workspace by default.

## 8. Definition of done

- [ ] Core logic lives in a VS Code-free service module, unit-tested against fixtures (see phase notes above for what fixtures to build).
- [ ] All buttons in the dashboard spec are wired to real behavior, not the placeholder `showInformationMessage` stub.
- [ ] The Language Model Tool calls the same service module and returns a concise, agent-readable text result (not raw JSON dumped as text).
- [ ] No destructive or external-write action (file rewrite, PR post, process kill) runs without an explicit user-initiated click — the LM tool path in particular must stay read/report-only unless the directive above says otherwise.
- [ ] `npm run package` produces a `dist/extension.js` with no bundling warnings; `vsce package` produces a `.vsix` that installs cleanly via `code --install-extension`.
- [ ] README.md (user-facing, not this directive) documents what the extension does in plain language, per `AGENTS.md`'s copy conventions.
    