export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail?: string;
  date: string;
  summary: string;
  body?: string;
  previousHash?: string;
}

export interface GitBlameLine {
  lineNumber: number;
  commit: GitCommit;
  originalLineNumber?: number;
  finalLineNumber?: number;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

export interface GitStatusFile {
  path: string;
  indexStatus: string;
  workingTreeStatus: string;
  staged: boolean;
  untracked: boolean;
}

export interface GitTag {
  name: string;
  target?: string;
}

export interface GitStash {
  ref: string;
  summary: string;
  branch?: string;
}

export interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface GitGraphCommit extends GitCommit {
  graph: string;
  refs?: string;
}

export interface GitWorktree {
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked?: string;
  prunable?: string;
}

export interface RepositoryContext {
  root: string;
  relativePath: string;
}
