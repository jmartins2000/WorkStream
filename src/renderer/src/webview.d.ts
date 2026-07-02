import type { DetailedHTMLProps, HTMLAttributes } from 'react'

/**
 * Minimal typing for Electron's <webview> tag plus the runtime methods we call
 * on the element (executeJavaScript, reload). Electron exposes far more, but
 * this is the subset the app relies on.
 */
export interface WebviewElement extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>
  reload(): void
  getURL(): string
  // Browser navigation (used by BrowserPane)
  loadURL(url: string): Promise<void>
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
}

type WebviewProps = DetailedHTMLProps<HTMLAttributes<WebviewElement>, WebviewElement> & {
  src?: string
  partition?: string
  allowpopups?: boolean
  useragent?: string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewProps
    }
  }
}
