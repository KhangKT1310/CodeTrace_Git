declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
};

type GitRefBadge = {
  name: string;
  type: 'local' | 'remote' | 'tag' | 'head' | 'stash' | 'other';
};

type CommitGraphSegment = {
  lane: number;
  color: string;
  part: 'full' | 'top' | 'bottom';
};

type CommitGraphConnector = {
  fromLane: number;
  toLane: number;
  color: string;
  kind: 'flow' | 'merge';
};

type CommitGraphRow = {
  lane: number;
  color: string;
  laneCount: number;
  segments: CommitGraphSegment[];
  connectors: CommitGraphConnector[];
};

type CommitGraphCommit = {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  date: string;
  relativeDate?: string;
  refs: GitRefBadge[];
  subject: string;
  body?: string;
  graph: CommitGraphRow;
};

type WorkingTreeChange = {
  path: string;
};

type CommitGraphPayload = {
  repoRoot: string;
  currentBranch: string | null;
  branches: string[];
  hasWorkingTreeChanges: boolean;
  workingTreeChanges: WorkingTreeChange[];
  commits: CommitGraphCommit[];
};

type CommitGraphChangedFile = {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
};

type CommitGraphCommitDetail = {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  date: string;
  parents: string[];
  files: CommitGraphChangedFile[];
  statsSummary?: string;
};

type ViewState = {
  branchFilter: string;
  showRemoteBranches: boolean;
  searchText: string;
  selectedHash?: string;
};

type GraphPoint = {
  x: number;
  y: number;
};

type GraphLine = {
  p1: GraphPoint;
  p2: GraphPoint;
  isCommitted: boolean;
  lockedFirst: boolean;
};

type GraphPlacement = {
  connectsTo: GraphVertex | null;
  branch: GraphBranch;
};

type GraphLayoutCommit = {
  hash: string;
  parents: string[];
  isUncommitted: boolean;
  isHead: boolean;
};

type GraphConfig = {
  colours: string[];
  grid: {
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  };
};

const vscode = acquireVsCodeApi();
const svgNs = 'http://www.w3.org/2000/svg';
const rowHeight = 26;
const graphConfig: GraphConfig = {
  colours: ['#00AEEF', '#28D94F', '#D336B8', '#F59E0B', '#8B5CF6', '#EF4444', '#14B8A6', '#94A3B8'],
  grid: {
    x: 14,
    y: rowHeight,
    offsetX: 22,
    offsetY: rowHeight / 2
  }
};
const state: ViewState = vscode.getState() ?? {
  branchFilter: 'show all',
  showRemoteBranches: true,
  searchText: ''
};

let payload: CommitGraphPayload | null = null;
let selectedHash = state.selectedHash;
let selectedKind: 'commit' | 'workingTree' | null = null;
let searchTimer: number | undefined;

const branchFilter = document.getElementById('branch-filter') as HTMLSelectElement;
const showRemote = document.getElementById('show-remote') as HTMLInputElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const refreshButton = document.getElementById('refresh') as HTMLButtonElement;
const settingsButton = document.getElementById('settings') as HTMLButtonElement;
const rowsElement = document.getElementById('rows') as HTMLDivElement;
const errorElement = document.getElementById('error') as HTMLDivElement;
const loadingElement = document.getElementById('loading') as HTMLDivElement;
const appElement = document.getElementById('app') as HTMLDivElement;
const detailsElement = document.getElementById('details') as HTMLDivElement;
const detailsOpenButton = document.getElementById('details-open') as HTMLButtonElement;
const detailsEmptyElement = document.getElementById('details-empty') as HTMLDivElement;
const detailsBodyElement = document.getElementById('details-body') as HTMLDivElement;
const detailHashElement = document.getElementById('detail-hash') as HTMLSpanElement;
const detailParentsElement = document.getElementById('detail-parents') as HTMLSpanElement;
const detailAuthorElement = document.getElementById('detail-author') as HTMLSpanElement;
const detailCommitterElement = document.getElementById('detail-committer') as HTMLSpanElement;
const detailDateElement = document.getElementById('detail-date') as HTMLSpanElement;
const detailSubjectElement = document.getElementById('detail-subject') as HTMLDivElement;
const detailBodyTextElement = document.getElementById('detail-body-text') as HTMLPreElement;
const detailStatsElement = document.getElementById('detail-stats') as HTMLSpanElement;
const detailFilesElement = document.getElementById('detail-files') as HTMLDivElement;

