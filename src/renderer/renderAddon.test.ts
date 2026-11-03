import { describe, expect, it, vi } from 'vitest'
import { clearRenderAtlas, disposeRenderAddon, rebuildRenderModel, renderAtlasOf } from './renderAddon'

describe('disposeRenderAddon', () => {
  it("disposes a WebGL renderer's cursor-blink manager before the addon", () => {
    const order: string[] = []
    const addon = {
      _renderer: { _cursorBlinkStateManager: { dispose: () => order.push('blink') } },
      dispose: () => order.push('addon')
    }
    disposeRenderAddon(addon)
    expect(order).toEqual(['blink', 'addon'])
  })

  it('just disposes an addon without that renderer shape (Canvas)', () => {
    const addon = { dispose: vi.fn() }
    disposeRenderAddon(addon)
    expect(addon.dispose).toHaveBeenCalledOnce()
  })

  it('still disposes the addon if the blink manager throws', () => {
    const addon = {
      _renderer: {
        _cursorBlinkStateManager: {
          dispose: () => {
            throw new Error('x')
          }
        }
      },
      dispose: vi.fn()
    }
    disposeRenderAddon(addon)
    expect(addon.dispose).toHaveBeenCalledOnce()
  })
})

// Mimics xterm's TextureAtlas: clearTexture() bumps every page's version and
// resets its canvas, but (the upstream bug) leaves _glyphs/_usedPixels alone —
// unless the atlas is already empty, when it returns without touching anything.
function fakeAtlas(empty = false) {
  const pages = [0, 1].map(() => ({ version: 0, _glyphs: ['a', 'b'] as unknown[], _usedPixels: 50 }))
  const clearTexture = (): void => {
    if (empty) return
    for (const p of pages) p.version++
  }
  return { pages, clearTexture }
}

describe('clearRenderAtlas', () => {
  it("resets a WebGL atlas's glyph records along with the clear", () => {
    const atlas = fakeAtlas()
    const addon = { _renderer: { _charAtlas: atlas }, clearTextureAtlas: atlas.clearTexture, dispose: vi.fn() }
    clearRenderAtlas(addon)
    for (const p of atlas.pages) {
      expect(p._glyphs).toEqual([])
      expect(p._usedPixels).toBe(0)
    }
  })

  it('finds the shared atlas through a Canvas renderer’s layers', () => {
    const atlas = fakeAtlas()
    const addon = {
      _renderer: { _renderLayers: [{}, { _charAtlas: atlas }] },
      clearTextureAtlas: atlas.clearTexture,
      dispose: vi.fn()
    }
    clearRenderAtlas(addon)
    expect(atlas.pages[0]._glyphs).toEqual([])
  })

  it('leaves glyphs alone when xterm skipped the clear (they are still live)', () => {
    const atlas = fakeAtlas(true)
    const addon = { _renderer: { _charAtlas: atlas }, clearTextureAtlas: atlas.clearTexture, dispose: vi.fn() }
    clearRenderAtlas(addon)
    expect(atlas.pages[0]._glyphs).toEqual(['a', 'b'])
    expect(atlas.pages[0]._usedPixels).toBe(50)
  })

  it('still clears an addon whose internals it does not recognise', () => {
    const clearTextureAtlas = vi.fn()
    clearRenderAtlas({ clearTextureAtlas, dispose: vi.fn() })
    expect(clearTextureAtlas).toHaveBeenCalledOnce()
  })

  it('reports whether anything was cleared, so siblings are rebuilt only then', () => {
    const live = fakeAtlas()
    const liveAddon = { _renderer: { _charAtlas: live }, clearTextureAtlas: live.clearTexture, dispose: vi.fn() }
    expect(clearRenderAtlas(liveAddon)).toBe(true)
    const empty = fakeAtlas(true)
    const emptyAddon = { _renderer: { _charAtlas: empty }, clearTextureAtlas: empty.clearTexture, dispose: vi.fn() }
    expect(clearRenderAtlas(emptyAddon)).toBe(false)
    // Unknown internals: the clear was asked for, assume it happened.
    expect(clearRenderAtlas({ clearTextureAtlas: vi.fn(), dispose: vi.fn() })).toBe(true)
  })
})

describe('renderAtlasOf', () => {
  it('identifies the WebGL atlas, so panes sharing one can be told apart from the rest', () => {
    const atlas = fakeAtlas()
    const a = { _renderer: { _charAtlas: atlas }, dispose: vi.fn() }
    const b = { _renderer: { _charAtlas: atlas }, dispose: vi.fn() }
    const c = { _renderer: { _charAtlas: fakeAtlas() }, dispose: vi.fn() }
    expect(renderAtlasOf(a)).toBe(renderAtlasOf(b))
    expect(renderAtlasOf(a)).not.toBe(renderAtlasOf(c))
  })

  it('reports nothing for a Canvas renderer (it copies pixels, so a shared clear cannot mis-draw it)', () => {
    const canvas = { _renderer: { _renderLayers: [{ _charAtlas: fakeAtlas() }] }, dispose: vi.fn() }
    expect(renderAtlasOf(canvas)).toBeUndefined()
    expect(renderAtlasOf({ dispose: vi.fn() })).toBeUndefined()
  })
})

describe('rebuildRenderModel', () => {
  it("forgets a WebGL renderer's cells without touching the atlas", () => {
    const _clearModel = vi.fn()
    const clearTextureAtlas = vi.fn()
    const addon = { _renderer: { _clearModel }, clearTextureAtlas, dispose: vi.fn() }
    rebuildRenderModel(addon)
    expect(_clearModel).toHaveBeenCalledWith(true)
    expect(clearTextureAtlas).not.toHaveBeenCalled()
  })

  it('falls back to the public clear (a rebuild plus a harmless clear) without the hook', () => {
    const clearTextureAtlas = vi.fn()
    const addon = { _renderer: {}, clearTextureAtlas, dispose: vi.fn() }
    rebuildRenderModel(addon)
    expect(clearTextureAtlas).toHaveBeenCalledOnce()
  })
})
