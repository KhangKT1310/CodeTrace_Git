import * as vscode from 'vscode';
import { GitGraphCommit } from '../models/git';

const LANE_COLORS = [
  '#f97316',
  '#38bdf8',
  '#22c55e',
  '#e879f9',
  '#facc15',
  '#fb7185',
  '#a78bfa',
  '#14b8a6'
];

export function renderCommitGraphHtml(
  webview: vscode.Webview,
  repositoryRoot: string,
  commits: GitGraphCommit[]
): string {
  const nonce = String(Date.now());
  const serializedCommits = JSON.stringify(commits.map(commit => ({
    hash: commit.hash,
    shortHash: commit.shortHash,
    author: commit.author,
    date: commit.date,
    summary: commit.summary,
    body: commit.body ?? '',
    refs: commit.refs ?? '',
    graphHtml: renderGraphHtml(commit.graph)
  })));

  const rows = commits.map((commit, index) => `
    <button class="row${index === 0 ? ' is-selected' : ''}" data-index="${index}" data-hash="${escapeHtml(commit.hash)}">
      <span class="graph">${renderGraphHtml(commit.graph)}</span>
      <span class="summary">
        <span class="title">${escapeHtml(commit.summary)}</span>
        <span class="meta">${escapeHtml(commit.shortHash)} • ${escapeHtml(commit.author)} • ${escapeHtml(formatDate(commit.date))}</span>
        ${commit.refs ? `<span class="refs">${escapeHtml(commit.refs)}</span>` : ''}
      </span>
    </button>
  `).join('');

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Commit Graph</title>
      <style>
        :root {
          --border: rgba(128, 128, 128, 0.18);
          --surface: rgba(128, 128, 128, 0.06);
          --surface-strong: rgba(128, 128, 128, 0.12);
          --muted: var(--vscode-descriptionForeground);
          --shadow: 0 18px 40px rgba(0, 0, 0, 0.18);
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          color: var(--vscode-foreground);
          background:
            radial-gradient(circle at top left, rgba(56, 189, 248, 0.08), transparent 25%),
            radial-gradient(circle at top right, rgba(249, 115, 22, 0.08), transparent 25%),
            var(--vscode-editor-background);
          font-family: var(--vscode-font-family);
        }
        .shell {
          display: grid;
          grid-template-columns: minmax(420px, 1.8fr) minmax(320px, 1fr);
          min-height: 100vh;
        }
        .left {
          border-right: 1px solid var(--border);
          min-width: 0;
        }
        .header {
          position: sticky;
          top: 0;
          z-index: 2;
          padding: 16px 18px 14px;
          backdrop-filter: blur(10px);
          background: color-mix(in srgb, var(--vscode-editor-background) 82%, transparent);
          border-bottom: 1px solid var(--border);
        }
        .eyebrow {
          display: inline-flex;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(249, 115, 22, 0.14);
          color: #fdba74;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .header h1 {
          margin: 10px 0 6px;
          font-size: 18px;
        }
        .header p {
          margin: 0;
          font-size: 12px;
          color: var(--muted);
          word-break: break-all;
        }
        .rows {
          padding: 10px;
        }
        .row {
          width: 100%;
          display: grid;
          grid-template-columns: 150px minmax(0, 1fr);
          gap: 12px;
          align-items: start;
          padding: 12px 12px;
          margin-bottom: 8px;
          border: 1px solid transparent;
          border-radius: 14px;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .row:hover {
          background: var(--surface);
          border-color: var(--border);
        }
        .row.is-selected {
          background: var(--surface);
          border-color: rgba(56, 189, 248, 0.35);
          box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.12);
        }
        .graph {
          white-space: pre;
          font-family: var(--vscode-editor-font-family);
          font-size: 12px;
          line-height: 1.2;
          padding-top: 2px;
        }
        .lane {
          display: inline-block;
          width: 1ch;
          text-align: center;
          font-weight: 700;
        }
        .summary {
          min-width: 0;
          display: block;
        }
        .title {
          display: block;
          font-size: 13px;
          font-weight: 700;
          margin-bottom: 4px;
        }
        .meta,
        .refs {
          display: block;
          color: var(--muted);
          font-size: 12px;
        }
        .refs {
          margin-top: 5px;
        }
        .right {
          padding: 18px;
          background: linear-gradient(180deg, rgba(128, 128, 128, 0.04), transparent);
        }
        .detail-card {
          position: sticky;
          top: 18px;
          padding: 18px;
          border: 1px solid var(--border);
          border-radius: 20px;
          background: var(--surface);
          box-shadow: var(--shadow);
        }
        .detail-card h2 {
          margin: 0 0 10px;
          font-size: 19px;
          line-height: 1.25;
        }
        .detail-meta {
          display: grid;
          gap: 10px;
          margin-bottom: 16px;
        }
        .detail-meta-item {
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid var(--border);
          background: rgba(128, 128, 128, 0.05);
        }
        .detail-meta-item span {
          display: block;
          color: var(--muted);
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 4px;
        }
        .detail-meta-item strong {
          font-size: 13px;
          line-height: 1.45;
          word-break: break-word;
        }
        .message {
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid var(--border);
          background: rgba(128, 128, 128, 0.05);
          margin-bottom: 14px;
        }
        .message h3,
        .patch h3 {
          margin: 0 0 8px;
          font-size: 12px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .message p {
          margin: 0;
          white-space: pre-wrap;
          line-height: 1.55;
          font-size: 13px;
        }
        .refs-inline {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .ref-pill {
          display: inline-flex;
          padding: 5px 9px;
          border-radius: 999px;
          background: rgba(56, 189, 248, 0.12);
          color: #7dd3fc;
          font-size: 11px;
          font-weight: 700;
        }
        .patch button {
          width: 100%;
          border: 0;
          border-radius: 14px;
          padding: 12px 14px;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          color: #0f172a;
          background: linear-gradient(135deg, #38bdf8, #f97316);
        }
        .patch button:hover {
          filter: brightness(1.05);
        }
        @media (max-width: 980px) {
          .shell { grid-template-columns: 1fr; }
          .left { border-right: 0; border-bottom: 1px solid var(--border); }
          .detail-card { position: static; }
        }
      </style>
    </head>
    <body>
      <div class="shell">
        <section class="left">
          <div class="header">
            <div class="eyebrow">Commit Graph</div>
            <h1>History Overview</h1>
            <p>${escapeHtml(repositoryRoot)}</p>
          </div>
          <div class="rows">${rows}</div>
        </section>
        <aside class="right">
          <div class="detail-card">
            <h2 id="detail-title">Select a commit</h2>
            <div class="detail-meta">
              <div class="detail-meta-item">
                <span>Commit</span>
                <strong id="detail-hash">-</strong>
              </div>
              <div class="detail-meta-item">
                <span>Author</span>
                <strong id="detail-author">-</strong>
              </div>
              <div class="detail-meta-item">
                <span>Date</span>
                <strong id="detail-date">-</strong>
              </div>
            </div>
            <div class="message">
              <h3>Message</h3>
              <p id="detail-message">Select a commit on the left to inspect it here.</p>
              <div class="refs-inline" id="detail-refs"></div>
            </div>
            <div class="patch">
              <h3>Patch</h3>
              <button id="open-patch" type="button">Open Full Commit Details</button>
            </div>
          </div>
        </aside>
      </div>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const commits = ${serializedCommits};
        const rows = Array.from(document.querySelectorAll('.row'));
        const detailTitle = document.getElementById('detail-title');
        const detailHash = document.getElementById('detail-hash');
        const detailAuthor = document.getElementById('detail-author');
        const detailDate = document.getElementById('detail-date');
        const detailMessage = document.getElementById('detail-message');
        const detailRefs = document.getElementById('detail-refs');
        const openPatch = document.getElementById('open-patch');
        let selectedIndex = 0;

        function renderDetail(index) {
          const commit = commits[index];
          if (!commit) {
            return;
          }

          selectedIndex = index;
          rows.forEach((row, rowIndex) => row.classList.toggle('is-selected', rowIndex === index));
          detailTitle.textContent = commit.summary || '(no summary)';
          detailHash.textContent = commit.shortHash + '  ' + commit.hash;
          detailAuthor.textContent = commit.author;
          detailDate.textContent = new Date(commit.date).toLocaleString();
          detailMessage.textContent = (commit.body && commit.body.trim()) || commit.summary || '(no message)';
          detailRefs.innerHTML = '';

          if (commit.refs) {
            commit.refs.split(',').map(part => part.trim()).filter(Boolean).forEach(ref => {
              const pill = document.createElement('span');
              pill.className = 'ref-pill';
              pill.textContent = ref;
              detailRefs.appendChild(pill);
            });
          }
        }

        rows.forEach((row, index) => {
          row.addEventListener('click', () => renderDetail(index));
          row.addEventListener('dblclick', () => {
            vscode.postMessage({ type: 'openCommit', hash: commits[index].hash });
          });
        });

        openPatch.addEventListener('click', () => {
          const commit = commits[selectedIndex];
          if (!commit) {
            return;
          }
          vscode.postMessage({ type: 'openCommit', hash: commit.hash });
        });

        renderDetail(0);
      </script>
    </body>
  </html>`;
}

function renderGraphHtml(graph: string): string {
  let html = '';
  for (let index = 0; index < graph.length; index += 1) {
    const character = graph[index];
    if (character === ' ') {
      html += ' ';
      continue;
    }

    const laneIndex = Math.floor(index / 2) % LANE_COLORS.length;
    html += `<span class="lane" style="color:${LANE_COLORS[laneIndex]}">${escapeHtml(character)}</span>`;
  }
  return html;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
