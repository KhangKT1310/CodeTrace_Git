import * as vscode from 'vscode';
import { GitCommandError, GitService } from '../services/gitService';

export class BlameHoverProvider implements vscode.HoverProvider, vscode.Disposable {
  private blameCache = new Map<string, ReturnType<GitService['getBlame']>>();
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly gitService: GitService) {
    this.disposables = [
      vscode.workspace.onDidChangeTextDocument(event => {
        this.clearCache(event.document.uri);
      }),
      vscode.workspace.onDidSaveTextDocument(document => {
        this.clearCache(document.uri);
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        this.clearCache(document.uri);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.blameCache.clear();
      })
    ];
  }

  dispose(): void {
    this.blameCache.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    if (document.uri.scheme !== 'file') {
      return undefined;
    }

    try {
      const blame = await this.getBlame(document.uri);
      const blameLine = blame.get(position.line);
      if (!blameLine) {
        return undefined;
      }

      const markdown = new vscode.MarkdownString(undefined, true);
      markdown.appendMarkdown(`**${blameLine.commit.summary || 'No summary'}**\n\n`);
      markdown.appendMarkdown(`- Commit: \`${blameLine.commit.shortHash}\`\n`);
      markdown.appendMarkdown(`- Author: ${blameLine.commit.author}\n`);
      markdown.appendMarkdown(`- Date: ${this.formatDate(blameLine.commit.date)}\n`);
      return new vscode.Hover(markdown);
    } catch (error) {
      if (!(error instanceof GitCommandError) || !error.isRepositoryError) {
        void vscode.window.showWarningMessage(error instanceof Error ? error.message : 'Unable to load blame information.');
      }
      return undefined;
    }
  }

  private getBlame(uri: vscode.Uri) {
    const key = uri.toString();
    const cached = this.blameCache.get(key);
    if (cached) {
      return cached;
    }

    const pending = this.gitService.getBlame(uri);
    this.blameCache.set(key, pending);
    return pending;
  }

  private clearCache(uri: vscode.Uri): void {
    if (uri.scheme !== 'file') {
      return;
    }
    this.blameCache.delete(uri.toString());
  }

  private formatDate(value: string): string {
    if (!value) {
      return 'Unknown';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
}
