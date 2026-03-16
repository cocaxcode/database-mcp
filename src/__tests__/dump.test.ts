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

  // ── Flujo conversacional ──

  it('paso 1: pregunta scope (total/personalizada) si no se pasa', async () => {
    const res = await callTool(ctx.client, 'db_dump', {})
    expect(res.text).toContain('Todas las tablas')
    expect(res.text).toContain('Personalizar tablas')
    expect(res.text).toContain('scope="all"')
    expect(res.text).toContain('scope="custom"')
    expect(res.isError).toBeFalsy()
  })

  it('paso 2: lista tablas con conteo si scope=custom sin tables', async () => {
    const res = await callTool(ctx.client, 'db_dump', { scope: 'custom' })
    expect(res.text).toContain('Tablas disponibles')
    expect(res.text).toContain('users')
    expect(res.text).toContain('posts')
    expect(res.text).toContain('filas')
    expect(res.text).toContain('filas en total')
    expect(res.isError).toBeFalsy()
  })

  it('paso 3: pregunta contenido si scope=all sin content', async () => {
    const res = await callTool(ctx.client, 'db_dump', { scope: 'all' })
    expect(res.text).toContain('Solo estructura')
    expect(res.text).toContain('Solo datos')
    expect(res.text).toContain('Todo')
    expect(res.text).toContain('content="schema"')
    expect(res.text).toContain('content="data"')
    expect(res.text).toContain('content="full"')
    expect(res.isError).toBeFalsy()
  })

  it('paso 3: pregunta contenido si scope=custom con tables', async () => {
    const res = await callTool(ctx.client, 'db_dump', { scope: 'custom', tables: ['users'] })
    expect(res.text).toContain('Solo estructura')
    expect(res.text).toContain('Solo datos')
    expect(res.text).toContain('content="schema"')
    expect(res.isError).toBeFalsy()
  })

  // ── Ejecucion real ──

  it('exporta solo estructura (all + schema)', async () => {
    const res = await callTool(ctx.client, 'db_dump', {
      scope: 'all',
      content: 'schema',
    })
    expect(res.text).toContain('Dump completado')
    expect(res.text).toContain('solo estructura')
    expect(res.text).toContain('Filas:     0')
    expect(res.text).toMatch(/Tablas:\s+2/)
    expect(res.isError).toBeFalsy()
  })

  it('exporta solo datos (all + data)', async () => {
    const res = await callTool(ctx.client, 'db_dump', {
      scope: 'all',
      content: 'data',
    })
    expect(res.text).toContain('Dump completado')
    expect(res.text).toContain('solo datos')
    expect(res.text).toContain('Filas:     3')
    expect(res.isError).toBeFalsy()
  })

  it('exporta todo (all + full)', async () => {
    const res = await callTool(ctx.client, 'db_dump', {
      scope: 'all',
      content: 'full',
    })
    expect(res.text).toContain('Dump completado')
    expect(res.text).toContain('estructura + datos')
    expect(res.text).toContain('Filas:     3')
    expect(res.isError).toBeFalsy()
  })

  it('exporta tablas especificas con datos', async () => {
    const res = await callTool(ctx.client, 'db_dump', {
      scope: 'custom',
      content: 'full',
      tables: ['users'],
    })
    expect(res.text).toContain('Dump completado')
    expect(res.text).toMatch(/Tablas:\s+1/)
    expect(res.text).toContain('Filas:     2')
    expect(res.isError).toBeFalsy()
  })

  // ── Dump list ──

  it('lista dumps disponibles', async () => {
    const res = await callTool(ctx.client, 'db_dump_list', {})
    expect(res.text).toContain('dump-test')
    expect(res.text).toContain('.sql')
    expect(res.isError).toBeFalsy()
  })

  // ── Restore ──

  it('restore pide confirmacion', async () => {
    const listRes = await callTool(ctx.client, 'db_dump_list', {})
    const dumps = JSON.parse(listRes.text)
    const filename = dumps[0].filename

    const res = await callTool(ctx.client, 'db_restore', { filename })
    expect(res.text).toContain('seguro')
    expect(res.text).toContain('confirm=true')
    expect(res.isError).toBeFalsy()
  })

  it('restore ejecuta con confirmacion', async () => {
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
    const ctx2 = await createTestClient()
    const res = await callTool(ctx2.client, 'db_dump_list', {})
    expect(res.text).toContain('No hay dumps disponibles')
    await ctx2.cleanup()
  })
})
