import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { ensureProjectStorage, resetProjectStorageCache } from '../utils/project-storage.js'

let projectDir: string
let storageDir: string

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'dbmcp-proj-'))
  storageDir = await mkdtemp(join(tmpdir(), 'dbmcp-store-'))
  resetProjectStorageCache()
})

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true })
  await rm(storageDir, { recursive: true, force: true })
})

const exists = async (p: string) => access(p).then(() => true, () => false)

describe('gitignore perezoso', () => {
  it('no crea .gitignore ni .database-mcp/ al arrancar el server', async () => {
    createServer(storageDir, projectDir)
    await new Promise((r) => setTimeout(r, 50))

    expect(await exists(join(projectDir, '.gitignore'))).toBe(false)
    expect(await exists(join(projectDir, '.database-mcp'))).toBe(false)
  })

  it('no modifica un .gitignore existente al arrancar el server', async () => {
    const original = 'node_modules/\ndist/\n'
    await writeFile(join(projectDir, '.gitignore'), original, 'utf-8')

    createServer(storageDir, projectDir)
    await new Promise((r) => setTimeout(r, 50))

    expect(await readFile(join(projectDir, '.gitignore'), 'utf-8')).toBe(original)
  })

  it('anade el patron cuando se crea .database-mcp/ por primera vez', async () => {
    await ensureProjectStorage(projectDir)

    expect(await exists(join(projectDir, '.database-mcp'))).toBe(true)
    const content = await readFile(join(projectDir, '.gitignore'), 'utf-8')
    expect(content).toContain('.database-mcp/')
  })

  it('crea la subcarpeta indicada y respeta el contenido previo del .gitignore', async () => {
    await writeFile(join(projectDir, '.gitignore'), 'node_modules/', 'utf-8')

    await ensureProjectStorage(projectDir, 'dumps')

    expect(await exists(join(projectDir, '.database-mcp', 'dumps'))).toBe(true)
    const content = await readFile(join(projectDir, '.gitignore'), 'utf-8')
    expect(content).toBe('node_modules/\n.database-mcp/\n')
  })

  it('no duplica el patron en llamadas sucesivas', async () => {
    await ensureProjectStorage(projectDir)
    resetProjectStorageCache()
    await ensureProjectStorage(projectDir, 'rollbacks')

    const content = await readFile(join(projectDir, '.gitignore'), 'utf-8')
    expect(content.split('\n').filter((l) => l.trim() === '.database-mcp/')).toHaveLength(1)
  })
})
