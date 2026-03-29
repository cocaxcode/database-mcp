import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, callTool, type TestContext } from './helpers.js'

describe('History tools', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestClient()
    await callTool(ctx.client, 'conn_create', { name: 'test', type: 'sqlite', mode: 'read-write', group: 'test' })
    await callTool(ctx.client, 'conn_switch', { name: 'test' })

    await callTool(ctx.client, 'execute_mutation', {
      sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
    })
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  it('history_list muestra historial de queries', async () => {
    await callTool(ctx.client, 'execute_query', { sql: 'SELECT * FROM users' })
    await callTool(ctx.client, 'execute_mutation', { sql: "INSERT INTO users (name) VALUES ('test')" })

    const result = await callTool(ctx.client, 'history_list')
    const entries = JSON.parse(result.text)
    expect(entries.length).toBeGreaterThanOrEqual(2)
  })

  it('history_list filtra por type', async () => {
    await callTool(ctx.client, 'execute_query', { sql: 'SELECT * FROM users' })
    await callTool(ctx.client, 'execute_mutation', { sql: "INSERT INTO users (name) VALUES ('test')" })

    const result = await callTool(ctx.client, 'history_list', { type: 'read' })
    const entries = JSON.parse(result.text)
    expect(entries.every((e: { type: string }) => e.type === 'read')).toBe(true)
  })

  it('history_list filtra por connection', async () => {
    await callTool(ctx.client, 'execute_query', { sql: 'SELECT * FROM users' })

    const result = await callTool(ctx.client, 'history_list', { connection: 'test' })
    const entries = JSON.parse(result.text)
    expect(entries.every((e: { connection: string }) => e.connection === 'test')).toBe(true)
  })

  it('history_clear limpia todo el historial', async () => {
    await callTool(ctx.client, 'execute_query', { sql: 'SELECT * FROM users' })

    const result = await callTool(ctx.client, 'history_clear')
    expect(result.text).toContain('eliminada')

    const list = await callTool(ctx.client, 'history_list')
    expect(list.text).toContain('No hay historial')
  })

  it('history muestra historial vacio', async () => {
    // Solo el CREATE TABLE deberia estar
    const result = await callTool(ctx.client, 'history_clear')
    expect(result.text).toContain('eliminada')

    const list = await callTool(ctx.client, 'history_list')
    expect(list.text).toContain('No hay historial')
  })
})
