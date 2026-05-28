import * as vscode from 'vscode';

export class FileBlameProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'open-git-insight-blame';

  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly content = new Map<string, string>();

  setContent(uri: vscode.Uri, value: string): void {
    this.content.set(uri.toString(), value);
    this.changeEmitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? 'No blame information loaded.';
  }
}
