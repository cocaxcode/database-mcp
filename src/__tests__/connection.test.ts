import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, callTool, type TestContext } from './helpers.js'

describe('Connection tools', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestClient()
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  it('conn_create crea una conexion SQLite', async () => {
    const result = await callTool(ctx.client, 'conn_create', {
      name: 'test-sqlite',
      type: 'sqlite',
      mode: 'read-write',
      group: 'test',
    })
    expect(result.text).toContain("'test-sqlite' creada")
  })

  it('conn_list muestra conexiones', async () => {
    await callTool(ctx.client, 'conn_create', { name: 'a', type: 'sqlite', group: 'test' })
    await callTool(ctx.client, 'conn_create', { name: 'b', type: 'sqlite', group: 'test' })

    const result = await callTool(ctx.client, 'conn_list')
    const list = JSON.parse(result.text)
    expect(list).toHaveLength(2)
  })

  it('conn_get muestra conexion con password enmascarado', async () => {
    await callTool(ctx.client, 'conn_create', {
      name: 'pg',
      type: 'postgresql',
      host: 'localhost',
      password: 'secret',
      group: 'test',
    })

    const result = await callTool(ctx.client, 'conn_get', { name: 'pg' })
    const conn = JSON.parse(result.text)
    expect(conn.password).toBe('***')
  })

  it('conn_set actualiza un campo', async () => {
    await callTool(ctx.client, 'conn_create', { name: 'test', type: 'sqlite', group: 'test' })
    const result = await callTool(ctx.client, 'conn_set', { name: 'test', key: 'mode', value: 'read-write' })
    expect(result.text).toContain('actualizado')
  })

  it('conn_switch cambia conexion activa', async () => {
    await callTool(ctx.client, 'conn_create', { name: 'test', type: 'sqlite', group: 'test' })
    const result = await callTool(ctx.client, 'conn_switch', { name: 'test' })
    expect(result.text).toContain("'test'")

    const list = await callTool(ctx.client, 'conn_list')
    const items = JSON.parse(list.text)
    expect(items[0].active).toBe(true)
  })

  it('conn_rename renombra conexion', async () => {
    await callTool(ctx.client, 'conn_create', { name: 'old', type: 'sqlite', group: 'test' })
    const result = await callTool(ctx.client, 'conn_rename', { name: 'old', new_name: 'new' })
    expect(result.text).toContain("renombrada a 'new'")
  })

  it('conn_delete sin confirm muestra advertencia', async () => {
    await callTool(ctx.client, 'conn_create', { name: 'test', type: 'sqlite', group: 'test' })
    const result = await callTool(ctx.client, 'conn_delete', { name: 'test' })
    expect(result.text).toContain('Estas seguro')
  })

  it('conn_delete con confirm elimina', async () => {
    await callTool(ctx.client, 'conn_create', { name: 'test', type: 'sqlite', group: 'test' })
    const result = await callTool(ctx.client, 'conn_delete', { name: 'test', confirm: true })
    expect(result.text).toContain("'test' eliminada")
  })

  it('conn_duplicate duplica conexion', async () => {
    await callTool(ctx.client, 'conn_create', { name: 'original', type: 'sqlite', group: 'test' })
    const result = await callTool(ctx.client, 'conn_duplicate', { name: 'original', new_name: 'copy' })
    expect(result.text).toContain("duplicada como 'copy'")
  })

  it('conn_test prueba conexion SQLite :memory:', async () => {
    await callTool(ctx.client, 'conn_create', { name: 'mem', type: 'sqlite', mode: 'read-write', group: 'test' })
    const result = await callTool(ctx.client, 'conn_test', { name: 'mem' })
    expect(result.text).toContain('OK')
  })

  it('conn_project_list y conn_project_clear', async () => {
    await callTool(ctx.client, 'conn_create', { name: 'test', type: 'sqlite', group: 'test' })
    await callTool(ctx.client, 'conn_switch', { name: 'test', project: '/my/project' })

    const list = await callTool(ctx.client, 'conn_project_list')
    expect(list.text).toContain('/my/project')

    const clear = await callTool(ctx.client, 'conn_project_clear', { project: '/my/project' })
    expect(clear.text).toContain('eliminada')
  })
})
