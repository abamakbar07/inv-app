"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"

export function DataStatus({ initialStatus = false }: { initialStatus?: boolean }) {
  const [dataExists, setDataExists] = useState(initialStatus)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const checkStatus = async () => {
      setIsLoading(true)
      try {
        const response = await fetch("/api/data-status")
        const data = await response.json()
        setDataExists(data.dataExists)
      } catch (error) {
        console.error("Error checking data status:", error)
      } finally {
        setIsLoading(false)
      }
    }

    checkStatus()
  }, [])

  return (
    <div className="mb-4">
      <p className="text-sm font-medium mb-2">Data Status:</p>
      {isLoading ? (
        <Badge variant="outline" className="bg-gray-100">
          Checking...
        </Badge>
      ) : dataExists ? (
        <Badge variant="default" className="bg-green-500">
          Data Available
        </Badge>
      ) : (
        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
          No Data Available
        </Badge>
      )}
    </div>
  )
}
