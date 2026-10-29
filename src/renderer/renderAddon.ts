/** A pane's renderer addon (WebGL or Canvas), as Grove holds it. */
export interface RenderAddon {
  dispose(): void
  clearTextureAtlas?: () => void
}

interface AtlasPage {
  version: number
  _glyphs?: unknown[]
  _usedPixels?: number
}
interface RendererInternals {
  _cursorBlinkStateManager?: { dispose?(): void }
  /** WebGL renderer's atlas. */
  _charAtlas?: { pages?: AtlasPage[] }
  /** Canvas renderer's layers — they all share one atlas. */
  _renderLayers?: { _charAtlas?: { pages?: AtlasPage[] } }[]
}
function rendererOf(addon: RenderAddon): RendererInternals | undefined {
  return (addon as { _renderer?: RendererInternals })._renderer
}

/**
 * Drop the addon's glyph atlas — without growing it.
 *
 * xterm's AtlasPage.clear() (5.5, and still 6.0) resets the page's canvas and
 * packing cursor but not its `_glyphs` list or `_usedPixels`, and clearTexture()
 * drops the glyph cache that would otherwise reuse them. So every clear
 * re-rasterizes each visible glyph and APPENDS it again; the list never
 * shrinks. Grove clears on every reveal and after every burst of agent output,
 * and the atlas is shared by every pane with the same font, so in a long session
 * it held hundreds of thousands of dead glyph records. Finish the reset upstream
 * forgot — only on pages that were actually cleared (clearTexture() is a no-op
 * on an empty atlas, and then the glyphs it holds are still live).
 */
export function clearRenderAtlas(addon: RenderAddon): void {
  const r = rendererOf(addon)
  const pages = r?._charAtlas?.pages ?? r?._renderLayers?.find((l) => l._charAtlas)?._charAtlas?.pages
  const before = pages?.map((p) => p.version)
  addon.clearTextureAtlas?.()
  pages?.forEach((p, i) => {
    if (p.version === before?.[i] || !Array.isArray(p._glyphs)) return
    p._glyphs.length = 0
    p._usedPixels = 0
  })
}

/**
 * Dispose a renderer addon without leaking its renderer.
 *
 * @xterm/addon-webgl (0.18, and still 0.19) never registers WebglRenderer's
 * `_cursorBlinkStateManager` for disposal — unlike the canvas addon, which does.
 * With cursorBlink on, disposing the addon therefore leaves the blink interval
 * running forever, and that timer's closure pins the entire dead renderer: its
 * WebGL context, canvases and glyph atlas. Grove swaps renderers on every tab
 * and worktree switch (WebGL on screen, Canvas when hidden — see <Pane>), so
 * each switch leaked one renderer (~90 KB, a GL context and a live 600ms timer)
 * and the app got measurably heavier the longer it was used. Dispose the blink
 * manager ourselves first; on a Canvas addon the lookup finds nothing.
 */
export function disposeRenderAddon(addon: RenderAddon): void {
  try {
    rendererOf(addon)?._cursorBlinkStateManager?.dispose?.()
  } catch {
    /* already gone */
  }
  addon.dispose()
}
