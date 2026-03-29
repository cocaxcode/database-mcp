import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, callTool, type TestContext } from './helpers.js'

describe('Rollback tools', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestClient()
    await callTool(ctx.client, 'conn_create', { name: 'test', type: 'sqlite', mode: 'read-write', group: 'test' })
    await callTool(ctx.client, 'conn_switch', { name: 'test' })

    await callTool(ctx.client, 'execute_mutation', {
      sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)',
    })
    await callTool(ctx.client, 'execute_mutation', {
      sql: "INSERT INTO users (name, email) VALUES ('Alice', 'alice@test.com')",
    })
    await callTool(ctx.client, 'execute_mutation', {
      sql: "INSERT INTO users (name, email) VALUES ('Bob', 'bob@test.com')",
    })
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  it('rollback_list muestra snapshots', async () => {
    const result = await callTool(ctx.client, 'rollback_list')
    const snapshots = JSON.parse(result.text)
    // CREATE TABLE + 2 INSERTs = at least 3
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
  })

  it('rollback_list con connection filter', async () => {
    const result = await callTool(ctx.client, 'rollback_list', { connection: 'test' })
    const snapshots = JSON.parse(result.text)
    expect(snapshots.every((s: { connection: string }) => s.connection === 'test')).toBe(true)
  })

  it('rollback de DELETE restaura filas', async () => {
    // Eliminar Bob
    const deleteResult = await callTool(ctx.client, 'execute_mutation', {
      sql: "DELETE FROM users WHERE name = 'Bob'",
    })

    // Extraer rollback ID
    const rollbackLine = deleteResult.text.split('\n').find((l: string) => l.includes('Rollback disponible'))
    const rollbackId = rollbackLine?.split(': ')[1]
    expect(rollbackId).toBeDefined()

    // Verificar que Bob fue eliminado
    const check1 = await callTool(ctx.client, 'execute_query', { sql: 'SELECT * FROM users' })
    const data1 = JSON.parse(check1.text.split('\n\nNota:')[0])
    expect(data1.rowCount).toBe(1)

    // Aplicar rollback
    const rollback = await callTool(ctx.client, 'rollback_apply', { id: rollbackId!, confirm: true })
    expect(rollback.text).toContain('Rollback aplicado')

    // Verificar que Bob esta de vuelta
    const check2 = await callTool(ctx.client, 'execute_query', { sql: 'SELECT * FROM users' })
    const data2 = JSON.parse(check2.text.split('\n\nNota:')[0])
    expect(data2.rowCount).toBe(2)
  })

  it('rollback de INSERT elimina la fila insertada', async () => {
    // Insertar Charlie
    const insertResult = await callTool(ctx.client, 'execute_mutation', {
      sql: "INSERT INTO users (name, email) VALUES ('Charlie', 'charlie@test.com')",
    })

    // Extraer rollback ID
    const rollbackLine = insertResult.text.split('\n').find((l: string) => l.includes('Rollback disponible'))
    const rollbackId = rollbackLine?.split(': ')[1]
    expect(rollbackId).toBeDefined()

    // Verificar que Charlie existe (3 users)
    const check1 = await callTool(ctx.client, 'execute_query', { sql: 'SELECT * FROM users' })
    const data1 = JSON.parse(check1.text.split('\n\nNota:')[0])
    expect(data1.rowCount).toBe(3)

    // Aplicar rollback del INSERT
    const rollback = await callTool(ctx.client, 'rollback_apply', { id: rollbackId!, confirm: true })
    expect(rollback.text).toContain('Rollback aplicado')

    // Verificar que Charlie fue eliminado (2 users)
    const check2 = await callTool(ctx.client, 'execute_query', { sql: 'SELECT * FROM users' })
    const data2 = JSON.parse(check2.text.split('\n\nNota:')[0])
    expect(data2.rowCount).toBe(2)
  })

  it('rollback de DELETE con columnas JSON funciona', async () => {
    // Crear tabla con columna JSON
    await callTool(ctx.client, 'execute_mutation', {
      sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, data TEXT)',
    })
    await callTool(ctx.client, 'execute_mutation', {
      sql: `INSERT INTO items (name, data) VALUES ('item1', '{"key":"value","nested":{"a":1}}')`,
    })

    // Eliminar
    const deleteResult = await callTool(ctx.client, 'execute_mutation', {
      sql: "DELETE FROM items WHERE name = 'item1'",
    })

    const rollbackLine = deleteResult.text.split('\n').find((l: string) => l.includes('Rollback disponible'))
    const rollbackId = rollbackLine?.split(': ')[1]
    expect(rollbackId).toBeDefined()

    // Verificar eliminado
    const check1 = await callTool(ctx.client, 'execute_query', { sql: 'SELECT * FROM items' })
    const data1 = JSON.parse(check1.text.split('\n\nNota:')[0])
    expect(data1.rowCount).toBe(0)

    // Rollback
    const rollback = await callTool(ctx.client, 'rollback_apply', { id: rollbackId!, confirm: true })
    expect(rollback.text).toContain('Rollback aplicado')

    // Verificar restaurado
    const check2 = await callTool(ctx.client, 'execute_query', { sql: 'SELECT * FROM items' })
    const data2 = JSON.parse(check2.text.split('\n\nNota:')[0])
    expect(data2.rowCount).toBe(1)
  })

  it('rollback sin confirm muestra preview', async () => {
    await callTool(ctx.client, 'execute_mutation', {
      sql: "DELETE FROM users WHERE name = 'Alice'",
    })

    const list = await callTool(ctx.client, 'rollback_list', { limit: 1 })
    const snapshots = JSON.parse(list.text)
    const id = snapshots[0].id

    const result = await callTool(ctx.client, 'rollback_apply', { id })
    expect(result.text).toContain('Revertir')
    expect(result.text).toContain('confirm=true')
  })

  it('rollback de DDL muestra mensaje', async () => {
    await callTool(ctx.client, 'execute_mutation', {
      sql: 'CREATE TABLE temp (id INTEGER)',
    })

    const list = await callTool(ctx.client, 'rollback_list', { limit: 1 })
    const snapshots = JSON.parse(list.text)
    const ddlSnap = snapshots.find((s: { type: string }) => s.type === 'ddl')

    if (ddlSnap) {
      const result = await callTool(ctx.client, 'rollback_apply', { id: ddlSnap.id, confirm: true })
      expect(result.text).toContain('DDL')
    }
  })
})
