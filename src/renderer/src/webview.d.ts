/**
 * Minimal typing for Electron's <webview> tag plus the runtime methods we call
 * on the element (executeJavaScript, reload). Electron exposes far more, but
 * this is the subset the app relies on.
 *
 * JSX typing for the tag itself comes from @types/react's built-in
 * `webview` intrinsic (WebViewHTMLAttributes). Note its `allowpopups` is
 * typed as boolean but react-dom does NOT know the attribute — passing `true`
 * hits the unknown-attribute path, which warns and renders NO attribute
 * (silently disabling window.open in the guest). Pass the string 'true'
 * (cast) instead; see the panes.
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
