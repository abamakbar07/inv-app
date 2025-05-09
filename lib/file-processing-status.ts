import fs from "fs"
import path from "path"
import { promises as fsPromises } from "fs"

export type ProcessingStatus = {
  isProcessing: boolean
  startTime?: number
  progress?: {
    current: number
    total: number
    message: string
  }
  error?: string
  lastUpdated: number
}

// Use a file-based approach instead of KV
const STATUS_FILE_PATH = path.join(process.cwd(), "tmp")
const STATUS_FILE_NAME = "processing_status.json"

// Ensure the tmp directory exists
async function ensureTmpDirectory() {
  try {
    if (!fs.existsSync(STATUS_FILE_PATH)) {
      await fsPromises.mkdir(STATUS_FILE_PATH, { recursive: true })
    }
  } catch (error) {
    console.error("Error creating tmp directory:", error)
  }
}

// Initialize with not processing
export async function initProcessingStatus(): Promise<ProcessingStatus> {
  await ensureTmpDirectory()

  const status: ProcessingStatus = {
    isProcessing: false,
    lastUpdated: Date.now(),
  }

  try {
    await fsPromises.writeFile(path.join(STATUS_FILE_PATH, STATUS_FILE_NAME), JSON.stringify(status))
  } catch (error) {
    console.error("Error writing status file:", error)
  }

  return status
}

// Start processing
export async function startProcessing(): Promise<ProcessingStatus> {
  await ensureTmpDirectory()

  const status: ProcessingStatus = {
    isProcessing: true,
    startTime: Date.now(),
    progress: {
      current: 0,
      total: 0,
      message: "Starting processing...",
    },
    lastUpdated: Date.now(),
  }

  try {
    await fsPromises.writeFile(path.join(STATUS_FILE_PATH, STATUS_FILE_NAME), JSON.stringify(status))
  } catch (error) {
    console.error("Error writing status file:", error)
  }

  return status
}

// Update progress
export async function updateProgress(current: number, total: number, message: string): Promise<ProcessingStatus> {
  await ensureTmpDirectory()

  let startTime = Date.now()
  try {
    const currentStatus = await getProcessingStatus()
    startTime = currentStatus.startTime || Date.now()
  } catch (error) {
    console.error("Error getting current status:", error)
  }

  const status: ProcessingStatus = {
    isProcessing: true,
    startTime,
    progress: {
      current,
      total,
      message,
    },
    lastUpdated: Date.now(),
  }

  try {
    await fsPromises.writeFile(path.join(STATUS_FILE_PATH, STATUS_FILE_NAME), JSON.stringify(status))
  } catch (error) {
    console.error("Error writing status file:", error)
  }

  return status
}

// Set error
export async function setProcessingError(error: string): Promise<ProcessingStatus> {
  await ensureTmpDirectory()

  let currentStatus: ProcessingStatus = {
    isProcessing: false,
    lastUpdated: Date.now(),
  }

  try {
    currentStatus = await getProcessingStatus()
  } catch (error) {
    console.error("Error getting current status:", error)
  }

  const status: ProcessingStatus = {
    isProcessing: false,
    startTime: currentStatus.startTime,
    progress: currentStatus.progress,
    error,
    lastUpdated: Date.now(),
  }

  try {
    await fsPromises.writeFile(path.join(STATUS_FILE_PATH, STATUS_FILE_NAME), JSON.stringify(status))
  } catch (error) {
    console.error("Error writing status file:", error)
  }

  return status
}

// End processing
export async function endProcessing(): Promise<ProcessingStatus> {
  await ensureTmpDirectory()

  const status: ProcessingStatus = {
    isProcessing: false,
    lastUpdated: Date.now(),
  }

  try {
    await fsPromises.writeFile(path.join(STATUS_FILE_PATH, STATUS_FILE_NAME), JSON.stringify(status))
  } catch (error) {
    console.error("Error writing status file:", error)
  }

  return status
}

// Get current status
export async function getProcessingStatus(): Promise<ProcessingStatus> {
  await ensureTmpDirectory()

  try {
    const filePath = path.join(STATUS_FILE_PATH, STATUS_FILE_NAME)

    if (!fs.existsSync(filePath)) {
      return await initProcessingStatus()
    }

    const data = await fsPromises.readFile(filePath, "utf8")
    const status = JSON.parse(data) as ProcessingStatus

    // If it's been processing for more than 30 minutes, assume it failed
    if (status.isProcessing && status.startTime && Date.now() - status.startTime > 30 * 60 * 1000) {
      return await setProcessingError("Processing timed out after 30 minutes")
    }

    return status
  } catch (error) {
    console.error("Error reading status file:", error)
    return await initProcessingStatus()
  }
}
