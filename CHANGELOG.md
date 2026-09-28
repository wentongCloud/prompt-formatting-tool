# Changelog

## 1.3.0

### Added
- Inline code spans (`` `…` `` / ``` ``…`` ```) are now treated as character descriptions, not structural escapes. Prose like ``Escape line breaks as `\n` `` survives both formatting and compression verbatim, peeled in lockstep with the surrounding text (same layer count, strict single-layer decode) and never expanded into a physical line break.
- `npm run test:extension` — builds and verifies both extension loading directories (project root and `dist`) and toolbar page paths.

### Fixed
- Chrome extension can now be loaded from the project root as well as `dist`: the build emits a root `manifest.json` pointing at the `dist` bundle, so "Load unpacked" no longer fails with "Manifest file is missing or unreadable".
- Toolbar click opens the tool page via a runtime-relative URL, fixing the service-worker navigation.

### Changed
- Refactored the mixed-layer/newline peelers onto a single shared backslash walker (`walkEscapes`).
- Updated extension icons.