class GraphBranch {
  private readonly colour: number;
  private end = 0;
  private readonly lines: GraphLine[] = [];

  constructor(colour: number) {
    this.colour = colour;
  }

  addLine(p1: GraphPoint, p2: GraphPoint, isCommitted: boolean, lockedFirst: boolean): void {
    this.lines.push({ p1, p2, isCommitted, lockedFirst });
  }

  getColour(): number {
    return this.colour;
  }

  setEnd(end: number): void {
    this.end = end;
  }

  getEnd(): number {
    return this.end;
  }

  draw(svg: SVGSVGElement, config: GraphConfig): void {
    const colour = config.colours[this.colour % config.colours.length];
    const placedLines = this.lines
      .map(line => ({
        p1: this.toPixel(line.p1, config),
        p2: this.toPixel(line.p2, config),
        isCommitted: line.isCommitted,
        lockedFirst: line.lockedFirst
      }));
    const simplified = this.simplifyLines(placedLines);
    const curveHeight = config.grid.y * 0.8;
    let path = '';

    for (let index = 0; index < simplified.length; index += 1) {
      const line = simplified[index];
      const previous = index > 0 ? simplified[index - 1] : undefined;

      if (path && previous && previous.isCommitted !== line.isCommitted) {
        GraphBranch.appendPath(svg, path, previous.isCommitted, colour);
        path = '';
      }

      if (!path || (previous && (line.p1.x !== previous.p2.x || line.p1.y !== previous.p2.y))) {
        path += `M${line.p1.x.toFixed(0)},${line.p1.y.toFixed(1)}`;
      }

      if (line.p1.x === line.p2.x) {
        path += `L${line.p2.x.toFixed(0)},${line.p2.y.toFixed(1)}`;
        continue;
      }

      const control1Y = line.p1.y + curveHeight;
      const control2Y = line.p2.y - curveHeight;
      path += `C${line.p1.x.toFixed(0)},${control1Y.toFixed(1)} ${line.p2.x.toFixed(0)},${control2Y.toFixed(1)} ${line.p2.x.toFixed(0)},${line.p2.y.toFixed(1)}`;
    }

    if (path && simplified.length > 0) {
      GraphBranch.appendPath(svg, path, simplified[simplified.length - 1].isCommitted, colour);
    }
  }

  private toPixel(point: GraphPoint, config: GraphConfig): GraphPoint {
    return {
      x: point.x * config.grid.x + config.grid.offsetX,
      y: point.y * config.grid.y + config.grid.offsetY
    };
  }

  private simplifyLines(lines: GraphLine[]): GraphLine[] {
    const simplified = lines.slice();
    let index = 0;

    while (index < simplified.length - 1) {
      const current = simplified[index];
      const next = simplified[index + 1];
      const canJoin =
        current.p1.x === current.p2.x &&
        current.p2.x === next.p1.x &&
        next.p1.x === next.p2.x &&
        current.p2.y === next.p1.y &&
        current.isCommitted === next.isCommitted;

      if (!canJoin) {
        index += 1;
        continue;
      }

      current.p2.y = next.p2.y;
      simplified.splice(index + 1, 1);
    }

    return simplified;
  }

  private static appendPath(svg: SVGSVGElement, pathData: string, isCommitted: boolean, colour: string): void {
    const shadow = document.createElementNS(svgNs, 'path');
    shadow.setAttribute('d', pathData);
    shadow.setAttribute('fill', 'none');
    shadow.setAttribute('stroke', 'rgba(0, 0, 0, 0.32)');
    shadow.setAttribute('stroke-width', '3.8');
    shadow.setAttribute('stroke-linecap', 'round');
    shadow.setAttribute('stroke-linejoin', 'round');
    shadow.setAttribute('opacity', '0.3');
    svg.appendChild(shadow);

    const line = document.createElementNS(svgNs, 'path');
    line.setAttribute('d', pathData);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', isCommitted ? colour : '#808080');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('opacity', '0.95');
    if (!isCommitted) {
      line.setAttribute('stroke-dasharray', '2 2');
    }
    svg.appendChild(line);
  }
}

