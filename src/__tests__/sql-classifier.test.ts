import { describe, it, expect } from 'vitest'
import { classifySql } from '../utils/sql-classifier.js'

describe('classifySql', () => {
  it('clasifica SELECT como read', () => {
    expect(classifySql('SELECT * FROM users')).toBe('read')
  })

  it('clasifica SELECT con subquery como read', () => {
    expect(classifySql('SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)')).toBe('read')
  })

  it('clasifica INSERT como write', () => {
    expect(classifySql('INSERT INTO users (name) VALUES ($1)')).toBe('write')
  })

  it('clasifica UPDATE como write', () => {
    expect(classifySql('UPDATE users SET name = $1 WHERE id = $2')).toBe('write')
  })

  it('clasifica DELETE como write', () => {
    expect(classifySql('DELETE FROM users WHERE id = 1')).toBe('write')
  })

  it('clasifica CREATE TABLE como ddl', () => {
    expect(classifySql('CREATE TABLE test (id INTEGER)')).toBe('ddl')
  })

  it('clasifica DROP TABLE como ddl', () => {
    expect(classifySql('DROP TABLE test')).toBe('ddl')
  })

  it('clasifica ALTER TABLE como ddl', () => {
    expect(classifySql('ALTER TABLE test ADD COLUMN name TEXT')).toBe('ddl')
  })

  it('ignora comentarios de linea', () => {
    expect(classifySql('-- comentario\nSELECT * FROM users')).toBe('read')
  })

  it('ignora comentarios de bloque', () => {
    expect(classifySql('/* comment */ SELECT * FROM users')).toBe('read')
  })

  it('clasifica SHOW como read', () => {
    expect(classifySql('SHOW TABLES')).toBe('read')
  })

  it('clasifica WITH (CTE) como read', () => {
    expect(classifySql('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe('read')
  })

  it('clasifica PRAGMA como read', () => {
    expect(classifySql('PRAGMA table_info("users")')).toBe('read')
  })

  it('clasifica TRUNCATE como ddl', () => {
    expect(classifySql('TRUNCATE TABLE users')).toBe('ddl')
  })

  it('default conservador a write', () => {
    expect(classifySql('CALL some_procedure()')).toBe('write')
  })

  it('maneja SQL vacio como write', () => {
    expect(classifySql('')).toBe('write')
  })
})
