import type { ClaudeBridge } from '../../shared/types'

declare global {
  interface Window {
    /** Bridge exposed by the preload script. */
    claude: ClaudeBridge
  }
}

export {}
