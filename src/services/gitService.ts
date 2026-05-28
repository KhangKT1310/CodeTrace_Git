import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { GitBlameLine, GitBranch, GitCommit, RepositoryContext } from '../models/git';

const execFileAsync = promisify(execFile);
const LOG_DELIMITER = '\u001f';

export class GitService {
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
    const format = ['%H', '%h', '%an', '%ae', '%ad', '%s', '%P'].join(LOG_DELIMITER);
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

    return output
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [hash, shortHash, author, authorEmail, date, summary, parents] = line.split(LOG_DELIMITER);
        return {
          hash,
          shortHash,
          author,
          authorEmail,
          date,
          summary,
          previousHash: parents?.split(' ')[0]
        };
      });
  }

  async getCommitDetails(repositoryRoot: string, commitHash: string): Promise<string> {
    return this.runGit(['show', '--stat', '--patch', commitHash], repositoryRoot);
  }

  async getBranches(repositoryRoot: string): Promise<GitBranch[]> {
    const output = await this.runGit(['branch', '--all', '--no-color'], repositoryRoot);

    return output
      .split('\n')
      .map(line => line.trimEnd())
      .filter(Boolean)
      .map(line => {
        const current = line.startsWith('*');
        const name = current ? line.replace(/^\*\s*/, '').trim() : line.trim();
        return {
          name,
          current,
          remote: name.startsWith('remotes/')
        };
      });
  }

  async getFileContentAtRevision(uri: vscode.Uri, revision: string): Promise<string> {
    const repository = await this.getRequiredRepositoryContext(uri);
    return this.runGit(['show', `${revision}:${repository.relativePath}`], repository.root);
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

  async runGit(args: string[], cwd: string): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024
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

      const stderr = typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr?: string }).stderr ?? '')
        : '';
      const message = stderr.trim() || (error instanceof Error ? error.message : 'Unknown Git error');
      throw new GitCommandError(this.toUserMessage(message), message);
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
