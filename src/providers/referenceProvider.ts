import * as vscode from 'vscode';
import { GitRemote, GitStash, GitTag } from '../models/git';
import { GitService } from '../services/gitService';
import { RepositoryController } from '../services/repositoryController';

class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly kind: 'tags' | 'stashes' | 'remotes',
    label: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = `ref-group-${kind}`;
  }
}

class RefItem extends vscode.TreeItem {
  constructor(label: string, description?: string, tooltip?: string, icon?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = tooltip ?? label;
    this.iconPath = icon ? new vscode.ThemeIcon(icon) : undefined;
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
  }
}

export class ReferenceProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly gitService: GitService,
    private readonly repositoryController: RepositoryController
  ) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const repositoryRoot = await this.repositoryController.getRepositoryRootForActiveEditor();
    if (!repositoryRoot) {
      return [new MessageItem('Select or open a repository to view tags, stashes, and remotes.')];
    }

    try {
      if (!element) {
        return [
          new GroupItem('tags', 'Tags'),
          new GroupItem('stashes', 'Stashes'),
          new GroupItem('remotes', 'Remotes')
        ];
      }

      if (!(element instanceof GroupItem)) {
        return [];
      }

      if (element.kind === 'tags') {
        const tags = await this.gitService.getTags(repositoryRoot);
        return tags.length > 0 ? tags.map(tag => toTagItem(tag)) : [new MessageItem('No tags found.')];
      }

      if (element.kind === 'stashes') {
        const stashes = await this.gitService.getStashes(repositoryRoot);
        return stashes.length > 0 ? stashes.map(stash => toStashItem(stash)) : [new MessageItem('No stashes found.')];
      }

      const remotes = await this.gitService.getRemotes(repositoryRoot);
      return remotes.length > 0 ? remotes.map(remote => toRemoteItem(remote)) : [new MessageItem('No remotes found.')];
    } catch (error) {
      return [new MessageItem(error instanceof Error ? error.message : 'Unable to load references.')];
    }
  }
}

function toTagItem(tag: GitTag): vscode.TreeItem {
  return new RefItem(tag.name, tag.target, `${tag.name}\n${tag.target ?? ''}`.trim(), 'tag');
}

function toStashItem(stash: GitStash): vscode.TreeItem {
  const description = stash.branch ? `${stash.branch}` : undefined;
  return new RefItem(stash.ref, description, `${stash.ref}\n${stash.summary}`.trim(), 'archive');
}

function toRemoteItem(remote: GitRemote): vscode.TreeItem {
  const description = remote.fetchUrl && remote.pushUrl && remote.fetchUrl !== remote.pushUrl
    ? 'fetch/push'
    : remote.fetchUrl
      ? 'fetch'
      : remote.pushUrl
        ? 'push'
        : undefined;
  const tooltip = [remote.name, remote.fetchUrl, remote.pushUrl].filter(Boolean).join('\n');
  return new RefItem(remote.name, description, tooltip, 'cloud');
}
