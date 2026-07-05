import { useRef, useState, type JSX, type ReactNode } from 'react'
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

/** A fenced code block with a hover copy button. */
function CodeBlock({ children }: { children?: ReactNode }): JSX.Element {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    const text = preRef.current?.textContent ?? ''
    if (!text) return
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="code-block">
      <button
        type="button"
        className="code-block__copy"
        onClick={copy}
        title="Copy code"
        aria-label="Copy code"
      >
        {copied ? '✓ Copied' : '⧉ Copy'}
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  )
}

/** Render assistant/user text as GitHub-flavored markdown. */
export function Markdown({ children }: MarkdownProps): JSX.Element {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ExternalLink, pre: CodeBlock }}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
