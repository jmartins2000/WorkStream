/**
 * Ambient types for the Vite-exposed `import.meta.env`. Only `VITE_`-prefixed
 * vars are exposed to the renderer (see electron.vite.config renderer target).
 */
interface ImportMetaEnv {
  /**
   * Dev/test escape hatch: '1' unlocks the media tabs without a live Claude run.
   * Set by the `dev:test` npm script; never set in production builds.
   */
  readonly VITE_UNLOCK_MEDIA?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Vite turns image imports into URLs. */
declare module '*.png' {
  const url: string
  export default url
}
