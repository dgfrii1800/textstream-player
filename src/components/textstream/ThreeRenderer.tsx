/* ── Three.js GPU-Accelerated Text Renderer (InstancedMesh) ────── */
/* Each glyph is a single plane instance with per-instance char + color */
/* Font atlas is baked into a single texture — no per-character materials */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react"
import * as THREE from "three"
import type { FrameData, TextCell } from "@/lib/text-stream-types"

/* ── Constants ─────────────────────────────────────────────────── */
const ATLAS_COLS = 16
const ATLAS_ROWS = 8
const CELL_SIZE = 64
const ATLAS_W = ATLAS_COLS * CELL_SIZE   // 1024
const ATLAS_H = ATLAS_ROWS * CELL_SIZE   // 512

// All characters supported by the atlas (positions are row-major)
const CHARSET =
  " ░▒▓█▀▄▌▐" +
  "@%#*+=-:." +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "abcdefghijklmnopqrstuvwxyz" +
  "0123456789" +
  "!\"#$%&'()*,-./:;<=>?[\\]^_`{|}~"

/** Lookup: character → atlas column, row */
const CHAR_MAP = new Map<string, number>()
for (let i = 0; i < CHARSET.length; i++) {
  CHAR_MAP.set(CHARSET[i], i)
}

/* ── Public API ────────────────────────────────────────────────── */
export interface ThreeRendererHandle {
  updateFrame: (frame: FrameData) => void
  resize: () => void
  setEffects: (effects: { crt: boolean; scanlines: boolean; glow: boolean; bloom: boolean; noise: boolean; filmGrain: boolean }) => void
  setTheme: (theme: string) => void
  getFps: () => number
}

interface ThreeRendererProps {
  className?: string
  gridWidth?: number
  gridHeight?: number
}

/* ── Build Atlas Texture ───────────────────────────────────────── */
function buildAtlasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = ATLAS_W
  canvas.height = ATLAS_H
  const ctx = canvas.getContext("2d")!
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H)

  const fontSize = Math.round(CELL_SIZE * 0.78)
  ctx.fillStyle = "#ffffff"
  ctx.font = `bold ${fontSize}px "SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", monospace`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"

  for (let i = 0; i < CHARSET.length; i++) {
    const col = i % ATLAS_COLS
    const row = Math.floor(i / ATLAS_COLS)
    const cx = col * CELL_SIZE + CELL_SIZE / 2
    const cy = row * CELL_SIZE + CELL_SIZE / 2
    ctx.fillText(CHARSET[i], cx, cy + 1)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  return tex
}

/* ── Shaders ───────────────────────────────────────────────────── */
const VERTEX_SHADER = `
  attribute float aCharIndex;
  varying vec2 vUv;
  varying vec3 vColor;
  uniform float uAtlasCols;
  uniform float uAtlasRows;

  void main() {
    float col = mod(aCharIndex, uAtlasCols);
    float row = floor(aCharIndex / uAtlasCols);
    vUv = vec2(
      uv.x / uAtlasCols + col / uAtlasCols,
      uv.y / uAtlasRows + (uAtlasRows - 1.0 - row) / uAtlasRows
    );
    vColor = instanceColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT_SHADER = `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    float alpha = texture2D(uAtlas, vUv).r;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }
