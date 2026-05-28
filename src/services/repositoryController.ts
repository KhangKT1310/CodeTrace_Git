import * as vscode from 'vscode';
import { RepositoryContext } from '../models/git';
import { GitService } from './gitService';

const STORAGE_KEY = 'openGitInsight.selectedRepositoryRoot';

export class RepositoryController implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeRepository = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gitService: GitService
  ) {}

  dispose(): void {
    this.changeEmitter.dispose();
  }

  async getSelectedRoot(): Promise<string | undefined> {
    const stored = this.context.workspaceState.get<string>(STORAGE_KEY);
    if (stored) {
      return stored;
    }

    const repositories = await this.gitService.getWorkspaceRepositories();
    return repositories[0]?.root;
  }

  async setSelectedRoot(root: string | undefined): Promise<void> {
    const current = this.context.workspaceState.get<string>(STORAGE_KEY);
    if (current === root) {
      return;
    }
    await this.context.workspaceState.update(STORAGE_KEY, root);
    this.changeEmitter.fire(root);
  }

  async pickRepository(): Promise<RepositoryContext | undefined> {
    const repositories = await this.gitService.getWorkspaceRepositories();
    if (repositories.length === 0) {
      void vscode.window.showInformationMessage('No Git repositories were found in the current workspace.');
      return undefined;
    }

    if (repositories.length === 1) {
      await this.setSelectedRoot(repositories[0].root);
      return repositories[0];
    }

    const current = await this.getSelectedRoot();
    const picked = await vscode.window.showQuickPick(
      repositories.map(repository => ({
        label: vscode.workspace.asRelativePath(repository.root, false),
        description: repository.root === current ? 'current' : undefined,
        detail: repository.root,
        repository
      })),
      { placeHolder: 'Select the active repository for repo-scoped views' }
    );

    if (!picked) {
      return undefined;
    }

    await this.setSelectedRoot(picked.repository.root);
    return picked.repository;
  }

  async getRepositoryRootForActiveEditor(): Promise<string | undefined> {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri?.scheme === 'file') {
      const repository = await this.gitService.getRepositoryContext(activeUri);
      if (repository) {
        return repository.root;
      }
    }

    return this.getSelectedRoot();
  }
}
