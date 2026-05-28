import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import {
  CommitGraphChangedFile,
  CommitGraphCommitDetail,
  GitBlameLine,
  GitBranch,
  GitCommit,
  GitGraphCommit,
  GitRemote,
  GitStash,
  GitStatusFile,
  GitTag,
  GitWorktree,
  RepositoryContext
} from '../models/git';

const execFileAsync = promisify(execFile);
const LOG_DELIMITER = '\u001f';
const RECORD_DELIMITER = '\u001e';
const DEFAULT_TIMEOUT_MS = 15_000;

type GitRunOptions = {
  timeoutMs?: number;
  maxBuffer?: number;
};

export class GitService {
  async getWorkspaceRepositories(): Promise<RepositoryContext[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const repositories = new Map<string, RepositoryContext>();

    for (const folder of folders) {
      try {
        const root = (await this.runGit(['rev-parse', '--show-toplevel'], folder.uri.fsPath)).trim();
        repositories.set(root, { root, relativePath: '.' });
      } catch (_error) {
        continue;
      }
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri?.scheme === 'file') {
      const repository = await this.getRepositoryContext(activeUri);
      if (repository) {
        repositories.set(repository.root, { root: repository.root, relativePath: '.' });
      }
    }

    return [...repositories.values()].sort((left, right) => left.root.localeCompare(right.root));
  }

  async getRepositoryContext(uri: vscode.Uri): Promise<RepositoryContext | undefined> {
    if (uri.scheme !== 'file') {
      return undefined;
    }

    const filePath = uri.fsPath;
    const cwd = path.dirname(filePath);

    try {
      const root = (await this.runGit(['rev-parse', '--show-toplevel'], cwd)).trim();
      return {
        root,
        relativePath: path.relative(root, filePath).replace(/\\/g, '/')
      };
    } catch (error) {
      if (error instanceof GitCommandError && error.isRepositoryError) {
        return undefined;
      }

      throw error;
    }
  }

  async getCurrentBranch(repositoryRoot: string): Promise<string | null> {
    const output = await this.runGit(['branch', '--show-current'], repositoryRoot);
    const branch = output.trim();
    return branch || null;
  }

  async getBlame(uri: vscode.Uri): Promise<Map<number, GitBlameLine>> {
    const repository = await this.getRequiredRepositoryContext(uri);
    const output = await this.runGit(
      ['blame', '--line-porcelain', '--', repository.relativePath],
      repository.root
    );

    return this.parseBlame(output);
  }

  async getFileHistory(uri: vscode.Uri, maxCommits: number): Promise<GitCommit[]> {
    const repository = await this.getRequiredRepositoryContext(uri);
    const format = ['%H', '%h', '%an', '%ae', '%ad', '%s', '%b', '%P'].join(LOG_DELIMITER) + RECORD_DELIMITER;
    const output = await this.runGit(
      [
        'log',
        '--follow',
        `-n${maxCommits}`,
        '--date=iso',
        `--format=${format}`,
        '--',
        repository.relativePath
      ],
      repository.root
    );

    return this.parseCommits(output);
  }

  async getCommitDetails(repositoryRoot: string, commitHash: string): Promise<string> {
    return this.runGit(['show', '--stat', '--patch', '--date=iso-strict', commitHash], repositoryRoot, {
      timeoutMs: 30_000,
      maxBuffer: 20 * 1024 * 1024
    });
  }

