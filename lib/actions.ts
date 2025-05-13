"use server"

import { revalidatePath } from "next/cache"
import * as XLSX from "xlsx"
import { upsertEmbeddings, clearAllEmbeddings } from "@/lib/upstash"
import { setupVectorIndex } from "@/lib/setup-index"
import {
  startProcessing,
  endProcessing,
  setProcessingError,
  getProcessingStatus,
  updateProgress,
  generateUserId,
  isProcessLockedByOtherUser
} from "@/lib/file-processing-status"

export async function processInventoryData(formData: FormData) {
  // Generate a unique ID for this processing session
  const userId = generateUserId()
  
  try {
    // Check if already processing
    const currentStatus = await getProcessingStatus()
    if (currentStatus.isProcessing) {
      return {
        success: false,
        message: "Another processing task is already running. Please wait for it to complete.",
        isAlreadyProcessing: true,
      }
    }
    
    // Check if locked by another user
    if (await isProcessLockedByOtherUser(userId)) {
      return {
        success: false,
        message: "Another user is currently uploading data. Please try again later.",
        isAlreadyProcessing: true,
      }
    }

    // Start processing with the user ID
    await startProcessing(userId)

    // First, ensure the index is set up with the correct dimensions
    await setupVectorIndex()
    await updateProgress(0, 100, "Setting up vector index...")

    const file = formData.get("file") as File
    const selectedColumnsJson = formData.get("selectedColumns") as string
    let selectedColumns: string[] = []

    if (selectedColumnsJson) {
      try {
        selectedColumns = JSON.parse(selectedColumnsJson)
      } catch (error) {
        console.error("Error parsing selected columns:", error)
      }
    }

    if (!file) {
      await setProcessingError("No file provided")
      throw new Error("No file provided")
    }

    // Process the file based on its type
    const fileType = file.name.split(".").pop()?.toLowerCase()
    let data: any[] = []

    await updateProgress(10, 100, "Parsing file...")

    if (fileType === "csv") {
      // For CSV files, we'll use XLSX to parse them as well
      // This simplifies our code and reduces dependencies
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: "array" })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      data = XLSX.utils.sheet_to_json(worksheet)
    } else if (fileType === "xlsx" || fileType === "xls") {
      // Process Excel file
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: "array" })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      data = XLSX.utils.sheet_to_json(worksheet)
    } else {
      await setProcessingError("Unsupported file type. Please upload a CSV or Excel file.")
      throw new Error("Unsupported file type. Please upload a CSV or Excel file.")
    }

    if (data.length === 0) {
      await setProcessingError("The file contains no data.")
      throw new Error("The file contains no data.")
    }

    // Filter data to include only selected columns if any are specified
    if (selectedColumns && selectedColumns.length > 0) {
      await updateProgress(15, 100, `Filtering data to include only selected columns...`)
      
      data = data.map(row => {
        const filteredRow: Record<string, any> = {}
        selectedColumns.forEach(column => {
          if (column in row) {
            filteredRow[column] = row[column]
          }
        })
        return filteredRow
      })
    }

    // Limit the amount of data to process to avoid rate limits
    const MAX_RECORDS = 500
    if (data.length > MAX_RECORDS) {
      console.log(`Limiting data to ${MAX_RECORDS} records to avoid rate limits`)
      data = data.slice(0, MAX_RECORDS)
    }

    await updateProgress(20, 100, `Parsed ${data.length} records, preparing to clear existing data...`)

    // Clear existing data before adding new data
    await clearAllEmbeddings()

    await updateProgress(30, 100, "Existing data cleared, preparing to generate embeddings...")

    // Process and embed the data
    // Convert data to string format for embedding
    const dataString = JSON.stringify(data, null, 2)

    try {
      // Upsert the data to Upstash Vector
      const result = await upsertEmbeddings("inventory-data", dataString)

      await updateProgress(
        100,
        100,
        `Successfully processed ${result.chunksProcessed} of ${result.totalChunks} chunks.`,
      )

      // End processing
      await endProcessing()

      revalidatePath("/")

      return {
        success: true,
        message: `Successfully processed ${result.chunksProcessed} of ${result.totalChunks} chunks from ${data.length} inventory records with ${selectedColumns.length} selected columns.`,
      }
    } catch (error) {
      // If embedding fails, provide a more helpful error message
      console.error("Error during embedding process:", error)

      const errorMessage = `Encountered an error during embedding: ${error instanceof Error ? error.message : String(error)}. This may be due to API rate limits or dimension mismatches. Try using the "Reset Index" button.`

      await setProcessingError(errorMessage)

      return {
        success: false,
        message: errorMessage,
      }
    }
  } catch (error) {
    console.error("Error processing inventory data:", error)

    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred"
    await setProcessingError(errorMessage)

    throw error
  }
}

export async function clearAllData() {
  const userId = generateUserId()
  
  try {
    // Check if already processing
    const currentStatus = await getProcessingStatus()
    if (currentStatus.isProcessing) {
      return {
        success: false,
        message: "Another processing task is already running. Please wait for it to complete.",
      }
    }
    
    // Check if locked by another user
    if (await isProcessLockedByOtherUser(userId)) {
      return {
        success: false,
        message: "Another user is currently performing data operations. Please try again later.",
      }
    }

    // Start processing with user ID
    await startProcessing(userId)
    await updateProgress(0, 100, "Clearing all data...")

    await clearAllEmbeddings()

    await updateProgress(100, 100, "All data cleared successfully.")
    await endProcessing()

    revalidatePath("/")

    return {
      success: true,
      message: "All inventory data has been cleared.",
    }
  } catch (error) {
    console.error("Error clearing data:", error)

    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred"
    await setProcessingError(errorMessage)

    throw error
  }
}
