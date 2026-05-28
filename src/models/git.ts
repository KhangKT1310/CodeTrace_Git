export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail?: string;
  date: string;
  summary: string;
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

export interface RepositoryContext {
  root: string;
  relativePath: string;
}
