/* ── TextStream Controls ─────────────────────────────────────────── */

import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Toggle } from "@/components/ui/toggle"
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Monitor,
  Sparkles,
  ScanLine,
  Gauge,
} from "lucide-react"
import type { PlayerSettings, RenderingMode, ThemePreset } from "@/lib/text-stream-types"

interface ControlsProps {
  settings: PlayerSettings
  onUpdateSettings: (partial: Partial<PlayerSettings>) => void
  onPlay: () => void
  onPause: () => void
  isPlaying: boolean
  fpsSliderValue: number
  onFpsSliderChange: (value: number) => void
}

const MODE_LABELS: Record<RenderingMode, string> = {
  ascii: "ASCII",
  unicode: "Unicode Blocks",
  braille: "Braille",
  ansi: "ANSI",
}

const THEME_LABELS: Record<ThemePreset, string> = {
  modern: "Modern",
  retro_dos: "Retro DOS",
  cyberpunk: "Cyberpunk",
  matrix: "Matrix",
  terminal: "Terminal",
  hacker: "Hacker",
  minimal: "Minimal",
}

export function Controls({
  settings,
  onUpdateSettings,
  onPlay,
  onPause,
  isPlaying,
}: ControlsProps) {
  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      {/* Playback controls */}
      <div className="flex items-center justify-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant="default"
          size="icon"
          className="h-9 w-9 rounded-full"
          onClick={isPlaying ? onPause : onPlay}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="h-4 w-4 fill-current ml-0.5" />
          )}
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      {/* Mode selector */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
          Mode
        </span>
        <Select
          value={settings.mode}
          onValueChange={(v) => onUpdateSettings({ mode: v as RenderingMode })}
        >
          <SelectTrigger className="w-[140px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MODE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k} className="text-xs">
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Resolution slider */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
            Resolution
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {settings.resolution}×{Math.round(settings.resolution * 0.56)}
          </span>
        </div>
        <Slider
          value={[settings.resolution]}
          onValueChange={([v]) => onUpdateSettings({ resolution: v })}
          min={40}
          max={320}
          step={10}
          className="py-0"
        />
      </div>

      {/* FPS slider */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
            FPS
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {settings.fps}
          </span>
        </div>
        <Slider
          value={[settings.fps]}
          onValueChange={([v]) => onUpdateSettings({ fps: v })}
          min={1}
          max={60}
          step={1}
          className="py-0"
        />
      </div>

      <Separator />

      {/* Image adjustments */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
            Brightness
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {settings.brightness.toFixed(1)}
          </span>
        </div>
        <Slider
          value={[settings.brightness]}
          onValueChange={([v]) => onUpdateSettings({ brightness: v })}
          min={0.1}
          max={3.0}
          step={0.1}
          className="py-0"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
            Contrast
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {settings.contrast.toFixed(1)}
          </span>
        </div>
        <Slider
          value={[settings.contrast]}
          onValueChange={([v]) => onUpdateSettings({ contrast: v })}
          min={0.1}
          max={3.0}
          step={0.1}
          className="py-0"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
            Density
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {settings.density.toFixed(1)}
          </span>
        </div>
        <Slider
          value={[settings.density]}
          onValueChange={([v]) => onUpdateSettings({ density: v })}
          min={0.1}
          max={2.0}
          step={0.1}
          className="py-0"
        />
      </div>

      <Separator />

      {/* Theme Selector */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
          Theme
        </span>
        <Select
          value={settings.theme}
          onValueChange={(v) => onUpdateSettings({ theme: v as ThemePreset })}
        >
          <SelectTrigger className="w-[140px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(THEME_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k} className="text-xs">
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Effect toggles */}
      <div className="flex flex-wrap gap-1">
        {[
          { key: "crt" as const, label: "CRT", icon: Monitor },
          { key: "scanlines" as const, label: "Scan", icon: ScanLine },
          { key: "glow" as const, label: "Glow", icon: Sparkles },
          { key: "noise" as const, label: "Noise", icon: Gauge },
        ].map(({ key, label, icon: Icon }) => (
          <Toggle
            key={key}
            pressed={settings.effects[key]}
            onPressedChange={(pressed) =>
              onUpdateSettings({
                effects: { ...settings.effects, [key]: pressed },
              })
            }
            className="h-7 text-[11px] gap-1 px-2"
          >
            <Icon className="h-3 w-3" />
            {label}
          </Toggle>
        ))}
      </div>
    </div>
  )
}
