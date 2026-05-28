import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CommitGraphService, CommitGraphQuery } from '../../git/commitGraphService';
import { GitCommandError, GitService } from '../../git/gitService';
import { CommitGraphCommitDetail, GitCommit } from '../../models/git';
import { CommitDetailsProvider } from '../../providers/commitDetailsProvider';
import { RepositoryController } from '../../services/repositoryController';

type CommitGraphMessage =
  | { type: 'commitGraph:ready'; branchFilter?: string; showRemoteBranches?: boolean; searchText?: string }
  | { type: 'commitGraph:refresh' }
  | { type: 'commitGraph:selectCommit'; hash: string }
  | { type: 'commitGraph:openCommit'; hash: string }
  | { type: 'commitGraph:openWorkingTree' }
  | { type: 'commitGraph:filterChanged'; branchFilter?: string; showRemoteBranches?: boolean; searchText?: string }
  | { type: 'commitGraph:settings' };

export class CommitGraphPanel implements vscode.Disposable {
  private static currentPanel: CommitGraphPanel | undefined;

  static async show(
    context: vscode.ExtensionContext,
    gitService: GitService,
    commitGraphService: CommitGraphService,
    repositoryController: RepositoryController,
    commitDetailsProvider: CommitDetailsProvider
  ): Promise<void> {
    if (CommitGraphPanel.currentPanel) {
      CommitGraphPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      await CommitGraphPanel.currentPanel.updateRepository();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'codeTraceGit.commitGraph',
      'Git Graph',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webviews', 'commitGraph')
        ]
      }
    );

    CommitGraphPanel.currentPanel = new CommitGraphPanel(
      context,
      panel,
      gitService,
      commitGraphService,
      repositoryController,
      commitDetailsProvider
    );
    await CommitGraphPanel.currentPanel.updateRepository();
  }

  private repositoryRoot: string | undefined;
  private readonly detailCache = new Map<string, CommitGraphCommitDetail>();
  private query: CommitGraphQuery = {
    branchFilter: vscode.workspace.getConfiguration('codeTraceGit.commitGraph').get<string>('defaultBranchFilter', 'show all'),
    showRemoteBranches: vscode.workspace.getConfiguration('codeTraceGit.commitGraph').get<boolean>('showRemoteBranches', true),
    searchText: ''
  };

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly gitService: GitService,
    private readonly commitGraphService: CommitGraphService,
    private readonly repositoryController: RepositoryController,
    private readonly commitDetailsProvider: CommitDetailsProvider
  ) {
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, context.subscriptions);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message as CommitGraphMessage);
    }, null, context.subscriptions);
  }

  dispose(): void {
    if (CommitGraphPanel.currentPanel === this) {
      CommitGraphPanel.currentPanel = undefined;
    }
  }

  private async updateRepository(): Promise<void> {
    this.repositoryRoot = await this.repositoryController.getRepositoryRootForActiveEditor();
    await this.loadData();
  }

  private async handleMessage(message: CommitGraphMessage): Promise<void> {
    if (message.type === 'commitGraph:ready') {
      this.query = {
        branchFilter: message.branchFilter || this.query.branchFilter,
        showRemoteBranches: typeof message.showRemoteBranches === 'boolean'
          ? message.showRemoteBranches
          : this.query.showRemoteBranches,
        searchText: message.searchText || this.query.searchText
      };
      await this.loadData();
      return;
    }

    if (message.type === 'commitGraph:refresh') {
      this.commitGraphService.invalidate(this.repositoryRoot);
      await this.loadData(true);
      return;
    }

    if (message.type === 'commitGraph:filterChanged') {
      const nextBranchFilter = message.branchFilter || this.query.branchFilter;
      const nextShowRemote = typeof message.showRemoteBranches === 'boolean'
        ? message.showRemoteBranches
        : this.query.showRemoteBranches;
      const shouldReload = nextBranchFilter !== this.query.branchFilter || nextShowRemote !== this.query.showRemoteBranches;

      this.query = {
        branchFilter: nextBranchFilter,
        showRemoteBranches: nextShowRemote,
        searchText: message.searchText || this.query.searchText
      };

      if (shouldReload) {
        await this.loadData();
      }
      return;
    }

    if (message.type === 'commitGraph:openCommit' && typeof message.hash === 'string') {
      await this.openCommit(message.hash);
      return;
    }

    if (message.type === 'commitGraph:selectCommit' && typeof message.hash === 'string') {
      await this.loadCommitDetail(message.hash);
      return;
    }

    if (message.type === 'commitGraph:openWorkingTree') {
      await this.openWorkingTree();
      return;
    }

    if (message.type === 'commitGraph:settings') {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'codeTraceGit.commitGraph'
      );
    }
  }

  private async loadData(refresh = false): Promise<void> {
    if (!this.repositoryRoot) {
      this.postError('Open a workspace folder or active file inside a Git repository to view the commit graph.');
      return;
    }

    try {
      this.detailCache.clear();
      const payload = await this.commitGraphService.loadPayload(this.repositoryRoot, {
        ...this.query,
        refresh
      });
      this.panel.title = `Git Graph${payload.currentBranch ? `: ${payload.currentBranch}` : ''}`;
      await this.panel.webview.postMessage({
        type: 'commitGraph:data',
        payload
      });
    } catch (error) {
      this.postError(toDisplayMessage(error));
    }
  }

  private async loadCommitDetail(hash: string): Promise<void> {
    if (!this.repositoryRoot) {
      return;
    }

    try {
      const detail = this.detailCache.get(hash) ?? await this.commitGraphService.getCommitDetail(this.repositoryRoot, hash);
      this.detailCache.set(hash, detail);
      await this.panel.webview.postMessage({
        type: 'commitGraph:detail',
        payload: detail
      });
    } catch (error) {
      this.postError(toDisplayMessage(error));
    }
  }

  private async openCommit(hash: string): Promise<void> {
    if (!this.repositoryRoot) {
      return;
    }

    const commit = await this.gitService.getCommit(this.repositoryRoot, hash);
    if (!commit) {
      return;
    }

    await showCommitDetails(this.gitService, this.commitDetailsProvider, {
      commit,
      fileUri: vscode.Uri.file(this.repositoryRoot),
      repositoryRoot: this.repositoryRoot
    });
  }

  private async openWorkingTree(): Promise<void> {
    if (!this.repositoryRoot) {
      return;
    }

    try {
      const content = await this.commitGraphService.getWorkingTreeSummary(this.repositoryRoot);
      const document = await vscode.workspace.openTextDocument({
        content,
        language: 'diff'
      });
      await vscode.window.showTextDocument(document, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
      });
    } catch (error) {
      this.postError(toDisplayMessage(error));
    }
  }

  private postError(message: string): void {
    void this.panel.webview.postMessage({
      type: 'commitGraph:error',
      message
    });
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const baseUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webviews', 'commitGraph');
    const htmlPath = path.join(baseUri.fsPath, 'index.html');
    const template = fs.readFileSync(htmlPath, 'utf8');
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(baseUri, 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(baseUri, 'main.js'));

    return template
      .replace(/{{CSP_SOURCE}}/g, webview.cspSource)
      .replace(/{{NONCE}}/g, nonce)
      .replace('{{STYLE_URI}}', styleUri.toString())
      .replace('{{SCRIPT_URI}}', scriptUri.toString());
  }
}

export async function showCommitDetails(
  gitService: GitService,
  provider: CommitDetailsProvider,
  item: CommitReference
): Promise<void> {
  try {
    const repositoryRoot = item.repositoryRoot ?? (await gitService.getRepositoryContext(item.fileUri))?.root;
    if (!repositoryRoot) {
      void vscode.window.showWarningMessage('The selected file is not inside a Git repository.');
      return;
    }

    const content = await gitService.getCommitDetails(repositoryRoot, item.commit.hash);
    const uri = vscode.Uri.from({
      scheme: CommitDetailsProvider.scheme,
      path: `/${item.commit.shortHash}.patch`,
      query: item.commit.hash
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

export function toDisplayMessage(error: unknown): string {
  if (error instanceof GitCommandError) {
    return error.message;
  }

  return error instanceof Error ? error.message : 'The Git operation failed.';
}

export type CommitReference = {
  commit: GitCommit;
  fileUri: vscode.Uri;
  repositoryRoot?: string;
};
