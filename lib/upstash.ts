// This file should only be imported from server components or server actions
import { Index } from "@upstash/vector"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { updateProgress } from "./file-processing-status"

// The dimension we want to use for our embeddings
const VECTOR_DIMENSIONS = 1536

// Configure Upstash Vector client
const index = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL || "",
  token: process.env.UPSTASH_VECTOR_REST_TOKEN || "",
})

// Configure Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "")

// Improved chunking logic with better text formatting
function generateChunks(input: string, maxChunkSize = 2000): string[] {
  try {
    // Parse the JSON if it's a JSON string
    let data: any[] = []
    try {
      data = JSON.parse(input)
    } catch (e) {
      // If it's not valid JSON, treat it as plain text
      console.log("Input is not valid JSON, treating as plain text")

      // Simple text chunking
      const chunks: string[] = []
      let currentChunk = ""
      const paragraphs = input.split(/\n+/)

      for (const paragraph of paragraphs) {
        if (currentChunk.length + paragraph.length + 1 > maxChunkSize) {
          chunks.push(currentChunk)
          currentChunk = paragraph
        } else {
          currentChunk += (currentChunk ? "\n" : "") + paragraph
        }
      }

      if (currentChunk) {
        chunks.push(currentChunk)
      }

      return chunks
    }

    // If we have an array of objects, process each object separately
    if (Array.isArray(data)) {
      const chunks: string[] = []
      let currentChunk = ""

      // Process each item in the array
      for (let i = 0; i < data.length; i++) {
        // Convert the object to a readable text format
        const itemText = Object.entries(data[i])
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")

        const itemWithHeader = `Item ${i + 1}:\n${itemText}`

        // If adding this item would exceed the chunk size, start a new chunk
        if (currentChunk.length + itemWithHeader.length + 2 > maxChunkSize) {
          chunks.push(currentChunk)
          currentChunk = itemWithHeader
        } else {
          currentChunk += (currentChunk ? "\n\n" : "") + itemWithHeader
        }
      }

      // Add the last chunk if it's not empty
      if (currentChunk) {
        chunks.push(currentChunk)
      }

      return chunks
    } else {
      // If it's not an array, convert the whole object to text
      const text = Object.entries(data)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n")

      // Simple text chunking
      const chunks: string[] = []
      let currentChunk = ""
      const paragraphs = text.split(/\n+/)

      for (const paragraph of paragraphs) {
        if (currentChunk.length + paragraph.length + 1 > maxChunkSize) {
          chunks.push(currentChunk)
          currentChunk = paragraph
        } else {
          currentChunk += (currentChunk ? "\n" : "") + paragraph
        }
      }

      if (currentChunk) {
        chunks.push(currentChunk)
      }

      return chunks
    }
  } catch (error) {
    console.error("Error generating chunks:", error)
    // Return a single chunk with the original input if there's an error
    return [input.substring(0, maxChunkSize)]
  }
}

// Retry function with exponential backoff
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 5, initialDelay = 1000, factor = 2): Promise<T> {
  let retries = 0
  let delay = initialDelay

  while (true) {
    try {
      return await fn()
    } catch (error: any) {
      retries++

      // If we've reached max retries or it's not a rate limit error, throw
      if (retries >= maxRetries || !error.toString().includes("429")) {
        throw error
      }

      console.log(`Rate limit hit, retrying in ${delay}ms (attempt ${retries}/${maxRetries})`)

      // Wait for the delay period
      await new Promise((resolve) => setTimeout(resolve, delay))

      // Increase delay for next retry
      delay *= factor
    }
  }
}

