import type { QueryResult } from '../lib/types.js'

const MAX_RESULT_LENGTH = 25000

/**
 * Formatea un QueryResult como JSON compacto.
 * Trunca a MAX_RESULT_LENGTH caracteres si es necesario.
 */
export function formatQueryResult(result: QueryResult): string {
  const json = JSON.stringify(
    {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      ...(result.affectedRows !== undefined ? { affectedRows: result.affectedRows } : {}),
      executionTimeMs: result.executionTimeMs,
    },
    null,
    2,
  )

  if (json.length <= MAX_RESULT_LENGTH) {
    return json
  }

  // Truncar filas progresivamente
  const rows = [...result.rows]
  while (rows.length > 0) {
    rows.pop()
    const truncated = JSON.stringify(
      {
        columns: result.columns,
        rows,
        rowCount: result.rowCount,
        truncated: true,
        shownRows: rows.length,
        totalRows: result.rows.length,
        ...(result.affectedRows !== undefined ? { affectedRows: result.affectedRows } : {}),
        executionTimeMs: result.executionTimeMs,
      },
      null,
      2,
    )
    if (truncated.length <= MAX_RESULT_LENGTH) {
      return truncated
    }
  }

  // Caso extremo: ni una fila cabe
  return JSON.stringify({
    columns: result.columns,
    rows: [],
    rowCount: result.rowCount,
    truncated: true,
    shownRows: 0,
    totalRows: result.rows.length,
    executionTimeMs: result.executionTimeMs,
  })
}
