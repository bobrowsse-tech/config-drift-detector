import * as vscode from 'vscode';
import { DashboardProvider } from './dashboardProvider';
import { registerConfigDriftScanTool } from './lmTool';
import {
  ConfigDriftService,
  type DriftReport,
  type EnvironmentMapping,
} from './service';

const LAST_REPORT_KEY = 'configDrift.lastReport';
const SELECTED_KEY = 'configDrift.selectedKey';

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function createService(): ConfigDriftService | undefined {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('Config Drift Detector needs an open workspace folder.');
    return undefined;
  }
  return new ConfigDriftService(root);
}

async function confirmMappings(
  mappings: EnvironmentMapping[]
): Promise<EnvironmentMapping[] | undefined> {
  if (!mappings.length) {
    return [];
  }
  const picks = await vscode.window.showQuickPick(
    mappings.map((m) => ({
      label: m.name,
      description: `${m.sources.length} source(s)`,
      detail: m.sources.slice(0, 3).join(', ') + (m.sources.length > 3 ? '…' : ''),
      picked: true,
      mapping: m,
    })),
    {
      canPickMany: true,
      title: 'Config Drift: confirm environments to scan',
      placeHolder: 'Select environments to compare',
    }
  );
  if (!picks) {
    return undefined;
  }
  return picks.map((p) => p.mapping);
}

export function activate(context: vscode.ExtensionContext) {
  const dashboard = new DashboardProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('config-drift-detectorView', dashboard)
  );

  const getReport = () => context.workspaceState.get<DriftReport>(LAST_REPORT_KEY);
  const setReport = (report: DriftReport) => {
    void context.workspaceState.update(LAST_REPORT_KEY, report);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('configDrift.scan', async (opts?: {
      environments?: string[];
      skipConfirm?: boolean;
    }) => {
      const service = createService();
      if (!service) {
        return undefined;
      }
      dashboard.setSummary('Discovering environments…');
      const discovered = service.discover();
      let mappings = discovered.environments;
      if (opts?.environments?.length) {
        const wanted = new Set(opts.environments.map((e) => e.toLowerCase()));
        mappings = mappings.filter((m) => wanted.has(m.name));
      }
      if (!opts?.skipConfirm) {
        const confirmed = await confirmMappings(mappings);
        if (confirmed === undefined) {
          dashboard.setSummary('Scan cancelled.');
          return undefined;
        }
        mappings = confirmed;
      }
      if (!mappings.length) {
        const note = discovered.notes[0] ?? 'No environments to scan.';
        dashboard.setSummary(note);
        vscode.window.showWarningMessage(note);
        return undefined;
      }

      dashboard.setSummary(`Scanning ${mappings.length} environment(s)…`);
      const result = service.scan({ mappings, environments: mappings.map((m) => m.name) });
      setReport(result.report);
      dashboard.showReport(result.report);
      const summary = service.formatReport(result.report).split('\n').slice(0, 3).join(' · ');
      dashboard.setSummary(summary);
      vscode.window.showInformationMessage(
        `Config Drift: ${result.report.summary.missing} missing, ${result.report.summary.typeMismatch} type-mismatch, ${result.report.summary.ignored} ignored.`
      );
      return result.report;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('configDrift.viewReport', async () => {
      let report = getReport();
      if (!report) {
        report = await vscode.commands.executeCommand<DriftReport | undefined>('configDrift.scan');
      }
      if (!report) {
        return;
      }
      dashboard.showReport(report);
      dashboard.setSummary(
        `${report.summary.missing} missing · ${report.summary.typeMismatch} type-mismatch · ${report.summary.ignored} ignored · ${report.summary.ok} ok`
      );
      await vscode.commands.executeCommand('config-drift-detectorView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('configDrift.jumpToSource', async (payload?: {
      key?: string;
      environment?: string;
    }) => {
      const service = createService();
      const report = getReport();
      if (!service || !report) {
        vscode.window.showWarningMessage('Run a scan first.');
        return;
      }

      let key = payload?.key ?? context.workspaceState.get<string>(SELECTED_KEY);
      if (!key) {
        const pick = await vscode.window.showQuickPick(
          report.rows.map((r) => ({
            label: r.key,
            description: r.flag,
            detail: `present: ${r.presentIn.join(', ') || '—'}`,
          })),
          { title: 'Jump to source — select key' }
        );
        if (!pick) {
          return;
        }
        key = pick.label;
      }

      let environment = payload?.environment;
      const row = report.rows.find((r) => r.key === key);
      if (!environment && row && row.presentIn.length > 1) {
        const envPick = await vscode.window.showQuickPick(row.presentIn, {
          title: `Jump to source — environment for ${key}`,
        });
        if (!envPick) {
          return;
        }
        environment = envPick;
      }

      const loc = service.findSource(report, key, environment);
      if (!loc) {
        vscode.window.showWarningMessage(`No source location for ${key}.`);
        return;
      }
      const root = workspaceRoot()!;
      const uri = vscode.Uri.file(`${root}/${loc.sourceFile}`);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const line = Math.max(0, loc.line - 1);
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('configDrift.ignoreKey', async (payload?: {
      key?: string;
      environment?: string;
    }) => {
      const service = createService();
      const report = getReport();
      if (!service) {
        return;
      }

      let key = payload?.key ?? context.workspaceState.get<string>(SELECTED_KEY);
      if (!key) {
        const rows = report?.rows ?? [];
        const pick = await vscode.window.showQuickPick(
          rows
            .filter((r) => r.flag === 'missing' || r.flag === 'type-mismatch')
            .map((r) => ({ label: r.key, description: r.flag })),
          { title: 'Ignore key — select key to allowlist' }
        );
        if (!pick) {
          return;
        }
        key = pick.label;
      }

      const scope = await vscode.window.showQuickPick(
        [
          { label: 'All environments', description: key, env: undefined as string | undefined },
          ...(report?.rows.find((r) => r.key === key)?.missingFrom.map((e) => ({
            label: `Only ${e}`,
            description: `${key}@${e}`,
            env: e as string | undefined,
          })) ?? []),
        ],
        { title: `Ignore ${key}` }
      );
      if (!scope) {
        return;
      }

      const file = service.ignoreKey(key, payload?.environment ?? scope.env);
      vscode.window.showInformationMessage(`Added to ${file}`);
      // Re-scan silently with last mappings via full discover + skip confirm of same envs
      const refreshed = service.scan({
        environments: report?.environments,
      });
      setReport(refreshed.report);
      dashboard.showReport(refreshed.report);
      dashboard.setSummary(
        `Ignored ${key}. Now ${refreshed.report.summary.missing} missing, ${refreshed.report.summary.ignored} ignored.`
      );
    })
  );

  dashboard.onSelectKey((key) => {
    void context.workspaceState.update(SELECTED_KEY, key);
  });

  registerConfigDriftScanTool(context, () => createService(), setReport, dashboard);
}

export function deactivate() {}
