/* ── TextStream Player – Orchestrates all streaming components ──── */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTextStream } from "@/hooks/use-text-stream"
import { ThreeRenderer, type ThreeRendererHandle } from "./ThreeRenderer"
import { Controls } from "./Controls"
import { StatsPanel } from "./StatsPanel"
import { Button } from "@/components/ui/button"
import { Upload, Film, AlertCircle } from "lucide-react"

export function TextStreamPlayer() {
  const rendererRef = useRef<ThreeRendererHandle>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
        await uploadVideo(file)
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
  const latency = stats ? `${(stats.frame_time_ms + stats.convert_time_ms + stats.encode_time_ms).toFixed(0)}ms` : "—"

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
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-tight">TextStream</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">
            {videoLoaded && metadata
              ? `${metadata.width}×${metadata.height} · ${metadata.fps}fps`
              : "No video loaded"}
          </span>
        </div>
        <div className="flex items-center gap-2">
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
          <ThreeRenderer
            ref={rendererRef}
            className="absolute inset-0"
            gridWidth={settings.resolution}
            gridHeight={Math.round(settings.resolution * 0.56)}
          />
        </div>

        {/* Right sidebar: controls */}
        <div className="w-56 border-l flex flex-col overflow-y-auto bg-background/50">
          <Controls
            settings={settings}
            onUpdateSettings={updateSettings}
            onPlay={() => { play(); setIsPlaying(true) }}
            onPause={() => { pause(); setIsPlaying(false) }}
            isPlaying={isPlaying}
            fpsSliderValue={settings.fps}
            onFpsSliderChange={(v) => updateSettings({ fps: v })}
          />
          <div className="border-t mt-auto">
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
