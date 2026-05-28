# CodeTrace_Git

CodeTrace_Git is a VS Code extension that adds Git productivity features using the local Git CLI rather than any GitLens dependency.

## Features

- Inline blame annotations for the current line or all visible lines
- Hover blame with commit hash, author, date, and summary
- File History sidebar for the active file
- Branch list sidebar
- Commit details viewer
- Compare current file with the previous revision

## Requirements

- VS Code 1.90 or newer
- Git installed and available on your PATH

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
code --install-extension codetrace-git-0.0.1.vsix
```

## Configuration

- `openGitInsight.inlineBlame.enabled`
- `openGitInsight.inlineBlame.mode`
- `openGitInsight.history.maxCommits`

## Notes

- Files outside Git repositories are handled gracefully.
- Git command failures are surfaced with user-friendly error messages.
- The extension does not use GitLens code, branding, or assets.
