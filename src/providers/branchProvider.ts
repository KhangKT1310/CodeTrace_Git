import * as vscode from 'vscode';
import { GitBranch } from '../models/git';
import { GitService } from '../services/gitService';
import { RepositoryController } from '../services/repositoryController';

class BranchItem extends vscode.TreeItem {
  constructor(branch: GitBranch) {
    super(branch.name, vscode.TreeItemCollapsibleState.None);
    this.description = branch.current ? 'current' : branch.remote ? 'remote' : 'local';
    this.tooltip = branch.name;
    this.iconPath = new vscode.ThemeIcon(branch.current ? 'git-branch' : 'source-control');
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
  }
}

export class BranchProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
      return [new MessageItem('Select or open a repository to view branches.')];
    }

    try {
      const branches = await this.gitService.getBranches(repositoryRoot);
      if (branches.length === 0) {
        return [new MessageItem('No branches found.')];
      }
      return branches.map(branch => new BranchItem(branch));
    } catch (error) {
      return [new MessageItem(error instanceof Error ? error.message : 'Unable to load branches.')];
    }
  }
}
