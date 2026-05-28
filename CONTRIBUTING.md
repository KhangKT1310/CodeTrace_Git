# Contributing to CodeTrace_Git

## Scope

Contributions should stay aligned with the project goal: practical Git history and repository insight inside VS Code, built on top of the local Git CLI and kept lightweight.

Good contribution areas:

- Bug fixes in existing Git, provider, or webview flows
- UI and UX improvements for existing views and commands
- Performance improvements for history, blame, status, or graph rendering
- Documentation updates
- Small, focused features that fit the current extension scope

Avoid broad changes that add heavy dependencies, duplicate GitLens behavior unnecessarily, or move the project away from a local Git CLI approach.

## Development Setup

Requirements:

- Node.js and npm
- VS Code 1.90 or newer
- Git available on `PATH`

Install and build:

```bash
npm install
npm run compile
```

To run the extension locally, open the project in VS Code and press `F5`.

## Project Structure

- `src/providers/`: tree views, blame, status, and editor integrations
- `src/services/`: repository, Git, and AI service orchestration
- `src/git/`: lower-level Git graph and Git execution helpers
- `src/webviews/`: webview panels and frontend assets
- `scripts/`: packaging and build helper scripts

## Contribution Guidelines

- Keep changes focused. Separate refactors from behavior changes when possible.
- Prefer extending existing services/providers over introducing parallel abstractions.
- Keep the extension responsive. Avoid blocking the VS Code UI thread with heavy synchronous work.
- Use the local Git CLI as the source of truth unless there is a strong reason not to.
- Minimize dependencies. New packages should have a clear maintenance and size justification.
- Preserve existing naming and command conventions unless there is a concrete cleanup plan.

## Code Style

- Follow the existing TypeScript style in the repo.
- Keep code readable and explicit over clever abstractions.
- Reuse existing models and services before adding new ones.
- Keep webview code and extension host code clearly separated.
- Add comments only where the logic is not obvious.

## Validation Before Submitting

At minimum, run:

```bash
npm run compile
```

If your change affects packaging, also run:

```bash
npm run package
```

If you changed UI behavior, validate it manually in a VS Code Extension Development Host.

## Pull Request Notes

- Describe the user-visible change and why it is needed.
- List any manual verification steps you performed.
- Include screenshots or short recordings for webview or sidebar UI changes when helpful.
- Keep pull requests reviewable. Smaller PRs are preferred over large mixed changes.

## Commit Guidance

- Use clear, direct commit messages.
- Reference the affected area when useful, for example: `status: fix staged file refresh`.

## Documentation

Update `README.md` when your change affects:

- Features
- Setup or requirements
- Commands or configuration
- Packaging or installation steps
