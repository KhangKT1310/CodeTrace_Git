import * as vscode from 'vscode';
import {
  CommitGraphCommitDetail,
  CommitGraphCommit,
  CommitGraphConnector,
  CommitGraphPayload,
  CommitGraphRow,
  CommitGraphSegment,
  GitRefBadge,
  GitStatusFile
} from '../models/git';
import { GitCommandError, GitService } from './gitService';

const LOG_DELIMITER = '\u001f';
const RECORD_DELIMITER = '\u001e';
const GRAPH_COLORS = ['#00AEEF', '#28D94F', '#D336B8', '#F59E0B', '#8B5CF6', '#EF4444'];

export type CommitGraphQuery = {
  branchFilter: string;
  showRemoteBranches: boolean;
  searchText: string;
  refresh?: boolean;
};

type RawCommit = {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  date: string;
  refs: GitRefBadge[];
  subject: string;
  body: string;
};

type CachedPayload = {
  payload: CommitGraphPayload;
  cacheKey: string;
};

export class CommitGraphService {
  private readonly cache = new Map<string, CachedPayload>();

  constructor(private readonly gitService: GitService) {}

  invalidate(repoRoot?: string): void {
    if (!repoRoot) {
      this.cache.clear();
      return;
    }

    this.cache.delete(repoRoot);
  }

  async loadPayload(repositoryRoot: string, query: CommitGraphQuery): Promise<CommitGraphPayload> {
    const maxCommits = this.getMaxCommits();
    const cacheKey = JSON.stringify({
      branchFilter: query.branchFilter,
      showRemoteBranches: query.showRemoteBranches,
      maxCommits
    });
    const cached = this.cache.get(repositoryRoot);
    if (!query.refresh && cached?.cacheKey === cacheKey) {
      return cached.payload;
    }

    const currentBranch = await this.loadCurrentBranch(repositoryRoot);
    const branches = await this.loadBranchNames(repositoryRoot, query.showRemoteBranches, currentBranch);
    const effectiveBranchFilter = this.normalizeBranchFilter(query.branchFilter, branches);
    const [workingTreeChanges, commits] = await Promise.all([
      this.gitService.getWorkingTreeStatus(repositoryRoot),
      this.loadCommits(repositoryRoot, effectiveBranchFilter, maxCommits)
    ]);

    const payload: CommitGraphPayload = {
      repoRoot: repositoryRoot,
      currentBranch,
      branches,
      hasWorkingTreeChanges: workingTreeChanges.length > 0,
      workingTreeChanges,
      commits: this.buildGraphRows(commits)
    };

    this.cache.set(repositoryRoot, { payload, cacheKey });
    return payload;
  }

  async getWorkingTreeSummary(repositoryRoot: string): Promise<string> {
    const statuses = await this.gitService.getWorkingTreeStatus(repositoryRoot);
    if (statuses.length === 0) {
      return 'Working tree is clean.';
    }

    return statuses
      .map(status => `${status.indexStatus}${status.workingTreeStatus} ${status.path}`)
      .join('\n');
  }

  async getCommitDetail(repositoryRoot: string, hash: string): Promise<CommitGraphCommitDetail> {
    return this.gitService.getCommitGraphDetail(repositoryRoot, hash);
  }

  private normalizeBranchFilter(branchFilter: string, branches: string[]): string {
    const normalized = (branchFilter ?? '').trim().toLowerCase();
    if (!normalized || normalized === 'show all' || normalized === 'current branch') {
      return normalized || 'show all';
    }

    return branches.includes(branchFilter) ? branchFilter : 'show all';
  }

  private async loadCurrentBranch(repositoryRoot: string): Promise<string | null> {
    try {
      return await this.gitService.getCurrentBranch(repositoryRoot);
    } catch (error) {
      if (error instanceof GitCommandError && error.rawMessage.toLowerCase().includes('does not have any commits yet')) {
        return null;
      }
      throw error;
    }
  }

  private async loadBranchNames(
    repositoryRoot: string,
    showRemoteBranches: boolean,
    currentBranch: string | null
  ): Promise<string[]> {
    const branches = await this.gitService.getBranches(repositoryRoot);
    const names = branches
      .filter(branch => showRemoteBranches || !branch.remote)
      .map(branch => branch.name)
      .filter(name => name && !name.endsWith('/HEAD'));

    const branchSet = new Set<string>(['show all', 'current branch', ...names]);
    if (currentBranch) {
      branchSet.add(currentBranch);
    }

    return [...branchSet];
  }

