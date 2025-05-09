import { type NextRequest, NextResponse } from "next/server"
import { processInventoryData } from "@/lib/actions"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const result = await processInventoryData(formData)

    return NextResponse.json(result)
  } catch (error) {
    console.error("Upload API error:", error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "An unknown error occurred",
      },
      { status: 500 },
    )
  }
}
