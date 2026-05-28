import * as vscode from 'vscode';
import { GitBranch } from '../models/git';
import { GitService } from '../services/gitService';

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

  constructor(private readonly gitService: GitService) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return [new MessageItem('Open a repository file to view branches.')];
    }

    const repository = await this.gitService.getRepositoryContext(editor.document.uri);
    if (!repository) {
      return [new MessageItem('This file is not inside a Git repository.')];
    }

    try {
      const branches = await this.gitService.getBranches(repository.root);
      if (branches.length === 0) {
        return [new MessageItem('No branches found.')];
      }
      return branches.map(branch => new BranchItem(branch));
    } catch (error) {
      return [new MessageItem(error instanceof Error ? error.message : 'Unable to load branches.')];
    }
  }
}
