/* ── Three.js GPU-Accelerated Text Renderer ─────────────────────── */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react"
import * as THREE from "three"
import type { FrameData, TextCell } from "@/lib/text-stream-types"

export interface ThreeRendererHandle {
  updateFrame: (frame: FrameData) => void
  resize: () => void
  setEffects: (effects: { crt: boolean; scanlines: boolean; glow: boolean; bloom: boolean; noise: boolean; filmGrain: boolean }) => void
  setTheme: (theme: string) => void
}

interface ThreeRendererProps {
  className?: string
  gridWidth?: number
  gridHeight?: number
}

// Minimal ASCII-on-texture approach — we render each glyph as a sprite
// from a generated font texture atlas.
const CHARSET = " ░▒▓█▀▄▌▐█@%#*+=-:.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

function buildCharTexture(gl: THREE.WebGLRenderer, char: string, size: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = "#ffffff"
  ctx.font = `bold ${size * 0.85}px "SF Mono", "Fira Code", "Cascadia Code", monospace`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(char, size / 2, size / 2 + 1)
  return new THREE.CanvasTexture(canvas)
}

export const ThreeRenderer = forwardRef<ThreeRendererHandle, ThreeRendererProps>(
  ({ className, gridWidth = 160, gridHeight = 90 }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const sceneRef = useRef<THREE.Scene | null>(null)
    const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const spritesRef = useRef<Map<string, THREE.Sprite>>(new Map())
    const textureCacheRef = useRef<Map<string, THREE.CanvasTexture>>(new Map())
    const charSizeRef = useRef(16)
    const frameIdRef = useRef(0)
    const currentFrameRef = useRef<FrameData | null>(null)
    const effectsRef = useRef({ crt: false, scanlines: false, glow: false, bloom: false, noise: false, filmGrain: false })

    const getCharTexture = useCallback((char: string): THREE.CanvasTexture => {
      const existing = textureCacheRef.current.get(char)
      if (existing) return existing
      const tex = buildCharTexture(rendererRef.current!, char, charSizeRef.current)
      textureCacheRef.current.set(char, tex)
      return tex
    }, [])

    // Initialize scene
    useEffect(() => {
      if (!containerRef.current) return

      const container = containerRef.current
      const rect = container.getBoundingClientRect()
      const w = rect.width || 800
      const h = rect.height || 600

      // Scene
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0a0a0a)
      sceneRef.current = scene

      // Orthographic camera
      const aspect = w / h
      const viewSize = 100
      const camera = new THREE.OrthographicCamera(
        -viewSize * aspect,
        viewSize * aspect,
        viewSize,
        -viewSize,
        0.1,
        1000,
      )
      camera.position.z = 10
      cameraRef.current = camera

      // Renderer
      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      })
      renderer.setSize(w, h)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      container.appendChild(renderer.domElement)
      rendererRef.current = renderer

      // Animation loop
      const animate = () => {
        frameIdRef.current = requestAnimationFrame(animate)
        renderer.render(scene, camera)
      }
      animate()

      return () => {
        cancelAnimationFrame(frameIdRef.current)
        renderer.dispose()
        renderer.domElement.remove()
      }
    }, [])

    // Build sprites for a frame
    const buildSprites = useCallback(
      (cells: TextCell[], gridW: number, gridH: number) => {
        const scene = sceneRef.current
        const renderer = rendererRef.current
        if (!scene || !renderer) return

        // Clear and dispose old sprites
        spritesRef.current.forEach((sprite) => {
          scene.remove(sprite)
          if (sprite.material) {
            sprite.material.dispose()
          }
        })
        spritesRef.current.clear()

        if (!cells.length) return

        // Calculate aspect
        const aspect = gridW / gridH
        const viewSize = 100
        const camAspect = renderer.domElement.width / renderer.domElement.height
        const displayW = viewSize * camAspect
        const displayH = viewSize

        let fitW: number, fitH: number
        if (aspect > camAspect) {
          fitW = displayW * 0.9
          fitH = fitW / aspect
        } else {
          fitH = displayH * 0.9
          fitW = fitH * aspect
        }

        const cellW = fitW / gridW
        const cellH = fitH / gridH

        const startX = -fitW / 2 + cellW / 2
        const startY = fitH / 2 - cellH / 2

        // Cap sprites for performance
        const maxSprites = 40000
        const limitedCells = cells.slice(0, maxSprites)

        for (const cell of limitedCells) {
          const tex = getCharTexture(cell.char || " ")
          const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthTest: false,
            sizeAttenuation: false,
          })

          // Parse color
          const color = new THREE.Color(cell.color || "#ffffff")
          mat.color = color

          const sprite = new THREE.Sprite(mat)
          const x = startX + cell.x * cellW
          const y = startY - cell.y * cellH
          sprite.position.set(x, y, 0)

          // Scale sprite to cell size (with slight positive bias)
          const scaleX = cellW * 1.05
          const scaleY = cellH * 1.05
          sprite.scale.set(scaleX, scaleY, 1)

          scene.add(sprite)
          spritesRef.current.set(`${cell.x},${cell.y}`, sprite)
        }
      },
      [getCharTexture],
    )

    // Expose updateFrame to parent
    const updateFrame = useCallback(
      (frame: FrameData) => {
        currentFrameRef.current = frame
        const cells = frame.cells || []
        const gw = frame.grid_width || gridWidth
        const gh = frame.grid_height || gridHeight
        buildSprites(cells, gw, gh)
      },
      [buildSprites, gridWidth, gridHeight],
    )

    const resize = useCallback(() => {
      const container = containerRef.current
      const renderer = rendererRef.current
      const camera = cameraRef.current
      if (!container || !renderer || !camera) return

      const rect = container.getBoundingClientRect()
      const w = rect.width || 800
      const h = rect.height || 600

      renderer.setSize(w, h)
      const aspect = w / h
      const viewSize = 100

      camera.left = -viewSize * aspect
      camera.right = viewSize * aspect
      camera.top = viewSize
      camera.bottom = -viewSize
      camera.updateProjectionMatrix()

      // Re-render current frame if exists
      if (currentFrameRef.current) {
        buildSprites(
          currentFrameRef.current.cells || [],
          currentFrameRef.current.grid_width || gridWidth,
          currentFrameRef.current.grid_height || gridHeight,
        )
      }
    }, [buildSprites, gridWidth, gridHeight])

    const setEffects = useCallback(
      (effects: { crt: boolean; scanlines: boolean; glow: boolean; bloom: boolean; noise: boolean; filmGrain: boolean }) => {
        effectsRef.current = effects
        const scene = sceneRef.current
        if (!scene) return

        // Simple effect: adjust background color slightly
        if (effects.crt || effects.scanlines) {
          // effects handled via CSS overlay
        }
      },
      [],
    )

    const setTheme = useCallback((theme: string) => {
      const scene = sceneRef.current
      if (!scene) return
      switch (theme) {
        case "minimal":
          scene.background = new THREE.Color(0x0a0a0a)
          break
        case "terminal":
          scene.background = new THREE.Color(0x000000)
          break
        case "matrix":
          scene.background = new THREE.Color(0x000000)
          break
        case "retro_dos":
          scene.background = new THREE.Color(0x0000a8)
          break
        case "cyberpunk":
          scene.background = new THREE.Color(0x0d0221)
          break
        case "hacker":
          scene.background = new THREE.Color(0x001a00)
          break
        default:
          scene.background = new THREE.Color(0x0a0a0a)
      }
    }, [])

    useImperativeHandle(ref, () => ({ updateFrame, resize, setEffects, setTheme }), [
      updateFrame,
      resize,
      setEffects,
      setTheme,
    ])

    // Handle resize
    useEffect(() => {
      const onResize = () => resize()
      window.addEventListener("resize", onResize)
      return () => window.removeEventListener("resize", onResize)
    }, [resize])

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
        }}
      />
    )
  },
)

ThreeRenderer.displayName = "ThreeRenderer"
