/* ── TextStream Type Definitions ─────────────────────────────────── */

/** A single cell in the text grid */
export interface TextCell {
  x: number
  y: number
  char: string
  color: string
  bg_color?: string
}

/** Complete frame data from the server */
export interface FrameData {
  frame: number
  width: number
  height: number
  mode?: string
  grid_width?: number
  grid_height?: number
  is_keyframe?: boolean
  cells: TextCell[]
  removed?: Array<{ x: number; y: number }>
  stats?: FrameStats
  type?: string
}

/** Performance statistics attached to each frame */
export interface FrameStats {
  frame_time_ms: number
  convert_time_ms: number
  encode_time_ms: number
  cells_count: number
  changed_count: number
  compression_ratio: number
  frame_rate: number
}

/** Video metadata from the backend */
export interface VideoMetadata {
  width: number
  height: number
  fps: number
  duration: number
  total_frames: number
  codec: string
  size: number
  format: string
}

/** WebSocket control messages */
export type WsClientMessage =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; frame: number }
  | { type: "settings"; [key: string]: unknown }
  | { type: "frame_ack"; frame: number }
  | { type: "ping" }
  | { type: "get_status" }

export type WsServerMessage =
  | { type: "connected"; client_id: string; video_loaded: boolean; metadata: VideoMetadata | Record<string, unknown> }
  | { type: "frame"; frame: number; cells: TextCell[]; stats?: FrameStats }
  | { type: "status"; status: string; frame?: number }
  | { type: "settings_updated"; settings: Record<string, unknown> }
  | { type: "pong" }
  | { type: "status_info"; playing: boolean; paused: boolean; current_frame: number; target_fps: number }

/** Rendering modes */
export type RenderingMode = "ascii" | "unicode" | "braille" | "ansi"

/** Color modes */
export type ColorMode = "full_rgb" | "ansi_256" | "grayscale" | "monochrome"

/** Visual theme preset */
export type ThemePreset = "modern" | "retro_dos" | "cyberpunk" | "matrix" | "terminal" | "hacker" | "minimal"

/** Player settings */
export interface PlayerSettings {
  fps: number
  mode: RenderingMode
  resolution: number
  brightness: number
  contrast: number
  gamma: number
  density: number
  theme: ThemePreset
  effects: {
    crt: boolean
    scanlines: boolean
    glow: boolean
    bloom: boolean
    noise: boolean
    filmGrain: boolean
  }
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  fps: 24,
  mode: "unicode",
  resolution: 160,
  brightness: 1.0,
  contrast: 1.0,
  gamma: 1.0,
  density: 1.0,
  theme: "minimal",
  effects: {
    crt: false,
    scanlines: false,
    glow: false,
    bloom: false,
    noise: false,
    filmGrain: false,
  },
}
