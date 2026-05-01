import { memo, type CSSProperties } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { useTheme } from '@/app/use-theme';

// Curated language set: imported eagerly so streaming code blocks don't flash.
// Aliases mirror what models commonly emit.
const LANGUAGES: Record<
  string,
  Parameters<typeof SyntaxHighlighter.registerLanguage>[1]
> = {
  bash,
  sh: bash,
  shell: bash,
  zsh: bash,
  css,
  js: javascript,
  javascript,
  json,
  jsx,
  md: markdown,
  markdown,
  py: python,
  python,
  rs: rust,
  rust,
  sql,
  ts: typescript,
  typescript,
  tsx,
  yaml,
  yml: yaml,
};

const REGISTERED = new Set<string>();
function ensureLanguage(name: string): void {
  if (REGISTERED.has(name)) return;
  const grammar = LANGUAGES[name];
  if (!grammar) return;
  SyntaxHighlighter.registerLanguage(name, grammar);
  REGISTERED.add(name);
}

// Override the highlight theme's outer container styling so it blends with the
// chat bubble (no rounded corners on the outer pre — the bubble already has
// them).
const codeBlockStyle: CSSProperties = {
  margin: 0,
  padding: '0.625rem 0.75rem',
  borderRadius: '0.375rem',
  fontSize: '0.75rem',
  background: 'transparent',
};

interface MessageContentProps {
  content: string;
}

function MessageContentImpl({ content }: MessageContentProps): JSX.Element {
  const { resolvedTheme } = useTheme();
  const codeStyle = resolvedTheme === 'dark' ? oneDark : oneLight;

  const components: Components = {
    code({ className, children, ...rest }) {
      const match = /language-(\w+)/.exec(className ?? '');
      const text = String(children).replace(/\n$/, '');
      // ReactMarkdown distinguishes inline vs fenced via the surrounding
      // structure; we infer block code from the presence of a language class
      // *or* a multi-line body.
      const isBlock = !!match || text.includes('\n');
      if (!isBlock) {
        return (
          <code
            className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]"
            {...rest}
          >
            {children}
          </code>
        );
      }
      const lang = match?.[1];
      if (lang) ensureLanguage(lang);
      return (
        <SyntaxHighlighter
          language={lang ?? 'text'}
          style={codeStyle}
          customStyle={codeBlockStyle}
          PreTag="div"
          data-testid="chat-codeblock"
        >
          {text}
        </SyntaxHighlighter>
      );
    },
    pre({ children }) {
      // Wrap fenced code in a styled container so the language coloring lives
      // inside a clearly delimited box.
      return (
        <div className="my-2 overflow-hidden rounded-md border border-border bg-foreground/5 font-mono">
          {children}
        </div>
      );
    },
    a({ children, href, ...rest }) {
      return (
        <a
          {...rest}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          {children}
        </a>
      );
    },
    ul({ children, ...rest }) {
      return (
        <ul {...rest} className="my-2 list-disc space-y-1 pl-5">
          {children}
        </ul>
      );
    },
    ol({ children, ...rest }) {
      return (
        <ol {...rest} className="my-2 list-decimal space-y-1 pl-5">
          {children}
        </ol>
      );
    },
    p({ children, ...rest }) {
      return (
        <p {...rest} className="my-1 leading-relaxed first:mt-0 last:mb-0">
          {children}
        </p>
      );
    },
    table({ children, ...rest }) {
      return (
        <div className="my-2 overflow-x-auto">
          <table
            {...rest}
            className="w-full border-collapse text-xs [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-foreground/5 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left"
          >
            {children}
          </table>
        </div>
      );
    },
    blockquote({ children, ...rest }) {
      return (
        <blockquote
          {...rest}
          className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground"
        >
          {children}
        </blockquote>
      );
    },
    h1: ({ children }) => (
      <h1 className="mb-2 mt-3 text-base font-semibold">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-3 text-sm font-semibold">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1 mt-2 text-sm font-medium">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1 mt-2 text-sm font-medium">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="mb-1 mt-2 text-sm font-medium">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="mb-1 mt-2 text-sm font-medium">{children}</h6>
    ),
  };

  return (
    <div data-testid="chat-markdown" className="text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MessageContent = memo(MessageContentImpl);
