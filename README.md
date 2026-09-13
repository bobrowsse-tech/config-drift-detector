# Config Drift Detector

Diffs environment configuration (.env, k8s, Terraform) across environments and flags the keys that silently diverged.

## Status

Scaffold generated. Core logic is not yet implemented — see `DIRECTIVE.md` for the full build plan.

## Development

```bash
npm install
npm run watch    # esbuild + tsc in watch mode
```

Then press `F5` in VS Code to launch an Extension Development Host.
