/* ── TextStream Player – Orchestrates all streaming components ──── */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTextStream } from "@/hooks/use-text-stream"
import { ThreeRenderer, type ThreeRendererHandle } from "./ThreeRenderer"
import { Controls } from "./Controls"
import { StatsPanel } from "./StatsPanel"
import { Button } from "@/components/ui/button"
import { Upload, Film, AlertCircle, Volume2, VolumeX } from "lucide-react"

/* ── Adaptive Quality Levels ────────────────────────────────────── */
interface QualityLevel {
  resolution: number
  label: string
}

const QUALITY_LEVELS: QualityLevel[] = [
  { resolution: 320, label: "Ultra" },
  { resolution: 240, label: "High" },
  { resolution: 160, label: "Medium" },
  { resolution: 120, label: "Low" },
  { resolution: 80, label: "Potato" },
  { resolution: 48, label: "Extreme" },
]

/* ── Audio Manager ──────────────────────────────────────────────── */
class AudioManager {
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private buffer: AudioBuffer | null = null
  private startTime = 0
  private pausedAt = 0
  private _isPlaying = false
  private gainNode: GainNode | null = null

  async load(url: string): Promise<void> {
    this.stop()
    const res = await fetch(url)
    const arrayBuf = await res.arrayBuffer()
    this.ctx = new AudioContext()
    this.buffer = await this.ctx.decodeAudioData(arrayBuf)
    this.gainNode = this.ctx.createGain()
    this.gainNode.gain.value = 1.0
    this.gainNode.connect(this.ctx.destination)
  }

  play(offsetSec = 0) {
    if (!this.ctx || !this.buffer || !this.gainNode) return
    this.stop()
    this.source = this.ctx.createBufferSource()
    this.source.buffer = this.buffer
    this.source.connect(this.gainNode)
    this.source.start(0, offsetSec)
    this.startTime = this.ctx.currentTime - offsetSec
    this.pausedAt = 0
    this._isPlaying = true
  }

  pause() {
    if (!this.ctx || !this._isPlaying) return
    this.pausedAt = this.currentTime
    this.stop()
    this._isPlaying = false
  }

  stop() {
    if (this.source) {
      try { this.source.stop() } catch { /* ignore */ }
      this.source.disconnect()
      this.source = null
    }
    this._isPlaying = false
  }

  seek(offsetSec: number) {
    if (this._isPlaying) {
      this.play(offsetSec)
    } else {
      this.pausedAt = offsetSec
    }
  }

  get currentTime(): number {
    if (!this.ctx || !this._isPlaying) return this.pausedAt
    return this.ctx.currentTime - this.startTime
  }

  get isPlaying(): boolean { return this._isPlaying }
  get duration(): number { return this.buffer?.duration ?? 0 }

  setVolume(v: number) {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(1, v))
  }

  destroy() {
    this.stop()
    this.ctx?.close()
    this.ctx = null
    this.buffer = null
  }

  get hasAudio(): boolean { return this.buffer !== null }
}

