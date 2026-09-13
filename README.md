# Config Drift Detector

Diffs environment configuration across `.env*` files, Kubernetes overlays, and Terraform tfvars — flags keys that are missing, intentionally ignored, or look type-mismatched. Secret **values** are never shown (names and coarse shapes only).

## Install

```bash
git clone https://github.com/bobrowsse-tech/config-drift-detector.git
cd config-drift-detector
npm install
npm run package
npx @vscode/vsce package --no-dependencies
code --install-extension config-drift-detector-0.1.0.vsix
```

Or press **F5** after `npm install` for an Extension Development Host.

## Use

Open the **Config Drift Detector** side panel:

| Action | What it does |
|---|---|
| **Scan Environments** | Discovers envs by convention and builds a key inventory |
| **View Drift Report** | Key / present in / missing from / flag |
| **Jump to Source** | Opens the defining file:line |
| **Ignore Key** | Appends to checked-in `.configdrift-ignore` (`KEY` or `KEY@env`) |

Agents can call `config_drift_scan` (report-only).

## How it’s built

TypeScript strict + esbuild CJS bundle; VS Code–free service in `src/service/`; dashboard + LM tool call the same module.

```bash
npm run watch
npm run test:unit
npm run package
```

## License

MIT

## Contributing

Changes to `main` must go through a pull request. See [CONTRIBUTING.md](./CONTRIBUTING.md).

### Extension Development Host

With the local suite umbrella checked out, press **F5** (**Extension + playground**) to load `../playgrounds/config-drift-detector/` as the test workspace.
