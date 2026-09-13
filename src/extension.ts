import * as vscode from 'vscode';
import { DashboardProvider } from './dashboardProvider';
import { registerConfigDriftScanTool } from './lmTool';

export function activate(context: vscode.ExtensionContext) {
  const dashboard = new DashboardProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("config-drift-detectorView", dashboard)
  );

  context.subscriptions.push(vscode.commands.registerCommand("configDrift.scan", () => {
    // TODO (Scan Environments): Discovers environment definitions (by filename convention and folder structure) and builds the normalized key inventory per environment.
    vscode.window.showInformationMessage("Scan Environments \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("configDrift.viewReport", () => {
    // TODO (View Drift Report): Renders a sortable table: key, present-in, missing-from, type-mismatch flag, with severity coloring.
    vscode.window.showInformationMessage("View Drift Report \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("configDrift.jumpToSource", () => {
    // TODO (Jump to Source): Opens the exact file and line where a selected key is defined in a chosen environment.
    vscode.window.showInformationMessage("Jump to Source \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("configDrift.ignoreKey", () => {
    // TODO (Ignore Key): Adds a key to a checked-in allowlist (.configdrift-ignore) for intentionally environment-specific values, e.g. a staging-only debug flag.
    vscode.window.showInformationMessage("Ignore Key \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  // Exposes the same capability to Copilot Chat / Claude Code / any MCP-aware
  // agent via the Language Model Tool API — see contributes.languageModelTools
  // in package.json and DIRECTIVE.md, section "Language Model Tool".
  registerConfigDriftScanTool(context);
}

export function deactivate() {}
