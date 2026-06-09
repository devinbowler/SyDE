import Database from 'better-sqlite3'
import path from 'path'
import { app, safeStorage } from 'electron'
import type { Mode, ScopeLevel, StoredMessage, StoredSession } from '@shared/types'

let db: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (db) return db
  const dbPath = path.join(app.getPath('userData'), 'syde.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      file_path TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      scope_level TEXT,
      mode TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  return db
}

function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function createSession(filePath: string | null): StoredSession {
  const stmt = getDb().prepare(
    'INSERT INTO sessions (created_at, file_path) VALUES (?, ?)'
  )
  const created = Date.now()
  const info = stmt.run(created, filePath)
  return {
    id: Number(info.lastInsertRowid),
    created_at: created,
    file_path: filePath
  }
}

export function listSessions(limit = 50): StoredSession[] {
  const stmt = getDb().prepare(
    'SELECT id, created_at, file_path FROM sessions ORDER BY created_at DESC LIMIT ?'
  )
  return stmt.all(limit) as StoredSession[]
}

export function getMessages(sessionId: number): StoredMessage[] {
  const stmt = getDb().prepare(
    `SELECT id, session_id, role, content, scope_level, mode, timestamp
     FROM messages WHERE session_id = ? ORDER BY id ASC`
  )
  return stmt.all(sessionId) as StoredMessage[]
}

export function appendMessage(args: {
  sessionId: number
  role: 'user' | 'assistant'
  content: string
  scopeLevel: ScopeLevel | null
  mode: Mode | null
}): StoredMessage {
  const stmt = getDb().prepare(
    `INSERT INTO messages (session_id, role, content, scope_level, mode, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const ts = Date.now()
  const info = stmt.run(
    args.sessionId,
    args.role,
    args.content,
    args.scopeLevel,
    args.mode,
    ts
  )
  return {
    id: Number(info.lastInsertRowid),
    session_id: args.sessionId,
    role: args.role,
    content: args.content,
    scope_level: args.scopeLevel,
    mode: args.mode,
    timestamp: ts
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

// ── Preferences (string-keyed) ─────────────────────────────────────────────

const ENC_PREFIX = 'enc:v1:'

export function setPreference(key: string, value: string | null): void {
  const d = getDb()
  if (value === null || value === '') {
    d.prepare('DELETE FROM preferences WHERE key = ?').run(key)
    return
  }
  d.prepare(
    'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function getPreference(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM preferences WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

// Secret values are encrypted at rest with the OS keychain (DPAPI on Windows,
// Keychain on macOS, libsecret on Linux when available). If safeStorage is not
// usable (e.g., Linux without a keychain), we fall back to plain text — still
// inside the app's userData directory and not committed to source control.
export function setSecret(key: string, value: string | null): void {
  if (value === null || value === '') {
    setPreference(key, null)
    return
  }
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(value)
    setPreference(key, ENC_PREFIX + buf.toString('base64'))
  } else {
    setPreference(key, value)
  }
}

export function getSecret(key: string): string | null {
  const stored = getPreference(key)
  if (stored === null) return null
  if (stored.startsWith(ENC_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      // Encrypted blob exists but we can't decrypt — treat as missing.
      return null
    }
    try {
      const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      return null
    }
  }
  return stored
}

export function hasSecret(key: string): boolean {
  return getPreference(key) !== null
}