  private async loadCommits(
    repositoryRoot: string,
    branchFilter: string,
    maxCommits: number
  ): Promise<RawCommit[]> {
    const format = `%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%s%x1f%b%x1e`;
    const target = this.resolveBranchTarget(branchFilter);
    const args = [
      'log',
      '--decorate=full',
      '--date=iso-strict',
      '--topo-order',
      `-n${maxCommits}`,
      `--pretty=format:${format}`
    ];
    if (target === '--all') {
      args.push('--all');
    } else {
      args.push(target);
    }

    try {
      const output = await this.gitService.runGit(args, repositoryRoot, {
        timeoutMs: 30_000,
        maxBuffer: 20 * 1024 * 1024
      });
      return output
        .split(RECORD_DELIMITER)
        .map(entry => entry.trim())
        .filter(Boolean)
        .map(line => this.parseCommitLine(line));
    } catch (error) {
      if (error instanceof GitCommandError && error.rawMessage.toLowerCase().includes('does not have any commits yet')) {
        return [];
      }
      throw error;
    }
  }

  private parseCommitLine(line: string): RawCommit {
    const [
      hash = '',
      parents = '',
      authorName = '',
      authorEmail = '',
      date = '',
      decorations = '',
      subject = '',
      body = ''
    ] = line.split(LOG_DELIMITER);
    return {
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      authorName,
      authorEmail,
      date,
      refs: this.parseRefs(decorations),
      subject,
      body
    };
  }

  private parseRefs(decorations: string | undefined): GitRefBadge[] {
    const value = decorations ?? '';
    if (!value.trim()) {
      return [];
    }

    const badges: GitRefBadge[] = [];
    for (const ref of value.split(',').map(item => item.trim()).filter(Boolean)) {
      if (ref.startsWith('HEAD -> ')) {
        badges.push({ name: 'HEAD', type: 'head' });
        const rawTarget = ref.slice('HEAD -> '.length);
        const target = this.normalizeRefName(rawTarget);
        if (target) {
          badges.push({ name: target, type: this.classifyRef(rawTarget, target) });
        }
        continue;
      }

      if (ref === 'HEAD') {
        badges.push({ name: 'HEAD', type: 'head' });
        continue;
      }

      if (ref.startsWith('tag: ')) {
        badges.push({ name: this.normalizeRefName(ref.slice('tag: '.length)), type: 'tag' });
        continue;
      }

      const normalized = this.normalizeRefName(ref);
      if (!normalized) {
        continue;
      }

      badges.push({ name: normalized, type: this.classifyRef(ref, normalized) });
    }

    return badges;
  }

