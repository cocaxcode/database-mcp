import { describe, it, expect } from 'vitest'
import { assertSafeIdentifier, quoteIdentifier, escapeValue } from '../utils/sql-escape.js'
import { assertSafePath } from '../utils/path-guard.js'
import { classifySql } from '../utils/sql-classifier.js'
import { extractTableAndWhere } from '../utils/sql-parser-light.js'
import { join } from 'node:path'

describe('sql-escape', () => {
  describe('assertSafeIdentifier', () => {
    it('acepta identificadores validos', () => {
      expect(() => assertSafeIdentifier('users')).not.toThrow()
      expect(() => assertSafeIdentifier('user_roles')).not.toThrow()
      expect(() => assertSafeIdentifier('_private')).not.toThrow()
      expect(() => assertSafeIdentifier('T1')).not.toThrow()
    })

    it('rechaza identificadores con SQL injection', () => {
      expect(() => assertSafeIdentifier("users'; DROP TABLE--")).toThrow()
      expect(() => assertSafeIdentifier('user"name')).toThrow()
      expect(() => assertSafeIdentifier('table name')).toThrow()
      expect(() => assertSafeIdentifier('../etc')).toThrow()
      expect(() => assertSafeIdentifier('')).toThrow()
      expect(() => assertSafeIdentifier('1invalid')).toThrow()
    })
  })

  describe('quoteIdentifier', () => {
    it('usa comillas dobles para PostgreSQL', () => {
      expect(quoteIdentifier('users', 'postgresql')).toBe('"users"')
    })

    it('usa backticks para MySQL', () => {
      expect(quoteIdentifier('users', 'mysql')).toBe('`users`')
    })

    it('usa comillas dobles para SQLite', () => {
      expect(quoteIdentifier('users', 'sqlite')).toBe('"users"')
    })

    it('rechaza identificadores inseguros', () => {
      expect(() => quoteIdentifier("'; DROP TABLE", 'postgresql')).toThrow()
    })
  })

  describe('escapeValue', () => {
    it('escapa null/undefined', () => {
      expect(escapeValue(null)).toBe('NULL')
      expect(escapeValue(undefined)).toBe('NULL')
    })

    it('escapa numeros', () => {
      expect(escapeValue(42)).toBe('42')
      expect(escapeValue(3.14)).toBe('3.14')
    })

    it('escapa booleans', () => {
      expect(escapeValue(true)).toBe('TRUE')
      expect(escapeValue(false)).toBe('FALSE')
    })

    it('escapa strings con comillas simples', () => {
      expect(escapeValue("O'Reilly")).toBe("'O''Reilly'")
    })

    it('escapa strings con backslashes', () => {
      expect(escapeValue('path\\to\\file')).toBe("'path\\\\to\\\\file'")
    })

    it('escapa objetos JSON', () => {
      expect(escapeValue({ key: "val'ue" })).toBe("'{\"key\":\"val''ue\"}'")
    })

    it('escapa arrays JSON', () => {
      expect(escapeValue([1, 2, 3])).toBe("'[1,2,3]'")
    })

    it('escapa fechas', () => {
      const d = new Date('2024-01-01T00:00:00.000Z')
      expect(escapeValue(d)).toBe("'2024-01-01T00:00:00.000Z'")
    })
  })
})

describe('path-guard', () => {
  it('acepta rutas seguras', () => {
    const base = join(process.cwd(), 'test-dumps')
    const result = assertSafePath(base, 'backup.sql')
    expect(result).toBe(join(base, 'backup.sql'))
  })

  it('rechaza path traversal con ..', () => {
    expect(() => assertSafePath('/tmp/dumps', '../../etc/passwd')).toThrow()
  })

  it('rechaza path traversal con rutas absolutas en Windows-style', () => {
    expect(() => assertSafePath('/tmp/dumps', '../secret.sql')).toThrow()
  })
})

describe('sql-classifier — CTE bypass prevention', () => {
  it('clasifica WITH...SELECT como read', () => {
    expect(classifySql('WITH cte AS (SELECT * FROM users) SELECT * FROM cte')).toBe('read')
  })

  it('clasifica WITH...UPDATE como write', () => {
    expect(classifySql('WITH updated AS (UPDATE users SET name = \'x\' RETURNING *) SELECT * FROM updated')).toBe('write')
  })

  it('clasifica WITH...DELETE como write', () => {
    expect(classifySql('WITH deleted AS (DELETE FROM users RETURNING *) SELECT * FROM deleted')).toBe('write')
  })

  it('clasifica WITH...INSERT como write', () => {
    expect(classifySql('WITH data AS (SELECT 1) INSERT INTO users SELECT * FROM data')).toBe('write')
  })
})

describe('sql-parser-light — schema.table support', () => {
  it('extrae tabla de INSERT INTO schema.table', () => {
    const result = extractTableAndWhere('INSERT INTO public.users (name) VALUES (\'test\')')
    expect(result).toEqual({ table: 'users' })
  })

  it('extrae tabla de UPDATE con comillas', () => {
    const result = extractTableAndWhere('UPDATE "users" SET name = \'x\' WHERE id = 1')
    expect(result).toEqual({ table: 'users', where: 'id = 1' })
  })

  it('extrae tabla de DELETE con backticks', () => {
    const result = extractTableAndWhere('DELETE FROM `orders` WHERE id = 5')
    expect(result).toEqual({ table: 'orders', where: 'id = 5' })
  })

  it('extrae tabla de UPDATE schema.table', () => {
    const result = extractTableAndWhere('UPDATE public.users SET name = \'x\' WHERE id = 1')
    expect(result).toEqual({ table: 'users', where: 'id = 1' })
  })
})
