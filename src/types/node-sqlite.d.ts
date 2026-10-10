/**
 * Minimal ambient typings for Node's built-in `node:sqlite` module.
 *
 * `node:sqlite` (DatabaseSync) shipped experimentally in Node 22.5+ and is
 * what backs the Protection Monitoring Session store (see
 * src/lib/protection/db.ts) — it needs zero new npm dependencies, which is
 * why it was chosen over better-sqlite3/Prisma/etc. for this hackathon
 * project (see db.ts's own doc comment for the full tradeoff).
 *
 * The installed `@types/node` (20.x) predates this module, so TypeScript
 * has no built-in declarations for it yet. This file declares ONLY the
 * small slice of the real API actually used here — not a full re-typing of
 * `node:sqlite` — and can be deleted once `@types/node` ships its own.
 */
declare module "node:sqlite" {
  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    run(...params: unknown[]): StatementResultingChanges;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
