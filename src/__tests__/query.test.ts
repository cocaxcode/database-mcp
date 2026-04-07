import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, callTool, type TestContext } from './helpers.js'

describe('Query tools', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestClient()
    // Crear y activar conexion SQLite :memory:
    await callTool(ctx.client, 'conn_create', { name: 'test', type: 'sqlite', mode: 'read-write', group: 'test' })
    await callTool(ctx.client, 'conn_switch', { name: 'test' })

    // Crear tabla de prueba
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

  describe('execute_query', () => {
    it('ejecuta SELECT y retorna resultados', async () => {
      const result = await callTool(ctx.client, 'execute_query', {
        sql: 'SELECT * FROM users',
      })
      const data = JSON.parse(result.text.split(/\n\n(?:Nota:|--- Schema)/)[0])
      expect(data.rowCount).toBe(2)
      expect(data.columns).toContain('name')
    })

    it('aplica LIMIT por defecto', async () => {
      const result = await callTool(ctx.client, 'execute_query', {
        sql: 'SELECT * FROM users',
        limit: 1,
      })
      const data = JSON.parse(result.text.split(/\n\n(?:Nota:|--- Schema)/)[0])
      expect(data.rowCount).toBe(1)
    })

    it('rechaza mutaciones', async () => {
      const result = await callTool(ctx.client, 'execute_query', {
        sql: "INSERT INTO users (name) VALUES ('test')",
      })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('lectura')
    })
  })

  describe('execute_mutation', () => {
    it('ejecuta INSERT y retorna affected rows', async () => {
      const result = await callTool(ctx.client, 'execute_mutation', {
        sql: "INSERT INTO users (name, email) VALUES ('Charlie', 'charlie@test.com')",
      })
      expect(result.text).toContain('Rollback disponible')
    })

    it('ejecuta UPDATE', async () => {
      const result = await callTool(ctx.client, 'execute_mutation', {
        sql: "UPDATE users SET name = 'Updated' WHERE id = 1",
      })
      expect(result.isError).toBeFalsy()
    })

    it('ejecuta DELETE', async () => {
      const result = await callTool(ctx.client, 'execute_mutation', {
        sql: 'DELETE FROM users WHERE id = 1',
      })
      expect(result.isError).toBeFalsy()

      // Verificar que se elimino
      const check = await callTool(ctx.client, 'execute_query', {
        sql: 'SELECT * FROM users',
      })
      const data = JSON.parse(check.text.split(/\n\n(?:Nota:|--- Schema)/)[0])
      expect(data.rowCount).toBe(1)
    })

    it('rechaza read-only mode', async () => {
      await callTool(ctx.client, 'conn_set', { name: 'test', key: 'mode', value: 'read-only' })

      const result = await callTool(ctx.client, 'execute_mutation', {
        sql: "INSERT INTO users (name) VALUES ('test')",
      })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('read-only')
    })
  })

  describe('schema context', () => {
    it('incluye schema de tablas referenciadas en respuesta de query', async () => {
      const result = await callTool(ctx.client, 'execute_query', {
        sql: 'SELECT * FROM users',
      })
      expect(result.text).toContain('--- Schema de tablas referenciadas ---')
      expect(result.text).toContain('users(')
      expect(result.text).toContain('name TEXT')
      expect(result.text).toContain('email TEXT')
    })

    it('incluye schema en respuesta de error', async () => {
      const result = await callTool(ctx.client, 'execute_query', {
        sql: 'SELECT nonexistent_column FROM users',
      })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('--- Schema de tablas referenciadas ---')
      expect(result.text).toContain('users(')
    })

    it('incluye schema en respuesta de mutation', async () => {
      const result = await callTool(ctx.client, 'execute_mutation', {
        sql: "INSERT INTO users (name, email) VALUES ('Test', 'test@test.com')",
      })
      expect(result.text).toContain('--- Schema de tablas referenciadas ---')
      expect(result.text).toContain('users(')
    })
  })

  describe('explain_query', () => {
    it('muestra plan de ejecucion', async () => {
      const result = await callTool(ctx.client, 'explain_query', {
        sql: 'SELECT * FROM users',
      })
      expect(result.isError).toBeFalsy()
    })
  })
})
