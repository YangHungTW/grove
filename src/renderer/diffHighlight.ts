/** Per-line syntax highlighting for the Changes/diff view. highlight.js is
 * synchronous and self-escaping, so it slots into the existing hand-escaped diff
 * renderer without re-introducing an injection vector: `highlightDiffLine` is the
 * ONLY producer of the HTML fed to `dangerouslySetInnerHTML`, and it always
 * escapes (hljs escapes; the fallback escapes manually). */
import hljs from 'highlight.js'

/** Escape the five HTML-significant characters. Used for the no-language fallback
 * so the output is exactly what React children would have rendered. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** File extension → highlight.js language id. Only returns ids hljs registers in
 * its common bundle; anything unknown returns undefined (→ plain escaped text). */
const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  json: 'json',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  scala: 'scala',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  vue: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  dockerfile: 'dockerfile',
  lua: 'lua',
  pl: 'perl'
}

/** Map a file path to a highlight.js language id (or undefined when unknown). */
export function extToLang(path: string): string | undefined {
  const base = path.split('/').pop() ?? path
  // Extensionless well-known names (Dockerfile, Makefile-ish) fall back to the
  // lowercased basename; otherwise use the last dotted segment.
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot + 1) : base
  const lang = EXT_LANG[ext.toLowerCase()]
  return lang
}

/**
 * Highlight a single diff line's text, returning HTML-escaped markup safe to
 * inject. With a known language hljs tokenises (and escapes) the text; with an
 * unknown/undefined language or an unregistered id, the raw text is HTML-escaped
 * and returned verbatim. Never throws.
 */
export function highlightDiffLine(text: string, lang: string | undefined): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
    } catch {
      return escapeHtml(text)
    }
  }
  return escapeHtml(text)
}
