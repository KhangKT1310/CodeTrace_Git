# CodeTrace_Git

CodeTrace_Git is a VS Code extension for exploring repository history, blame, status, references, and worktrees directly inside VS Code.

It uses your local Git CLI, stays lightweight, and focuses on practical repo insight without depending on GitLens.

## Why CodeTrace_Git

- Inspect file history without leaving the editor
- View line blame inline or on hover while reading code
- Open commit details, patch views, and previous file revisions quickly
- Track branches, tags, stashes, remotes, and worktrees from a dedicated sidebar
- Explore repository history in a visual commit graph webview
- Generate commit messages or staged diff explanations with an optional local or custom AI endpoint

## Features

- Inline blame annotations for the current line or all visible lines
- Hover blame with commit hash, author, date, and summary
- File History sidebar for the active file
- Commit Graph webview with branch filters and working tree awareness
- Branch list sidebar
- Status sidebar with stage, unstage, diff, and discard actions
- References sidebar for tags, stashes, and remotes
- Worktree sidebar with open, copy path, add, and remove actions
- Commit details viewer
- Compare the current file with the previous revision
- Compare a selected file-history entry with its parent revision
- Open a file at any previous revision
- Show history for the current selection or line range
- AI commit message generation and staged diff explanation

## Requirements

- VS Code 1.90 or newer
- Git installed and available on your PATH

## Included Views

- `File History`: commit history for the active file
- `Commit Graph`: visual repository history with branch context
- `Branches`: local and remote branches
- `Status`: working tree changes with quick actions
- `References`: tags, stashes, and remotes
- `Worktrees`: Git worktree management

## Common Workflows

### Review changes faster

Use inline blame, hover blame, file history, and commit details together to understand why a line changed and what the related patch looked like.

### Investigate repository state

Use the Status, Branches, References, and Worktrees views to inspect what is currently changed, what refs exist, and which parallel worktrees are active.

### Navigate history visually

Open the Commit Graph webview to browse commit relationships, filter by branch, and inspect working tree state alongside repository history.

## Development

```bash
npm install
npm run compile
```

Run the extension in VS Code with `F5`.

## Package a VSIX

```bash
npm install
npm run compile
npm run package
```

This creates a `.vsix` file in the project root.

## Install From VSIX

1. In VS Code open the Extensions view.
2. Select the `...` menu in the top-right corner.
3. Choose `Install from VSIX...`.
4. Pick the generated `.vsix` file.

Or install from the command line:

```bash
code --install-extension codetrace-git-1.0.1.vsix
```

## Configuration

- `openGitInsight.inlineBlame.enabled`
- `openGitInsight.inlineBlame.mode`
- `openGitInsight.history.maxCommits`
- `openGitInsight.codeLens.enabled`
- `openGitInsight.ai.provider`
- `openGitInsight.ai.endpoint`
- `openGitInsight.ai.model`
- `codeTraceGit.commitGraph.maxCommits`
- `codeTraceGit.commitGraph.showRemoteBranches`
- `codeTraceGit.commitGraph.defaultBranchFilter`

## Notes

- Files outside Git repositories are handled gracefully.
- Git command failures are surfaced with user-friendly error messages.
- The extension does not use GitLens code, branding, or assets.
