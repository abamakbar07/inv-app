"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { useChat } from "ai/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Send, AlertCircle, RefreshCw } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

export default function ChatInterface({ dataExists = false }: { dataExists?: boolean }) {
  const [inputValue, setInputValue] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  const { messages, input, handleInputChange, handleSubmit, isLoading, error, reload } = useChat({
    api: "/api/chat",
    initialMessages: [
      {
        id: "welcome",
        role: "assistant",
        content:
          "Hello! I'm your Inventory Analyst assistant. Ask me anything about your inventory data, and I'll help you analyze it.",
      },
    ],
    onError: (error) => {
      console.error("Chat error:", error)
      toast({
        title: "Chat Error",
        description: error.message || "An error occurred while processing your request.",
        variant: "destructive",
      })
    },
  })

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim() && !isLoading) {
      handleSubmit(e)
      setInputValue("")
    }
  }

  // Update local state when the AI hook's input changes
  useEffect(() => {
    setInputValue(input)
  }, [input])

  // Handle local input changes and update the AI hook
  const handleLocalInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    handleInputChange(e)
  }

  const handleRetry = () => {
    if (reload) {
      reload()
    }
  }

  if (!dataExists) {
    return (
      <div className="p-6">
        <Alert variant="warning" className="bg-yellow-50 border-yellow-200">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-800">No inventory data available</AlertTitle>
          <AlertDescription className="text-yellow-700">
            Please upload your inventory data first to start chatting with the AI analyst.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[600px]">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn("flex items-start gap-3 max-w-[80%]", message.role === "user" ? "ml-auto" : "")}
          >
            {message.role !== "user" && (
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground">AI</AvatarFallback>
              </Avatar>
            )}
            <div
              className={cn(
                "rounded-lg px-4 py-2 text-sm",
                message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              {message.content}
            </div>
            {message.role === "user" && (
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-gray-200">U</AvatarFallback>
              </Avatar>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="text-sm">Analyzing inventory data...</p>
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{error.message || "An error occurred while processing your request."}</span>
              <Button size="sm" variant="outline" onClick={handleRetry} className="self-start">
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-4">
        <form onSubmit={handleFormSubmit} className="flex gap-2">
          <Input
            value={inputValue}
            onChange={handleLocalInputChange}
            placeholder="Ask about your inventory data..."
            className="flex-1"
            disabled={isLoading}
          />
          <Button type="submit" disabled={!inputValue.trim() || isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </div>
    </div>
  )
}
