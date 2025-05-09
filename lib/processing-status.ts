import { kv } from "@vercel/kv"

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

const STATUS_KEY = "inventory_processing_status"

// Initialize with not processing
export async function initProcessingStatus(): Promise<ProcessingStatus> {
  const status: ProcessingStatus = {
    isProcessing: false,
    lastUpdated: Date.now(),
  }

  await kv.set(STATUS_KEY, status)
  return status
}

// Start processing
export async function startProcessing(): Promise<ProcessingStatus> {
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

  await kv.set(STATUS_KEY, status)
  return status
}

// Update progress
export async function updateProgress(current: number, total: number, message: string): Promise<ProcessingStatus> {
  const status: ProcessingStatus = {
    isProcessing: true,
    startTime: (await getProcessingStatus()).startTime,
    progress: {
      current,
      total,
      message,
    },
    lastUpdated: Date.now(),
  }

  await kv.set(STATUS_KEY, status)
  return status
}

// Set error
export async function setProcessingError(error: string): Promise<ProcessingStatus> {
  const currentStatus = await getProcessingStatus()

  const status: ProcessingStatus = {
    isProcessing: false,
    startTime: currentStatus.startTime,
    progress: currentStatus.progress,
    error,
    lastUpdated: Date.now(),
  }

  await kv.set(STATUS_KEY, status)
  return status
}

// End processing
export async function endProcessing(): Promise<ProcessingStatus> {
  const status: ProcessingStatus = {
    isProcessing: false,
    lastUpdated: Date.now(),
  }

  await kv.set(STATUS_KEY, status)
  return status
}

// Get current status
export async function getProcessingStatus(): Promise<ProcessingStatus> {
  const status = await kv.get<ProcessingStatus>(STATUS_KEY)

  if (!status) {
    return await initProcessingStatus()
  }

  // If it's been processing for more than 30 minutes, assume it failed
  if (status.isProcessing && status.startTime && Date.now() - status.startTime > 30 * 60 * 1000) {
    return await setProcessingError("Processing timed out after 30 minutes")
  }

  return status
}