  private normalizeRefName(value: string): string {
    return (value ?? '')
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^refs\/tags\//, '')
      .replace(/^refs\//, '')
      .trim();
  }

  private classifyRef(rawRef: string, normalized: string): GitRefBadge['type'] {
    if (normalized === 'HEAD') {
      return 'head';
    }
    if (normalized === 'stash' || normalized.startsWith('stash@{')) {
      return 'stash';
    }
    if (rawRef.startsWith('refs/tags/')) {
      return 'tag';
    }
    if (rawRef.startsWith('refs/heads/')) {
      return 'local';
    }
    if (rawRef.startsWith('refs/remotes/')) {
      return 'remote';
    }
    if (normalized.startsWith('origin/') || normalized.startsWith('upstream/')) {
      return 'remote';
    }
    return 'local';
  }

  private buildGraphRows(commits: RawCommit[]): CommitGraphCommit[] {
    const activeLanes: Array<string | null> = [];

    return commits.map(commit => {
      const before = activeLanes.slice();
      const beforeByHash = new Map<string, number>();
      before.forEach((hash, index) => {
        if (hash) {
          beforeByHash.set(hash, index);
        }
      });
      let lane = before.findIndex(hash => hash === commit.hash);
      if (lane === -1) {
        lane = this.findEmptyLane(before);
        if (lane === -1) {
          lane = before.length;
        }
      }

      const after = before.slice();
      after[lane] = commit.parents[0] ?? null;
      const connectors: CommitGraphConnector[] = [];

      for (const parent of commit.parents.slice(1)) {
        let parentLane = after.findIndex(hash => hash === parent);
        if (parentLane === -1) {
          parentLane = this.findEmptyLane(after);
          if (parentLane === -1) {
            parentLane = after.length;
          }
          after[parentLane] = parent;
        }

        connectors.push({
          fromLane: lane,
          toLane: parentLane,
          color: this.getLaneColor(parentLane),
          kind: 'merge'
        });
      }

      this.dedupeLanes(after, lane, commit.parents[0]);
      this.trimTrailingEmpty(after);
      const afterByHash = new Map<string, number>();
      after.forEach((hash, index) => {
        if (hash) {
          afterByHash.set(hash, index);
        }
      });

      for (const [hash, fromLane] of beforeByHash) {
        const toLane = afterByHash.get(hash);
        if (typeof toLane === 'number' && toLane !== fromLane) {
          connectors.push({
            fromLane,
            toLane,
            color: this.getLaneColor(toLane),
            kind: 'flow'
          });
        }
      }

      activeLanes.splice(0, activeLanes.length, ...after);

      return {
        hash: commit.hash,
        shortHash: commit.hash.slice(0, 8),
        parents: commit.parents,
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        date: commit.date,
        relativeDate: this.formatRelativeDate(commit.date),
        refs: commit.refs,
        subject: commit.subject,
        body: commit.body.trim(),
        graph: this.buildRowModel(before, after, lane, connectors)
      };
    });
  }

  private buildRowModel(
    before: Array<string | null>,
    after: Array<string | null>,
    lane: number,
    connectors: CommitGraphConnector[]
  ): CommitGraphRow {
    const laneCount = Math.max(before.length, after.length, lane + 1, 1);
    const segments: CommitGraphSegment[] = [];
    const movedFrom = new Set<number>();
    const movedTo = new Set<number>();

    for (const connector of connectors) {
      if (connector.kind === 'flow' && connector.fromLane !== connector.toLane) {
        movedFrom.add(connector.fromLane);
        movedTo.add(connector.toLane);
      }
    }

    for (let index = 0; index < laneCount; index += 1) {
      const hasBefore = Boolean(before[index]);
      const hasAfter = Boolean(after[index]);
      let part: CommitGraphSegment['part'] | null = null;

      if (movedFrom.has(index) && hasBefore) {
        part = 'top';
      } else if (movedTo.has(index) && hasAfter) {
        part = 'bottom';
      } else if (hasBefore && hasAfter) {
        part = 'full';
      } else if (hasBefore) {
        part = 'top';
      } else if (hasAfter) {
        part = 'bottom';
      }

      if (!part) {
        continue;
      }

      segments.push({
        lane: index,
        color: this.getLaneColor(index),
        part
      });
    }

    return {
      lane,
      color: this.getLaneColor(lane),
      laneCount,
      segments,
      connectors
    };
  }

  private dedupeLanes(lanes: Array<string | null>, laneToKeep: number, firstParent?: string): void {
    const seen = new Set<string>();
    for (let index = 0; index < lanes.length; index += 1) {
      const hash = lanes[index];
      if (!hash) {
        continue;
      }

      if (index === laneToKeep && firstParent && hash === firstParent) {
        seen.add(hash);
        continue;
      }

      if (seen.has(hash)) {
        lanes[index] = null;
        continue;
      }

      seen.add(hash);
    }
  }

  private trimTrailingEmpty(lanes: Array<string | null>): void {
    while (lanes.length > 0 && !lanes[lanes.length - 1]) {
      lanes.pop();
    }
  }

  private findEmptyLane(lanes: Array<string | null>): number {
    return lanes.findIndex(value => !value);
  }

  private getLaneColor(lane: number): string {
    return GRAPH_COLORS[lane % GRAPH_COLORS.length];
  }

  private resolveBranchTarget(branchFilter: string): string {
    const normalized = (branchFilter ?? '').trim().toLowerCase();
    if (!normalized || normalized === 'show all') {
      return '--all';
    }
    if (normalized === 'current branch') {
      return 'HEAD';
    }
    return branchFilter;
  }

  private getMaxCommits(): number {
    const configured = vscode.workspace.getConfiguration('codeTraceGit.commitGraph').get<number>('maxCommits', 1000);
    return Math.max(1, Math.min(5_000, configured));
  }

  private formatRelativeDate(value: string): string | undefined {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return undefined;
    }

    const elapsedMs = Date.now() - timestamp;
    const minutes = Math.round(elapsedMs / 60_000);
    if (minutes < 1) {
      return 'now';
    }
    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }

    const days = Math.round(hours / 24);
    if (days < 30) {
      return `${days}d ago`;
    }

    const months = Math.round(days / 30);
    if (months < 12) {
      return `${months}mo ago`;
    }

    return `${Math.round(months / 12)}y ago`;
  }
}