class GraphVertex {
  private readonly isUncommitted: boolean;
  private x = 0;
  private readonly children: GraphVertex[] = [];
  private readonly parents: GraphVertex[] = [];
  private nextParent = 0;
  private branch: GraphBranch | null = null;
  private current = false;
  private nextX = 0;
  private readonly connections: Array<GraphPlacement | undefined> = [];

  constructor(
    readonly id: number,
    isUncommitted: boolean
  ) {
    this.isUncommitted = isUncommitted;
  }

  addChild(vertex: GraphVertex): void {
    this.children.push(vertex);
  }

  addParent(vertex: GraphVertex): void {
    this.parents.push(vertex);
  }

  getParents(): ReadonlyArray<GraphVertex> {
    return this.parents;
  }

  hasParents(): boolean {
    return this.parents.length > 0;
  }

  isMerge(): boolean {
    return this.parents.length > 1;
  }

  getNextParent(): GraphVertex | null {
    return this.nextParent < this.parents.length ? this.parents[this.nextParent] : null;
  }

  registerParentProcessed(): void {
    this.nextParent += 1;
  }

  addToBranch(branch: GraphBranch, x: number): void {
    if (this.branch) {
      return;
    }

    this.branch = branch;
    this.x = x;
  }

  isNotOnBranch(): boolean {
    return this.branch === null;
  }

  isOnThisBranch(branch: GraphBranch): boolean {
    return this.branch === branch;
  }

  getBranch(): GraphBranch | null {
    return this.branch;
  }

  getPoint(): GraphPoint {
    return { x: this.x, y: this.id };
  }

  getNextPoint(): GraphPoint {
    return { x: this.nextX, y: this.id };
  }

  getPointConnectingTo(vertex: GraphVertex | null, branch: GraphBranch): GraphPoint | null {
    for (let index = 0; index < this.connections.length; index += 1) {
      const connection = this.connections[index];
      if (connection?.connectsTo === vertex && connection.branch === branch) {
        return { x: index, y: this.id };
      }
    }

    return null;
  }

  registerUnavailablePoint(x: number, connectsToVertex: GraphVertex | null, branch: GraphBranch): void {
    if (x !== this.nextX) {
      return;
    }

    this.nextX = x + 1;
    this.connections[x] = { connectsTo: connectsToVertex, branch };
  }

  setCurrent(): void {
    this.current = true;
  }

  isCommitted(): boolean {
    return !this.isUncommitted;
  }

  getColourIndex(): number {
    return this.branch ? this.branch.getColour() : 0;
  }

  draw(svg: SVGSVGElement, config: GraphConfig): void {
    if (!this.branch) {
      return;
    }

    const colour = this.isUncommitted ? '#808080' : config.colours[this.branch.getColour() % config.colours.length];
    const x = this.x * config.grid.x + config.grid.offsetX;
    const y = this.id * config.grid.y + config.grid.offsetY;

    const halo = document.createElementNS(svgNs, 'circle');
    halo.setAttribute('cx', String(x));
    halo.setAttribute('cy', String(y));
    halo.setAttribute('r', this.current ? '6.2' : '5.6');
    halo.setAttribute('fill', colour);
    halo.setAttribute('opacity', '0.12');
    svg.appendChild(halo);

    const dot = document.createElementNS(svgNs, 'circle');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', this.current ? '4.2' : '3.6');
    dot.setAttribute('stroke-width', this.current ? '1.5' : '0.8');
    dot.setAttribute('stroke', colour);
    dot.setAttribute('fill', this.current ? 'var(--bg)' : colour);
    svg.appendChild(dot);
  }
}

class GraphLayoutEngine {
  private readonly vertices: GraphVertex[] = [];
  private readonly branches: GraphBranch[] = [];
  private readonly availableColours: number[] = [];

  constructor(
    commits: GraphLayoutCommit[],
    private readonly config: GraphConfig
  ) {
    if (commits.length === 0) {
      return;
    }

    const nullVertex = new GraphVertex(-1, false);
    const lookup = new Map<string, number>();
    commits.forEach((commit, index) => {
      lookup.set(commit.hash, index);
      this.vertices.push(new GraphVertex(index, commit.isUncommitted));
    });

    commits.forEach((commit, index) => {
      commit.parents.forEach(parentHash => {
        const parentIndex = lookup.get(parentHash);
        const parentVertex = typeof parentIndex === 'number' ? this.vertices[parentIndex] : nullVertex;
        this.vertices[index].addParent(parentVertex);
        if (parentVertex.id >= 0) {
          parentVertex.addChild(this.vertices[index]);
        }
      });

      if (commit.isHead) {
        this.vertices[index].setCurrent();
      }
    });

    let index = 0;
    while (index < this.vertices.length) {
      if (this.vertices[index].getNextParent() || this.vertices[index].isNotOnBranch()) {
        this.determinePath(index);
      } else {
        index += 1;
      }
    }
  }

