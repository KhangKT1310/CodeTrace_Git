import * as vscode from 'vscode';
import { GitCommit } from '../models/git';
import { GitCommandError, GitService } from '../services/gitService';

export class FileHistoryItem extends vscode.TreeItem {
  constructor(
    public readonly commit: GitCommit,
    public readonly fileUri: vscode.Uri
  ) {
    super(`${commit.shortHash} ${commit.summary}`, vscode.TreeItemCollapsibleState.None);
    this.description = `${commit.author} • ${new Date(commit.date).toLocaleDateString()}`;
    this.tooltip = `${commit.hash}\n${commit.author}\n${commit.date}\n${commit.summary}`;
    this.contextValue = 'commit';
    this.command = {
      command: 'openGitInsight.showCommitDetails',
      title: 'Show Commit Details',
      arguments: [this]
    };
  }
}

export class MessageItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
  }
}

export class FileHistoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
      return [new MessageItem('Open a file to view history.')];
    }

    try {
      const maxCommits = vscode.workspace
        .getConfiguration('openGitInsight.history')
        .get<number>('maxCommits', 30);
      const commits = await this.gitService.getFileHistory(editor.document.uri, maxCommits);

      if (commits.length === 0) {
        return [new MessageItem('No history found for this file.')];
      }

      return commits.map(commit => new FileHistoryItem(commit, editor.document.uri));
    } catch (error) {
      const message = error instanceof GitCommandError ? error.message : 'Unable to load file history.';
      return [new MessageItem(message)];
    }
  }
}
