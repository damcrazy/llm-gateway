import { handleTranscription } from "@/lib/gateway/handlers"

// Vercel Hobby allows up to 300s (Pro: 800s). Ignored when self-hosted.
export const maxDuration = 300

export const POST = (request: Request) =>
  handleTranscription(request, "audio/transcriptions")
