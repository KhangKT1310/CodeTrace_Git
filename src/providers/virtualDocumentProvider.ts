import * as vscode from 'vscode';

export class VirtualDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly content = new Map<string, string>();

  constructor(public readonly scheme: string) {}

  setContent(uri: vscode.Uri, value: string): void {
    this.content.set(uri.toString(), value);
    this.changeEmitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? 'No content loaded.';
  }
}
