import { describe, it, expect } from 'vitest'
import {
  compressQueryResult,
  makeQueryCallId,
  DEFAULT_MAX_CELL_BYTES,
} from '../utils/compress-query.js'
import type { QueryResult } from '../lib/types.js'

function buildResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: ['id', 'title', 'content'],
    rows: [
      { id: 1, title: 'Hello', content: 'World' },
      { id: 2, title: 'Foo', content: 'Bar' },
    ],
    rowCount: 2,
    executionTimeMs: 10,
    ...overrides,
  }
}

describe('makeQueryCallId', () => {
  it('genera IDs únicos de 8 chars', () => {
    const id1 = makeQueryCallId()
    const id2 = makeQueryCallId()
    expect(id1).toHaveLength(8)
    expect(id2).toHaveLength(8)
    expect(id1).not.toBe(id2)
  })
})

describe('compressQueryResult', () => {
  describe("verbosity='full'", () => {
    it('devuelve result intacto + call_id', () => {
      const res = buildResult()
      const out = compressQueryResult(res, { verbosity: 'full', call_id: 'abc12345' })
      expect(out.call_id).toBe('abc12345')
      expect(out.rows).toEqual(res.rows)
      expect(out.columns).toEqual(res.columns)
      expect(out.rowCount).toBe(2)
      expect(out.tokens_saved_estimate).toBe(0)
    })
  })

  describe("verbosity='minimal'", () => {
    it('solo devuelve rowCount + first_row_preview', () => {
      const res = buildResult()
      const out = compressQueryResult(res, { verbosity: 'minimal' })
      expect(out.rowCount).toBe(2)
      expect(out.rows).toEqual([])
      expect(out.first_row_preview).toBeDefined()
      expect(out.first_row_preview!.id).toBe(1)
      expect(out.rows_truncated).toBe(true)
      expect(out.hint).toContain('inspect_last_query')
    })

    it('sin rows no incluye preview ni hint', () => {
      const res = buildResult({ rows: [], rowCount: 0 })
      const out = compressQueryResult(res, { verbosity: 'minimal' })
      expect(out.first_row_preview).toBeUndefined()
      expect(out.rows_truncated).toBeFalsy()
    })

    it('preserva affectedRows si existe', () => {
      const res = buildResult({ rows: [], rowCount: 0, affectedRows: 5 })
      const out = compressQueryResult(res, { verbosity: 'minimal' })
      expect(out.affectedRows).toBe(5)
    })

    it('omite affectedRows cuando es null (EXPLAIN)', () => {
      const res = buildResult({
        rows: [],
        rowCount: 1,
        affectedRows: null as unknown as number,
      })
      const out = compressQueryResult(res, { verbosity: 'minimal' })
      expect('affectedRows' in out).toBe(false)
    })
  })

  describe("verbosity='normal' (default)", () => {
    it('celdas bajo max_cell_bytes pasan intactas', () => {
      const res = buildResult()
      const out = compressQueryResult(res)
      expect(out.rows).toEqual(res.rows)
      expect(out.cells_truncated).toBeUndefined()
    })

    it('celdas grandes se truncan con marcador …(+NB)', () => {
      const big = 'x'.repeat(2000)
      const res = buildResult({ rows: [{ id: 1, title: 'T', content: big }] })
      const out = compressQueryResult(res, { max_cell_bytes: 100 })
      const cell = (out.rows as Record<string, unknown>[])[0].content as string
      expect(cell.length).toBeLessThan(big.length)
      expect(cell).toContain('…(+')
      expect(out.cells_truncated).toBe(1)
      expect(out.hint).toContain('truncated')
    })

    it('only_columns filtra columnas', () => {
      const res = buildResult()
      const out = compressQueryResult(res, { only_columns: ['id', 'title'] })
      expect(out.columns).toEqual(['id', 'title'])
      const row0 = (out.rows as Record<string, unknown>[])[0]
      expect(Object.keys(row0)).toEqual(['id', 'title'])
      expect(row0.content).toBeUndefined()
    })

    it('only_columns ignora columnas inexistentes', () => {
      const res = buildResult()
      const out = compressQueryResult(res, { only_columns: ['id', 'nope'] })
      expect(out.columns).toEqual(['id'])
    })

    it('max_rows_in_response cap + hint', () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({
        id: i,
        title: `t${i}`,
        content: 'x',
      }))
      const res = buildResult({ rows, rowCount: 10 })
      const out = compressQueryResult(res, { max_rows_in_response: 3 })
      expect((out.rows as Record<string, unknown>[]).length).toBe(3)
      expect(out.rows_truncated).toBe(true)
      expect(out.original_rows).toBe(10)
      expect(out.hint).toContain('Showing 3/10 rows')
    })

    it('serializa objetos complejos al truncarlos', () => {
      const big = { nested: { a: 1, b: 'x'.repeat(1000) } }
      const res = buildResult({ rows: [{ id: 1, title: 'T', content: big }] })
      const out = compressQueryResult(res, { max_cell_bytes: 50 })
      const cell = (out.rows as Record<string, unknown>[])[0].content
      expect(typeof cell).toBe('string')
      expect(cell).toContain('…(+')
    })

    it('Dates se convierten a ISO', () => {
      const d = new Date('2026-01-01T00:00:00Z')
      const res = buildResult({ rows: [{ id: 1, title: 't', content: d }] })
      const out = compressQueryResult(res)
      expect((out.rows as Record<string, unknown>[])[0].content).toBe(d.toISOString())
    })
  })

  it('tokens_saved_estimate > 0 cuando hay truncado', () => {
    const big = 'x'.repeat(5000)
    const res = buildResult({ rows: [{ id: 1, title: 't', content: big }] })
    const out = compressQueryResult(res, { max_cell_bytes: 100 })
    expect(out.tokens_saved_estimate).toBeGreaterThan(0)
  })

  it('default max_cell_bytes es 500', () => {
    expect(DEFAULT_MAX_CELL_BYTES).toBe(500)
  })
})
