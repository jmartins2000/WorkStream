import { type JSX, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  children: string
}

/**
 * Open links in the system browser rather than navigating the renderer. The
 * main process window-open handler routes window.open() to shell.openExternal.
 */
function ExternalLink({ href, children }: { href?: string; children?: ReactNode }): JSX.Element {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault()
        if (href) window.open(href, '_blank')
      }}
    >
      {children}
    </a>
  )
}

/** Render assistant/user text as GitHub-flavored markdown. */
export function Markdown({ children }: MarkdownProps): JSX.Element {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ExternalLink }}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
