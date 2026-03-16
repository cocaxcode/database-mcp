import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../server.js'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export interface TestContext {
  client: Client
  storageDir: string
  projectDir: string
  cleanup: () => Promise<void>
}

export async function createTestClient(): Promise<TestContext> {
  const storageDir = await mkdtemp(join(tmpdir(), 'dbmcp-storage-'))
  const projectDir = await mkdtemp(join(tmpdir(), 'dbmcp-project-'))

  const server = createServer(storageDir, projectDir)
  const client = new Client({ name: 'test-client', version: '1.0.0' })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ])

  return {
    client,
    storageDir,
    projectDir,
    cleanup: async () => {
      await client.close()
      await server.close()
    },
  }
}

export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError?: boolean }> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return {
    text: content[0]?.text ?? '',
    isError: result.isError as boolean | undefined,
  }
}
