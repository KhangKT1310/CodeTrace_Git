import * as vscode from 'vscode';

class CommitGraphItem extends vscode.TreeItem {
  constructor() {
    super('Git Graph', vscode.TreeItemCollapsibleState.None);
    this.description = 'Open graph view';
    this.tooltip = 'Open the Git graph webview';
    this.iconPath = new vscode.ThemeIcon('graph');
    this.command = {
      command: 'codeTraceGit.showCommitGraph',
      title: 'CodeTrace Git: Show Commit Graph'
    };
  }
}

export class CommitGraphLauncherProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    return [new CommitGraphItem()];
  }
}
