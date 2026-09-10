/// <reference types="vite/client" />

import type { StockApi } from '../../shared/types'

declare global {
  interface Window {
    stockApi: StockApi
  }
}

export {}