// Generate embeddings using Google's embedding model with retry logic
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await retryWithBackoff(async () => {
      // Create the embedding model with the correct model name
      // Note: Using embedding-001 model which supports dimension configuration
      const embeddingModel = genAI.getGenerativeModel({
        model: "embedding-001",
        generationConfig: {
          outputDimension: VECTOR_DIMENSIONS, // Use outputDimension (not outputDimensionality)
        },
      })

      // Log the text length for debugging
      console.log(`Generating embedding for text of length ${text.length}`)

      // Generate the embedding
      const result = await embeddingModel.embedContent(text)
      const embedding = result.embedding.values

      // Verify the embedding dimension
      if (embedding.length !== VECTOR_DIMENSIONS) {
        console.warn(`Unexpected embedding dimension: ${embedding.length}, expected: ${VECTOR_DIMENSIONS}`)

        // If dimensions don't match, resize the vector to match expected dimensions
        if (embedding.length > VECTOR_DIMENSIONS) {
          console.log(`Resizing embedding from ${embedding.length} to ${VECTOR_DIMENSIONS}`)
          return embedding.slice(0, VECTOR_DIMENSIONS)
        } else {
          // Pad with zeros if embedding is too small (unlikely scenario)
          console.log(`Padding embedding from ${embedding.length} to ${VECTOR_DIMENSIONS}`)
          return [...embedding, ...Array(VECTOR_DIMENSIONS - embedding.length).fill(0)]
        }
      }

      return embedding
    })
  } catch (error) {
    console.error("Error generating embedding after retries:", error)
    throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Upsert embeddings to Upstash Vector with improved rate limiting
export async function upsertEmbeddings(resourceId: string, content: string) {
  try {
    // Generate chunks from the content - using better text formatting
    const chunks = generateChunks(content)
    console.log(`Generated ${chunks.length} chunks from content`)

    // Update progress
    await updateProgress(0, chunks.length, `Preparing to process ${chunks.length} chunks...`)

    // Process chunks in smaller batches with longer delays between batches
    const batchSize = 3 // Reduced batch size
    let successCount = 0

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize)

      // Update progress
      await updateProgress(
        i,
        chunks.length,
        `Processing chunks ${i + 1}-${Math.min(i + batch.length, chunks.length)} of ${chunks.length}...`,
      )

      // Generate embeddings for each chunk in the batch
      const embeddingPromises = batch.map(async (chunk, index) => {
        try {
          // Log a sample of the chunk for debugging
          console.log(`Processing chunk ${i + index} (${chunk.length} chars): ${chunk.substring(0, 100)}...`)

          const embedding = await generateEmbedding(chunk)
          successCount++
          return {
            id: `${resourceId}-${i + index}`,
            vector: embedding,
            metadata: {
              resourceId,
              content: chunk,
            },
          }
        } catch (error) {
          console.error(`Failed to embed chunk ${i + index}:`, error)
          // Return null for failed embeddings
          return null
        }
      })

      const embeddingsToUpsert = (await Promise.all(embeddingPromises)).filter(Boolean)

      if (embeddingsToUpsert.length > 0) {
        // Upsert the batch to Upstash Vector
        await index.upsert(embeddingsToUpsert)
      }

      // Add a longer delay between batches to avoid rate limits
      if (i + batchSize < chunks.length) {
        console.log(`Processed ${i + batch.length}/${chunks.length} chunks, waiting before next batch...`)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }

    // Update final progress
    await updateProgress(
      chunks.length,
      chunks.length,
      `Completed processing ${successCount} of ${chunks.length} chunks.`,
    )

    return {
      success: true,
      chunksProcessed: successCount,
      totalChunks: chunks.length,
    }
  } catch (error) {
    console.error("Error upserting embeddings:", error)
    throw error
  }
}

// Find relevant content based on a query with retry logic
export async function findRelevantContent(query: string, k = 5) {
  try {
    // Generate embedding for the query with retry logic
    const queryEmbedding = await generateEmbedding(query)

    // Query Upstash Vector for similar content
    const results = await index.query({
      vector: queryEmbedding,
      topK: k,
      includeMetadata: true,
    })

    return results
  } catch (error) {
    console.error("Error finding relevant content:", error)
    throw error
  }
}

// Check if data exists in Upstash Vector
export async function checkDataExists(): Promise<boolean> {
  try {
    // Try to get a single vector to check if data exists
    // Use the correct dimension for the dummy vector - consistent with VECTOR_DIMENSIONS
    const results = await index.query({
      vector: Array(VECTOR_DIMENSIONS).fill(0), // Dummy vector with dimensions set to 1536
      topK: 1,
    })

    return results.length > 0
  } catch (error) {
    console.error("Error checking if data exists:", error)
    return false
  }
}

// Clear all embeddings from Upstash Vector
export async function clearAllEmbeddings() {
  try {
    // Get all vector IDs
    // Use the correct dimension for the dummy vector - consistent with VECTOR_DIMENSIONS
    const allVectors = await index.query({
      vector: Array(VECTOR_DIMENSIONS).fill(0), // Dummy vector with dimensions set to 1536
      topK: 1000, // Get a large number of vectors
    })

    if (allVectors.length === 0) {
      return { success: true, message: "No data to clear." }
    }

    // Delete all vectors
    const ids = allVectors.map((vector) => vector.id)
    await index.delete(ids)

    return {
      success: true,
      message: `Cleared ${ids.length} vectors from the database.`,
    }
  } catch (error) {
    console.error("Error clearing embeddings:", error)
    throw error
  }
}
