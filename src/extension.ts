import * as path from 'path';
import * as vscode from 'vscode';
import { BranchProvider } from './providers/branchProvider';
import { BlameHoverProvider } from './providers/blameHoverProvider';
import { CommitDetailsProvider } from './providers/commitDetailsProvider';
import { FileHistoryItem, FileHistoryProvider } from './providers/fileHistoryProvider';
import { InlineBlameController } from './providers/inlineBlameController';
import { GitCommandError, GitService } from './services/gitService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const gitService = new GitService();
  const inlineBlame = new InlineBlameController(gitService);
  const fileHistoryProvider = new FileHistoryProvider(gitService);
  const branchProvider = new BranchProvider(gitService);
  const commitDetailsProvider = new CommitDetailsProvider();

  context.subscriptions.push(
    inlineBlame,
    vscode.workspace.registerTextDocumentContentProvider(CommitDetailsProvider.scheme, commitDetailsProvider),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, new BlameHoverProvider(gitService)),
    vscode.window.registerTreeDataProvider('openGitInsight.fileHistory', fileHistoryProvider),
    vscode.window.registerTreeDataProvider('openGitInsight.branches', branchProvider),
    vscode.window.onDidChangeActiveTextEditor(() => {
      fileHistoryProvider.refresh();
      branchProvider.refresh();
      void inlineBlame.refresh();
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      fileHistoryProvider.refresh();
      branchProvider.refresh();
      void inlineBlame.refresh(true);
    }),
    vscode.commands.registerCommand('openGitInsight.refreshFileHistory', () => {
      fileHistoryProvider.refresh();
      branchProvider.refresh();
      void inlineBlame.refresh(true);
    }),
    vscode.commands.registerCommand('openGitInsight.showCommitDetails', async (item?: FileHistoryItem) => {
      await showCommitDetails(gitService, commitDetailsProvider, item);
    }),
    vscode.commands.registerCommand('openGitInsight.compareWithPrevious', async (item?: FileHistoryItem) => {
      await compareWithPrevious(gitService, item);
    }),
    vscode.commands.registerCommand('openGitInsight.copyCommitHash', async (item?: FileHistoryItem) => {
      if (!item) {
        return;
      }
      await vscode.env.clipboard.writeText(item.commit.hash);
      void vscode.window.showInformationMessage(`Copied ${item.commit.shortHash} to the clipboard.`);
    })
  );

  void inlineBlame.refresh();
}

export function deactivate(): void {}

async function showCommitDetails(
  gitService: GitService,
  provider: CommitDetailsProvider,
  item?: FileHistoryItem
): Promise<void> {
  const target = item ?? (await getHistoryItemFromActiveLine(gitService));
  if (!target) {
    void vscode.window.showInformationMessage('Open a repository file and place the cursor on a tracked line to view commit details.');
    return;
  }

  try {
    const repository = await gitService.getRepositoryContext(target.fileUri);
    if (!repository) {
      void vscode.window.showWarningMessage('The selected file is not inside a Git repository.');
      return;
    }

    const content = await gitService.getCommitDetails(repository.root, target.commit.hash);
    const uri = vscode.Uri.from({
      scheme: CommitDetailsProvider.scheme,
      path: `/${target.commit.shortHash}.patch`,
      query: target.commit.hash
    });
    provider.setContent(uri, content);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside
    });
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

async function compareWithPrevious(gitService: GitService, item?: FileHistoryItem): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const targetUri = item?.fileUri ?? editor?.document.uri;
  if (!targetUri) {
    void vscode.window.showInformationMessage('Open a file or select a history item to compare revisions.');
    return;
  }

  try {
    const previousRevision = await gitService.getPreviousRevision(targetUri, item?.commit.hash);
    if (!previousRevision) {
      void vscode.window.showInformationMessage('No previous revision is available for this file.');
      return;
    }

    const previousContent = await gitService.getFileContentAtRevision(targetUri, previousRevision);
    const leftUri = await createReadonlyContentDocument(
      previousContent,
      editor?.document.languageId
    );

    await vscode.commands.executeCommand(
      'vscode.diff',
      leftUri,
      targetUri,
      `${path.basename(targetUri.fsPath)}: ${previousRevision.slice(0, 8)} ↔ Working Tree`
    );
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

async function createReadonlyContentDocument(
  content: string,
  languageId?: string
): Promise<vscode.Uri> {
  const document = await vscode.workspace.openTextDocument({
    content,
    language: languageId
  });
  if (languageId) {
    await vscode.languages.setTextDocumentLanguage(document, languageId);
  }
  return document.uri;
}

async function getHistoryItemFromActiveLine(gitService: GitService): Promise<FileHistoryItem | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return undefined;
  }

  const blame = await gitService.getBlame(editor.document.uri);
  const blameLine = blame.get(editor.selection.active.line);
  if (!blameLine) {
    return undefined;
  }

  return new FileHistoryItem(blameLine.commit, editor.document.uri);
}

function toDisplayMessage(error: unknown): string {
  if (error instanceof GitCommandError) {
    return error.message;
  }

  return error instanceof Error ? error.message : 'The Git operation failed.';
}