  getWidth(): number {
    if (this.vertices.length === 0) {
      return 56;
    }

    let x = 0;
    for (const vertex of this.vertices) {
      const point = vertex.getNextPoint();
      if (point.x > x) {
        x = point.x;
      }
    }

    return Math.max(56, 2 * this.config.grid.offsetX + Math.max(0, x - 1) * this.config.grid.x + 8);
  }

  render(totalRows: number): SVGSVGElement {
    const width = this.getWidth();
    const height = Math.max(totalRows * this.config.grid.y, this.config.grid.y);
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'graph-overlay');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    svg.style.setProperty('--bg', 'var(--vscode-editor-background)');

    for (const branch of this.branches) {
      branch.draw(svg, this.config);
    }

    for (const vertex of this.vertices) {
      vertex.draw(svg, this.config);
    }

    return svg;
  }

  private determinePath(startAt: number): void {
    let index = startAt;
    let vertex = this.vertices[index];
    let parentVertex = vertex.getNextParent();
    let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();
    const startCommitted = vertex.isCommitted();

    if (
      parentVertex &&
      parentVertex.id !== -1 &&
      vertex.isMerge() &&
      !vertex.isNotOnBranch() &&
      !parentVertex.isNotOnBranch()
    ) {
      let foundPointToParent = false;
      const parentBranch = parentVertex.getBranch() as GraphBranch;

      for (index = startAt + 1; index < this.vertices.length; index += 1) {
        const currentVertex = this.vertices[index];
        let currentPoint = currentVertex.getPointConnectingTo(parentVertex, parentBranch);

        if (currentPoint) {
          foundPointToParent = true;
        } else {
          currentPoint = currentVertex.getNextPoint();
        }

        parentBranch.addLine(
          lastPoint,
          currentPoint,
          startCommitted,
          !foundPointToParent && currentVertex !== parentVertex ? lastPoint.x < currentPoint.x : true
        );
        currentVertex.registerUnavailablePoint(currentPoint.x, parentVertex, parentBranch);
        lastPoint = currentPoint;

        if (foundPointToParent) {
          vertex.registerParentProcessed();
          break;
        }
      }

      return;
    }

    const branch = new GraphBranch(this.getAvailableColour(startAt));
    vertex.addToBranch(branch, lastPoint.x);
    vertex.registerUnavailablePoint(lastPoint.x, vertex, branch);

    for (index = startAt + 1; index < this.vertices.length; index += 1) {
      const currentVertex = this.vertices[index];
      const currentPoint =
        parentVertex === currentVertex && !parentVertex.isNotOnBranch()
          ? currentVertex.getPoint()
          : currentVertex.getNextPoint();

      branch.addLine(lastPoint, currentPoint, startCommitted, lastPoint.x < currentPoint.x);
      currentVertex.registerUnavailablePoint(currentPoint.x, parentVertex, branch);
      lastPoint = currentPoint;

      if (parentVertex !== currentVertex) {
        continue;
      }

      vertex.registerParentProcessed();
      const parentAlreadyOnBranch = !parentVertex.isNotOnBranch();
      parentVertex.addToBranch(branch, currentPoint.x);
      vertex = parentVertex;
      parentVertex = vertex.getNextParent();
      if (!parentVertex || parentAlreadyOnBranch) {
        break;
      }
    }

    if (index === this.vertices.length && parentVertex && parentVertex.id === -1) {
      vertex.registerParentProcessed();
    }

    branch.setEnd(index);
    this.branches.push(branch);
    this.availableColours[branch.getColour()] = index;
  }

  private getAvailableColour(startAt: number): number {
    for (let index = 0; index < this.availableColours.length; index += 1) {
      if (startAt > this.availableColours[index]) {
        return index;
      }
    }

    this.availableColours.push(0);
    return this.availableColours.length - 1;
  }
}

