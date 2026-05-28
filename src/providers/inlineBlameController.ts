import * as vscode from 'vscode';
import { GitBlameLine } from '../models/git';
import { GitCommandError, GitService } from '../services/gitService';

export class InlineBlameController implements vscode.Disposable {
  private readonly decorationType = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('descriptionForeground'),
      margin: '0 0 0 2rem'
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  });

  private blameCache = new Map<string, Map<number, GitBlameLine>>();
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly gitService: GitService) {
    this.disposables = [
      vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()),
      vscode.window.onDidChangeTextEditorSelection(() => void this.refresh()),
      vscode.window.onDidChangeTextEditorVisibleRanges(() => void this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => void this.refresh()),
      vscode.workspace.onDidChangeTextDocument(event => {
        this.blameCache.delete(event.document.uri.toString());
        void this.refresh();
      }),
      vscode.workspace.onDidSaveTextDocument(document => {
        this.blameCache.delete(document.uri.toString());
        void this.refresh();
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('openGitInsight.inlineBlame')) {
          void this.refresh(true);
        }
      })
    ];
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.decorationType.dispose();
  }

  async refresh(clear = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return;
    }

    if (clear) {
      this.blameCache.delete(editor.document.uri.toString());
    }

    const configuration = vscode.workspace.getConfiguration('openGitInsight.inlineBlame');
    if (!configuration.get<boolean>('enabled', true)) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    try {
      const blame = await this.getBlame(editor.document.uri);
      const mode = configuration.get<'currentLine' | 'allLines'>('mode', 'currentLine');
      const decorations =
        mode === 'allLines'
          ? this.buildAllLineDecorations(editor, blame)
          : this.buildCurrentLineDecorations(editor, blame);
      editor.setDecorations(this.decorationType, decorations);
    } catch (error) {
      editor.setDecorations(this.decorationType, []);
      if (!(error instanceof GitCommandError) || !error.isRepositoryError) {
        void vscode.window.showWarningMessage(this.toDisplayMessage(error));
      }
    }
  }

  private async getBlame(uri: vscode.Uri): Promise<Map<number, GitBlameLine>> {
    const key = uri.toString();
    let blame = this.blameCache.get(key);
    if (!blame) {
      blame = await this.gitService.getBlame(uri);
      this.blameCache.set(key, blame);
    }
    return blame;
  }

  private buildCurrentLineDecorations(
    editor: vscode.TextEditor,
    blame: Map<number, GitBlameLine>
  ): vscode.DecorationOptions[] {
    const line = editor.selection.active.line;
    const blameLine = blame.get(line);
    if (!blameLine) {
      return [];
    }

    return [this.toDecoration(editor.document.lineAt(line).range, blameLine)];
  }

  private buildAllLineDecorations(
    editor: vscode.TextEditor,
    blame: Map<number, GitBlameLine>
  ): vscode.DecorationOptions[] {
    const visibleRanges = editor.visibleRanges;
    if (visibleRanges.length === 0) {
      return [];
    }

    const decorations: vscode.DecorationOptions[] = [];
    for (const visibleRange of visibleRanges) {
      for (let line = visibleRange.start.line; line <= visibleRange.end.line; line += 1) {
        const blameLine = blame.get(line);
        if (!blameLine) {
          continue;
        }
        decorations.push(this.toDecoration(editor.document.lineAt(line).range, blameLine));
      }
    }

    return decorations;
  }

  private toDecoration(range: vscode.Range, blameLine: GitBlameLine): vscode.DecorationOptions {
    const date = blameLine.commit.date ? new Date(blameLine.commit.date).toLocaleDateString() : '';
    return {
      range,
      renderOptions: {
        after: {
          contentText: `${blameLine.commit.author}  ${blameLine.commit.summary}  ${date}`.trim()
        }
      },
      hoverMessage: `${blameLine.commit.shortHash} ${blameLine.commit.summary}`
    };
  }

  private toDisplayMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unable to update inline blame.';
  }
}
