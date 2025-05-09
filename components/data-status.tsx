"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"

interface DataStatusProps {
  initialStatus?: boolean;
  hasError?: boolean;
}

export function DataStatus({ initialStatus = false, hasError = false }: DataStatusProps) {
  const [dataExists, setDataExists] = useState<boolean>(initialStatus)

  useEffect(() => {
    async function checkStatus() {
      try {
        const response = await fetch('/api/data-status')
        if (response.ok) {
          const { exists } = await response.json()
          setDataExists(exists)
        }
      } catch (error) {
        console.error('Error checking data status:', error)
      }
    }

    checkStatus()
  }, [])

  if (hasError) {
    return (
      <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded">
        <h3 className="font-medium">Database Connection Error</h3>
        <p className="text-sm">Unable to check data status. There might be an issue with your vector database connection.</p>
      </div>
    )
  }

  return (
    <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded">
      <h3 className="font-medium">Data Status</h3>
      <p className="text-sm">
        {dataExists
          ? 'Inventory data is available for analysis.'
          : 'No inventory data has been uploaded yet.'}
      </p>
    </div>
  )
}
