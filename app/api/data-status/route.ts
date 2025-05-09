import { NextResponse } from "next/server"
import { checkDataExists } from "@/lib/upstash"

export async function GET() {
  try {
    const dataExists = await checkDataExists()
    return NextResponse.json({ dataExists })
  } catch (error) {
    console.error("Error checking data status:", error)
    return NextResponse.json({ dataExists: false, error: "Failed to check data status" }, { status: 500 })
  }
}
