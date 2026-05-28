import * as vscode from 'vscode';
import { GitCommit } from '../models/git';
import { GitService } from '../services/gitService';

export class GitInsightCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  constructor(private readonly gitService: GitService) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!vscode.workspace.getConfiguration('openGitInsight.codeLens').get<boolean>('enabled', true)) {
      return [];
    }

    if (document.uri.scheme !== 'file') {
      return [];
    }

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri
    );

    if (!symbols || symbols.length === 0) {
      return [];
    }

    const targets = flattenSymbols(symbols)
      .filter(symbol => isRelevantSymbol(symbol.kind))
      .slice(0, 12);

    const lenses = await Promise.all(targets.map(symbol => this.createCodeLens(document.uri, symbol)));
    return lenses.filter((lens): lens is vscode.CodeLens => Boolean(lens));
  }

  private async createCodeLens(
    uri: vscode.Uri,
    symbol: vscode.DocumentSymbol
  ): Promise<vscode.CodeLens | undefined> {
    const blameLine = await this.gitService.getBlameForLine(uri, symbol.range.start.line);
    if (!blameLine) {
      return undefined;
    }

    const title = `${blameLine.commit.author} • ${blameLine.commit.shortHash} • ${blameLine.commit.summary}`;
    return new vscode.CodeLens(symbol.selectionRange, {
      command: 'openGitInsight.showCommitDetails',
      title,
      arguments: [{
        commit: blameLine.commit,
        fileUri: uri
      } satisfies CommitReference]
    });
  }
}

function flattenSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  const result: vscode.DocumentSymbol[] = [];
  const stack = [...symbols];

  while (stack.length > 0) {
    const symbol = stack.shift();
    if (!symbol) {
      continue;
    }

    result.push(symbol);
    stack.unshift(...symbol.children);
  }

  return result;
}

function isRelevantSymbol(kind: vscode.SymbolKind): boolean {
  return [
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Struct,
    vscode.SymbolKind.Module
  ].includes(kind);
}

type CommitReference = {
  commit: GitCommit;
  fileUri: vscode.Uri;
};
