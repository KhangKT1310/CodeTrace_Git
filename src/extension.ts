import * as path from 'path';
import * as vscode from 'vscode';
import { BranchProvider } from './providers/branchProvider';
import { BlameHoverProvider } from './providers/blameHoverProvider';
import { CommitGraphLauncherProvider } from './providers/commitGraphLauncherProvider';
import { GitInsightCodeLensProvider } from './providers/codeLensProvider';
import { CommitDetailsProvider } from './providers/commitDetailsProvider';
import { FileBlameProvider } from './providers/fileBlameProvider';
import { FileHistoryItem, FileHistoryProvider } from './providers/fileHistoryProvider';
import { InlineBlameController } from './providers/inlineBlameController';
import { ReferenceProvider } from './providers/referenceProvider';
import { StatusFileItem, StatusProvider } from './providers/statusProvider';
import { VirtualDocumentProvider } from './providers/virtualDocumentProvider';
import { WorktreeItem, WorktreeProvider } from './providers/worktreeProvider';
import { GitCommit } from './models/git';
import { CommitGraphService } from './git/commitGraphService';
import { GitCommandError, GitService } from './git/gitService';
import { AIService } from './services/aiService';
import { RepositoryController } from './services/repositoryController';
import { CommitGraphPanel } from './webviews/commitGraph/commitGraphPanel';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const gitService = new GitService();
  const commitGraphService = new CommitGraphService(gitService);
  const aiService = new AIService();
  const repositoryController = new RepositoryController(context, gitService);
  const inlineBlame = new InlineBlameController(gitService);
  const blameHoverProvider = new BlameHoverProvider(gitService);
  const fileHistoryProvider = new FileHistoryProvider(gitService);
  const commitGraphLauncherProvider = new CommitGraphLauncherProvider();
  const branchProvider = new BranchProvider(gitService, repositoryController);
  const statusProvider = new StatusProvider(gitService, repositoryController);
  const referenceProvider = new ReferenceProvider(gitService, repositoryController);
  const worktreeProvider = new WorktreeProvider(gitService, repositoryController);
  const commitDetailsProvider = new CommitDetailsProvider();
  const fileBlameProvider = new FileBlameProvider();
  const revisionProvider = new VirtualDocumentProvider('open-git-insight-revision');
  const historyProvider = new VirtualDocumentProvider('open-git-insight-history');
  const aiProvider = new VirtualDocumentProvider('open-git-insight-ai');
  const codeLensProvider = new GitInsightCodeLensProvider(gitService);

  context.subscriptions.push(
    repositoryController,
    inlineBlame,
    blameHoverProvider,
    vscode.workspace.registerTextDocumentContentProvider(CommitDetailsProvider.scheme, commitDetailsProvider),
    vscode.workspace.registerTextDocumentContentProvider(FileBlameProvider.scheme, fileBlameProvider),
    vscode.workspace.registerTextDocumentContentProvider(revisionProvider.scheme, revisionProvider),
    vscode.workspace.registerTextDocumentContentProvider(historyProvider.scheme, historyProvider),
    vscode.workspace.registerTextDocumentContentProvider(aiProvider.scheme, aiProvider),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, blameHoverProvider),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
    vscode.window.registerTreeDataProvider('openGitInsight.fileHistory', fileHistoryProvider),
    vscode.window.registerTreeDataProvider('openGitInsight.commitGraph', commitGraphLauncherProvider),
    vscode.window.registerTreeDataProvider('openGitInsight.branches', branchProvider),
    vscode.window.registerTreeDataProvider('openGitInsight.status', statusProvider),
    vscode.window.registerTreeDataProvider('openGitInsight.references', referenceProvider),
    vscode.window.registerTreeDataProvider('openGitInsight.worktrees', worktreeProvider),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void syncActiveRepository(repositoryController, gitService);
      refreshRepoViews(fileHistoryProvider, branchProvider, statusProvider, referenceProvider, worktreeProvider, codeLensProvider, inlineBlame);
      void CommitGraphPanel.refreshCurrent();
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      refreshRepoViews(fileHistoryProvider, branchProvider, statusProvider, referenceProvider, worktreeProvider, codeLensProvider, inlineBlame, true);
      void CommitGraphPanel.refreshCurrent({ invalidate: true });
    }),
    repositoryController.onDidChangeRepository(() => {
      refreshRepoViews(fileHistoryProvider, branchProvider, statusProvider, referenceProvider, worktreeProvider, codeLensProvider, inlineBlame, true);
      void CommitGraphPanel.refreshCurrent({ invalidate: true });
    }),
    vscode.commands.registerCommand('openGitInsight.refreshFileHistory', () => {
      refreshRepoViews(fileHistoryProvider, branchProvider, statusProvider, referenceProvider, worktreeProvider, codeLensProvider, inlineBlame, true);
    }),
    vscode.commands.registerCommand('openGitInsight.switchRepository', async () => {
      await repositoryController.pickRepository();
    }),
    vscode.commands.registerCommand('openGitInsight.showCommitGraph', async () => {
      await CommitGraphPanel.show(context, gitService, commitGraphService, repositoryController, commitDetailsProvider);
    }),
    vscode.commands.registerCommand('codeTraceGit.showCommitGraph', async () => {
      await CommitGraphPanel.show(context, gitService, commitGraphService, repositoryController, commitDetailsProvider);
    }),
    vscode.commands.registerCommand('openGitInsight.showCommitDetails', async (item?: CommitReference) => {
      await showCommitDetails(gitService, commitDetailsProvider, item);
    }),
    vscode.commands.registerCommand('openGitInsight.compareWithPrevious', async (item?: FileHistoryItem) => {
      await compareWithPrevious(gitService, item);
    }),
    vscode.commands.registerCommand('openGitInsight.openFileAtRevision', async () => {
      await openFileAtRevision(gitService, revisionProvider);
    }),
    vscode.commands.registerCommand('openGitInsight.showFileBlame', async () => {
      await showFileBlame(gitService, fileBlameProvider);
    }),
    vscode.commands.registerCommand('openGitInsight.showSelectionHistory', async () => {
      await showSelectionHistory(gitService, historyProvider);
    }),
    vscode.commands.registerCommand('openGitInsight.searchCommits', async () => {
      await searchCommits(gitService, repositoryController, commitDetailsProvider);
    }),
    vscode.commands.registerCommand('openGitInsight.stageStatusFile', async (item?: StatusFileItem) => {
      await stageStatusFile(gitService, statusProvider, item);
    }),
    vscode.commands.registerCommand('openGitInsight.unstageStatusFile', async (item?: StatusFileItem) => {
      await unstageStatusFile(gitService, statusProvider, item);
    }),
    vscode.commands.registerCommand('openGitInsight.discardStatusFile', async (item?: StatusFileItem) => {
      await discardStatusFile(gitService, statusProvider, item);
    }),
    vscode.commands.registerCommand('openGitInsight.diffStatusFile', async (item?: StatusFileItem) => {
      await diffStatusFile(gitService, revisionProvider, item);
    }),
    vscode.commands.registerCommand('openGitInsight.refreshWorktrees', () => {
      worktreeProvider.refresh();
    }),
    vscode.commands.registerCommand('openGitInsight.openWorktree', async (item?: WorktreeItem) => {
      await openWorktree(item);
    }),
    vscode.commands.registerCommand('openGitInsight.copyWorktreePath', async (item?: WorktreeItem) => {
      await copyWorktreePath(item);
    }),
    vscode.commands.registerCommand('openGitInsight.addWorktree', async () => {
      await addWorktree(gitService, repositoryController, worktreeProvider);
    }),
    vscode.commands.registerCommand('openGitInsight.removeWorktree', async (item?: WorktreeItem) => {
      await removeWorktree(gitService, worktreeProvider, item);
    }),
    vscode.commands.registerCommand('openGitInsight.generateCommitMessage', async () => {
      await generateCommitMessage(gitService, repositoryController, aiService, aiProvider);
    }),
    vscode.commands.registerCommand('openGitInsight.explainStagedDiff', async () => {
      await explainStagedDiff(gitService, repositoryController, aiService, aiProvider);
    }),
    vscode.commands.registerCommand('openGitInsight.copyCommitHash', async (item?: FileHistoryItem) => {
      if (!item) {
        return;
      }
      await vscode.env.clipboard.writeText(item.commit.hash);
      void vscode.window.showInformationMessage(`Copied ${item.commit.shortHash} to the clipboard.`);
    })
  );

  await syncActiveRepository(repositoryController, gitService);
  void inlineBlame.refresh();
}