branchFilter.value = state.branchFilter;
showRemote.checked = state.showRemoteBranches;
searchInput.value = state.searchText;

branchFilter.addEventListener('change', () => {
  state.branchFilter = branchFilter.value;
  syncState();
  requestFilterUpdate();
});

showRemote.addEventListener('change', () => {
  state.showRemoteBranches = showRemote.checked;
  syncState();
  requestFilterUpdate();
});

searchInput.addEventListener('input', () => {
  state.searchText = searchInput.value;
  syncState();
  renderRows();
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => requestFilterUpdate(), 200);
});

refreshButton.addEventListener('click', () => {
  showLoading(true);
  vscode.postMessage({ type: 'commitGraph:refresh' });
});

settingsButton.addEventListener('click', () => {
  vscode.postMessage({ type: 'commitGraph:settings' });
});

detailsOpenButton.addEventListener('click', () => {
  openSelection();
});

rowsElement.addEventListener('keydown', event => {
  if (!payload) {
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSelection(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSelection(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    openSelection();
  }
});

window.addEventListener('message', event => {
  const message = event.data;
  if (message?.type === 'commitGraph:data') {
    showLoading(false);
    showError('');
    payload = message.payload as CommitGraphPayload;
    renderPayload();
    return;
  }

  if (message?.type === 'commitGraph:error') {
    showLoading(false);
    showError(String(message.message ?? 'Unable to load commit graph.'));
    return;
  }

  if (message?.type === 'commitGraph:detail') {
    renderDetail(message.payload as CommitGraphCommitDetail);
  }
});

vscode.postMessage({
  type: 'commitGraph:ready',
  branchFilter: state.branchFilter,
  showRemoteBranches: state.showRemoteBranches,
  searchText: state.searchText
});

function renderPayload(): void {
  if (!payload) {
    return;
  }

  renderBranchOptions();
  renderRows();
}

function renderBranchOptions(): void {
  if (!payload) {
    return;
  }

  const options = payload.branches.length > 0 ? payload.branches : ['show all', 'current branch'];
  const previous = state.branchFilter;
  branchFilter.replaceChildren();

  for (const name of options) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = formatBranchLabel(name);
    branchFilter.appendChild(option);
  }

  if (!options.includes(previous)) {
    state.branchFilter = options.includes('show all') ? 'show all' : options[0];
    syncState();
  }

  branchFilter.value = state.branchFilter;
  showRemote.checked = state.showRemoteBranches;
}

function renderRows(): void {
  if (!payload) {
    rowsElement.replaceChildren();
    return;
  }

  const commits = getVisibleCommits();
  const totalRows = commits.length + (payload.hasWorkingTreeChanges ? 1 : 0);
  const graphWidth = renderGraphOverlay(commits, totalRows);
  appElement.style.setProperty('--graph-width', `${graphWidth}px`);

  const content = document.createElement('div');
  content.className = 'rows__content';

  if (payload.hasWorkingTreeChanges) {
    content.appendChild(createWorkingTreeRow(payload.workingTreeChanges.length));
  }

  for (const commit of commits) {
    content.appendChild(createCommitRow(commit));
  }

  rowsElement.appendChild(content);

  selectedKind = null;
  if (selectedHash) {
    const row = rowsElement.querySelector<HTMLElement>(`[data-hash="${cssEscape(selectedHash)}"]`);
    if (row) {
      selectRow(row, false);
    }
  }

  if (!selectedKind) {
    const firstRow = rowsElement.querySelector<HTMLElement>('.row');
    if (firstRow) {
      selectRow(firstRow, false);
    } else {
      clearDetail();
    }
  }
}

function renderGraphOverlay(commits: CommitGraphCommit[], totalRows: number): number {
  rowsElement.replaceChildren();
  const layoutCommits = buildLayoutCommits(commits);
  const engine = new GraphLayoutEngine(layoutCommits, graphConfig);
  const overlay = engine.render(totalRows);
  rowsElement.appendChild(overlay);
  return engine.getWidth();
}

function buildLayoutCommits(commits: CommitGraphCommit[]): GraphLayoutCommit[] {
  const headHash = findHeadHash(commits);
  const layoutCommits = commits.map(commit => ({
    hash: commit.hash,
    parents: commit.parents,
    isUncommitted: false,
    isHead: commit.hash === headHash
  }));

  if (!payload?.hasWorkingTreeChanges) {
    return layoutCommits;
  }

  return [
    {
      hash: '__working_tree__',
      parents: headHash ? [headHash] : [],
      isUncommitted: true,
      isHead: !headHash
    },
    ...layoutCommits
  ];
}

function findHeadHash(commits: CommitGraphCommit[]): string | undefined {
  return commits.find(commit => commit.refs.some(ref => ref.type === 'head'))?.hash;
}

function getVisibleCommits(): CommitGraphCommit[] {
  if (!payload) {
    return [];
  }

  const term = state.searchText.trim().toLowerCase();
  if (!term) {
    return payload.commits;
  }

  return payload.commits.filter(commit => createSearchIndex(commit).includes(term));
}

function createWorkingTreeRow(changeCount: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row row--working-tree';
  row.tabIndex = -1;
  row.dataset.kind = 'workingTree';
  row.addEventListener('click', () => selectRow(row));
  row.addEventListener('dblclick', () => openSelection());

  row.appendChild(createGraphSpacerCell());
  row.appendChild(createDescriptionCell(`Uncommitted Changes (${changeCount})`, 'Working tree'));
  row.appendChild(createMetaCell(formatDate(new Date().toISOString()), 'cell cell--date meta'));
  row.appendChild(createMetaCell('*', 'cell cell--author meta'));
  row.appendChild(createMetaCell('*', 'cell cell--commit meta commit-hash'));
  return row;
}

function createCommitRow(commit: CommitGraphCommit): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  row.tabIndex = -1;
  row.dataset.kind = 'commit';
  row.dataset.hash = commit.hash;
  row.addEventListener('click', () => selectRow(row));
  row.addEventListener('dblclick', () => openSelection());

  row.appendChild(createGraphSpacerCell());
  row.appendChild(createDescriptionCell(commit.subject, commit.body, commit.refs));
  row.appendChild(createMetaCell(formatDate(commit.date), 'cell cell--date meta'));
  row.appendChild(createMetaCell(commit.authorName, 'cell cell--author meta'));
  row.appendChild(createMetaCell(commit.shortHash, 'cell cell--commit meta commit-hash'));
  return row;
}

