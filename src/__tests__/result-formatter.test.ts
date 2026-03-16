import { describe, it, expect } from 'vitest'
import { formatQueryResult } from '../utils/result-formatter.js'
import type { QueryResult } from '../lib/types.js'

describe('formatQueryResult', () => {
  it('formatea resultado normal', () => {
    const result: QueryResult = {
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'Alice' }],
      rowCount: 1,
      executionTimeMs: 5,
    }
    const json = formatQueryResult(result)
    const parsed = JSON.parse(json)
    expect(parsed.rowCount).toBe(1)
    expect(parsed.rows).toHaveLength(1)
  })

  it('incluye affectedRows si esta presente', () => {
    const result: QueryResult = {
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: 3,
      executionTimeMs: 2,
    }
    const json = formatQueryResult(result)
    const parsed = JSON.parse(json)
    expect(parsed.affectedRows).toBe(3)
  })

  it('trunca resultados grandes', () => {
    const bigRows = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      data: 'x'.repeat(100),
    }))
    const result: QueryResult = {
      columns: ['id', 'data'],
      rows: bigRows,
      rowCount: 1000,
      executionTimeMs: 10,
    }
    const json = formatQueryResult(result)
    expect(json.length).toBeLessThanOrEqual(25000)

    const parsed = JSON.parse(json)
    expect(parsed.truncated).toBe(true)
    expect(parsed.shownRows).toBeLessThan(1000)
  })
})
