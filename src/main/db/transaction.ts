import type { AppDatabase } from './client'

// 参照先の確認と更新を1つのトランザクションで行うための関数（フェーズ5.2）。
// better-sqlite3 は同期APIのため、fn の中のRepository呼び出し（同じ接続）はすべてこのトランザクションに含まれる。
// BEGIN IMMEDIATE で開始し、確認から更新までの間に他の書き込みが入らないようにする。例外時はROLLBACKする。
export type RunInTransaction = <T>(fn: () => T) => T

export function createTransactionRunner(db: AppDatabase): RunInTransaction {
  return <T>(fn: () => T): T => db.$client.transaction(fn).immediate()
}
