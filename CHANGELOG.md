# Changelog

## 0.3.2

### Docs

- Added **"Native vs MCP: real token cost"** section to the README with a concrete comparison table (psql raw vs full/normal/minimal/only_columns) based on a measured real-world query. Clarifies why `inspect_last_query` is especially valuable for SQL (no DB CPU re-cost, no re-triggered side-effects on RETURNING).

## 0.3.1

### Fixed

- `explain_query` and other queries from the postgres driver no longer include a cosmetic `"affectedRows": null` field in the compressed output. The compressor now filters both `undefined` and `null` values.

## 0.3.0

### Added

- **Response compression for `execute_query` / `execute_mutation` / `explain_query`**: four new optional parameters to reduce AI context consumption by 60-95%.
  - `verbosity: 'minimal' | 'normal' | 'full'` (default `'normal'`).
    - `minimal` — only `rowCount`, `executionTimeMs`, `affectedRows`, and preview of the first row. Ideal for INSERT/UPDATE confirmation, COUNT queries, polling. Saves ~90-95% tokens.
    - `normal` (default) — full rows but each CELL truncated to `max_cell_bytes` bytes. Preserves table structure; truncated cells get a trailing `…(+NB)` marker. Saves ~60-80% tokens on tables with large columns (content, HTML, JSON).
    - `full` — entire result untouched. Same shape as pre-0.3 releases.
  - `only_columns: string[]` — client-side column projection. Useful when the SQL already returned extra columns you don't want in the response.
  - `max_cell_bytes: number` — max bytes per cell for `'normal'` (default 500).
  - `max_rows_in_response: number` — cap rows returned to the agent beyond the SQL LIMIT.
- **`include_schema_context: boolean`** on `execute_query` (default true, false for `'minimal'`). Skip the schema trail when you already know it.
- **New tool `inspect_last_query`** — recovers the full, uncompressed result of a previous query via `call_id`. Does NOT re-execute the SQL, preserving DB load and side-effects. Ring buffer of 20 results + disk persistence at `~/.database-mcp/last-queries/` with 1h TTL.

### Changed

- `execute_query` / `execute_mutation` / `explain_query` responses now include `call_id` and may include `rows_truncated`, `cells_truncated`, `hint`, `tokens_saved_estimate` when `'normal'` or `'minimal'`. `rowCount`, `columns`, `rows`, `executionTimeMs`, `affectedRows` are preserved for backward compatibility. Pass `verbosity: 'full'` to get the exact pre-0.3 shape.
- `result-formatter.ts` global 25KB truncation replaced with per-cell byte limit — preserves structure and row count instead of cutting trailing rows blindly.

### Internal

- New modules: `utils/compress-query.ts`, `services/query-cache.ts`, `tools/inspect.ts`, `lib/query-schemas.ts`.
- 56 new tests (157 total, all passing).
- No new runtime dependencies.
