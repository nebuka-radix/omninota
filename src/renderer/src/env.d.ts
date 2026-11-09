import type { GtdApi } from '../../shared/contracts/ipc'

declare global {
  interface Window {
    readonly gtd: GtdApi
  }
}

export {}