  async getCommitGraphDetail(repositoryRoot: string, commitHash: string): Promise<CommitGraphCommitDetail> {
    const metadataFormat = [
      '%H',
      '%h',
      '%P',
      '%an',
      '%ae',
      '%cn',
      '%ce',
      '%ad',
      '%s',
      '%b'
    ].join(LOG_DELIMITER);
    const metadataOutput = await this.runGit(
      ['show', '--no-patch', '--date=iso-strict', `--format=${metadataFormat}`, commitHash],
      repositoryRoot,
      { timeoutMs: 30_000 }
    );
    const [
      hash = '',
      shortHash = '',
      parents = '',
      authorName = '',
      authorEmail = '',
      committerName = '',
      committerEmail = '',
      date = '',
      subject = '',
      body = ''
    ] = metadataOutput.trimEnd().split(LOG_DELIMITER);

    const numstatOutput = await this.runGit(
      ['show', '--numstat', '--format=', '--find-renames', commitHash],
      repositoryRoot,
      { timeoutMs: 30_000, maxBuffer: 20 * 1024 * 1024 }
    );
    const nameStatusOutput = await this.runGit(
      ['diff-tree', '--no-commit-id', '--name-status', '-r', '--find-renames', commitHash],
      repositoryRoot,
      { timeoutMs: 30_000, maxBuffer: 20 * 1024 * 1024 }
    );

    const files = this.parseCommitChangedFiles(numstatOutput, nameStatusOutput);
    const statsSummary = files.length > 0
      ? `${files.length} file${files.length === 1 ? '' : 's'} changed`
      : undefined;

    return {
      hash,
      shortHash,
      subject,
      body: body.trim(),
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      date,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      files,
      statsSummary
    };
  }

