# AGENTS.md — Prompt Formatting Tool

## Architecture Overview

A Prompt formatting tool available as both a Chrome extension and a web app. It formats escaped single-line text into readable multi-line Markdown and compresses Markdown back into JSON-safe escaped single-line text.

### Core Modules (`src/`)

| Module | Lines | Responsibility | Internal Dependencies |
|--------|-------|---------------|----------------------|
| `escape.js` | ~192 | Escape primitives: JSON escape table constants, paired-scan decode/encode (`decodeEscapeLayer`/`encodeEscapeLayer`), gate-passthrough encoding (`gateEncode`), quote-aware scanning (`forEachOutsideChar`/`hasStructuralEscapes`) | None |
| `json.js` | ~95 | JSON pipeline: strict parsing + multi-layer peeling (`parseJsonLayers`) + `jsonrepair` fallback + formatting | `escape.js` |
| `toon.js` | ~265 | TOON pipeline: quote-aware layer peeling, generic header detection (`name[N]{fields}:` / `name[N]:` / `name{fields}:`), line-aware block layout and value governance | `escape.js` |
| `html.js` | ~165 | HTML formatting: prettier-style tree-building (`formatHtml`) with single-line collapse + HTML whitespace collapsing | None (self-contained) |
| `transform.js` | ~260 | Orchestrator: input type detection (`detectInputType`), input cleaning (`cleanPromptInput`), format/compress entry points (`formatInput`/`compressPrompt`) | `escape.js`, `json.js`, `html.js`, `toon.js` |
| `main.jsx` | ~197 | UI entry: React app shell with three-column layout, format/compress buttons, syntax highlighting, drag-to-resize panels | `transform.js` |

### Dependency Direction (unidirectional, no cycles)

```
main.jsx → transform.js → { escape.js, json.js, html.js, toon.js }
                           json.js  → escape.js
                           toon.js  → escape.js
                           html.js  (self-contained)
                           escape.js (no internal dependencies)
```

Arrows point from dependent to dependency. No module imports from a module that depends on it.

## Key Development Conventions

### 1. Escape Gate Passthrough (门禁直通)

Compression of plain text uses `gateEncode`, **not** decode-first. Decode-first would misinterpret literal `\t` in Windows paths (`C:\tmp`) as a Tab character, which then gets collapsed and lost.

- **Multi-line input** (contains a real newline) is readable Markdown and fully escaped via the escape table (`encodeEscapeLayer`) — **unless** it mixes in compressed fragments (literal `\n` / `\"` sequences, detected by `MIXED_LAYER_SIGNAL`): then denoise-first applies — a targeted peel (`peelMixedLayer`) strips only `\"` → `"` and `\n` → real newline before collapsing and encoding, so the product carries exactly one escape layer and repeated compression is idempotent. The peel deliberately never touches `\t` / `\\` (path/regex safety).
- **Single-line input** may already be a compressed product: if it contains legal escapes (`\"`, `\\`, `\n`, `\r`, `\b`, `\f`, `\uXXXX` — deliberately **excluding** `\t`), they are protected as-is and never double-escaped. Repeated compression is idempotent.
- A **bare `"`** (not preceded by `\`) is always escaped to `\"`, even in gate mode — only already-escaped `\"` is protected, so the compressed output is always a valid JSON string body.
- Literal `\t` has its backslash escaped (`\` → `\\`); a real Tab character outputs `\t`.

### 2. TOON Symmetric Peeling (对称剥层)

The TOON pipeline uses quote-aware `hasStructuralEscapes` (escapes outside quotes: `\X` where X ∈ `nrt"`) to decide whether to peel a layer:

- **Format side**: peel layers until no structural escapes remain outside quotes, using strict single-layer decode (no fold semantics — avoids corrupting in-value literal `\\n`).
- **Compress side**: if structural escapes exist, peel one layer then blindly re-encode one layer (symmetric with format-side peeling). In-value literal escapes are protected by quote pairing.
- **Headers**: all three TOON header shapes are recognized — `name[N]{fields}:` (table), `name[N]:` (array without field declaration), `name{fields}:` (single object). Document splitting only cuts at column-0 headers (lookbehind line anchor); indented or `- `-prefixed headers are nested blocks, never split points.
- **Layout**: bodies with line structure use line-aware layout — source lines are TOON lines (CSV rows stay intact, never split on commas), indented by a block stack driven by declared `[N]` lengths (data rows consumed by the innermost block; exhausted blocks pop, so sibling `- fields[·]{·}:` blocks keep the same indent; truncated input beyond declared counts keeps blocks open). Flat bodies keep the legacy comma-per-line state machine.

### 3. Whitespace Collapsing Rules (空白折叠)

- **Both format and compress**: collapse runs of ≥2 consecutive spaces/tabs into a single space.
- **Format side**: preserves leading indentation and trailing whitespace per line; fenced code block contents are self-contained and not collapsed.
- **Compress side**: collapses inline whitespace (≥2 spaces/tabs → single space), strips line-leading/trailing whitespace, preserves newline structure. CR/CRLF normalized to LF before processing. An escaped `\n` is treated as a line boundary so indentation after it is stripped (not collapsed to a space); `\\n` (escaped backslash + literal `n`) is not a line break.
- **HTML whitespace**: all whitespace runs between tags (including newlines) collapse to a single space.
- **Fenced blocks**: symmetric on both sides — format peels and formats inner content; compress blindly adds one escape layer. Inner JSON/HTML/XML is formatted/compressed independently.

## Commands

```bash
# Run tests (Node.js built-in test runner)
npm test

# Build for production (Vite build, outputs to dist/)
npm run build

# Development server
npm run dev
```

Tests live in `src/transform.test.js` and validate exclusively through `transform.js` public exports — they verify the contract of the orchestrator, not internal module APIs.
