import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

async function main() {
  const args = process.argv.slice(2)

  // Parsear argumentos CLI
  let dsn: string | undefined
  let transport = 'stdio'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dsn' && args[i + 1]) {
      dsn = args[++i]
    } else if (args[i] === '--transport' && args[i + 1]) {
      transport = args[++i]
    }
  }

  const server = createServer()

  // Si se pasa --dsn, crear conexion "default" automaticamente
  if (dsn) {
    const { Storage } = await import('./lib/storage.js')
    const storage = new Storage()
    const type = detectTypeFromDsn(dsn)

    try {
      const now = new Date().toISOString()
      await storage.createConnection({
        name: 'default',
        type,
        mode: 'read-write',
        dsn,
        createdAt: now,
        updatedAt: now,
      })
    } catch {
      // Ya existe, ignorar
    }

    try {
      await storage.setActiveConnection('default')
    } catch {
      // Ya activa, ignorar
    }

    console.error(`database-mcp: conexion 'default' creada desde DSN (${type})`)
  }

  if (transport === 'stdio') {
    const stdioTransport = new StdioServerTransport()
    await server.connect(stdioTransport)
    console.error('database-mcp server running on stdio')
  } else {
    console.error(`Transporte '${transport}' no soportado. Usa --transport stdio`)
    process.exit(1)
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.error('database-mcp: shutting down...')
    try {
      await server.close()
    } catch {
      // Ignorar errores de cierre
    }
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function detectTypeFromDsn(dsn: string): 'postgresql' | 'mysql' | 'sqlite' {
  if (dsn.startsWith('postgresql://') || dsn.startsWith('postgres://')) return 'postgresql'
  if (dsn.startsWith('mysql://')) return 'mysql'
  if (dsn.startsWith('sqlite://') || dsn.endsWith('.db') || dsn.endsWith('.sqlite') || dsn === ':memory:') return 'sqlite'
  return 'postgresql'
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
