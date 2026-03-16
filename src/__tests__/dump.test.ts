import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestClient, callTool, type TestContext } from './helpers.js'

describe('db_dump / db_restore / db_dump_list', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await createTestClient()

    // Crear conexion SQLite en memoria y activarla
    await callTool(ctx.client, 'conn_create', {
      name: 'dump-test',
      type: 'sqlite',
      mode: 'read-write',
    })
    await callTool(ctx.client, 'conn_switch', { name: 'dump-test' })

    // Crear tablas y datos de prueba
    await callTool(ctx.client, 'execute_mutation', {
      sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT)',
    })
    await callTool(ctx.client, 'execute_mutation', {
      sql: 'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, user_id INTEGER, FOREIGN KEY (user_id) REFERENCES users(id))',
    })
    await callTool(ctx.client, 'execute_mutation', {
      sql: "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@test.com')",
    })
    await callTool(ctx.client, 'execute_mutation', {
      sql: "INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@test.com')",
    })
    await callTool(ctx.client, 'execute_mutation', {
      sql: "INSERT INTO posts (id, title, user_id) VALUES (1, 'Hello World', 1)",
    })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it('pregunta por modo si no se pasa', async () => {
    const res = await callTool(ctx.client, 'db_dump', {})
    expect(res.text).toContain('Solo estructura')
    expect(res.text).toContain('Estructura + datos')
    expect(res.isError).toBeFalsy()
  })

  it('pregunta por tablas si no se pasan', async () => {
    const res = await callTool(ctx.client, 'db_dump', { mode: 'full' })
    expect(res.text).toContain('Tablas disponibles')
    expect(res.text).toContain('users')
    expect(res.text).toContain('posts')
    expect(res.isError).toBeFalsy()
  })

  it('exporta solo estructura', async () => {
    const res = await callTool(ctx.client, 'db_dump', {
      mode: 'schema',
      all_tables: true,
    })
    expect(res.text).toContain('Dump completado')
    expect(res.text).toContain('Filas:    0')
    expect(res.text).toMatch(/Tablas:\s+2/)
    expect(res.isError).toBeFalsy()
  })

  it('exporta estructura + datos', async () => {
    const res = await callTool(ctx.client, 'db_dump', {
      mode: 'full',
      all_tables: true,
    })
    expect(res.text).toContain('Dump completado')
    expect(res.text).toContain('Filas:    3')
    expect(res.isError).toBeFalsy()
  })

  it('exporta tablas especificas', async () => {
    const res = await callTool(ctx.client, 'db_dump', {
      mode: 'full',
      tables: ['users'],
    })
    expect(res.text).toContain('Dump completado')
    expect(res.text).toMatch(/Tablas:\s+1/)
    expect(res.text).toContain('Filas:    2')
    expect(res.isError).toBeFalsy()
  })

  it('lista dumps disponibles', async () => {
    const res = await callTool(ctx.client, 'db_dump_list', {})
    expect(res.text).toContain('dump-test')
    expect(res.text).toContain('.sql')
    expect(res.isError).toBeFalsy()
  })

  it('restore pide confirmacion', async () => {
    // Primero obtener el nombre del dump
    const listRes = await callTool(ctx.client, 'db_dump_list', {})
    const dumps = JSON.parse(listRes.text)
    const filename = dumps[0].filename

    const res = await callTool(ctx.client, 'db_restore', { filename })
    expect(res.text).toContain('seguro')
    expect(res.text).toContain('confirm=true')
    expect(res.isError).toBeFalsy()
  })

  it('restore ejecuta con confirmacion', async () => {
    // Obtener el dump full mas reciente
    const listRes = await callTool(ctx.client, 'db_dump_list', {})
    const dumps = JSON.parse(listRes.text)
    const fullDump = dumps.find((d: { filename: string }) => d.filename.includes('full'))

    const res = await callTool(ctx.client, 'db_restore', {
      filename: fullDump.filename,
      confirm: true,
    })
    expect(res.text).toContain('Restauracion completada')
    expect(res.isError).toBeFalsy()

    // Verificar que los datos siguen ahi
    const users = await callTool(ctx.client, 'execute_query', { sql: 'SELECT count(*) as cnt FROM users' })
    expect(users.text).toContain('2')
  })

  it('restore lista dumps si no se pasa filename', async () => {
    const res = await callTool(ctx.client, 'db_restore', {})
    expect(res.text).toContain('Dumps disponibles')
    expect(res.isError).toBeFalsy()
  })

  it('db_dump_list sin dumps devuelve mensaje vacio', async () => {
    // Crear un cliente nuevo sin dumps
    const ctx2 = await createTestClient()
    const res = await callTool(ctx2.client, 'db_dump_list', {})
    expect(res.text).toContain('No hay dumps disponibles')
    await ctx2.cleanup()
  })
})
