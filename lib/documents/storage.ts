/**
 * Document storage provider (D2, T9.D1 — landed early with C3.6): FS
 * provider now, object storage later. Bytes live behind this seam; the
 * registry row carries only the storageKey.
 */
import fs from 'fs/promises'
import path from 'path'

const ROOT = process.env.DOCUMENTS_PATH ?? './storage/documents'

export interface DocumentStorage {
  put(key: string, bytes: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
}

export const fsStorage: DocumentStorage = {
  async put(key, bytes) {
    const p = path.join(ROOT, key)
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, bytes)
  },
  async get(key) {
    return fs.readFile(path.join(ROOT, key))
  },
}
