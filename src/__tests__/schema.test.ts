import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, callTool, type TestContext } from './helpers.js'

describe('Schema tools', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestClient()
    await callTool(ctx.client, 'conn_create', { name: 'test', type: 'sqlite', mode: 'read-write', group: 'test' })
    await callTool(ctx.client, 'conn_switch', { name: 'test' })

    // Crear tablas de prueba
    await callTool(ctx.client, 'execute_mutation', {
      sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT)',
    })
    await callTool(ctx.client, 'execute_mutation', {
      sql: 'CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), total REAL)',
    })
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  it('search_schema lista tablas con detail_level=names', async () => {
    const result = await callTool(ctx.client, 'search_schema', { detail_level: 'names' })
    const tables = JSON.parse(result.text)
    expect(tables).toHaveLength(2)
    expect(tables[0].name).toBeDefined()
    expect(tables[0].columns).toBeUndefined()
  })

  it('search_schema con detail_level=summary incluye columnas', async () => {
    const result = await callTool(ctx.client, 'search_schema', { detail_level: 'summary' })
    const tables = JSON.parse(result.text)
    expect(tables[0].columns).toBeDefined()
    expect(tables[0].columns.length).toBeGreaterThan(0)
  })

  it('search_schema con detail_level=full incluye FK e indices', async () => {
    const result = await callTool(ctx.client, 'search_schema', { detail_level: 'full' })
    const tables = JSON.parse(result.text)
    const ordersTable = tables.find((t: { name: string }) => t.name === 'orders')
    expect(ordersTable.foreignKeys).toBeDefined()
    expect(ordersTable.indexes).toBeDefined()
  })

  it('search_schema filtra por patron', async () => {
    const result = await callTool(ctx.client, 'search_schema', {
      detail_level: 'names',
      pattern: 'user%',
    })
    const tables = JSON.parse(result.text)
    expect(tables).toHaveLength(1)
    expect(tables[0].name).toBe('users')
  })

  it('search_schema filtra por object_type=table', async () => {
    const result = await callTool(ctx.client, 'search_schema', {
      detail_level: 'names',
      object_type: 'table',
    })
    const tables = JSON.parse(result.text)
    expect(tables).toHaveLength(2)
  })
})