function createGraphSpacerCell(): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'cell cell--graph';
  const spacer = document.createElement('span');
  spacer.className = 'graph-spacer';
  cell.appendChild(spacer);
  return cell;
}

function createDescriptionCell(subject: string, body?: string, refs: GitRefBadge[] = []): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'cell cell--description';
  const description = document.createElement('div');
  description.className = 'description';

  const visibleRefs = refs.filter(ref => state.showRemoteBranches || ref.type !== 'remote');
  if (visibleRefs.length > 0) {
    const badges = document.createElement('div');
    badges.className = 'description__badges';
    for (const ref of visibleRefs) {
      const badge = document.createElement('span');
      badge.className = `badge badge--${ref.type}`;
      badge.textContent = ref.name;
      badges.appendChild(badge);
    }
    description.appendChild(badges);
  }

  const title = document.createElement('span');
  title.className = 'description__subject';
  title.textContent = subject || '';
  description.appendChild(title);

  if (body) {
    const subtle = document.createElement('span');
    subtle.className = 'description__body';
    subtle.textContent = `- ${body.split('\n')[0]}`;
    description.appendChild(subtle);
  }

  cell.appendChild(description);
  return cell;
}

function createMetaCell(value: string, className: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = className;
  cell.textContent = value;
  return cell;
}

function createSearchIndex(commit: CommitGraphCommit): string {
  return [
    commit.hash,
    commit.shortHash,
    commit.authorName,
    commit.authorEmail,
    commit.subject,
    commit.body ?? '',
    ...commit.refs.map(ref => ref.name)
  ]
    .join(' ')
    .toLowerCase();
}

