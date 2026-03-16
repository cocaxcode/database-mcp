import { describe, it, expect, beforeEach } from 'vitest'
import { Storage } from '../lib/storage.js'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Connection } from '../lib/types.js'

describe('Storage', () => {
  let storage: Storage
  let baseDir: string

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'dbmcp-test-'))
    storage = new Storage(baseDir)
  })

  const makeConn = (name: string, overrides?: Partial<Connection>): Connection => ({
    name,
    type: 'sqlite',
    mode: 'read-write',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  })

  describe('createConnection', () => {
    it('crea una conexion', async () => {
      await storage.createConnection(makeConn('test'))
      const conn = await storage.getConnection('test')
      expect(conn?.name).toBe('test')
    })

    it('lanza error si ya existe', async () => {
      await storage.createConnection(makeConn('test'))
      await expect(storage.createConnection(makeConn('test'))).rejects.toThrow('ya existe')
    })
  })

  describe('listConnections', () => {
    it('lista conexiones vacias', async () => {
      const items = await storage.listConnections()
      expect(items).toHaveLength(0)
    })

    it('lista conexiones con flag activo', async () => {
      await storage.createConnection(makeConn('a'))
      await storage.createConnection(makeConn('b'))
      await storage.setActiveConnection('a')

      const items = await storage.listConnections()
      expect(items).toHaveLength(2)
      expect(items.find((i) => i.name === 'a')?.active).toBe(true)
      expect(items.find((i) => i.name === 'b')?.active).toBe(false)
    })
  })

  describe('updateConnection', () => {
    it('actualiza un campo', async () => {
      await storage.createConnection(makeConn('test'))
      await storage.updateConnection('test', { host: 'localhost' })
      const conn = await storage.getConnection('test')
      expect(conn?.host).toBe('localhost')
    })

    it('lanza error si no existe', async () => {
      await expect(storage.updateConnection('nope', {})).rejects.toThrow('no encontrada')
    })
  })

  describe('deleteConnection', () => {
    it('elimina una conexion', async () => {
      await storage.createConnection(makeConn('test'))
      await storage.deleteConnection('test')
      const conn = await storage.getConnection('test')
      expect(conn).toBeNull()
    })

    it('limpia active-conn al eliminar la activa', async () => {
      await storage.createConnection(makeConn('test'))
      await storage.setActiveConnection('test')
      await storage.deleteConnection('test')
      const active = await storage.getActiveConnection()
      expect(active).toBeNull()
    })
  })

  describe('renameConnection', () => {
    it('renombra una conexion', async () => {
      await storage.createConnection(makeConn('old'))
      await storage.renameConnection('old', 'new')
      expect(await storage.getConnection('old')).toBeNull()
      expect((await storage.getConnection('new'))?.name).toBe('new')
    })

    it('actualiza active-conn al renombrar', async () => {
      await storage.createConnection(makeConn('old'))
      await storage.setActiveConnection('old')
      await storage.renameConnection('old', 'new')
      const active = await storage.getActiveConnection()
      expect(active).toBe('new')
    })

    it('lanza error si nuevo nombre ya existe', async () => {
      await storage.createConnection(makeConn('a'))
      await storage.createConnection(makeConn('b'))
      await expect(storage.renameConnection('a', 'b')).rejects.toThrow('Ya existe')
    })
  })

  describe('duplicateConnection', () => {
    it('duplica una conexion', async () => {
      await storage.createConnection(makeConn('original', { host: 'localhost', port: 5432 }))
      await storage.duplicateConnection('original', 'copy')

      const copy = await storage.getConnection('copy')
      expect(copy?.name).toBe('copy')
      expect(copy?.host).toBe('localhost')
      expect(copy?.port).toBe(5432)
    })

    it('lanza error si destino ya existe', async () => {
      await storage.createConnection(makeConn('a'))
      await storage.createConnection(makeConn('b'))
      await expect(storage.duplicateConnection('a', 'b')).rejects.toThrow('ya existe')
    })
  })

  describe('project scoping', () => {
    it('devuelve conexion de proyecto si existe', async () => {
      await storage.createConnection(makeConn('global'))
      await storage.createConnection(makeConn('local'))
      await storage.setActiveConnection('global')
      await storage.setActiveConnection('local', '/project/a')

      const active = await storage.getActiveConnection('/project/a')
      expect(active).toBe('local')
    })

    it('fallback a global si no hay project-specific', async () => {
      await storage.createConnection(makeConn('global'))
      await storage.setActiveConnection('global')

      const active = await storage.getActiveConnection('/project/b')
      expect(active).toBe('global')
    })

    it('clearProjectConnection elimina asociacion', async () => {
      await storage.createConnection(makeConn('local'))
      await storage.setActiveConnection('local', '/project/a')

      const removed = await storage.clearProjectConnection('/project/a')
      expect(removed).toBe(true)
    })

    it('listProjectConnections lista mappings', async () => {
      await storage.createConnection(makeConn('a'))
      await storage.createConnection(makeConn('b'))
      await storage.setActiveConnection('a', '/project/x')
      await storage.setActiveConnection('b', '/project/y')

      const list = await storage.listProjectConnections()
      expect(Object.keys(list)).toHaveLength(2)
    })
  })
})
