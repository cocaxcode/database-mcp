import { z } from 'zod'

/**
 * Parámetros de compresión compartidos para tools de query (execute_query,
 * execute_mutation, explain_query). Reduce tokens de contexto.
 */
export const QueryVerbosityShape = {
  verbosity: z
    .enum(['minimal', 'normal', 'full'])
    .optional()
    .describe(
      `Controls result detail to save context tokens. Default: 'normal'.

- 'minimal': Only rowCount, executionTimeMs, affectedRows, and preview of first row.
  USE FOR: INSERT/UPDATE/DELETE where you only need to confirm success, COUNT queries,
  health-style SQL ("SELECT 1"), polling a job status. SAVES: ~90-95% tokens.

- 'normal' (DEFAULT): Full rows but each CELL truncated to max_cell_bytes. Preserves
  table structure. Cells flagged with trailing '…(+NB)' marker when truncated.
  USE FOR: most SELECT debugging — browsing tables with TEXT/JSONB columns, exploring data.
  SAVES: ~60-80% tokens on tables with large columns (content, html, json payloads).

- 'full': Entire result untouched. SAME SHAPE AS pre-compression releases.
  USE FOR: when you explicitly need the complete value of every cell.

If a cell is truncated you can call inspect_last_query({ call_id }) to recover the
full result WITHOUT re-executing the SQL (preserves DB load and any side-effects).`,
    ),
  only_columns: z
    .array(z.string())
    .optional()
    .describe(
      `Return only these columns from the result (client-side projection after fetch).
Cheaper than full when the SQL already returned extra columns you don't need.
Example: ["id", "title", "slug"] drops all other columns from the response.`,
    ),
  max_cell_bytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Max bytes per cell for verbosity='normal' (default: 500). Cells longer than this are truncated with '…(+NB)' suffix. Ignored for minimal/full.",
    ),
  max_rows_in_response: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Cap rows returned to the agent (does NOT change the SQL LIMIT). Useful to peek at a big result. Default: no cap beyond SQL LIMIT.',
    ),
}
