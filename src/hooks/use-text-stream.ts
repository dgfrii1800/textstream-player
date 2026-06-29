/* ── WebSocket Streaming Hook ────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from "react"
import type {
  FrameData,
  FrameStats,
  PlayerSettings,
  RenderingMode,
  VideoMetadata,
  WsClientMessage,
} from "@/lib/text-stream-types"
import { DEFAULT_SETTINGS } from "@/lib/text-stream-types"

interface UseTextStreamReturn {
  connected: boolean
  videoLoaded: boolean
  metadata: VideoMetadata | null
  latestFrame: FrameData | null
  stats: FrameStats | null
  settings: PlayerSettings
  error: string | null
  play: () => void
  pause: () => void
  seek: (frame: number) => void
  updateSettings: (partial: Partial<PlayerSettings>) => void
  uploadVideo: (file: File) => Promise<{ video_id: string; metadata: VideoMetadata }>
  connect: () => void
  disconnect: () => void
}

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8766/ws/stream"
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8766"

export function useTextStream(): UseTextStreamReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [videoLoaded, setVideoLoaded] = useState(false)
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [latestFrame, setLatestFrame] = useState<FrameData | null>(null)
  const [stats, setStats] = useState<FrameStats | null>(null)
  const [settings, setSettings] = useState<PlayerSettings>(DEFAULT_SETTINGS)
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        setError(null)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)

          switch (msg.type) {
            case "connected":
              setVideoLoaded(msg.video_loaded)
              if (msg.metadata && msg.metadata.width) {
                setMetadata(msg.metadata as VideoMetadata)
              }
              break

            case "frame":
              setLatestFrame(msg as FrameData)
              if (msg.stats) {
                setStats(msg.stats as FrameStats)
              }
              break

            case "status":
              if (msg.status === "playing") {
                // playing
              } else if (msg.status === "paused") {
                // paused
              }
              break

            case "settings_updated":
              setSettings((prev) => ({ ...prev, ...(msg.settings as Partial<PlayerSettings>) }))
              break

            case "pong":
              break
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => {
        setError("WebSocket connection error")
      }

      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
      }
    } catch {
      setError("Failed to create WebSocket connection")
    }
  }, [])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    setConnected(false)
  }, [])

  const send = useCallback((msg: WsClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const play = useCallback(() => send({ type: "play" }), [send])
  const pause = useCallback(() => send({ type: "pause" }), [send])
  const seek = useCallback((frame: number) => send({ type: "seek", frame }), [send])

  const updateSettings = useCallback(
    (partial: Partial<PlayerSettings>) => {
      setSettings((prev) => ({ ...prev, ...partial }))
      send({ type: "settings", ...partial } as unknown as WsClientMessage)
    },
    [send],
  )

  const uploadVideo = useCallback(
    async (file: File): Promise<{ video_id: string; metadata: VideoMetadata }> => {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || "Upload failed")
      }

      const data = await res.json()
      setVideoLoaded(true)
      setMetadata(data.metadata)

      // Trigger keyframe request after upload
      send({ type: "settings", mode: settings.mode })

      return data
    },
    [send, settings.mode],
  )

  // Connect on mount with auto-reconnect
  useEffect(() => {
    connect()

    const interval = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        connect()
      }
    }, 3000)

    return () => {
      disconnect()
      clearInterval(interval)
    }
  }, [connect, disconnect])

  return {
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
    connect,
    disconnect,
  }
}
