import type { JSX } from 'react'
import type { UseUpdate } from '../useUpdate'

/** Slim top-of-app banner offering to rebuild WorkStream to the latest commit. */
export function UpdateBanner({ update }: { update: UseUpdate }): JSX.Element | null {
  if (update.phase === 'idle' || update.phase === 'dismissed') return null

  const count = update.status?.behindBy ?? 0
  const commits = count === 1 ? '1 new update' : `${count} new updates`

  return (
    <div className="update-banner">
      {update.phase === 'updating' ? (
        <span className="update-banner__text">
          <span className="update-banner__spinner" /> Updating WorkStream — it&rsquo;ll reopen when
          done…
        </span>
      ) : update.phase === 'error' ? (
        <>
          <span className="update-banner__text update-banner__text--error">
            Update failed: {update.error}
          </span>
          <button type="button" className="update-banner__btn" onClick={() => void update.update()}>
            Retry
          </button>
          <button type="button" className="update-banner__btn" onClick={update.dismiss}>
            Dismiss
          </button>
        </>
      ) : (
        <>
          <span className="update-banner__text">
            <strong>WorkStream update available</strong>
            <span className="update-banner__detail">
              {commits}
              {update.status?.latestMessage ? ` · ${update.status.latestMessage}` : ''}
            </span>
          </span>
          <button type="button" className="update-banner__btn" onClick={update.dismiss}>
            Later
          </button>
          <button
            type="button"
            className="update-banner__btn update-banner__btn--primary"
            onClick={() => void update.update()}
          >
            Update
          </button>
        </>
      )}
    </div>
  )
}