`

/* ── Environment helper: 1 unit ≈ cell on screen ──────────────── */
function computeLayout(
  gw: number,
  gh: number,
  viewW: number,
  viewH: number,
) {
  const cellAspect = 0.5 // character cells are ~2× taller than wide
  const gridPxW = gw
  const gridPxH = gh * cellAspect
  const fitX = viewW * 0.9
  const fitY = viewH * 0.9
  const scale = Math.min(fitX / gridPxW, fitY / gridPxH)
  const cellW = scale
  const cellH = scale * cellAspect
  const totalW = gw * cellW
  const totalH = gh * cellH
  const startX = -totalW / 2 + cellW / 2
  const startY = totalH / 2 - cellH / 2
  return { cellW, cellH, startX, startY, totalW, totalH }
}

/* ── Themed background colours ─────────────────────────────────── */
const THEME_BG: Record<string, number> = {
  minimal: 0x0a0a0a,
  modern: 0x0a0a0a,
  terminal: 0x000000,
  matrix: 0x000000,
  retro_dos: 0x0000a8,
  cyberpunk: 0x0d0221,
  hacker: 0x001a00,
}

/* ── Component ─────────────────────────────────────────────────── */
export const ThreeRenderer = forwardRef<ThreeRendererHandle, ThreeRendererProps>(
  ({ className, gridWidth = 160, gridHeight = 90 }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const sceneRef = useRef<THREE.Scene | null>(null)
    const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const meshRef = useRef<THREE.InstancedMesh | null>(null)
    const charIdxAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null)
    const geometryRef = useRef<THREE.PlaneGeometry | null>(null)
    const materialRef = useRef<THREE.ShaderMaterial | null>(null)
    const frameIdRef = useRef(0)
    const layoutRef = useRef({ cellW: 1, cellH: 1, startX: 0, startY: 0 })
    const capRef = useRef(0)            // max instances allocated
    const dirtyRef = useRef(false)
    const fpsHistoryRef = useRef<number[]>([])
    const frameTimestampsRef = useRef<number[]>([])
    const currentThemeRef = useRef("minimal")

    // ── Init scene (once) ────────────────────────────────────────
    useEffect(() => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const w = rect.width || 800
      const h = rect.height || 600

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0a0a0a)
      sceneRef.current = scene

      const aspect = w / h
      const vs = 100
      const camera = new THREE.OrthographicCamera(
        -vs * aspect, vs * aspect, vs, -vs, 0.1, 1000,
      )
      camera.position.z = 10
      cameraRef.current = camera

      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      })
      renderer.setSize(w, h)
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
      container.appendChild(renderer.domElement)
      rendererRef.current = renderer

      // Create shared geometry (unit quad)
      const geo = new THREE.PlaneGeometry(1, 1)
      geometryRef.current = geo

      // Create atlas texture
      const atlasTex = buildAtlasTexture()

      // Shader material
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uAtlas: { value: atlasTex },
          uAtlasCols: { value: ATLAS_COLS },
          uAtlasRows: { value: ATLAS_ROWS },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthTest: false,
      })
      materialRef.current = mat

      // Dummy mesh with 1 instance (will be re-built on first frame)
      const mesh = new THREE.InstancedMesh(geo, mat, 1)
      mesh.count = 0
      meshRef.current = mesh
      scene.add(mesh)

      const animate = () => {
        frameIdRef.current = requestAnimationFrame(animate)

        // FPS tracking
        frameTimestampsRef.current.push(performance.now())
        if (frameTimestampsRef.current.length > 120) {
          frameTimestampsRef.current.shift()
        }

        if (dirtyRef.current && mesh.count > 0) {
          // instanceColor is set via setColorAt – mark dirty
          mesh.instanceMatrix.needsUpdate = true
          mesh.instanceColor!.needsUpdate = true
          if (charIdxAttrRef.current) {
            charIdxAttrRef.current.needsUpdate = true
          }
          dirtyRef.current = false
        }

        renderer.render(scene, camera)
      }
      animate()

      return () => {
        cancelAnimationFrame(frameIdRef.current)
        mat.dispose()
        atlasTex.dispose()
        geo.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    }, [])

    // ── Rebuild mesh when grid size changes ──────────────────────
    const ensureCapacity = useCallback((needed: number) => {
      const scene = sceneRef.current
      const geo = geometryRef.current
      const mat = materialRef.current
      const oldMesh = meshRef.current
      if (!scene || !geo || !mat) return

      if (oldMesh && oldMesh.count >= needed && capRef.current >= needed) {
        // Already big enough – just clear
        oldMesh.count = needed
        return
      }

      // Remove old
      if (oldMesh) scene.remove(oldMesh)

      const cap = Math.max(needed, 320 * 180) // 57,600 max
      capRef.current = cap

      const mesh = new THREE.InstancedMesh(geo, mat, cap)
      mesh.count = needed
      mesh.frustumCulled = false

      // Per-instance colour buffer
      const colors = new Float32Array(cap * 3)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)

      // Per-instance character index
      const charIdx = new Float32Array(cap)
      const attr = new THREE.InstancedBufferAttribute(charIdx, 1)
      mesh.geometry.setAttribute("aCharIndex", attr)
      charIdxAttrRef.current = attr

      const dummy = new THREE.Object3D()
      for (let i = 0; i < cap; i++) {
        dummy.position.set(0, 0, 0)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        mesh.setColorAt(i, new THREE.Color(0x000000))
        charIdx[i] = 0
      }
      attr.needsUpdate = true
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor.needsUpdate = true

      meshRef.current = mesh
      scene.add(mesh)
    }, [])

    // ── Update frame ─────────────────────────────────────────────
    const updateFrame = useCallback(
      (frame: FrameData) => {
        const mesh = meshRef.current
        const attr = charIdxAttrRef.current
        if (!mesh || !attr) return

        const cells = frame.cells || []
        const gw = frame.grid_width || gridWidth
        const gh = frame.grid_height || gridHeight
        const total = gw * gh
        if (total === 0) return

        ensureCapacity(total)
        mesh.count = total

        const renderer = rendererRef.current
        if (!renderer) return

        const w = renderer.domElement.width
        const h = renderer.domElement.height
        const viewW = (cameraRef.current!.right - cameraRef.current!.left)
        const viewH = (cameraRef.current!.top - cameraRef.current!.bottom)
        const layout = computeLayout(gw, gh, viewW, viewH)
        layoutRef.current = layout
        const { cellW, cellH, startX, startY } = layout

        const charArr = attr.array as Float32Array
        const colorArr = mesh.instanceColor!.array as Float32Array
        const dummy = new THREE.Object3D()
        const tmpColor = new THREE.Color()

        // Build lookup from cells
        const cellMap = new Map<string, TextCell>()
        for (const c of cells) {
          cellMap.set(`${c.x},${c.y}`, c)
        }

        let idx = 0
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const cell = cellMap.get(`${x},${y}`)
            const char = cell?.char || " "
            const hex = cell?.color || "#ffffff"

            const ci = CHAR_MAP.get(char) ?? 1 // fallback to '░'
            charArr[idx] = ci

            tmpColor.set(hex)
            colorArr[idx * 3] = tmpColor.r
            colorArr[idx * 3 + 1] = tmpColor.g
            colorArr[idx * 3 + 2] = tmpColor.b

            dummy.position.set(startX + x * cellW, startY - y * cellH, 0)
            dummy.scale.set(cellW * 1.04, cellH * 1.04, 1)
            dummy.updateMatrix()
            mesh.setMatrixAt(idx, dummy.matrix)

            idx++
          }
        }

        dirtyRef.current = true
      },
      [gridWidth, gridHeight, ensureCapacity],
    )

    // ── Resize ───────────────────────────────────────────────────
    const resize = useCallback(() => {
      const container = containerRef.current
      const renderer = rendererRef.current
      const camera = cameraRef.current
      if (!container || !renderer || !camera) return

      const rect = container.getBoundingClientRect()
      renderer.setSize(rect.width, rect.height)

      const aspect = rect.width / rect.height
      const vs = 100
      camera.left = -vs * aspect
      camera.right = vs * aspect
      camera.top = vs
      camera.bottom = -vs
      camera.updateProjectionMatrix()
    }, [])

    // ── Effects (CSS overlays handled by parent) ─────────────────
    const setEffects = useCallback(() => {}, [])

    // ── Theme ────────────────────────────────────────────────────
    const setTheme = useCallback((theme: string) => {
      currentThemeRef.current = theme
      const scene = sceneRef.current
      if (!scene) return
      scene.background = new THREE.Color(THEME_BG[theme] ?? 0x0a0a0a)
    }, [])

    // ── FPS tracking ─────────────────────────────────────────────
    const getFps = useCallback(() => {
      const stamps = frameTimestampsRef.current
      if (stamps.length < 10) return 0
      const recent = stamps.slice(-60)
      const elapsed = recent[recent.length - 1] - recent[0]
      return elapsed > 0 ? ((recent.length - 1) / elapsed * 1000) : 0
    }, [])

    useImperativeHandle(ref, () => ({
      updateFrame, resize, setEffects, setTheme, getFps,
    }), [updateFrame, resize, setEffects, setTheme, getFps])

    // Resize observer
    useEffect(() => {
      const onResize = () => resize()
      window.addEventListener("resize", onResize)
      return () => window.removeEventListener("resize", onResize)
    }, [resize])

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}
      />
    )
  },
)

ThreeRenderer.displayName = "ThreeRenderer"
