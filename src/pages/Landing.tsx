import { useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import {
  ArrowRight,
  Film,
  Grid3X3,
  Square,
  Braces,
  Terminal,
  Eye,
} from "lucide-react"

/* ── Landing Page – Minimalism Theme ────────────────────────────── */

const MODE_PREVIEWS = [
  { icon: Square, label: "Unicode Blocks", desc: "Character blocks for rich detail" },
  { icon: Braces, label: "ASCII Art", desc: "Classic monochrome characters" },
  { icon: Grid3X3, label: "Braille", desc: "2×4 dot grid, highest quality" },
  { icon: Terminal, label: "ANSI", desc: "Terminal-style fg/bg colors" },
]

const FEATURES = [
  {
    label: "GPU Accelerated",
    desc: "Instanced rendering via Three.js — tens of thousands of glyphs at 60 FPS",
  },
  {
    label: "Delta Compression",
    desc: "Only changed cells are transmitted. Typical bandwidth savings exceed 80%",
  },
  {
    label: "Adaptive Quality",
    desc: "Automatically adjusts resolution and frame rate to maintain performance",
  },
  {
    label: "Visual Effects",
    desc: "CRT scanlines, bloom, noise, film grain, and themed color palettes",
  },
]

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a] text-[#e0e0e0] selection:bg-[#e0e0e0]/10">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.04] bg-[#0a0a0a]/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-5 h-12 flex items-center justify-between">
          <span className="text-sm font-medium tracking-tight">TextStream</span>
          <nav className="flex items-center gap-5">
            <span className="text-[11px] text-[#666] hover:text-[#ccc] transition-colors cursor-default">
              Docs
            </span>
            <span className="text-[11px] text-[#666] hover:text-[#ccc] transition-colors cursor-default">
              GitHub
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] border-white/[0.08] text-[#ccc] hover:bg-white/[0.04]"
              onClick={() => navigate("/player")}
            >
              Launch Player
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="pt-32 pb-20 px-5">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] mb-8">
              <Film className="h-3 w-3 text-[#666]" />
              <span className="text-[11px] text-[#666] tracking-wider uppercase">
                Video as Text
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-light tracking-tight leading-none mb-5 text-white">
              Video reimagined
              <br />
              <span className="text-[#555]">as moving text.</span>
            </h1>
            <p className="text-sm text-[#666] max-w-xl mx-auto leading-relaxed mb-10">
              Every frame of any video is converted into colored glyphs and
              rendered on the GPU. No <code className="text-[#999] text-[12px]">{'<video>'}</code> tag required.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button
                className="h-9 px-5 text-xs bg-white text-[#0a0a0a] hover:bg-white/90 rounded-full"
                onClick={() => navigate("/player")}
              >
                Get Started
                <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-5 text-xs border-white/[0.08] text-[#888] hover:text-[#ccc] rounded-full"
                onClick={() => navigate("/player")}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Try demo
              </Button>
            </div>
          </div>
        </section>

        {/* Preview / Modes */}
        <section className="py-20 px-5">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-14">
              <span className="text-[10px] tracking-[0.2em] uppercase text-[#555]">
                Rendering Modes
              </span>
              <h2 className="text-2xl font-light text-white mt-3 mb-2">
                Four ways to see video as text
              </h2>
              <p className="text-sm text-[#666] max-w-md mx-auto">
                Each mode captures detail differently. Switch between them in real time.
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {MODE_PREVIEWS.map((mode) => (
                <div
                  key={mode.label}
                  className="group border border-white/[0.04] rounded-lg p-5 hover:border-white/[0.08] transition-colors bg-white/[0.02]"
                >
                  <mode.icon className="h-5 w-5 text-[#444] mb-3 group-hover:text-[#888] transition-colors" />
                  <h3 className="text-sm font-medium text-white/80 mb-1">{mode.label}</h3>
                  <p className="text-[11px] text-[#555] leading-relaxed">{mode.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 px-5 border-t border-white/[0.04]">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-14">
              <span className="text-[10px] tracking-[0.2em] uppercase text-[#555]">
                Technical
              </span>
              <h2 className="text-2xl font-light text-white mt-3 mb-2">
                Built for performance
              </h2>
              <p className="text-sm text-[#666] max-w-md mx-auto">
                Every layer is optimized — from Python decoding to GPU rendering.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
              {FEATURES.map((f) => (
                <div
                  key={f.label}
                  className="border border-white/[0.04] rounded-lg p-5 bg-white/[0.02]"
                >
                  <h3 className="text-sm font-medium text-white/80 mb-1.5">{f.label}</h3>
                  <p className="text-[12px] text-[#555] leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pipeline */}
        <section className="py-20 px-5 border-t border-white/[0.04]">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14">
              <span className="text-[10px] tracking-[0.2em] uppercase text-[#555]">
                Architecture
              </span>
              <h2 className="text-2xl font-light text-white mt-3 mb-2">
                How it works
              </h2>
            </div>
            <div className="flex items-center justify-center gap-2 md:gap-4 text-[11px] flex-wrap">
              {["Upload", "FFmpeg", "Convert", "Delta Encode", "WebSocket", "Three.js", "GPU", "Screen"].map(
                (step, i) => (
                  <div key={step} className="flex items-center gap-2 md:gap-4">
                    <span className="px-3 py-1.5 border border-white/[0.06] rounded text-[#888] bg-white/[0.02]">
                      {step}
                    </span>
                    {i < 7 && (
                      <ArrowRight className="h-3 w-3 text-[#333]" />
                    )}
                  </div>
                ),
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-6 px-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-[11px] text-[#444]">
          <span>TextStream · Video rendered as text</span>
          <span className="text-[#333]">Built with Three.js + Python + WebSocket</span>
        </div>
      </footer>
    </div>
  )
}