/* ── Component ──────────────────────────────────────────────────── */
export function TextStreamPlayer() {
  const rendererRef = useRef<ThreeRendererHandle>(null)
  const audioRef = useRef(new AudioManager())
  const [isPlaying, setIsPlaying] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [volume, setVolume] = useState(0.7)
  const [muted, setMuted] = useState(false)
  const [currentQuality, setCurrentQuality] = useState(2) // index into QUALITY_LEVELS
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [videoId, setVideoId] = useState<string | null>(null)
  const fpsMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const qualityChangePendingRef = useRef(false)

  const {
    connected,
    videoLoaded,
    metadata,
    latestFrame,
    stats,
    settings,
    error,
    play,
    pause,
    seek,
    updateSettings,
    uploadVideo,
  } = useTextStream()

  // Update Three.js when new frames arrive
  useEffect(() => {
    if (latestFrame && rendererRef.current) {
      rendererRef.current.updateFrame(latestFrame)
    }
  }, [latestFrame])

  // Sync settings with renderer
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setTheme(settings.theme)
      rendererRef.current.setEffects(settings.effects)
    }
  }, [settings.theme, settings.effects])

  // Adaptive quality monitoring
  useEffect(() => {
    fpsMonitorRef.current = setInterval(() => {
      if (!rendererRef.current || qualityChangePendingRef.current) return
      const fps = rendererRef.current.getFps()
      if (fps === 0) return

      const qIdx = currentQuality
      const ql = QUALITY_LEVELS[qIdx]

      // If below threshold, drop resolution
      if (fps < 20 && qIdx < QUALITY_LEVELS.length - 1) {
        qualityChangePendingRef.current = true
        const newIdx = qIdx + 1
        setCurrentQuality(newIdx)
        updateSettings({ resolution: QUALITY_LEVELS[newIdx].resolution })
        setTimeout(() => { qualityChangePendingRef.current = false }, 2000)
      }
      // If well above threshold for a while, increase resolution
      else if (fps > 50 && qIdx > 0) {
        qualityChangePendingRef.current = true
        const newIdx = qIdx - 1
        setCurrentQuality(newIdx)
        updateSettings({ resolution: QUALITY_LEVELS[newIdx].resolution })
        setTimeout(() => { qualityChangePendingRef.current = false }, 3000)
      }
    }, 2000)

    return () => { if (fpsMonitorRef.current) clearInterval(fpsMonitorRef.current) }
  }, [currentQuality, updateSettings])

  // Audio sync when playing/pausing
  useEffect(() => {
    const audio = audioRef.current
    if (isPlaying && audio.hasAudio) {
      audio.play(audio.currentTime) // resume from where we paused
    } else if (!isPlaying) {
      audio.pause()
    }
  }, [isPlaying])

  // Load audio when metadata is available
  useEffect(() => {
    if (videoId && metadata?.duration) {
      const audioUrl = `http://localhost:8765/api/audio/${videoId}`
      audioRef.current.load(audioUrl).catch(() => {
        // No audio track - that's OK
      })
    }
  }, [videoId, metadata?.duration])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => { audioRef.current.destroy() }
  }, [])

  // Sync volume
  useEffect(() => {
    audioRef.current.setVolume(muted ? 0 : volume)
  }, [volume, muted])

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      pause()
    } else {
      play()
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying, play, pause])

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setUploading(true)
      try {
        const result = await uploadVideo(file)
        setVideoId(result.video_id)
        // Auto-play after upload
        setTimeout(() => {
          play()
          setIsPlaying(true)
        }, 500)
      } catch (err) {
        console.error("Upload error:", err)
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    },
    [uploadVideo, play],
  )

  // Compute stats UI values
  const compressionRatio = stats?.compression_ratio ?? 0
  const charactersRendered = stats?.cells_count ?? 0
  const changedCells = stats?.changed_count ?? 0
  const bandwidth =
    latestFrame && stats
      ? `${((stats.changed_count * 50) / 1024).toFixed(1)} KB/s`
      : "—"
  const latency = stats
    ? `${(stats.frame_time_ms + stats.convert_time_ms + stats.encode_time_ms).toFixed(0)}ms`
    : "—"

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
        <p className="text-sm text-muted-foreground">Connecting to stream server...</p>
        <p className="text-xs text-muted-foreground/60">
          Start the backend with:{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">
            cd backend &amp;&amp; venv/bin/python main.py
          </code>
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-tight">TextStream</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">
            {videoLoaded && metadata
              ? `${metadata.width}×${metadata.height} · ${metadata.fps}fps`
              : "No video loaded"}
          </span>
          {videoLoaded && (
            <>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[10px] text-emerald-500/70">
                {QUALITY_LEVELS[currentQuality].label}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Volume */}
          {audioRef.current.hasAudio && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setMuted(!muted)}
              >
                {muted ? (
                  <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </Button>
            </div>
          )}

          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              connected ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
          <span className="text-[10px] text-muted-foreground">
            {connected ? "Connected" : "Disconnected"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="h-3 w-3" />
            {uploading ? "Uploading..." : "Upload"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mkv,.avi,.mov,.webm,.gif"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border-b border-destructive/20">
          <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
          <span className="text-xs text-destructive/80">{error}</span>
        </div>
      )}

      {/* Main area: renderer + sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Three.js viewport */}
        <div className="flex-1 relative bg-black/40">
          {!videoLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <Film className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground/50">Upload a video to begin</p>
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                Choose file
              </Button>
            </div>
          )}
          {/* CRT/scanline overlays via CSS */}
          {settings.effects.crt && (
            <div className="absolute inset-0 pointer-events-none z-20"
              style={{
                background:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
              }}
            />
          )}
          {settings.effects.scanlines && (
            <div className="absolute inset-0 pointer-events-none z-20"
              style={{
                background:
                  "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.08) 1px, rgba(0,0,0,0.08) 3px)",
              }}
            />
          )}
          <ThreeRenderer
            ref={rendererRef}
            className="absolute inset-0"
            gridWidth={settings.resolution}
            gridHeight={Math.round(settings.resolution * 0.56)}
          />
        </div>

        {/* Right sidebar: controls */}
        <div className="w-56 border-l border-white/[0.04] flex flex-col overflow-y-auto bg-background/50">
          <Controls
            settings={settings}
            onUpdateSettings={updateSettings}
            onPlay={() => { play(); setIsPlaying(true) }}
            onPause={() => { pause(); setIsPlaying(false) }}
            isPlaying={isPlaying}
            fpsSliderValue={settings.fps}
            onFpsSliderChange={(v) => updateSettings({ fps: v })}
          />
          <div className="border-t border-white/[0.04] mt-auto">
            <StatsPanel
              stats={stats}
              compressionRatio={compressionRatio}
              charactersRendered={charactersRendered}
              changedCells={changedCells}
              bandwidth={bandwidth}
              latency={latency}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