  async getBranches(repositoryRoot: string): Promise<GitBranch[]> {
    const output = await this.runGit(
      ['branch', '--all', '--format=%(HEAD)' + LOG_DELIMITER + '%(refname:short)'],
      repositoryRoot
    );

    return output
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [headMarker = '', rawName = ''] = line.split(LOG_DELIMITER);
        const name = rawName.trim();
        return {
          name: name.replace(/^remotes\//, ''),
          current: headMarker.trim() === '*',
          remote: name.startsWith('remotes/')
        };
      })
      .filter(branch => branch.name && !branch.name.endsWith('/HEAD'));
  }

  async getTags(repositoryRoot: string): Promise<GitTag[]> {
    const output = await this.runGit(
      ['tag', '--list', '--format=%(refname:short)' + LOG_DELIMITER + '%(objectname:short)'],
      repositoryRoot
    );

    return output
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, target] = line.split(LOG_DELIMITER);
        return { name, target };
      });
  }

  async getStashes(repositoryRoot: string): Promise<GitStash[]> {
    const output = await this.runGit(
      ['stash', 'list', `--format=%gd${LOG_DELIMITER}%gs`],
      repositoryRoot
    );

    return output
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [ref, summary] = line.split(LOG_DELIMITER);
        const branchMatch = summary.match(/^On ([^:]+):\s*(.*)$/);
        return {
          ref,
          summary: branchMatch ? branchMatch[2] : summary,
          branch: branchMatch?.[1]
        };
      });
  }

  async getRemotes(repositoryRoot: string): Promise<GitRemote[]> {
    const output = await this.runGit(['remote', '-v'], repositoryRoot);
    const remotes = new Map<string, GitRemote>();

    for (const line of output.split('\n').filter(Boolean)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
      if (!match) {
        continue;
      }

      const [, name, url, type] = match;
      const remote = remotes.get(name) ?? { name };
      if (type === 'fetch') {
        remote.fetchUrl = url;
      } else {
        remote.pushUrl = url;
      }
      remotes.set(name, remote);
    }

    return [...remotes.values()];
  }

  async getWorkingTreeStatus(repositoryRoot: string): Promise<GitStatusFile[]> {
    const output = await this.runGit(['status', '--porcelain', '--untracked-files=all'], repositoryRoot);

    return output
      .split('\n')
      .map(line => line.trimEnd())
      .filter(Boolean)
      .map(line => {
        const indexStatus = line[0] ?? ' ';
        const workingTreeStatus = line[1] ?? ' ';
        const filePath = line.slice(3).trim();
        return {
          path: filePath,
          indexStatus,
          workingTreeStatus,
          staged: indexStatus !== ' ' && indexStatus !== '?',
          untracked: indexStatus === '?' || workingTreeStatus === '?'
        };
      });
  }

  async searchCommits(repositoryRoot: string, query: string, maxResults: number): Promise<GitCommit[]> {
    const format = ['%H', '%h', '%an', '%ae', '%ad', '%s', '%b', '%P'].join(LOG_DELIMITER) + RECORD_DELIMITER;
    const outputs: string[] = [];
    const seen = new Set<string>();

    const appendResults = (content: string): void => {
      for (const commit of this.parseCommits(content)) {
        if (seen.has(commit.hash)) {
          continue;
        }
        seen.add(commit.hash);
        outputs.push([
          commit.hash,
          commit.shortHash,
          commit.author,
          commit.authorEmail ?? '',
          commit.date,
          commit.summary,
          commit.body ?? '',
          commit.previousHash ?? ''
        ].join(LOG_DELIMITER));
      }
    };

    try {
      appendResults(await this.runGit(
        ['log', `-n${maxResults}`, '--date=iso', `--format=${format}`, '--all', '--grep', query],
        repositoryRoot
      ));
    } catch (_error) {}

    try {
      appendResults(await this.runGit(
        ['log', `-n${maxResults}`, '--date=iso', `--format=${format}`, '--all', '--author', query],
        repositoryRoot
      ));
    } catch (_error) {}

    if (query.length >= 4) {
      try {
        appendResults(await this.runGit(
          ['log', `-n${maxResults}`, '--date=iso', `--format=${format}`, '--all', query],
          repositoryRoot
        ));
      } catch (_error) {}
    }

    return this.parseCommits(outputs.join(RECORD_DELIMITER)).slice(0, maxResults);
  }

  async getCommit(repositoryRoot: string, commitHash: string): Promise<GitCommit | undefined> {
    const format = ['%H', '%h', '%an', '%ae', '%ad', '%s', '%b', '%P'].join(LOG_DELIMITER) + RECORD_DELIMITER;
    const output = await this.runGit(
      ['log', '-n1', '--date=iso', `--format=${format}`, commitHash],
      repositoryRoot
    );
    return this.parseCommits(output)[0];
  }

  async getCommitGraph(repositoryRoot: string, maxCommits: number): Promise<GitGraphCommit[]> {
    const format = ['%H', '%h', '%an', '%ad', '%s', '%b', '%D'].join(LOG_DELIMITER);
    const output = await this.runGit(
      [
        'log',
        '--graph',
        '--decorate=short',
        '--all',
        `-n${maxCommits}`,
        '--date=iso',
        `--format=${format}`
      ],
      repositoryRoot
    );

    return output
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const delimiterIndex = line.indexOf(LOG_DELIMITER);
        if (delimiterIndex === -1) {
          return undefined;
        }

        const graph = line.slice(0, delimiterIndex);
        const payload = line.slice(delimiterIndex + 1);
        const [hash, shortHash, author, date, summary, body, refs] = payload.split(LOG_DELIMITER);
        if (!hash || !shortHash || !author || !date || !summary) {
          return undefined;
        }
        return {
          hash,
          shortHash,
          author,
          date,
          summary,
          body,
          refs,
          graph
        } as GitGraphCommit;
      })
      .filter((commit): commit is GitGraphCommit => Boolean(commit));
  }

  async getWorktrees(repositoryRoot: string): Promise<GitWorktree[]> {
    const output = await this.runGit(['worktree', 'list', '--porcelain'], repositoryRoot);
    const blocks = output.split('\n\n').map(block => block.trim()).filter(Boolean);

    return blocks.map(block => {
      const worktree: GitWorktree = {
        path: '',
        bare: false,
        detached: false
      };

      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) {
          worktree.path = line.slice('worktree '.length).trim();
        } else if (line.startsWith('HEAD ')) {
          worktree.head = line.slice('HEAD '.length).trim();
        } else if (line.startsWith('branch ')) {
          worktree.branch = line.slice('branch refs/heads/'.length).trim();
        } else if (line === 'bare') {
          worktree.bare = true;
        } else if (line === 'detached') {
          worktree.detached = true;
        } else if (line.startsWith('locked')) {
          worktree.locked = line.slice('locked'.length).trim();
        } else if (line.startsWith('prunable')) {
          worktree.prunable = line.slice('prunable'.length).trim();
        }
      }

      return worktree;
    });
  }

  async getFileBlameDocument(uri: vscode.Uri): Promise<string> {
    const repository = await this.getRequiredRepositoryContext(uri);
    const output = await this.runGit(
      ['blame', '--date=iso', '--', repository.relativePath],
      repository.root
    );
    return output;
  }

  async getBlameForLine(uri: vscode.Uri, lineNumber: number): Promise<GitBlameLine | undefined> {
    const blame = await this.getBlame(uri);
    return blame.get(lineNumber);
  }

  async getFileContentAtRevision(uri: vscode.Uri, revision: string): Promise<string> {
    const repository = await this.getRequiredRepositoryContext(uri);
    return this.runGit(['show', `${revision}:${repository.relativePath}`], repository.root);
  }

  async getFileContentAtRevisionByRepository(
    repositoryRoot: string,
    relativePath: string,
    revision: string
  ): Promise<string> {
    return this.runGit(['show', `${revision}:${relativePath}`], repositoryRoot);
  }

  async getPreviousRevision(uri: vscode.Uri, commitHash?: string): Promise<string | undefined> {
    if (commitHash) {
      const repository = await this.getRequiredRepositoryContext(uri);
      const output = await this.runGit(['rev-parse', `${commitHash}^`], repository.root);
      return output.trim() || undefined;
    }

    const history = await this.getFileHistory(uri, 2);
    return history[1]?.hash;
  }

  async getLineHistory(uri: vscode.Uri, startLine: number, endLine: number): Promise<string> {
    const repository = await this.getRequiredRepositoryContext(uri);
    return this.runGit(
      ['log', '--date=iso', '-L', `${startLine},${endLine}:${repository.relativePath}`],
      repository.root
    );
  }

  async stageFile(repositoryRoot: string, filePath: string): Promise<void> {
    await this.runGit(['add', '--', filePath], repositoryRoot);
  }

  async unstageFile(repositoryRoot: string, filePath: string): Promise<void> {
    await this.runGit(['reset', 'HEAD', '--', filePath], repositoryRoot);
  }

  async discardFile(repositoryRoot: string, filePath: string): Promise<void> {
    await this.runGit(['checkout', '--', filePath], repositoryRoot);
  }

  async discardUntrackedFile(repositoryRoot: string, filePath: string): Promise<void> {
    await this.runGit(['clean', '-f', '--', filePath], repositoryRoot);
  }

  async addWorktree(repositoryRoot: string, worktreePath: string, branchName?: string): Promise<void> {
    const args = ['worktree', 'add'];
    if (branchName) {
      args.push('-b', branchName);
    }
    args.push(worktreePath);
    await this.runGit(args, repositoryRoot);
  }

  async removeWorktree(repositoryRoot: string, worktreePath: string, force = false): Promise<void> {
    const args = ['worktree', 'remove'];
    if (force) {
      args.push('--force');
    }
    args.push(worktreePath);
    await this.runGit(args, repositoryRoot);
  }

  async getStagedDiff(repositoryRoot: string): Promise<string> {
    return this.runGit(['diff', '--cached'], repositoryRoot);
  }

  async runGit(args: string[], cwd: string, options: GitRunOptions = {}): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024
      });

      if (stderr && stderr.trim().length > 0) {
        const normalized = stderr.trim();
        if (normalized.toLowerCase().startsWith('fatal:')) {
          throw new GitCommandError(this.toUserMessage(normalized), normalized);
        }
      }

      return stdout;
    } catch (error: unknown) {
      if (error instanceof GitCommandError) {
        throw error;
      }

      const details = error as {
        stderr?: string;
        message?: string;
        code?: string | number;
        killed?: boolean;
        signal?: string;
      };

      const stderr = String(details?.stderr ?? '').trim();
      const message = stderr || details?.message || 'Unknown Git error';
      const timedOut = details?.killed || message.toLowerCase().includes('timed out');
      const userMessage = timedOut
        ? 'The Git command timed out. Try reducing the commit graph size or refreshing again.'
        : this.toUserMessage(message);
      throw new GitCommandError(userMessage, message);
    }
  }

  private async getRequiredRepositoryContext(uri: vscode.Uri): Promise<RepositoryContext> {
    const repository = await this.getRepositoryContext(uri);
    if (!repository) {
      throw new GitCommandError('The current file is not inside a Git repository.', 'Not a repository');
    }

    return repository;
  }

  private parseBlame(output: string): Map<number, GitBlameLine> {
    const lines = output.split('\n');
    const blameByLine = new Map<number, GitBlameLine>();
    let index = 0;

    while (index < lines.length) {
      const header = lines[index]?.trim();
      if (!header) {
        index += 1;
        continue;
      }

      const headerParts = header.split(/\s+/);
      if (headerParts.length < 3) {
        index += 1;
        continue;
      }

      const commitHash = headerParts[0];
      const originalLineNumber = Number(headerParts[1]);
      const finalLineNumber = Number(headerParts[2]);
      let author = 'Unknown';
      let authorEmail = '';
      let date = '';
      let summary = '';

      index += 1;

      while (index < lines.length) {
        const line = lines[index];
        if (line.startsWith('\t')) {
          break;
        }

        if (line.startsWith('author ')) {
          author = line.slice('author '.length);
        } else if (line.startsWith('author-mail ')) {
          authorEmail = line.slice('author-mail '.length).replace(/[<>]/g, '');
        } else if (line.startsWith('author-time ')) {
          const timestamp = Number(line.slice('author-time '.length));
          if (!Number.isNaN(timestamp)) {
            date = new Date(timestamp * 1000).toISOString();
          }
        } else if (line.startsWith('summary ')) {
          summary = line.slice('summary '.length);
        }

        index += 1;
      }

      if (index < lines.length && lines[index].startsWith('\t')) {
        index += 1;
      }

      blameByLine.set(finalLineNumber - 1, {
        lineNumber: finalLineNumber - 1,
        originalLineNumber,
        finalLineNumber,
        commit: {
          hash: commitHash,
          shortHash: commitHash.slice(0, 8),
          author,
          authorEmail,
          date,
          summary
        }
      });
    }

    return blameByLine;
  }

  private parseCommits(output: string): GitCommit[] {
    return output
      .split(RECORD_DELIMITER)
      .map(record => record.trim())
      .filter(Boolean)
      .map(record => {
        const [hash, shortHash, author, authorEmail, date, summary, body, parents] = record.split(LOG_DELIMITER);
        return {
          hash,
          shortHash,
          author,
          authorEmail,
          date,
          summary,
          body,
          previousHash: parents?.split(' ')[0]
        };
      });
  }

  private parseCommitChangedFiles(numstatOutput: string, nameStatusOutput: string): CommitGraphChangedFile[] {
    const statsByPath = new Map<string, { additions?: number; deletions?: number }>();
    for (const line of numstatOutput.split('\n').filter(Boolean)) {
      const [added = '', removed = '', ...pathParts] = line.split('\t');
      const pathValue = pathParts.join('\t').trim();
      if (!pathValue) {
        continue;
      }

      statsByPath.set(pathValue, {
        additions: added === '-' ? undefined : Number(added),
        deletions: removed === '-' ? undefined : Number(removed)
      });
    }

    const files: CommitGraphChangedFile[] = [];
    for (const line of nameStatusOutput.split('\n').filter(Boolean)) {
      const [status = '', ...pathParts] = line.split('\t');
      const rawPath = pathParts[pathParts.length - 1]?.trim() ?? '';
      if (!rawPath) {
        continue;
      }

      const stats = statsByPath.get(rawPath);
      files.push({
        path: rawPath,
        status,
        additions: stats?.additions,
        deletions: stats?.deletions
      });
    }

    return files;
  }

  private toUserMessage(message: string): string {
    const normalized = message.toLowerCase();
    if (normalized.includes('not a git repository')) {
      return 'This file is not inside a Git repository.';
    }
    if (normalized.includes('no such path')) {
      return 'Git could not find the file in the repository history.';
    }
    if (normalized.includes('ambiguous argument')) {
      return 'Git could not resolve the requested revision.';
    }
    if (normalized.includes('unknown revision')) {
      return 'Git could not resolve the requested revision.';
    }
    if (normalized.includes('does not have any commits yet')) {
      return 'This repository does not have any commits yet.';
    }
    if (normalized.includes('spawn git enoent')) {
      return 'Git is not installed or is not available on PATH.';
    }
    return `Git command failed: ${message.replace(/^fatal:\s*/i, '')}`;
  }
}

export class GitCommandError extends Error {
  readonly isRepositoryError: boolean;

  constructor(message: string, public readonly rawMessage: string) {
    super(message);
    this.name = 'GitCommandError';
    this.isRepositoryError = rawMessage.toLowerCase().includes('not a git repository');
  }
}
