import { NextResponse } from "next/server"
import { setupVectorIndex } from "@/lib/setup-index"

export async function POST() {
  try {
    const result = await setupVectorIndex()
    return NextResponse.json(result)
  } catch (error) {
    console.error("Error setting up index:", error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "An unknown error occurred",
      },
      { status: 500 },
    )
  }
}
