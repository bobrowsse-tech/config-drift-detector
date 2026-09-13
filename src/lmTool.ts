import * as vscode from 'vscode';
import type { ConfigDriftService, DriftReport } from './service';
import type { DashboardProvider } from './dashboardProvider';

interface ToolInput {
  environments?: string[];
}

/**
 * Language Model Tool — report-only. Scanning is fine; ignore-list writes
 * stay behind the dashboard Ignore button (human click).
 */
export function registerConfigDriftScanTool(
  context: vscode.ExtensionContext,
  getService: () => ConfigDriftService | undefined,
  setReport: (report: DriftReport) => void,
  dashboard: DashboardProvider
) {
  context.subscriptions.push(
    vscode.lm.registerTool('config_drift_scan', {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ToolInput>,
        _token: vscode.CancellationToken
      ) {
        const service = getService();
        if (!service) {
          return textResult('No workspace folder is open.');
        }
        const environments = options.input?.environments;
        const result = service.scan({ environments });
        setReport(result.report);
        dashboard.showReport(result.report);
        dashboard.setSummary(
          `${result.report.summary.missing} missing · ${result.report.summary.typeMismatch} type-mismatch · ${result.report.summary.ignored} ignored`
        );
        const notes = result.notes.length ? `\nNotes:\n${result.notes.map((n) => `- ${n}`).join('\n')}` : '';
        return textResult(service.formatReport(result.report) + notes);
      },
    })
  );
}

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}
