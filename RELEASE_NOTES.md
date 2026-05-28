# Release Notes

## v1.0.2 - 2026-05-29

### Highlights

- Renamed the extension's displayed product name from `CodeTrace_Git` to `CodeTrace_Extension` across docs and visible UI labels.
- Added a dedicated `CONTRIBUTING.md` with development setup, contribution scope, validation steps, and pull request guidance.
- Consolidated release version handling so the VSIX packaging script reads the version directly from `package.json`.

### Documentation

- Updated `README.md` to reflect the new extension name.
- Replaced the hardcoded VSIX install example with a version-agnostic command format.
- Updated roadmap and asset metadata to use the new product name consistently.

### Packaging and Maintenance

- Removed hardcoded VSIX version naming from `scripts/package-vsix.js`.
- Synced root package metadata in `package-lock.json` with the current extension version.

### Notes

- Repository URL remains `CodeTrace_Git` because it reflects the current GitHub repository path, not the extension display name.
