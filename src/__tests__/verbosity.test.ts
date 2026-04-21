import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, callTool, type TestContext } from './helpers.js'

describe('Query verbosity + only_columns + inspect_last_query', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestClient()
    await callTool(ctx.client, 'conn_create', {
      name: 'test',
      type: 'sqlite',
      mode: 'read-write',
      group: 'test',
    })
    await callTool(ctx.client, 'conn_switch', { name: 'test' })
    await callTool(ctx.client, 'execute_mutation', {
      sql: 'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, content TEXT)',
    })

    const bigContent = 'x'.repeat(2000)
    await callTool(ctx.client, 'execute_mutation', {
      sql: 'INSERT INTO posts (title, content) VALUES (?, ?)',
      params: ['Post 1', bigContent],
    })
    await callTool(ctx.client, 'execute_mutation', {
      sql: 'INSERT INTO posts (title, content) VALUES (?, ?)',
      params: ['Post 2', bigContent],
    })
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  function parseResult(text: string): Record<string, unknown> {
    const jsonPart = text.split(/\n(?:Nota:|Rollback)|\n\n--- Schema/)[0]
    return JSON.parse(jsonPart)
  }

  it("verbosity='minimal' devuelve rowCount + preview sin rows", async () => {
    const result = await callTool(ctx.client, 'execute_query', {
      sql: 'SELECT * FROM posts',
      verbosity: 'minimal',
    })
    const data = parseResult(result.text)
    expect(data.rowCount).toBe(2)
    expect(data.rows).toEqual([])
    expect(data.first_row_preview).toBeDefined()
    expect(data.call_id).toBeTruthy()
    expect(data.hint).toContain('inspect_last_query')
  })

  it("verbosity='normal' trunca celdas grandes (>500 bytes default)", async () => {
    const result = await callTool(ctx.client, 'execute_query', {
      sql: 'SELECT * FROM posts',
    })
    const data = parseResult(result.text)
    expect(data.rowCount).toBe(2)
    expect((data.rows as Record<string, unknown>[]).length).toBe(2)
    const row = (data.rows as Record<string, unknown>[])[0]
    const content = row.content as string
    expect(content.length).toBeLessThan(2000)
    expect(content).toContain('…(+')
    expect(data.cells_truncated).toBeGreaterThan(0)
  })

  it("verbosity='full' no trunca nada", async () => {
    const result = await callTool(ctx.client, 'execute_query', {
      sql: 'SELECT * FROM posts',
      verbosity: 'full',
    })
    const data = parseResult(result.text)
    const row = (data.rows as Record<string, unknown>[])[0]
    expect((row.content as string).length).toBe(2000)
    expect(data.tokens_saved_estimate).toBe(0)
  })

  it('only_columns proyecta sólo las columnas pedidas', async () => {
    const result = await callTool(ctx.client, 'execute_query', {
      sql: 'SELECT * FROM posts',
      only_columns: ['id', 'title'],
    })
    const data = parseResult(result.text)
    expect(data.columns).toEqual(['id', 'title'])
    const row0 = (data.rows as Record<string, unknown>[])[0]
    expect(row0.content).toBeUndefined()
  })

  it('max_cell_bytes personalizado', async () => {
    const result = await callTool(ctx.client, 'execute_query', {
      sql: 'SELECT * FROM posts',
      max_cell_bytes: 50,
    })
    const data = parseResult(result.text)
    const row = (data.rows as Record<string, unknown>[])[0]
    expect((row.content as string).length).toBeLessThan(100)
  })

  it('include_schema_context=false omite el schema trail', async () => {
    const result = await callTool(ctx.client, 'execute_query', {
      sql: 'SELECT * FROM posts',
      include_schema_context: false,
    })
    expect(result.text).not.toContain('--- Schema')
  })

  it('inspect_last_query recupera el result completo vía call_id', async () => {
    const queryResult = await callTool(ctx.client, 'execute_query', {
      sql: 'SELECT * FROM posts',
      verbosity: 'minimal',
    })
    const compressed = parseResult(queryResult.text)

    const inspected = await callTool(ctx.client, 'inspect_last_query', {
      call_id: compressed.call_id as string,
    })
    expect(inspected.isError).toBeFalsy()
    const textStart = inspected.text.indexOf('{')
    const payload = JSON.parse(inspected.text.slice(textStart))
    expect(payload.call_id).toBe(compressed.call_id)
    expect(payload.result.rows.length).toBe(2)
    expect((payload.result.rows[0].content as string).length).toBe(2000)
  })

  it('inspect_last_query sin call_id devuelve el más reciente', async () => {
    await callTool(ctx.client, 'execute_query', {
      sql: 'SELECT id FROM posts LIMIT 1',
    })
    const inspected = await callTool(ctx.client, 'inspect_last_query', {})
    expect(inspected.isError).toBeFalsy()
  })

  it('inspect_last_query con call_id inexistente devuelve error', async () => {
    const inspected = await callTool(ctx.client, 'inspect_last_query', {
      call_id: 'nonexist',
    })
    expect(inspected.isError).toBe(true)
  })

  it('execute_mutation con verbosity=minimal devuelve sólo affectedRows', async () => {
    const result = await callTool(ctx.client, 'execute_mutation', {
      sql: "UPDATE posts SET title = 'Updated' WHERE id = 1",
      verbosity: 'minimal',
    })
    const data = parseResult(result.text)
    expect(data.call_id).toBeTruthy()
    expect(data.executionTimeMs).toBeGreaterThanOrEqual(0)
  })
})
