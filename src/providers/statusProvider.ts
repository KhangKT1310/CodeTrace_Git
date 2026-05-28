import * as path from 'path';
import * as vscode from 'vscode';
import { GitStatusFile } from '../models/git';
import { GitCommandError, GitService } from '../services/gitService';
import { RepositoryController } from '../services/repositoryController';

export class StatusFileItem extends vscode.TreeItem {
  constructor(
    public readonly status: GitStatusFile,
    public readonly repositoryRoot: string
  ) {
    super(status.path, vscode.TreeItemCollapsibleState.None);
    this.description = describeStatus(status);
    this.tooltip = `${status.path}\n${describeStatus(status)}`;
    this.contextValue = 'status-file';
    this.iconPath = new vscode.ThemeIcon(iconForStatus(status));
    this.resourceUri = vscode.Uri.file(path.join(repositoryRoot, status.path));
    this.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [this.resourceUri]
    };
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
  }
}

export class StatusProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
      return [new MessageItem('Select or open a repository to view working tree status.')];
    }

    try {
      const statuses = await this.gitService.getWorkingTreeStatus(repositoryRoot);
      if (statuses.length === 0) {
        return [new MessageItem('Working tree is clean.')];
      }

      return statuses.map(status => new StatusFileItem(status, repositoryRoot));
    } catch (error) {
      const message = error instanceof GitCommandError ? error.message : 'Unable to load repository status.';
      return [new MessageItem(message)];
    }
  }
}

function describeStatus(status: GitStatusFile): string {
  if (status.untracked) {
    return 'untracked';
  }
  if (status.staged && status.workingTreeStatus !== ' ') {
    return 'staged + modified';
  }
  if (status.staged) {
    return 'staged';
  }
  return 'modified';
}

function iconForStatus(status: GitStatusFile): string {
  if (status.untracked) {
    return 'diff-added';
  }
  if (status.staged && status.workingTreeStatus !== ' ') {
    return 'diff-modified';
  }
  if (status.staged) {
    return 'check';
  }
  return 'edit';
}
