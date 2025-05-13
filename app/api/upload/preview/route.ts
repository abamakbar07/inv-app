import { type NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    
    if (!file) {
      return NextResponse.json(
        {
          success: false,
          message: "No file provided",
        },
        { status: 400 }
      )
    }
    
    // Process the file based on its type
    const fileType = file.name.split(".").pop()?.toLowerCase()
    
    if (fileType !== "csv" && fileType !== "xlsx" && fileType !== "xls") {
      return NextResponse.json(
        {
          success: false,
          message: "Unsupported file type. Please upload a CSV or Excel file.",
        },
        { status: 400 }
      )
    }
    
    // Convert file to array buffer
    const buffer = await file.arrayBuffer()
    let data: any[] = []
    let columns: string[] = []
    
    try {
      // Use XLSX to parse both CSV and Excel files
      const workbook = XLSX.read(buffer, { type: "array" })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      
      // Convert to JSON
      data = XLSX.utils.sheet_to_json(worksheet)
      
      // Limit preview data to first 10 rows to keep response size small
      const previewData = data.slice(0, 10)
      
      // Extract columns from the first row
      if (data.length > 0) {
        columns = Object.keys(data[0])
      }
      
      return NextResponse.json({
        success: true,
        data: previewData,
        columns: columns,
        totalRows: data.length
      })
    } catch (error) {
      console.error("Error parsing file:", error)
      return NextResponse.json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Failed to parse file",
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error("Upload preview API error:", error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "An unknown error occurred",
      },
      { status: 500 }
    )
  }
} 