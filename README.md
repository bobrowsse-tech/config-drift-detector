# Config Drift Detector

Diffs environment configuration across `.env*` files, Kubernetes manifests, and Terraform tfvars — and flags keys that are missing, ignored on purpose, or look type-mismatched.

Open a workspace, open the **Config Drift Detector** side panel, then:

1. **Scan Environments** — discovers environments by convention and builds a key inventory (names and coarse shapes only; secret values are never shown).
2. **View Drift Report** — sortable table of Key / Present in / Missing from / Flag.
3. **Jump to Source** — opens the file and line where a key is defined.
4. **Ignore Key** — appends to a checked-in `.configdrift-ignore` (optionally `KEY@environment`) for intentionally environment-specific values.

Agents can call `config_drift_scan` for a report-only structural diff.

## Development

```bash
npm install
npm run watch
npm run test:unit
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

MIT