function selectRow(row: HTMLElement, focus = true): void {
  for (const current of Array.from(rowsElement.querySelectorAll<HTMLElement>('.row.is-selected'))) {
    current.classList.remove('is-selected');
  }

  row.classList.add('is-selected');
  if (focus) {
    rowsElement.focus();
  }

  selectedKind = row.dataset.kind === 'workingTree' ? 'workingTree' : 'commit';
  selectedHash = row.dataset.hash;
  state.selectedHash = selectedHash;
  syncState();

  if (selectedKind === 'commit' && selectedHash) {
    appElement.classList.add('has-details');
    detailsElement.classList.remove('hidden');
    detailsEmptyElement.classList.remove('hidden');
    detailsBodyElement.classList.add('hidden');
    vscode.postMessage({ type: 'commitGraph:selectCommit', hash: selectedHash });
  } else {
    clearDetail();
  }
}

function moveSelection(direction: 1 | -1): void {
  const visibleRows = Array.from(rowsElement.querySelectorAll<HTMLElement>('.row'));
  if (visibleRows.length === 0) {
    return;
  }

  const currentIndex = Math.max(0, visibleRows.findIndex(row => row.classList.contains('is-selected')));
  const nextIndex = Math.min(visibleRows.length - 1, Math.max(0, currentIndex + direction));
  const nextRow = visibleRows[nextIndex];
  selectRow(nextRow);
  nextRow.scrollIntoView({ block: 'nearest' });
}

function openSelection(): void {
  if (selectedKind === 'workingTree') {
    vscode.postMessage({ type: 'commitGraph:openWorkingTree' });
    return;
  }

  if (selectedHash) {
    vscode.postMessage({ type: 'commitGraph:openCommit', hash: selectedHash });
  }
}

function requestFilterUpdate(): void {
  vscode.postMessage({
    type: 'commitGraph:filterChanged',
    branchFilter: state.branchFilter,
    showRemoteBranches: state.showRemoteBranches,
    searchText: state.searchText
  });
}

function showLoading(visible: boolean): void {
  loadingElement.classList.toggle('hidden', !visible);
}

function showError(message: string): void {
  errorElement.textContent = message;
  errorElement.classList.toggle('hidden', !message);
  errorElement.classList.toggle('state--error', Boolean(message));
  if (message) {
    rowsElement.replaceChildren();
    clearDetail();
  }
}

function renderDetail(detail: CommitGraphCommitDetail): void {
  detailsElement.classList.remove('hidden');
  detailsEmptyElement.classList.add('hidden');
  detailsBodyElement.classList.remove('hidden');
  detailHashElement.textContent = detail.hash;
  detailParentsElement.textContent = detail.parents.join(', ') || '-';
  detailAuthorElement.textContent = `${detail.authorName} <${detail.authorEmail}>`;
  detailCommitterElement.textContent = `${detail.committerName} <${detail.committerEmail}>`;
  detailDateElement.textContent = formatDate(detail.date);
  detailSubjectElement.textContent = detail.subject || detail.shortHash;
  detailBodyTextElement.textContent = detail.body || 'No commit message body.';
  detailStatsElement.textContent = detail.statsSummary ?? '';
  detailFilesElement.replaceChildren();

  if (detail.files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'meta';
    empty.textContent = 'No changed files.';
    detailFilesElement.appendChild(empty);
    return;
  }

  for (const file of detail.files) {
    const row = document.createElement('div');
    row.className = 'details__file';

    const status = document.createElement('span');
    status.className = 'details__file-status';
    status.textContent = file.status;

    const filePath = document.createElement('span');
    filePath.className = 'details__file-path';
    filePath.textContent = file.path;

    const stats = document.createElement('span');
    stats.className = 'details__file-stats';
    stats.textContent = formatFileStats(file);

    row.append(status, filePath, stats);
    detailFilesElement.appendChild(row);
  }
}

function clearDetail(): void {
  appElement.classList.remove('has-details');
  detailsElement.classList.add('hidden');
  detailsEmptyElement.classList.remove('hidden');
  detailsBodyElement.classList.add('hidden');
  detailFilesElement.replaceChildren();
}

function syncState(): void {
  vscode.setState(state);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatBranchLabel(name: string): string {
  if (name === 'show all') {
    return 'Show All';
  }
  if (name === 'current branch') {
    return 'Current Branch';
  }
  return name;
}

function formatFileStats(file: CommitGraphChangedFile): string {
  const parts: string[] = [];
  if (typeof file.additions === 'number') {
    parts.push(`+${file.additions}`);
  }
  if (typeof file.deletions === 'number') {
    parts.push(`-${file.deletions}`);
  }
  return parts.join(' ') || '';
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
