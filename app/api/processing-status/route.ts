import { NextResponse } from "next/server"
import { getProcessingStatus } from "@/lib/file-processing-status"

export async function GET() {
  try {
    const status = await getProcessingStatus()
    return NextResponse.json(status)
  } catch (error) {
    console.error("Error getting processing status:", error)
    // Return a default status if there's an error
    return NextResponse.json(
      {
        isProcessing: false,
        error: "Failed to get processing status",
        lastUpdated: Date.now(),
      },
      { status: 500 },
    )
  }
}
