// This file should only be imported from server components or server actions
import { Index } from "@upstash/vector"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { updateProgress } from "./file-processing-status"

// Upstash Vector database expects 1536 dimensions
// but Google's embedding-001 model actually outputs 768 dimensions
// We need to use 1536 to match the DB configuration
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
      
      // Log the retry attempt
      console.log(`Retry attempt ${retries}/${maxRetries}`)

      // Check if we have a 429 Too Many Requests error
      const isRateLimitError = 
        error.toString().includes("429") || 
        error.toString().includes("Too Many Requests") ||
        error.toString().includes("rate limit");

      // If we've reached max retries or it's not a rate limit error, throw
      if (retries >= maxRetries || !isRateLimitError) {
        console.error(`Giving up after ${retries} retries:`, error)
        throw error
      }

      // Calculate an appropriate delay - longer for rate limit errors
      const retryDelay = isRateLimitError ? delay * 2 : delay
      console.log(`Rate limit hit, retrying in ${retryDelay}ms (attempt ${retries}/${maxRetries})`)

      // Wait for the delay period
      await new Promise((resolve) => setTimeout(resolve, retryDelay))

      // Increase delay for next retry
      delay *= factor
    }
  }
}

// Generate embeddings using Google's embedding model with retry logic
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await retryWithBackoff(async () => {
      // Create the embedding model - don't try to configure dimensions, use model's default
      const embeddingModel = genAI.getGenerativeModel({
        model: "embedding-001",
        // Gemini model parameters only accept specific properties
      })

      // Log the text length for debugging
      console.log(`Generating embedding for text of length ${text.length}`)

      // Generate the embedding
      const result = await embeddingModel.embedContent(text)
      const embedding = result.embedding.values

      // Pad the embedding from 768 to 1536 to match Upstash database expectations
      console.log(`Generated embedding with ${embedding.length} dimensions, padding to ${VECTOR_DIMENSIONS}`)
      
      // Double each value to maintain the semantic meaning but reach required dimensions
      const paddedEmbedding = [...embedding, ...embedding]
      
      // Save both original and padded embeddings for debugging
      const fs = require('fs');
      const path = require('path');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sanitizedText = text.substring(0, 20).replace(/[^a-z0-9]/gi, '_');
      const debugData = {
        text_sample: text.substring(0, 100),
        timestamp: timestamp,
        original_dimensions: embedding.length,
        padded_dimensions: paddedEmbedding.length,
        original_embedding: embedding,
        padded_embedding: paddedEmbedding
      };
      
      try {
        const filename = path.join(process.cwd(), 'tmp', `raw_embedding_${sanitizedText}_${timestamp}.json`);
        fs.writeFileSync(filename, JSON.stringify(debugData, null, 2));
        console.log(`Saved raw embedding details to ${filename}`);
      } catch (error) {
        console.error("Error saving raw embedding to tmp:", error);
      }
      
      return paddedEmbedding
    }, 3, 2000, 2) // Reduce max retries to 3, increase initial delay to 2 seconds, and keep factor at 2
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
    const batchSize = 5 // Increased batch size
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
          
          // Save the chunk embedding to tmp directory for debugging
          await saveEmbeddingToTmp(`chunk_${resourceId}_${i + index}`, embedding, chunk.substring(0, 100))
          
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

      // Filter out null values and convert to the proper type
      const embeddingsResults = await Promise.all(embeddingPromises)
      const embeddingsToUpsert = embeddingsResults.filter((result): result is {
        id: string;
        vector: number[];
        metadata: { resourceId: string; content: string };
      } => result !== null)

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
export async function findRelevantContent(query: string, k = 20) {
  try {
    console.log("Finding relevant content for query:", query)
    
    // Preprocess query to improve matching for material codes
    // Handle special cases where the query is likely a material code lookup
    const isMaterialCodeQuery = /lokasi|dimana|berada|location|where|is|ada|qty|quantity|how many|much/.test(query.toLowerCase()) &&
                               /[A-Z0-9]{3,}/.test(query);
    
    // For material lookups, increase the number of matches
    const topK = isMaterialCodeQuery ? 50 : k;
    
    // Log if this appears to be a material code query
    if (isMaterialCodeQuery) {
      console.log("Detected material code lookup query, increasing result count to:", topK);
    }
    
    // Generate embedding for the query with retry logic
    const queryEmbedding = await generateEmbedding(query)
    console.log("Generated query embedding successfully")

    // Save the query embedding to tmp directory for debugging
    await saveEmbeddingToTmp(query, queryEmbedding)

    // Query Upstash Vector for similar content
    const results = await index.query({
      vector: queryEmbedding,
      topK: topK,
      includeMetadata: true,
    })

    console.log(`Found ${results.length} relevant items`)
    
    // If no results are found, this could be useful information
    if (results.length === 0) {
      console.log("No relevant content found in the database")
    }

    return results
  } catch (error) {
    console.error("Error finding relevant content:", error)
    // Instead of returning an empty array, throw the error
    // This will be handled appropriately in the chat API
    throw new Error(`Failed to retrieve relevant content: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Helper function to save embeddings to tmp directory
async function saveEmbeddingToTmp(query: string, embedding: number[], context: string = "") {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Create a sanitized filename from the query
    const sanitizedQuery = query.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(process.cwd(), 'tmp', `embedding_${sanitizedQuery}_${timestamp}.json`);
    
    // Create the debugging data with metadata
    const debugData = {
      query,
      timestamp: new Date().toISOString(),
      dimensions: embedding.length,
      context: context || query,
      embedding
    };
    
    // Write the embedding data to the file
    fs.writeFileSync(filename, JSON.stringify(debugData, null, 2));
    console.log(`Saved embedding to ${filename}`);
  } catch (error) {
    console.error("Error saving embedding to tmp directory:", error);
    // Don't throw - this is just for debugging and shouldn't affect the main functionality
  }
}

// Check if data exists in Upstash Vector
export async function checkDataExists(): Promise<boolean> {
  try {
    console.log("Checking if data exists in Upstash Vector")
    
    // Create a zero vector with the correct dimension
    const zeroVector = Array(VECTOR_DIMENSIONS).fill(0)
    
    // Try to get multiple vectors to ensure we have a valid result
    const results = await index.query({
      vector: zeroVector,
      topK: 100,  // Increased from 10 to get a better sample
    })

    console.log(`Database check: Found ${results.length} vectors in the database`)
    
    if (results.length > 0) {
      // Log a sample of what we found for debugging
      console.log("Sample vector ID:", results[0].id)
    }

    return results.length > 0
  } catch (error) {
    // If we get a vector dimension error or any other error, log it but don't crash
    console.error("Error checking if data exists:", error)
    
    // Throw the error to propagate it upward
    throw new Error(`Failed to check database: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Clear all embeddings from Upstash Vector
export async function clearAllEmbeddings() {
  try {
    console.log("Starting to clear all embeddings from database...")
    // Create a zero vector with the correct dimension
    const zeroVector = Array(VECTOR_DIMENSIONS).fill(0)
    
    // Upstash has a limit of 1000 items per query
    // We'll implement an iterative approach to delete all vectors
    const queryLimit = 1000;
    let deletedCount = 0;
    let hasMoreVectors = true;
    
    while (hasMoreVectors) {
      // Get batch of vectors (up to 1000)
      const vectors = await index.query({
        vector: zeroVector,
        topK: queryLimit,
      });
      
      console.log(`Found ${vectors.length} vectors to delete in this batch`);
      
      if (vectors.length === 0) {
        hasMoreVectors = false;
        break;
      }
      
      // Convert IDs to strings
      const ids = vectors.map((vector) => String(vector.id));
      
      // Delete in smaller batches to avoid overwhelming the API
      const batchSize = 100;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batchIds = ids.slice(i, i + batchSize);
        await index.delete(batchIds);
        deletedCount += batchIds.length;
        console.log(`Deleted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(ids.length/batchSize)} (${batchIds.length} vectors)`);
      }
      
      // If we got fewer than the query limit, we're done
      if (vectors.length < queryLimit) {
        hasMoreVectors = false;
      } else {
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return {
      success: true,
      message: deletedCount === 0 
        ? "No data to clear." 
        : `Cleared ${deletedCount} vectors from the database.`,
    }
  } catch (error) {
    console.error("Error clearing embeddings:", error)
    // Return a user-friendly error message rather than throwing
    return { 
      success: false, 
      message: `Error clearing data: ${error instanceof Error ? error.message : "Unknown error"}` 
    }
  }
}
