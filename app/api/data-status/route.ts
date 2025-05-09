import { NextResponse } from "next/server"
import { checkDataExists } from "@/lib/upstash"

export async function GET() {
  try {
    const dataExists = await checkDataExists()
    return NextResponse.json({ exists: dataExists })
  } catch (error) {
    console.error("Error checking data status:", error)
    return NextResponse.json(
      { 
        exists: false, 
        error: `Failed to check data status: ${error instanceof Error ? error.message : "Unknown error"}` 
      }, 
      { status: 500 }
    )
  }
}
