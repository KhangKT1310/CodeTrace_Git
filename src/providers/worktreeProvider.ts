import * as vscode from 'vscode';
import { GitWorktree } from '../models/git';
import { GitService } from '../services/gitService';
import { RepositoryController } from '../services/repositoryController';

export class WorktreeItem extends vscode.TreeItem {
  constructor(
    public readonly worktree: GitWorktree,
    public readonly repositoryRoot: string
  ) {
    super(worktree.branch || worktree.path, vscode.TreeItemCollapsibleState.None);
    this.description = worktree.detached
      ? 'detached'
      : worktree.branch
        ? `${worktree.branch}${worktree.bare ? ' • bare' : ''}`
        : worktree.bare
          ? 'bare'
          : undefined;
    this.tooltip = [
      worktree.path,
      worktree.branch ? `branch: ${worktree.branch}` : undefined,
      worktree.head ? `head: ${worktree.head}` : undefined,
      worktree.locked ? `locked: ${worktree.locked}` : undefined,
      worktree.prunable ? `prunable: ${worktree.prunable}` : undefined
    ].filter(Boolean).join('\n');
    this.contextValue = 'worktree';
    this.iconPath = new vscode.ThemeIcon(worktree.detached ? 'git-commit' : 'folder-library');
    this.resourceUri = vscode.Uri.file(worktree.path);
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
  }
}

export class WorktreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly gitService: GitService,
    private readonly repositoryController: RepositoryController
  ) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const repositoryRoot = await this.repositoryController.getRepositoryRootForActiveEditor();
    if (!repositoryRoot) {
      return [new MessageItem('Select or open a repository to view worktrees.')];
    }

    try {
      const worktrees = await this.gitService.getWorktrees(repositoryRoot);
      if (worktrees.length === 0) {
        return [new MessageItem('No worktrees found.')];
      }
      return worktrees.map(worktree => new WorktreeItem(worktree, repositoryRoot));
    } catch (error) {
      return [new MessageItem(error instanceof Error ? error.message : 'Unable to load worktrees.')];
    }
  }
}
