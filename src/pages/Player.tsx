import { useNavigate } from "react-router"
import { useAuth } from "@/hooks/use-auth"
import { TextStreamPlayer } from "@/components/textstream/TextStreamPlayer"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Loader2 } from "lucide-react"

export default function PlayerPage() {
  const navigate = useNavigate()
  const { isLoading, isAuthenticated } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAuthenticated) {
    navigate("/auth")
    return null
  }

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0a]">
      {/* Minimal top bar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-white/[0.04] bg-[#0a0a0a]/90">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <span className="text-xs text-muted-foreground/50">·</span>
        <span className="text-xs font-medium">Player</span>
      </div>

      {/* Player fills remaining space */}
      <div className="flex-1 min-h-0">
        <TextStreamPlayer />
      </div>
    </div>
  )
}
