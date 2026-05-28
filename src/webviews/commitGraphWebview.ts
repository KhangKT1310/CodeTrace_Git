import * as vscode from 'vscode';
import { GitBranch, GitGraphCommit } from '../models/git';

const LANE_COLORS = [
  '#9ca3af',
  '#ec4899',
  '#0ea5e9',
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#14b8a6',
  '#f97316'
];

export function renderCommitGraphHtml(
  webview: vscode.Webview,
  repositoryRoot: string,
  commits: GitGraphCommit[],
  branches: GitBranch[],
  hasWorkingTreeChanges: boolean
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
    graphSvg: renderGraphSvg(commit.graph)
  })));
  const serializedBranches = JSON.stringify(branches);

  const branchOptions = [
    { label: 'Show All', value: '*' },
    ...branches.map(branch => ({ label: branch.name, value: branch.name }))
  ]
    .map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join('');

  const dirtyRow = hasWorkingTreeChanges
    ? `
      <button class="row row-dirty" data-index="-1" data-hash="working-tree" data-refs="">
        <span class="cell graph-cell">${renderDirtyGraphSvg()}</span>
        <span class="cell description-cell">
          <span class="title">Uncommitted Changes</span>
          <span class="subtle">Working tree contains staged or unstaged changes.</span>
        </span>
        <span class="cell date-cell">${escapeHtml(formatDate(new Date().toISOString()))} *</span>
        <span class="cell author-cell">*</span>
        <span class="cell commit-cell">*</span>
      </button>
    `
    : '';

  const rows = commits.map((commit, index) => renderRow(commit, index)).join('');

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Commit Graph</title>
      <style>
        :root {
          --bg: #23251f;
          --panel: #2a2c25;
          --panel-2: #30322a;
          --line: rgba(255, 255, 255, 0.12);
          --line-soft: rgba(255, 255, 255, 0.06);
          --text: #f5f5f4;
          --muted: #b4b4af;
          --muted-2: #8c8c86;
          --selected: rgba(255, 255, 255, 0.08);
          --hover: rgba(255, 255, 255, 0.04);
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--vscode-font-family); }
        body { min-height: 100vh; }
        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 0 12px 0 0;
          border-bottom: 1px solid var(--line);
          background: #1f211c;
        }
        .tab {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-height: 42px;
          padding: 0 14px;
          border-right: 1px solid var(--line-soft);
          background: #24261f;
          font-weight: 700;
        }
        .tab-mark {
          display: inline-grid;
          grid-template-columns: repeat(2, 5px);
          gap: 2px;
        }
        .tab-mark span:nth-child(1) { background: #0ea5e9; }
        .tab-mark span:nth-child(2) { background: #ec4899; }
        .tab-mark span:nth-child(3) { background: #22c55e; }
        .tab-mark span:nth-child(4) { background: #f59e0b; }
        .tab-mark span {
          width: 5px;
          height: 5px;
          border-radius: 1px;
          display: block;
        }
        .toolbar {
          flex: 1;
          display: grid;
          grid-template-columns: auto minmax(240px, 420px) auto auto auto auto auto auto;
          gap: 10px;
          align-items: center;
          padding: 10px 0;
        }
        .toolbar label {
          font-size: 12px;
          font-weight: 700;
          color: var(--text);
          justify-self: end;
        }
        .toolbar select,
        .toolbar input {
          width: 100%;
          min-width: 0;
          height: 30px;
          padding: 0 10px;
          border: 1px solid var(--line);
          border-radius: 6px;
          background: var(--panel);
          color: var(--text);
          font: inherit;
        }
        .toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 700;
          color: var(--text);
          white-space: nowrap;
        }
        .icon-btn {
          width: 28px;
          height: 28px;
          border: 1px solid transparent;
          border-radius: 6px;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          font: inherit;
        }
        .icon-btn:hover {
          border-color: var(--line);
          background: var(--hover);
          color: var(--text);
        }
        .repo-path {
          display: none;
        }
        .table {
          width: 100%;
        }
        .header-row,
        .row {
          display: grid;
          grid-template-columns: 136px minmax(420px, 1fr) 118px 110px 84px;
          align-items: stretch;
        }
        .header-row {
          position: sticky;
          top: 42px;
          z-index: 2;
          background: #252720;
          border-bottom: 1px solid var(--line);
        }
        .header-row span {
          padding: 8px 10px;
          font-size: 12px;
          font-weight: 700;
          color: var(--text);
        }
        .rows {
          width: 100%;
        }
        .row {
          width: 100%;
          margin: 0;
          padding: 0;
          border: 0;
          border-bottom: 1px solid transparent;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .row:hover {
          background: var(--hover);
        }
        .row.is-selected {
          background: var(--selected);
        }
        .cell {
          min-width: 0;
          padding: 6px 10px;
          display: flex;
          align-items: center;
        }
        .graph-cell {
          justify-content: flex-start;
          padding-left: 6px;
          overflow: hidden;
        }
        .graph-cell svg {
          display: block;
          overflow: visible;
        }
        .description-cell {
          display: block;
          padding-top: 5px;
          padding-bottom: 5px;
        }
        .ref-line {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-height: 20px;
          margin-bottom: 1px;
        }
        .ref-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 20px;
          padding: 0 8px;
          border-radius: 5px;
          font-size: 11px;
          line-height: 20px;
          font-weight: 700;
          color: #121212;
          white-space: nowrap;
        }
        .ref-pill::before {
          content: '⎇';
          font-size: 10px;
          opacity: 0.9;
        }
        .ref-pill.local { background: #f59e0b; }
        .ref-pill.remote { background: #22c55e; }
        .ref-pill.tag { background: #0ea5e9; }
        .ref-pill.head { background: #ec4899; }
        .title {
          display: block;
          font-size: 13px;
          line-height: 1.35;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .subtle {
          display: block;
          margin-top: 1px;
          font-size: 12px;
          color: var(--muted-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .date-cell,
        .author-cell,
        .commit-cell {
          font-size: 12px;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .commit-cell {
          font-family: var(--vscode-editor-font-family);
        }
        .footer {
          position: sticky;
          bottom: 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          border-top: 1px solid var(--line);
          background: #1f211c;
          color: var(--muted);
          font-size: 12px;
        }
        .footer strong {
          color: var(--text);
        }
        @media (max-width: 1200px) {
          .toolbar {
            grid-template-columns: 1fr;
            padding-right: 10px;
          }
          .toolbar label {
            justify-self: start;
          }
        }
      </style>
    </head>
    <body>
      <div class="topbar">
        <div class="tab">
          <span class="tab-mark"><span></span><span></span><span></span><span></span></span>
          <span>Git Graph</span>
        </div>
        <div class="toolbar">
          <label for="branch-filter">Branches:</label>
          <select id="branch-filter">${branchOptions}</select>
          <label class="toggle">
            <input id="show-remote" type="checkbox" checked />
            <span>Show Remote Branches</span>
          </label>
          <button class="icon-btn" id="search-toggle" title="Search">⌕</button>
          <input id="search" type="text" placeholder="Search commits..." />
          <button class="icon-btn" id="open-details" title="Open Commit Details">↗</button>
          <button class="icon-btn" id="refresh-graph" title="Refresh">↻</button>
          <button class="icon-btn" id="copy-hash" title="Copy Commit Hash">⧉</button>
        </div>
      </div>
      <div class="table">
        <div class="header-row">
          <span>Graph</span>
          <span>Description</span>
          <span>Date</span>
          <span>Author</span>
          <span>Commit</span>
        </div>
        <div class="rows">${dirtyRow}${rows}</div>
      </div>
      <div class="footer">
        <span><strong id="selected-summary">Select a commit</strong></span>
        <span id="selected-meta">${escapeHtml(repositoryRoot)}</span>
      </div>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const commits = ${serializedCommits};
        const branches = ${serializedBranches};
        const rows = Array.from(document.querySelectorAll('.row'));
        const branchFilter = document.getElementById('branch-filter');
        const showRemote = document.getElementById('show-remote');
        const searchInput = document.getElementById('search');
        const selectedSummary = document.getElementById('selected-summary');
        const selectedMeta = document.getElementById('selected-meta');
        const openDetails = document.getElementById('open-details');
        const refreshGraph = document.getElementById('refresh-graph');
        const copyHash = document.getElementById('copy-hash');
        let selectedIndex = commits.length > 0 ? 0 : -1;

        function renderSelection(index) {
          selectedIndex = index;
          rows.forEach(row => row.classList.toggle('is-selected', Number(row.dataset.index) === index));

          if (index < 0) {
            selectedSummary.textContent = 'Uncommitted Changes';
            selectedMeta.textContent = 'Working tree contains local changes.';
            return;
          }

          const commit = commits[index];
          if (!commit) {
            selectedSummary.textContent = 'Select a commit';
            selectedMeta.textContent = '${escapeJs(repositoryRoot)}';
            return;
          }

          selectedSummary.textContent = commit.summary || '(no summary)';
          selectedMeta.textContent = [commit.shortHash, commit.author, formatDate(commit.date)].filter(Boolean).join(' • ');
        }

        function applyFilters() {
          const branchValue = branchFilter.value.toLowerCase();
          const allowRemote = showRemote.checked;
          const searchTerm = searchInput.value.trim().toLowerCase();

          rows.forEach(row => {
            const index = Number(row.dataset.index);
            if (index < 0) {
              row.hidden = false;
              return;
            }

            const commit = commits[index];
            const refs = (commit.refs || '').toLowerCase();
            const hasRemoteRef = refs.includes('origin/') || refs.includes('remotes/');
            const branchMatch = branchValue === '*' || refs.includes(branchValue);
            const remoteMatch = allowRemote || !hasRemoteRef;
            const searchMatch = !searchTerm
              || commit.summary.toLowerCase().includes(searchTerm)
              || commit.author.toLowerCase().includes(searchTerm)
              || commit.shortHash.toLowerCase().includes(searchTerm)
              || commit.hash.toLowerCase().includes(searchTerm)
              || refs.includes(searchTerm);

            row.hidden = !(branchMatch && remoteMatch && searchMatch);
          });
        }

        function openSelectedCommit() {
          if (selectedIndex < 0) {
            return;
          }
          const commit = commits[selectedIndex];
          if (!commit) {
            return;
          }
          vscode.postMessage({ type: 'openCommit', hash: commit.hash });
        }

        function copySelectedHash() {
          if (selectedIndex < 0) {
            return;
          }
          const commit = commits[selectedIndex];
          if (!commit) {
            return;
          }
          vscode.postMessage({ type: 'copyHash', hash: commit.hash });
        }

        rows.forEach(row => {
          row.addEventListener('click', () => renderSelection(Number(row.dataset.index)));
          row.addEventListener('dblclick', () => openSelectedCommit());
        });

        branchFilter.addEventListener('change', applyFilters);
        showRemote.addEventListener('change', applyFilters);
        searchInput.addEventListener('input', applyFilters);
        openDetails.addEventListener('click', openSelectedCommit);
        refreshGraph.addEventListener('click', () => vscode.postMessage({ type: 'refreshGraph' }));
        copyHash.addEventListener('click', copySelectedHash);

        applyFilters();
        renderSelection(selectedIndex);
      </script>
    </body>
  </html>`;
}

function renderRow(commit: GitGraphCommit, index: number): string {
  const refs = commit.refs ?? '';
  return `
    <button class="row${index === 0 ? ' is-selected' : ''}" data-index="${index}" data-hash="${escapeHtml(commit.hash)}" data-refs="${escapeHtml(refs)}">
      <span class="cell graph-cell">${renderGraphSvg(commit.graph)}</span>
      <span class="cell description-cell">
        ${refs ? `<span class="ref-line">${refs.split(',').map(ref => renderRefBadge(ref.trim())).join('')}</span>` : '<span class="ref-line"></span>'}
        <span class="title">${escapeHtml(commit.summary)}</span>
        ${(commit.body || '').trim() ? `<span class="subtle">${escapeHtml((commit.body || '').split('\n')[0])}</span>` : ''}
      </span>
      <span class="cell date-cell">${escapeHtml(formatDate(commit.date))}</span>
      <span class="cell author-cell">${escapeHtml(commit.author)}</span>
      <span class="cell commit-cell">${escapeHtml(commit.shortHash)}</span>
    </button>
  `;
}

function renderGraphSvg(graph: string): string {
  const laneSpacing = 16;
  const leftPad = 10;
  const top = 18;
  const height = 36;
  const lanes = Math.max(1, Math.ceil(graph.length / 2));
  const width = leftPad * 2 + lanes * laneSpacing;
  const pieces: string[] = [];

  for (let index = 0; index < graph.length; index += 1) {
    const character = graph[index];
    if (character === ' ') {
      continue;
    }

    const lane = Math.floor(index / 2);
    const x = leftPad + lane * laneSpacing;
    const color = LANE_COLORS[lane % LANE_COLORS.length];

    if (character === '|') {
      pieces.push(`<line x1="${x}" y1="1" x2="${x}" y2="${height - 1}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" />`);
    } else if (character === '*') {
      pieces.push(`<line x1="${x}" y1="1" x2="${x}" y2="${height - 1}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" opacity="0.72" />`);
      pieces.push(`<circle cx="${x}" cy="${top}" r="4.2" fill="${color}" />`);
    } else if (character === '/') {
      pieces.push(`<path d="M ${x + laneSpacing / 2} 4 Q ${x} ${top - 4} ${x - laneSpacing / 2} ${height - 4}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" />`);
    } else if (character === '\\') {
      pieces.push(`<path d="M ${x - laneSpacing / 2} 4 Q ${x} ${top - 4} ${x + laneSpacing / 2} ${height - 4}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" />`);
    } else if (character === '_') {
      pieces.push(`<line x1="${x}" y1="${top}" x2="${x + laneSpacing}" y2="${top}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" />`);
    } else {
      pieces.push(`<circle cx="${x}" cy="${top}" r="2.2" fill="${color}" opacity="0.85" />`);
    }
  }

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="commit graph row">${pieces.join('')}</svg>`;
}

function renderDirtyGraphSvg(): string {
  return `
    <svg width="64" height="36" viewBox="0 0 64 36" role="img" aria-label="working tree">
      <line x1="16" y1="2" x2="16" y2="34" stroke="#9ca3af" stroke-width="2.2" stroke-linecap="round" />
      <circle cx="16" cy="18" r="4.8" fill="#f59e0b" />
    </svg>
  `;
}

function renderRefBadge(ref: string): string {
  const normalized = ref.replace(/^tag:\s*/i, '');
  const lower = normalized.toLowerCase();
  const kind = lower === 'head'
    ? 'head'
    : lower.startsWith('origin/') || lower.startsWith('remotes/')
      ? 'remote'
      : /^v?\d/.test(lower)
        ? 'tag'
        : 'local';
  return `<span class="ref-pill ${kind}">${escapeHtml(normalized)}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hours}:${minutes}`;
}
