import type { DatabaseSync } from 'node:sqlite'
import type { CategoryRow } from '@shared/types'

interface CatRow {
  id: number
  name: string
  folder: string
  extensions: string
}

function toRow(r: CatRow): CategoryRow {
  let exts: string[] = []
  try {
    exts = JSON.parse(r.extensions) as string[]
  } catch {
    /* keep empty */
  }
  return { id: r.id, name: r.name, folder: r.folder, extensions: exts }
}

export class CategoriesRepo {
  constructor(private db: DatabaseSync) {}

  list(): CategoryRow[] {
    return (this.db.prepare('SELECT * FROM categories ORDER BY id').all() as unknown as CatRow[]).map(toRow)
  }

  get(id: number): CategoryRow | null {
    const r = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CatRow | undefined
    return r ? toRow(r) : null
  }

  byName(name: string): CategoryRow | null {
    const r = this.db.prepare('SELECT * FROM categories WHERE name = ?').get(name) as CatRow | undefined
    return r ? toRow(r) : null
  }

  create(name: string, folder: string, extensions: string[]): CategoryRow {
    const res = this.db
      .prepare('INSERT INTO categories (name, folder, extensions) VALUES (?, ?, ?)')
      .run(name, folder, JSON.stringify(extensions))
    return this.get(Number(res.lastInsertRowid))!
  }

  update(id: number, patch: Partial<Pick<CategoryRow, 'name' | 'folder' | 'extensions'>>): void {
    const cur = this.get(id)
    if (!cur) return
    this.db
      .prepare('UPDATE categories SET name = ?, folder = ?, extensions = ? WHERE id = ?')
      .run(
        patch.name ?? cur.name,
        patch.folder ?? cur.folder,
        JSON.stringify(patch.extensions ?? cur.extensions),
        id
      )
  }

  remove(id: number): void {
    // Re-point downloads at "Other" before deleting (FK is enforced).
    const other = this.byName('Other')
    if (other && id !== other.id) {
      this.db.prepare('UPDATE downloads SET category_id = ? WHERE category_id = ?').run(other.id, id)
    }
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  }

  /** Map a category name (from the magic/mime classifier) to its row id. */
  idForName(name: string, fallback = 'Other'): number {
    return this.byName(name)?.id ?? this.byName(fallback)?.id ?? 1
  }
}
