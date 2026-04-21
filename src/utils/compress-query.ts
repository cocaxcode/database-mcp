import type { QueryResult } from '../lib/types.js'

export type QueryVerbosity = 'minimal' | 'normal' | 'full'

export const DEFAULT_MAX_CELL_BYTES = 500

export interface CompressQueryOptions {
  verbosity?: QueryVerbosity
  only_columns?: string[]
  max_cell_bytes?: number
  max_rows_in_response?: number
  call_id?: string
}

export interface CompressedQueryResult {
  call_id: string
  columns: string[]
  rows: Record<string, unknown>[] | null
  rowCount: number
  affectedRows?: number
  executionTimeMs: number
  first_row_preview?: Record<string, unknown>
  rows_truncated?: boolean
  cells_truncated?: number
  original_rows?: number
  original_cell_bytes?: number
  tokens_saved_estimate?: number
  hint?: string
}

/**
 * Genera un call_id corto (8 chars) base36.
 */
export function makeQueryCallId(): string {
  const ts = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 6)
  return (ts + rnd).slice(-8)
}

function cellByteLength(value: unknown): number {
  if (value === null || value === undefined) return 4
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf-8')
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length
  if (value instanceof Date) return value.toISOString().length
  return Buffer.byteLength(JSON.stringify(value), 'utf-8')
}

function truncateCell(
  value: unknown,
  maxBytes: number,
): { value: unknown; truncated: boolean } {
  if (value === null || value === undefined) return { value, truncated: false }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { value, truncated: false }
  }

  if (typeof value === 'string') {
    const bytes = Buffer.byteLength(value, 'utf-8')
    if (bytes <= maxBytes) return { value, truncated: false }
    const truncated =
      Buffer.from(value, 'utf-8').subarray(0, maxBytes).toString('utf-8') +
      `…(+${bytes - maxBytes}B)`
    return { value: truncated, truncated: true }
  }

  if (value instanceof Date) {
    return { value: value.toISOString(), truncated: false }
  }

  // object / array — serializar y truncar si hace falta
  const serialized = JSON.stringify(value)
  const bytes = Buffer.byteLength(serialized, 'utf-8')
  if (bytes <= maxBytes) return { value, truncated: false }
  const truncated =
    Buffer.from(serialized, 'utf-8').subarray(0, maxBytes).toString('utf-8') +
    `…(+${bytes - maxBytes}B)`
  return { value: truncated, truncated: true }
}

/**
 * Comprime un QueryResult según verbosity y opciones.
 * Preserva rowCount / executionTimeMs / columns intactos para compatibilidad.
 */
export function compressQueryResult(
  result: QueryResult,
  opts: CompressQueryOptions = {},
): CompressedQueryResult {
  const verbosity: QueryVerbosity = opts.verbosity ?? 'normal'
  const maxCell = opts.max_cell_bytes ?? DEFAULT_MAX_CELL_BYTES
  const callId = opts.call_id ?? makeQueryCallId()

  // Tamaño original aproximado para estimación de tokens
  let originalCellBytes = 0
  for (const row of result.rows) {
    for (const key of result.columns) {
      originalCellBytes += cellByteLength(row[key])
    }
  }

  const base: CompressedQueryResult = {
    call_id: callId,
    columns: result.columns,
    rows: null,
    rowCount: result.rowCount,
    executionTimeMs: result.executionTimeMs,
    original_cell_bytes: originalCellBytes,
  }
  if (result.affectedRows != null) base.affectedRows = result.affectedRows

  // MINIMAL — sólo metadata + primera fila preview
  if (verbosity === 'minimal') {
    base.rows = []
    if (result.rows.length > 0) {
      const first = result.rows[0]
      const preview: Record<string, unknown> = {}
      for (const col of result.columns) {
        const { value } = truncateCell(first[col], 100)
        preview[col] = value
      }
      base.first_row_preview = preview
    }
    if (result.rows.length > 1) {
      base.rows_truncated = true
      base.original_rows = result.rows.length
      base.hint = `Use inspect_last_query({ call_id: "${callId}" }) for the full result (${result.rows.length} rows).`
    }
    base.tokens_saved_estimate = Math.max(
      0,
      Math.floor((originalCellBytes - 100 * result.columns.length) / 4),
    )
    return base
  }

  // FULL — sin compresión
  if (verbosity === 'full') {
    base.rows = result.rows
    base.tokens_saved_estimate = 0
    return base
  }

  // NORMAL (default) — cell truncation + only_columns + row cap
  const cols =
    opts.only_columns && opts.only_columns.length > 0
      ? opts.only_columns.filter((c) => result.columns.includes(c))
      : result.columns
  base.columns = cols

  const rowCap = opts.max_rows_in_response ?? result.rows.length
  const limitedRows = result.rows.slice(0, rowCap)

  let cellsTruncated = 0
  const processedRows: Record<string, unknown>[] = []
  for (const row of limitedRows) {
    const out: Record<string, unknown> = {}
    for (const col of cols) {
      const { value, truncated } = truncateCell(row[col], maxCell)
      out[col] = value
      if (truncated) cellsTruncated++
    }
    processedRows.push(out)
  }
  base.rows = processedRows
  if (cellsTruncated > 0) base.cells_truncated = cellsTruncated

  if (result.rows.length > rowCap) {
    base.rows_truncated = true
    base.original_rows = result.rows.length
    base.hint = `Showing ${rowCap}/${result.rows.length} rows. Use inspect_last_query({ call_id: "${callId}" }) for the full result.`
  } else if (cellsTruncated > 0) {
    base.hint = `${cellsTruncated} cell(s) truncated to ${maxCell} bytes. Use inspect_last_query({ call_id: "${callId}" }) for full values.`
  }

  // Estimación de tokens ahorrados
  const compressedBytes = Buffer.byteLength(JSON.stringify(processedRows), 'utf-8')
  base.tokens_saved_estimate = Math.max(
    0,
    Math.floor((originalCellBytes - compressedBytes) / 4),
  )

  return base
}

/**
 * Formatea un CompressedQueryResult como JSON pretty con contextos opcionales.
 * Extra es un string que se añade al final (ej: schemaCtx, rollbackMsg).
 */
export function formatCompressedResult(
  result: CompressedQueryResult,
  extra: string = '',
): string {
  return JSON.stringify(result, null, 2) + extra
}
