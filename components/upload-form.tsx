"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Upload, Trash2, RefreshCw, AlertTriangle, AlertCircle, FileText } from "lucide-react"
import { processInventoryData, clearAllData } from "@/lib/actions"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { Checkbox } from "@/components/ui/checkbox"
import type { ProcessingStatus } from "@/lib/file-processing-status"

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [fileData, setFileData] = useState<any[] | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [isPreviewingFile, setIsPreviewingFile] = useState(false)
  const { toast } = useToast()

  // Fetch processing status periodically
  useEffect(() => {
    // Track if component is mounted
    let isMounted = true;
    let pollingActive = false;
    let interval: NodeJS.Timeout | null = null;
    
    const fetchStatus = async () => {
      try {
        if (!isMounted) return;
        
        setStatusError(null)
        const response = await fetch("/api/processing-status")

        if (!response.ok) {
          throw new Error(`Status API returned ${response.status}: ${response.statusText}`)
        }

        const status = await response.json()
        setProcessingStatus(status)

        // If there's an error, show it
        if (status.error && !status.isProcessing) {
          toast({
            title: "Processing Error",
            description: status.error,
            variant: "destructive",
          })
        }

        // Update local state based on processing status
        if (status.isProcessing) {
          setIsUploading(true)
          
          // If processing started, increase polling frequency
          if (!pollingActive) {
            if (interval) clearInterval(interval);
            pollingActive = true;
            // Poll every 2 seconds during processing
            interval = setInterval(fetchStatus, 2000);
          }
        } else {
          setIsUploading(false)
          setIsClearing(false)
          setIsResetting(false)
          
          // If no longer processing, reduce polling frequency
          if (pollingActive) {
            if (interval) clearInterval(interval);
            pollingActive = false;
            // Poll every 10 seconds when idle
            interval = setInterval(fetchStatus, 10000);
          }
        }
      } catch (error) {
        console.error("Error fetching processing status:", error)
        setStatusError(error instanceof Error ? error.message : "Failed to fetch status")

        // Use default status when API fails
        setProcessingStatus({
          isProcessing: false,
          lastUpdated: Date.now(),
        })

        setIsUploading(false)
        setIsClearing(false)
        setIsResetting(false)
        
        // If error, reduce polling frequency
        if (pollingActive) {
          if (interval) clearInterval(interval);
          pollingActive = false;
          interval = setInterval(fetchStatus, 10000);
        }
      }
    }

    // Initial fetch
    fetchStatus()
    
    // Initial polling interval (less frequent)
    interval = setInterval(fetchStatus, 10000)

    // Cleanup function
    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    }
  }, [toast])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0]

      // Check file size - limit to 1MB to avoid rate limit issues
      if (selectedFile.size > 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select a file smaller than 1MB to avoid rate limit issues.",
          variant: "destructive",
        })
        return
      }

      setFile(selectedFile)
      
      // Preview the file and extract columns
      setIsPreviewingFile(true)
      
      try {
        // Read file content to extract columns
        const reader = new FileReader()
        
        reader.onload = async (event) => {
          if (!event.target || !event.target.result) return
          
          const arrayBuffer = event.target.result as ArrayBuffer
          
          // Use already imported XLSX from the server components
          const formData = new FormData()
          formData.append('file', selectedFile)
          formData.append('previewOnly', 'true')
          
          const response = await fetch('/api/upload/preview', {
            method: 'POST',
            body: formData
          })
          
          if (!response.ok) {
            throw new Error('Failed to preview file')
          }
          
          const result = await response.json()
          
          if (result.success) {
            setFileData(result.data)
            const extractedColumns = result.columns || []
            setColumns(extractedColumns)
            // By default select all columns
            setSelectedColumns(extractedColumns)
          } else {
            throw new Error(result.message || 'Failed to parse file')
          }
        }
        
        reader.readAsArrayBuffer(selectedFile)
      } catch (error) {
        console.error("File preview error:", error)
        toast({
          title: "File preview failed",
          description: error instanceof Error ? error.message : "Failed to preview file content",
          variant: "destructive",
        })
      } finally {
        setIsPreviewingFile(false)
      }
    }
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()

    // Check if already processing
    if (processingStatus?.isProcessing) {
      toast({
        title: "Already Processing",
        description: "Another processing task is already running. Please wait for it to complete.",
        variant: "default",
      })
      return
    }

    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select a CSV or Excel file to upload.",
        variant: "destructive",
      })
      return
    }

    // Check file type
    const fileType = file.name.split(".").pop()?.toLowerCase()
    if (fileType !== "csv" && fileType !== "xlsx" && fileType !== "xls") {
      toast({
        title: "Invalid file type",
        description: "Please upload a CSV or Excel file.",
        variant: "destructive",
      })
      return
    }

    // Check if at least one column is selected
    if (selectedColumns.length === 0) {
      toast({
        title: "No columns selected",
        description: "Please select at least one column to process.",
        variant: "destructive",
      })
      return
    }

    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("selectedColumns", JSON.stringify(selectedColumns))

      const result = await processInventoryData(formData)

      if (result.success) {
        toast({
          title: "Upload successful",
          description: result.message,
        })

        // Refresh the page to update data status
        window.location.reload()
      } else {
        if (result.isAlreadyProcessing) {
          toast({
            title: "Already Processing",
            description: result.message,
            variant: "default",
          })
        } else {
          toast({
            title: "Upload partially successful",
            description: result.message,
            variant: "default",
          })
        }
      }
    } catch (error) {
      console.error("Upload error:", error)
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      })
    } finally {
      setFile(null)
    }
  }

  const handleClearData = async () => {
    // Check if already processing
    if (processingStatus?.isProcessing) {
      toast({
        title: "Already Processing",
        description: "Another processing task is already running. Please wait for it to complete.",
        variant: "default",
      })
      return
    }

    if (!confirm("Are you sure you want to clear all inventory data? This action cannot be undone.")) {
      return
    }

    setIsClearing(true)

    try {
      const result = await clearAllData()

      if (result.success) {
        toast({
          title: "Data cleared",
          description: result.message,
        })

        // Refresh the page to update data status
        window.location.reload()
      } else {
        toast({
          title: "Clear data failed",
          description: result.message,
          variant: "default",
        })
      }
    } catch (error) {
      console.error("Clear data error:", error)
      toast({
        title: "Failed to clear data",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      })
    }
  }

  const handleResetIndex = async () => {
    // Check if already processing
    if (processingStatus?.isProcessing) {
      toast({
        title: "Already Processing",
        description: "Another processing task is already running. Please wait for it to complete.",
        variant: "default",
      })
      return
    }

    if (
      !confirm(
        "Are you sure you want to reset the vector index? This will clear all data and recreate the index with the correct dimensions.",
      )
    ) {
      return
    }

    setIsResetting(true)

    try {
      const response = await fetch("/api/setup-index", {
        method: "POST",
      })

      const result = await response.json()

      if (result.success) {
        toast({
          title: "Index reset successful",
          description: "The vector index has been reset with the correct dimensions.",
        })
      } else {
        toast({
          title: "Index reset failed",
          description: result.message,
          variant: "destructive",
        })
      }

      // Refresh the page to update data status
      window.location.reload()
    } catch (error) {
      console.error("Index reset error:", error)
      toast({
        title: "Failed to reset index",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      })
    } finally {
      setIsResetting(false)
    }
  }

  // Toggle column selection
  const toggleColumnSelection = (column: string) => {
    setSelectedColumns(prev => 
      prev.includes(column)
        ? prev.filter(col => col !== column)
        : [...prev, column]
    )
  }
  
  // Select all columns
  const selectAllColumns = () => {
    setSelectedColumns([...columns])
  }
  
  // Deselect all columns
  const deselectAllColumns = () => {
    setSelectedColumns([])
  }

  // Calculate progress percentage
  const progressPercentage = processingStatus?.progress
    ? Math.round((processingStatus.progress.current / processingStatus.progress.total) * 100)
    : 0

  return (
    <div className="space-y-4">
      <Alert variant="warning" className="bg-yellow-50 border-yellow-200 mb-4">
        <AlertTriangle className="h-4 w-4 text-yellow-600" />
        <AlertTitle className="text-yellow-800">Rate Limit Warning</AlertTitle>
        <AlertDescription className="text-yellow-700">
          Due to API rate limits, please upload small files (under 1MB) and avoid frequent uploads. If you encounter
          rate limit errors, wait a few minutes before trying again.
        </AlertDescription>
      </Alert>

      {statusError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Status API Error</AlertTitle>
          <AlertDescription>
            {statusError}. This won't affect your ability to upload files, but progress tracking may not work.
          </AlertDescription>
        </Alert>
      )}

      {processingStatus?.isProcessing && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
          <h3 className="text-blue-800 font-medium mb-2">Processing in Progress</h3>
          <div className="mb-2">
            <Progress value={progressPercentage} className="h-2" />
          </div>
          <p className="text-blue-700 text-sm">{processingStatus.progress?.message || "Processing..."}</p>
          <p className="text-blue-600 text-xs mt-1">
            {processingStatus.progress
              ? `${processingStatus.progress.current} of ${processingStatus.progress.total} (${progressPercentage}%)`
              : ""}
          </p>
        </div>
      )}

      <form onSubmit={handleUpload} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="file">Upload Inventory Data (CSV or Excel)</Label>
          <Input
            id="file"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            disabled={processingStatus?.isProcessing || false}
          />
          <p className="text-sm text-gray-500">Upload your inventory data to analyze and chat with it (max 1MB).</p>
        </div>
        
        {isPreviewingFile && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              <p className="text-blue-700">Previewing file content...</p>
            </div>
          </div>
        )}
        
        {columns.length > 0 && (
          <div className="border rounded-md p-4">
            <div className="mb-2 flex justify-between items-center">
              <Label className="text-sm font-medium">Select Columns to Process</Label>
              <div className="space-x-2">
                <Button 
                  type="button" 
                  size="sm" 
                  variant="outline" 
                  onClick={selectAllColumns}
                  disabled={processingStatus?.isProcessing || false}
                >
                  Select All
                </Button>
                <Button 
                  type="button" 
                  size="sm" 
                  variant="outline" 
                  onClick={deselectAllColumns}
                  disabled={processingStatus?.isProcessing || false}
                >
                  Deselect All
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mt-2">
              {columns.map((column) => (
                <div key={column} className="flex items-center space-x-2">
                  <Checkbox 
                    id={`column-${column}`} 
                    checked={selectedColumns.includes(column)}
                    onCheckedChange={() => toggleColumnSelection(column)}
                    disabled={processingStatus?.isProcessing || false}
                  />
                  <Label 
                    htmlFor={`column-${column}`}
                    className="text-sm cursor-pointer"
                  >
                    {column}
                  </Label>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Selected {selectedColumns.length} of {columns.length} columns
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          <Button 
            type="submit" 
            disabled={!file || selectedColumns.length === 0 || processingStatus?.isProcessing || false}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload & Process
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="destructive"
            onClick={handleClearData}
            disabled={processingStatus?.isProcessing || false}
          >
            {isClearing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Clearing...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear All Data
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleResetIndex}
            disabled={processingStatus?.isProcessing || false}
            className="border-amber-500 text-amber-700 hover:bg-amber-50"
          >
            {isResetting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Resetting...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reset Index
              </>
            )}
          </Button>
        </div>
      </form>

      <div className="mt-2 text-xs text-gray-500">
        <p>
          <strong>Having dimension errors?</strong> Use the "Reset Index" button to fix vector dimension mismatches.
        </p>
      </div>
    </div>
  )
}
