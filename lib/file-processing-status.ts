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
  userId?: string
  locked?: boolean
}

// Use a file-based approach instead of KV
const STATUS_FILE_PATH = path.join(process.cwd(), "tmp")
const STATUS_FILE_NAME = "processing_status.json"
const LOCK_FILE_NAME = "upload_lock.json"

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
    locked: false
  }

  try {
    await fsPromises.writeFile(path.join(STATUS_FILE_PATH, STATUS_FILE_NAME), JSON.stringify(status))
  } catch (error) {
    console.error("Error writing status file:", error)
  }

  return status
}

// Generate a unique user ID for session tracking
export function generateUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Try to acquire lock
export async function tryAcquireLock(userId: string): Promise<boolean> {
  await ensureTmpDirectory()
  
  try {
    const lockFilePath = path.join(STATUS_FILE_PATH, LOCK_FILE_NAME)
    
    // Check if lock exists
    if (fs.existsSync(lockFilePath)) {
      const lockData = await fsPromises.readFile(lockFilePath, 'utf8')
      const lock = JSON.parse(lockData)
      
      // If lock is expired (more than 5 minutes old), we can take it
      if (Date.now() - lock.timestamp > 5 * 60 * 1000) {
        // Create new lock
        await fsPromises.writeFile(lockFilePath, JSON.stringify({
          userId: userId,
          timestamp: Date.now()
        }))
        return true
      }
      
      // Lock exists and is valid, check if it belongs to this user
      return lock.userId === userId
    }
    
    // No lock exists, create it
    await fsPromises.writeFile(lockFilePath, JSON.stringify({
      userId: userId,
      timestamp: Date.now()
    }))
    
    return true
  } catch (error) {
    console.error("Error acquiring lock:", error)
    return false
  }
}

// Release lock
export async function releaseLock(userId: string): Promise<boolean> {
  await ensureTmpDirectory()
  
  try {
    const lockFilePath = path.join(STATUS_FILE_PATH, LOCK_FILE_NAME)
    
    // Check if lock exists
    if (fs.existsSync(lockFilePath)) {
      const lockData = await fsPromises.readFile(lockFilePath, 'utf8')
      const lock = JSON.parse(lockData)
      
      // Only the user who owns the lock can release it
      if (lock.userId === userId) {
        await fsPromises.unlink(lockFilePath)
        return true
      }
      
      return false
    }
    
    return true
  } catch (error) {
    console.error("Error releasing lock:", error)
    return false
  }
}

// Start processing
export async function startProcessing(userId?: string): Promise<ProcessingStatus> {
  await ensureTmpDirectory()
  
  // If userId is provided, try to acquire lock
  if (userId) {
    const hasLock = await tryAcquireLock(userId)
    if (!hasLock) {
      throw new Error("Cannot start processing: another user is currently uploading data.")
    }
  }

  const status: ProcessingStatus = {
    isProcessing: true,
    startTime: Date.now(),
    progress: {
      current: 0,
      total: 0,
      message: "Starting processing...",
    },
    lastUpdated: Date.now(),
    userId: userId,
    locked: true
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
  let userId: string | undefined
  
  try {
    const currentStatus = await getProcessingStatus()
    startTime = currentStatus.startTime || Date.now()
    userId = currentStatus.userId
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
    userId,
    locked: true
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
    userId: currentStatus.userId,
    locked: false
  }

  try {
    await fsPromises.writeFile(path.join(STATUS_FILE_PATH, STATUS_FILE_NAME), JSON.stringify(status))
    
    // Release lock if userId exists
    if (currentStatus.userId) {
      await releaseLock(currentStatus.userId)
    }
  } catch (error) {
    console.error("Error writing status file:", error)
  }

  return status
}

// End processing
export async function endProcessing(): Promise<ProcessingStatus> {
  await ensureTmpDirectory()
  
  let userId: string | undefined
  
  try {
    const currentStatus = await getProcessingStatus()
    userId = currentStatus.userId
  } catch (error) {
    console.error("Error getting current status:", error)
  }

  const status: ProcessingStatus = {
    isProcessing: false,
    lastUpdated: Date.now(),
    locked: false
  }

  try {
    await fsPromises.writeFile(path.join(STATUS_FILE_PATH, STATUS_FILE_NAME), JSON.stringify(status))
    
    // Release lock if userId exists
    if (userId) {
      await releaseLock(userId)
    }
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
      // Also release the lock if there's a userId
      if (status.userId) {
        await releaseLock(status.userId)
      }
      
      return await setProcessingError("Processing timed out after 30 minutes")
    }

    return status
  } catch (error) {
    console.error("Error reading status file:", error)
    return await initProcessingStatus()
  }
}

// Check if a process is locked by another user
export async function isProcessLockedByOtherUser(currentUserId: string): Promise<boolean> {
  try {
    const status = await getProcessingStatus()
    
    if (status.locked && status.userId && status.userId !== currentUserId) {
      return true
    }
    
    return false
  } catch (error) {
    console.error("Error checking process lock:", error)
    return false
  }
}
