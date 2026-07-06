import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { BrowserPane } from './components/BrowserPane'
import { ClaudeCockpit } from './components/ClaudeCockpit'
import { CodexCockpit } from './components/CodexCockpit'
import { SettingsPanel } from './components/SettingsPanel'
import type { MediaHandle } from './components/StremioPane'
import { StremioPane } from './components/StremioPane'
import { SitePane } from './components/SitePane'
import { useClaudeRun } from './useClaudeRun'
import { useCodexRun } from './useCodexRun'
import { useSettings } from './useSettings'
import { useTheme } from './useTheme'

/** 'claude' or the id of an entertainment tab (built-in or custom). */
type View = string

const YOUTUBE_URL = 'https://www.youtube.com/'

// Dev/test escape hatch. `npm run dev:test` sets VITE_UNLOCK_MEDIA=1, which
// makes the media tabs (Stremio/YouTube/Browser) reachable without a live
// Claude run — normally they're "earned" only while Claude is working. Off in
// any normal `npm run dev`/production build.
const UNLOCK_MEDIA = import.meta.env.VITE_UNLOCK_MEDIA === '1'

export function App(): JSX.Element {
  const [view, setView] = useState<View>('claude')
  // Remember which media tab the user was last on so hand-off returns them there.
  const [lastMediaView, setLastMediaView] = useState<string>('stremio')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { theme, toggle } = useTheme()
  const {
    settings,
    setWatchdogMs,
    setRunDefaults,
    setRemoteControl,
    setMediaTabs,
    setAdblock,
    setClaudeEnabled,
    setCodexEnabled
  } = useSettings()

  const enabledTabs = settings.mediaTabs.filter((tab) => tab.enabled)

  // Apply ad/tracker blocking to every media partition except Stremio (no ads
  // there, and filter rules must stay away from the local streaming server).
  useEffect(() => {
    const partitions = settings.mediaTabs
      .filter((tab) => tab.kind !== 'stremio')
      .map((tab) => (tab.kind === 'custom' ? `persist:custom-${tab.id}` : `persist:${tab.kind}`))
    void window.claude.setAdblock(settings.adblock, partitions)
  }, [settings.adblock, settings.mediaTabs])

  // Imperative handles of every mounted media pane, keyed by tab id. Callback
  // refs are cached so React doesn't re-invoke them on every render.
  const paneRefs = useRef(new Map<string, MediaHandle | null>())
  const refCallbacks = useRef(new Map<string, (handle: MediaHandle | null) => void>())
  const paneRef = (id: string): ((handle: MediaHandle | null) => void) => {
    let callback = refCallbacks.current.get(id)
    if (!callback) {
      callback = (handle) => {
        paneRefs.current.set(id, handle)
      }
      refCallbacks.current.set(id, callback)
    }
    return callback
  }

  // An agent needs the user: pause all media, exit any fullscreen, then show
  // THAT agent's cockpit. exitFullscreen must be awaited — the fullscreen
  // overlay covers the pane until the browser tears it down.
  const attentionTo = useCallback(async (target: 'claude' | 'codex') => {
    const panes = [...paneRefs.current.values()].filter(
      (handle): handle is MediaHandle => handle !== null
    )
    panes.forEach((pane) => pane.pause())
    try {
      await Promise.all(panes.map((pane) => pane.exitFullscreen()))
    } catch {
      // Don't let a fullscreen-exit failure block showing the cockpit.
    }
    setView(target)
  }, [])

  const handleAttention = useCallback(async () => attentionTo('claude'), [attentionTo])
  const handleCodexAttention = useCallback(() => {
    setCodexVisited(true) // ensure the pane is mounted before surfacing it
    void attentionTo('codex')
  }, [attentionTo])

  const run = useClaudeRun(handleAttention)
  const codexRun = useCodexRun(handleCodexAttention)

  // Codex mounts lazily: nothing (including its server process) exists until
  // the user first opens the tab; it stays mounted afterwards so the
  // conversation survives tab switches.
  const [codexVisited, setCodexVisited] = useState(false)

  // User sent a prompt or answered Claude — go back to whatever they were
  // watching (or the first enabled tab if that one was removed/disabled).
  const handleHandOff = useCallback(() => {
    const target = enabledTabs.some((tab) => tab.id === lastMediaView)
      ? lastMediaView
      : enabledTabs[0]?.id
    if (target) setView(target)
    // With every entertainment tab disabled there's nowhere to hand off to.
  }, [lastMediaView, enabledTabs])

  const showClaude = useCallback(() => setView('claude'), [])

  const showCodex = useCallback(() => {
    setCodexVisited(true)
    setView('codex')
  }, [])

  // Media tabs are "earned": accessible while either coding agent is working.
  // (UNLOCK_MEDIA bypasses this for local testing — see dev:test script.)
  const mediaAllowed =
    UNLOCK_MEDIA ||
    run.status === 'running' ||
    run.backgroundActive ||
    codexRun.status === 'running'

  const showMedia = useCallback(
    (tab: string) => {
      if (!mediaAllowed) return
      setView(tab)
      setLastMediaView(tab)
    },
    [mediaAllowed]
  )

  // The default coding tab respecting the settings toggles (Claude wins ties;
  // at least one is always enabled — settings enforce it).
  const fallbackCodingView = settings.claudeEnabled ? 'claude' : 'codex'

  // If the agents stop working while on a media tab — or the tab was disabled
  // or removed in settings — pull back to a cockpit.
  useEffect(() => {
    if (view === 'claude' || view === 'codex') return
    if (!mediaAllowed || !enabledTabs.some((tab) => tab.id === view)) {
      if (fallbackCodingView === 'codex') setCodexVisited(true)
      setView(fallbackCodingView)
    }
  }, [view, mediaAllowed, enabledTabs, fallbackCodingView])

  // If the coding tab currently in front gets disabled, jump to the other one.
  useEffect(() => {
    if (view === 'claude' && !settings.claudeEnabled) {
      setCodexVisited(true)
      setView('codex')
    } else if (view === 'codex' && !settings.codexEnabled) {
      setView('claude')
    }
  }, [view, settings.claudeEnabled, settings.codexEnabled])

  // Esc interrupts the running turn of whichever cockpit is in front.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (view === 'codex' && codexRun.status === 'running') codexRun.cancel()
      else if (run.status === 'running') run.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, codexRun, view])

  const needsAttention =
    view !== 'claude' &&
    (run.status === 'awaiting-input' || run.status === 'done' || run.status === 'error')

  const codexNeedsAttention =
    view !== 'codex' &&
    (codexRun.status === 'awaiting-input' ||
      codexRun.status === 'done' ||
      codexRun.status === 'error')

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">◇</span>
          <span className="topbar__name">WorkStream</span>
        </div>

        <div className="topbar__status">
          {settings.claudeEnabled && (
            <AgentStatus
              name="Claude"
              status={run.status}
              backgroundActive={run.backgroundActive}
            />
          )}
          {settings.codexEnabled && <AgentStatus name="Codex" status={codexRun.status} />}
        </div>

        <div className="topbar__right">
          {/* Coding tabs (Claude today; room for Codex etc.) — separate group
              from the entertainment tabs. */}
          <nav className="topbar__tabs topbar__tabs--coding">
            {settings.claudeEnabled && (
              <button
                type="button"
                className={'tab' + (view === 'claude' ? ' tab--active' : '')}
                onClick={showClaude}
              >
                Claude
                {needsAttention && <span className="tab__dot" />}
              </button>
            )}
            {settings.codexEnabled && (
              <button
                type="button"
                className={'tab' + (view === 'codex' ? ' tab--active' : '')}
                onClick={showCodex}
              >
                Codex
                {codexNeedsAttention && <span className="tab__dot" />}
              </button>
            )}
          </nav>
          {enabledTabs.length > 0 && (
            <nav className="topbar__tabs topbar__tabs--media">
              {enabledTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={'tab' + (view === tab.id ? ' tab--active' : '')}
                  onClick={() => showMedia(tab.id)}
                  disabled={!mediaAllowed}
                  title={mediaAllowed ? tab.label : 'Available while Claude is working'}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          )}
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Settings"
            aria-label="Open settings"
          >
            <GearIcon />
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggle}
            title={theme === 'dark' ? 'Switch to Daylight' : 'Switch to Lamplight'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>
      </header>

      <main className="stage">
        {/* All enabled panes stay mounted so playback/session state survive
            tab switches; disabling a tab in settings unmounts it. */}
        {enabledTabs.map((tab) => (
          <div
            key={tab.id}
            className={'pane pane--media' + (view === tab.id ? ' pane--front' : '')}
          >
            {tab.kind === 'stremio' && <StremioPane ref={paneRef(tab.id)} />}
            {tab.kind === 'youtube' && (
              <SitePane
                ref={paneRef(tab.id)}
                url={YOUTUBE_URL}
                partition="persist:youtube"
                adblock={settings.adblock}
              />
            )}
            {tab.kind === 'browser' && <BrowserPane ref={paneRef(tab.id)} />}
            {tab.kind === 'custom' && tab.url && (
              <SitePane
                ref={paneRef(tab.id)}
                url={tab.url}
                partition={`persist:custom-${tab.id}`}
                adblock={settings.adblock}
              />
            )}
          </div>
        ))}
        {codexVisited && settings.codexEnabled && (
          <div className={'pane pane--claude' + (view === 'codex' ? ' pane--front' : '')}>
            <CodexCockpit run={codexRun} onHandOff={handleHandOff} />
          </div>
        )}
        {settings.claudeEnabled && (
        <div className={'pane pane--claude' + (view === 'claude' ? ' pane--front' : '')}>
          <ClaudeCockpit
            run={run}
            onHandOff={handleHandOff}
            onAttention={() => void handleAttention()}
            watchdogMs={settings.watchdogMs}
            runDefaults={settings.runDefaults}
            remoteControl={settings.remoteControl}
          />
        </div>
        )}
        {settingsOpen && (
          <SettingsPanel
            watchdogMs={settings.watchdogMs}
            onWatchdogMsChange={setWatchdogMs}
            runDefaults={settings.runDefaults}
            onRunDefaultsChange={setRunDefaults}
            remoteControl={settings.remoteControl}
            onRemoteControlChange={setRemoteControl}
            mediaTabs={settings.mediaTabs}
            onMediaTabsChange={setMediaTabs}
            adblock={settings.adblock}
            onAdblockChange={setAdblock}
            claudeEnabled={settings.claudeEnabled}
            onClaudeEnabledChange={setClaudeEnabled}
            codexEnabled={settings.codexEnabled}
            onCodexEnabledChange={setCodexEnabled}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </main>
    </div>
  )
}

/** One agent's topbar status pill (shared by Claude and Codex). */
function AgentStatus({
  name,
  status,
  backgroundActive = false
}: {
  name: string
  status: 'idle' | 'running' | 'awaiting-input' | 'done' | 'error'
  backgroundActive?: boolean
}): JSX.Element | null {
  if (status === 'running') {
    return <span className="status status--running">● {name} working…</span>
  }
  if (status === 'awaiting-input') {
    return <span className="status status--attention">◆ {name} needs you</span>
  }
  if (backgroundActive) {
    return <span className="status status--running">● {name} task running…</span>
  }
  if (status === 'error') {
    return <span className="status status--error">⚠ {name} stopped</span>
  }
  if (status === 'done') {
    return <span className="status status--done">✓ {name} finished</span>
  }
  return null
}

function GearIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function SunIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
    </svg>
  )
}

function MoonIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  )
}
