// This file contains functions to set up or reset the Upstash Vector index
import { Index } from "@upstash/vector"

// The Gemini embedding model produces 3072-dimensional vectors
const VECTOR_DIMENSIONS = 1536

export async function setupVectorIndex() {
  try {
    const index = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL || "",
      token: process.env.UPSTASH_VECTOR_REST_TOKEN || "",
    })

    // Get index information
    const indexInfo = await index.info()
    console.log("Current index info:", indexInfo)

    // If the index exists but has wrong dimensions, reset it
    if (indexInfo && indexInfo.dimension !== VECTOR_DIMENSIONS) {
      console.log(`Index has wrong dimensions (${indexInfo.dimension}), resetting...`)
      await index.reset()
      console.log("Index reset complete")
    }

    return {
      success: true,
      message: "Vector index setup complete",
    }
  } catch (error) {
    console.error("Error setting up vector index:", error)
    throw error
  }
}
