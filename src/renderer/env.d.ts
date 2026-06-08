/// <reference types="vite/client" />
import type { RendererApi } from '../main/ipc'

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}
