import type { SydeAPI } from './index'

declare global {
  interface Window {
    syde: SydeAPI
  }
}

export {}