export function deactivate(): void {}

async function showCommitDetails(
  gitService: GitService,
  provider: CommitDetailsProvider,
  item?: CommitReference
): Promise<void> {
  const target = item ?? (await getHistoryItemFromActiveLine(gitService));
  if (!target) {
    void vscode.window.showInformationMessage('Open a repository file and place the cursor on a tracked line to view commit details.');
    return;
  }

  try {
    const repositoryRoot = ('repositoryRoot' in target ? target.repositoryRoot : undefined)
      ?? (await gitService.getRepositoryContext(target.fileUri))?.root;
    if (!repositoryRoot) {
      void vscode.window.showWarningMessage('The selected file is not inside a Git repository.');
      return;
    }

    const content = await gitService.getCommitDetails(repositoryRoot, target.commit.hash);
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

    const languageId = await resolveLanguageId(targetUri, editor);
    const previousContent = await gitService.getFileContentAtRevision(targetUri, previousRevision);
    const leftUri = await createReadonlyContentDocument(previousContent, languageId);

    if (item) {
      const selectedContent = await gitService.getFileContentAtRevision(targetUri, item.commit.hash);
      const rightUri = await createReadonlyContentDocument(selectedContent, languageId);

      await vscode.commands.executeCommand(
        'vscode.diff',
        leftUri,
        rightUri,
        `${path.basename(targetUri.fsPath)}: ${previousRevision.slice(0, 8)} ↔ ${item.commit.shortHash}`
      );
      return;
    }

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

async function resolveLanguageId(
  targetUri: vscode.Uri,
  editor?: vscode.TextEditor
): Promise<string | undefined> {
  if (editor?.document.uri.toString() === targetUri.toString()) {
    return editor.document.languageId;
  }

  try {
    const document = await vscode.workspace.openTextDocument(targetUri);
    return document.languageId;
  } catch {
    return undefined;
  }
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

async function showFileBlame(gitService: GitService, provider: FileBlameProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    void vscode.window.showInformationMessage('Open a tracked file to view full-file blame.');
    return;
  }

  try {
    const content = await gitService.getFileBlameDocument(editor.document.uri);
    const uri = vscode.Uri.from({
      scheme: FileBlameProvider.scheme,
      path: `/${path.basename(editor.document.uri.fsPath)}.blame`,
      query: editor.document.uri.toString()
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

async function searchCommits(
  gitService: GitService,
  repositoryController: RepositoryController,
  detailsProvider: CommitDetailsProvider
): Promise<void> {
  const repositoryRoot = await repositoryController.getRepositoryRootForActiveEditor();
  if (!repositoryRoot) {
    void vscode.window.showInformationMessage('Open or select a repository to search commits.');
    return;
  }

  const query = await vscode.window.showInputBox({
    prompt: 'Search commits by message, author, or hash',
    placeHolder: 'fix auth, khang, a1b2c3d'
  });

  if (!query) {
    return;
  }

  try {
    const commits = await gitService.searchCommits(repositoryRoot, query, 50);
    if (commits.length === 0) {
      void vscode.window.showInformationMessage(`No commits matched "${query}".`);
      return;
    }

    const fileUri = vscode.window.activeTextEditor?.document.uri ?? vscode.Uri.file(repositoryRoot);
    const picked = await vscode.window.showQuickPick(
      commits.map(commit => ({
        label: `${commit.shortHash} ${commit.summary}`,
        description: `${commit.author} • ${new Date(commit.date).toLocaleDateString()}`,
        detail: commit.body?.trim() || commit.hash,
        target: { commit, fileUri, repositoryRoot }
      })),
      { matchOnDescription: true, matchOnDetail: true, placeHolder: 'Select a commit to inspect' }
    );

    if (picked) {
      await showCommitDetails(gitService, detailsProvider, picked.target);
    }
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

async function openFileAtRevision(
  gitService: GitService,
  provider: VirtualDocumentProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    void vscode.window.showInformationMessage('Open a tracked file to view a previous revision.');
    return;
  }

  try {
    const repository = await gitService.getRepositoryContext(editor.document.uri);
    if (!repository) {
      void vscode.window.showInformationMessage('The current file is not inside a Git repository.');
      return;
    }

    const commits = await gitService.getFileHistory(editor.document.uri, 50);
    if (commits.length === 0) {
      void vscode.window.showInformationMessage('No revisions were found for this file.');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      commits.map(commit => ({
        label: `${commit.shortHash} ${commit.summary}`,
        description: `${commit.author} • ${new Date(commit.date).toLocaleDateString()}`,
        commit
      })),
      { placeHolder: 'Select a revision to open' }
    );

    if (!picked) {
      return;
    }

    const content = await gitService.getFileContentAtRevisionByRepository(
      repository.root,
      repository.relativePath,
      picked.commit.hash
    );
    const uri = vscode.Uri.from({
      scheme: provider.scheme,
      path: `/${path.basename(editor.document.uri.fsPath)}@${picked.commit.shortHash}`,
      query: `${picked.commit.hash}:${repository.relativePath}`
    });
    provider.setContent(uri, content);
    const document = await vscode.workspace.openTextDocument(uri);
    if (editor.document.languageId) {
      await vscode.languages.setTextDocumentLanguage(document, editor.document.languageId);
    }
    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside
    });
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

async function showSelectionHistory(
  gitService: GitService,
  provider: VirtualDocumentProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    void vscode.window.showInformationMessage('Open a tracked file to view line or selection history.');
    return;
  }

  const startLine = editor.selection.start.line + 1;
  const endLine = editor.selection.end.line + 1;

  try {
    const content = await gitService.getLineHistory(editor.document.uri, startLine, endLine);
    const uri = vscode.Uri.from({
      scheme: provider.scheme,
      path: `/${path.basename(editor.document.uri.fsPath)}.lines`,
      query: `${startLine}-${endLine}`
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

async function stageStatusFile(
  gitService: GitService,
  statusProvider: StatusProvider,
  item?: StatusFileItem
): Promise<void> {
  if (!item) {
    return;
  }

  try {
    await gitService.stageFile(item.repositoryRoot, item.status.path);
    statusProvider.refresh();
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

async function unstageStatusFile(
  gitService: GitService,
  statusProvider: StatusProvider,
  item?: StatusFileItem
): Promise<void> {
  if (!item) {
    return;
  }

  try {
    await gitService.unstageFile(item.repositoryRoot, item.status.path);
    statusProvider.refresh();
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

async function discardStatusFile(
  gitService: GitService,
  statusProvider: StatusProvider,
  item?: StatusFileItem
): Promise<void> {
  if (!item) {
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Discard changes in ${item.status.path}?`,
    { modal: true },
    'Discard'
  );
  if (confirmed !== 'Discard') {
    return;
  }

  try {
    if (item.status.untracked) {
      await gitService.discardUntrackedFile(item.repositoryRoot, item.status.path);
    } else {
      await gitService.discardFile(item.repositoryRoot, item.status.path);
    }
    statusProvider.refresh();
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

async function diffStatusFile(
  gitService: GitService,
  provider: VirtualDocumentProvider,
  item?: StatusFileItem
): Promise<void> {
  if (!item) {
    return;
  }

  const fileUri = vscode.Uri.file(path.join(item.repositoryRoot, item.status.path));
  if (item.status.untracked) {
    await vscode.window.showTextDocument(fileUri, { preview: true });
    return;
  }

  try {
    const content = await gitService.getFileContentAtRevisionByRepository(item.repositoryRoot, item.status.path, 'HEAD');
    const uri = vscode.Uri.from({
      scheme: provider.scheme,
      path: `/${path.basename(item.status.path)}@HEAD`,
      query: `HEAD:${item.status.path}`
    });
    provider.setContent(uri, content);
    const leftDocument = await vscode.workspace.openTextDocument(uri);
    const activeLanguage = vscode.window.activeTextEditor?.document.uri.fsPath === fileUri.fsPath
      ? vscode.window.activeTextEditor.document.languageId
      : undefined;
    if (activeLanguage) {
      await vscode.languages.setTextDocumentLanguage(leftDocument, activeLanguage);
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      uri,
      fileUri,
      `${path.basename(item.status.path)}: HEAD ↔ Working Tree`
    );
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

async function openWorktree(item?: WorktreeItem): Promise<void> {
  if (!item) {
    return;
  }

  const uri = vscode.Uri.file(item.worktree.path);
  await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
}

async function copyWorktreePath(item?: WorktreeItem): Promise<void> {
  if (!item) {
    return;
  }

  await vscode.env.clipboard.writeText(item.worktree.path);
  void vscode.window.showInformationMessage(`Copied worktree path: ${item.worktree.path}`);
}

async function addWorktree(
  gitService: GitService,
  repositoryController: RepositoryController,
  worktreeProvider: WorktreeProvider
): Promise<void> {
  const repositoryRoot = await repositoryController.getRepositoryRootForActiveEditor();
  if (!repositoryRoot) {
    void vscode.window.showInformationMessage('Open or select a repository before adding a worktree.');
    return;
  }

  const worktreePath = await vscode.window.showInputBox({
    prompt: 'Path for the new worktree',
    placeHolder: '/absolute/path/to/new-worktree'
  });
  if (!worktreePath) {
    return;
  }

  const branchName = await vscode.window.showInputBox({
    prompt: 'Optional branch name for the new worktree',
    placeHolder: 'feature/my-branch'
  });

  try {
    await gitService.addWorktree(repositoryRoot, worktreePath, branchName || undefined);
    worktreeProvider.refresh();
    void vscode.window.showInformationMessage(`Added worktree at ${worktreePath}`);
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

async function removeWorktree(
  gitService: GitService,
  worktreeProvider: WorktreeProvider,
  item?: WorktreeItem
): Promise<void> {
  if (!item) {
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Remove worktree at ${item.worktree.path}?`,
    { modal: true },
    'Remove'
  );
  if (confirmed !== 'Remove') {
    return;
  }

  try {
    await gitService.removeWorktree(item.repositoryRoot, item.worktree.path, true);
    worktreeProvider.refresh();
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

async function generateCommitMessage(
  gitService: GitService,
  repositoryController: RepositoryController,
  aiService: AIService,
  provider: VirtualDocumentProvider
): Promise<void> {
  await showAIOutput(
    gitService,
    repositoryController,
    provider,
    'commit-message',
    'AI Commit Message',
    diff => aiService.generateCommitMessage(diff)
  );
}

async function explainStagedDiff(
  gitService: GitService,
  repositoryController: RepositoryController,
  aiService: AIService,
  provider: VirtualDocumentProvider
): Promise<void> {
  await showAIOutput(
    gitService,
    repositoryController,
    provider,
    'explanation',
    'AI Diff Explanation',
    diff => aiService.explainDiff(diff)
  );
}

async function showAIOutput(
  gitService: GitService,
  repositoryController: RepositoryController,
  provider: VirtualDocumentProvider,
  kind: string,
  title: string,
  producer: (diff: string) => Promise<string>
): Promise<void> {
  const repositoryRoot = await repositoryController.getRepositoryRootForActiveEditor();
  if (!repositoryRoot) {
    void vscode.window.showInformationMessage('Open or select a repository before using AI features.');
    return;
  }

  try {
    const diff = await gitService.getStagedDiff(repositoryRoot);
    if (!diff.trim()) {
      void vscode.window.showInformationMessage('No staged diff found. Stage changes first.');
      return;
    }

    const output = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false
      },
      () => producer(diff)
    );

    const uri = vscode.Uri.from({
      scheme: provider.scheme,
      path: `/${kind}.md`,
      query: repositoryRoot
    });
    provider.setContent(uri, output);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(document, 'markdown');
    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside
    });
  } catch (error) {
    void vscode.window.showWarningMessage(toDisplayMessage(error));
  }
}

function refreshRepoViews(
  fileHistoryProvider: FileHistoryProvider,
  branchProvider: BranchProvider,
  statusProvider: StatusProvider,
  referenceProvider: ReferenceProvider,
  worktreeProvider: WorktreeProvider,
  codeLensProvider: GitInsightCodeLensProvider,
  inlineBlame: InlineBlameController,
  clearBlame = false
): void {
  fileHistoryProvider.refresh();
  branchProvider.refresh();
  statusProvider.refresh();
  referenceProvider.refresh();
  worktreeProvider.refresh();
  codeLensProvider.refresh();
  void inlineBlame.refresh(clearBlame);
}

async function syncActiveRepository(
  repositoryController: RepositoryController,
  gitService: GitService
): Promise<void> {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme !== 'file') {
    return;
  }

  const repository = await gitService.getRepositoryContext(activeUri);
  if (repository) {
    await repositoryController.setSelectedRoot(repository.root);
  }
}

function toDisplayMessage(error: unknown): string {
  if (error instanceof GitCommandError) {
    return error.message;
  }

  return error instanceof Error ? error.message : 'The Git operation failed.';
}

type CommitReference = {
  commit: GitCommit;
  fileUri: vscode.Uri;
  repositoryRoot?: string;
};
