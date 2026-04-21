import { mkdir, readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { QueryResult } from '../lib/types.js'

const MAX_IN_MEMORY = 20
const DEFAULT_TTL_MS = 60 * 60 * 1000 // 1h

export interface CachedQuery {
  call_id: string
  saved_at: number
  sql: string
  connection: string
  result: QueryResult
}

/**
 * Ring buffer de results SQL + persistencia a disco (TTL 1h).
 * Permite recuperar el result completo tras una compresión mediante call_id,
 * sin re-ejecutar el SQL (importante para queries caras o mutations).
 */
export class QueryCache {
  private buffer: CachedQuery[] = []
  private dir: string
  private ttlMs: number

  constructor(baseDir: string, ttlMs: number = DEFAULT_TTL_MS) {
    this.dir = join(baseDir, 'last-queries')
    this.ttlMs = ttlMs
  }

  async save(
    callId: string,
    sql: string,
    connection: string,
    result: QueryResult,
  ): Promise<void> {
    const entry: CachedQuery = {
      call_id: callId,
      saved_at: Date.now(),
      sql,
      connection,
      result,
    }

    this.buffer.push(entry)
    if (this.buffer.length > MAX_IN_MEMORY) {
      this.buffer.shift()
    }

    try {
      await mkdir(this.dir, { recursive: true })
      await writeFile(join(this.dir, `${callId}.json`), JSON.stringify(entry), 'utf-8')
      void this.cleanupExpired()
    } catch {
      // best-effort, memory-first
    }
  }

  async get(callId?: string): Promise<CachedQuery | null> {
    if (!callId) {
      if (this.buffer.length === 0) return this.getLatestFromDisk()
      return this.buffer[this.buffer.length - 1]
    }

    const fromMem = this.buffer.find((e) => e.call_id === callId)
    if (fromMem) return fromMem

    try {
      const raw = await readFile(join(this.dir, `${callId}.json`), 'utf-8')
      return JSON.parse(raw) as CachedQuery
    } catch {
      return null
    }
  }

  recentCount(windowMs: number = 5000): number {
    const now = Date.now()
    return this.buffer.filter((e) => now - e.saved_at <= windowMs).length
  }

  private async getLatestFromDisk(): Promise<CachedQuery | null> {
    try {
      const files = await readdir(this.dir)
      let latest: CachedQuery | null = null
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const raw = await readFile(join(this.dir, f), 'utf-8')
          const entry = JSON.parse(raw) as CachedQuery
          if (!latest || entry.saved_at > latest.saved_at) latest = entry
        } catch {
          // ignore corrupt file
        }
      }
      return latest
    } catch {
      return null
    }
  }

  private async cleanupExpired(): Promise<void> {
    try {
      const files = await readdir(this.dir)
      const now = Date.now()
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const s = await stat(join(this.dir, f))
          if (now - s.mtimeMs > this.ttlMs) {
            await unlink(join(this.dir, f))
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // dir not yet exists
    }
  }
}
