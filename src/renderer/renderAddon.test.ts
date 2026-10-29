import { describe, expect, it, vi } from 'vitest'
import { clearRenderAtlas, disposeRenderAddon } from './renderAddon'

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
})
