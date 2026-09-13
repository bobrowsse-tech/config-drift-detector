import * as vscode from 'vscode';
import type { DriftReport, DriftRow } from './service';

const BUTTONS: { label: string; command: string }[] = [
  { label: 'Scan Environments', command: 'configDrift.scan' },
  { label: 'View Drift Report', command: 'configDrift.viewReport' },
  { label: 'Jump to Source', command: 'configDrift.jumpToSource' },
  { label: 'Ignore Key', command: 'configDrift.ignoreKey' },
];

export class DashboardProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private summary = 'No scan run yet.';
  private report?: DriftReport;
  private selectHandler?: (key: string) => void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  onSelectKey(handler: (key: string) => void) {
    this.selectHandler = handler;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === 'runCommand') {
        void vscode.commands.executeCommand(message.command, message.payload);
      } else if (message.type === 'selectKey') {
        this.selectHandler?.(message.key);
      } else if (message.type === 'jump') {
        void vscode.commands.executeCommand('configDrift.jumpToSource', {
          key: message.key,
          environment: message.environment,
        });
      } else if (message.type === 'ignore') {
        void vscode.commands.executeCommand('configDrift.ignoreKey', {
          key: message.key,
        });
      }
    });

    if (this.report) {
      this.showReport(this.report);
    }
  }

  setSummary(text: string) {
    this.summary = text;
    this.post({ type: 'summary', text });
  }

  showReport(report: DriftReport) {
    this.report = report;
    this.post({ type: 'report', report: serializeReport(report) });
  }

  private post(message: unknown) {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(): string {
    const buttonsHtml = BUTTONS.map(
      (b) => `<button data-command="${b.command}">${b.label}</button>`
    ).join('\n');
    const nonce = String(Date.now());

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 8px;
      font-size: var(--vscode-font-size);
    }
    button {
      display: block; width: 100%; margin-bottom: 6px; padding: 6px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 4px; cursor: pointer; text-align: left;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      display: inline-block; width: auto; margin: 0 4px 0 0; padding: 2px 8px;
      font-size: 0.75em;
    }
    #summary {
      margin: 8px 0 12px;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.8em; }
    th, td { text-align: left; padding: 4px 2px; border-bottom: 1px solid var(--vscode-widget-border, transparent); vertical-align: top; }
    th { cursor: pointer; color: var(--vscode-descriptionForeground); }
    tr.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .flag { text-transform: uppercase; font-size: 0.7em; }
    .flag.missing { color: var(--vscode-testing-iconFailed); }
    .flag.type-mismatch { color: var(--vscode-editorWarning-foreground); }
    .flag.ignored { color: var(--vscode-descriptionForeground); }
    .flag.ok { color: var(--vscode-testing-iconPassed); }
    .hint { font-size: 0.75em; color: var(--vscode-descriptionForeground); margin-top: 8px; }
  </style>
</head>
<body>
  <div id="summary">${escapeHtml(this.summary)}</div>
  ${buttonsHtml}
  <p class="hint">Type-mismatch is a heuristic (string / number-looking / boolean-looking / empty), not a hard type system. Secret values are never shown.</p>
  <table>
    <thead>
      <tr>
        <th data-sort="key">Key</th>
        <th data-sort="present">Present in</th>
        <th data-sort="missing">Missing from</th>
        <th data-sort="flag">Flag</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const rowsEl = document.getElementById('rows');
    const summaryEl = document.getElementById('summary');
    let rows = [];
    let sortKey = 'flag';
    let sortDir = -1;

    document.querySelectorAll('button[data-command]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'runCommand', command: btn.dataset.command });
      });
    });

    document.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortKey === key) { sortDir *= -1; } else { sortKey = key; sortDir = 1; }
        render();
      });
    });

    function severity(flag) {
      return flag === 'missing' ? 3 : flag === 'type-mismatch' ? 2 : flag === 'ok' ? 1 : 0;
    }

    function render() {
      const sorted = [...rows].sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'key') cmp = a.key.localeCompare(b.key);
        else if (sortKey === 'present') cmp = a.presentIn.join(',').localeCompare(b.presentIn.join(','));
        else if (sortKey === 'missing') cmp = a.missingFrom.join(',').localeCompare(b.missingFrom.join(','));
        else cmp = severity(a.flag) - severity(b.flag);
        return cmp * sortDir;
      });
      rowsEl.innerHTML = '';
      for (const r of sorted) {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escape(r.key) + '</td>' +
          '<td>' + escape(r.presentIn.join(', ') || '—') + '</td>' +
          '<td>' + escape(r.missingFrom.join(', ') || '—') + '</td>' +
          '<td><span class="flag ' + r.flag + '">' + escape(r.flag) + (r.typeMismatch && r.flag !== 'type-mismatch' ? ' *' : '') + '</span></td>' +
          '<td></td>';
        const actions = tr.lastChild;
        const jump = document.createElement('button');
        jump.className = 'secondary';
        jump.textContent = 'Jump';
        jump.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: 'jump', key: r.key, environment: r.presentIn[0] });
        });
        const ignore = document.createElement('button');
        ignore.className = 'secondary';
        ignore.textContent = 'Ignore';
        ignore.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: 'ignore', key: r.key });
        });
        actions.appendChild(jump);
        actions.appendChild(ignore);
        tr.addEventListener('click', () => {
          rowsEl.querySelectorAll('tr').forEach((x) => x.classList.remove('selected'));
          tr.classList.add('selected');
          vscode.postMessage({ type: 'selectKey', key: r.key });
        });
        rowsEl.appendChild(tr);
      }
    }

    function escape(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'summary') {
        summaryEl.textContent = msg.text;
      } else if (msg.type === 'report') {
        rows = msg.report.rows || [];
        render();
      }
    });
  </script>
</body>
</html>`;
  }
}

function serializeReport(report: DriftReport) {
  return {
    scannedAt: report.scannedAt,
    environments: report.environments,
    summary: report.summary,
    rows: report.rows.map((r: DriftRow) => ({
      key: r.key,
      presentIn: r.presentIn,
      missingFrom: r.missingFrom,
      flag: r.flag,
      typeMismatch: r.typeMismatch,
    })),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
