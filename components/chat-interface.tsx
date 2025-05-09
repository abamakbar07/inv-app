"use client"

import type React from "react"

import { useState, useRef, useEffect, useCallback } from "react"
import { useChat, type Message } from "ai/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Send, AlertCircle, RefreshCw } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import type { ProcessingStatus } from "@/lib/file-processing-status"

export default function ChatInterface({ 
  dataExists = false,
  hasError = false 
}: { 
  dataExists?: boolean;
  hasError?: boolean;
}) {
  const [inputValue, setInputValue] = useState("")
  const [localError, setLocalError] = useState<Error | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null)
  const [isCustomHandling, setIsCustomHandling] = useState(false);
  const [fallbackMessages, setFallbackMessages] = useState<Message[]>([]);

  // Fetch processing status periodically
  useEffect(() => {
    // Track if component is mounted
    let isMounted = true;
    let pollingActive = false;
    let interval: NodeJS.Timeout | null = null;
    
    const fetchStatus = async () => {
      try {
        if (!isMounted) return;
        
        const response = await fetch("/api/processing-status")
        if (response.ok) {
          const status = await response.json()
          setProcessingStatus(status)
          
          // If no longer processing, stop the frequent polling
          if (!status.isProcessing && pollingActive) {
            if (interval) clearInterval(interval);
            pollingActive = false;
            
            // Check once every 15 seconds when idle
            interval = setInterval(fetchStatus, 15000);
          } else if (status.isProcessing && !pollingActive) {
            // If processing started, increase polling frequency
            if (interval) clearInterval(interval);
            pollingActive = true;
            
            // Check every 3 seconds during active processing
            interval = setInterval(fetchStatus, 3000);
          }
        }
      } catch (error) {
        console.error("Error fetching processing status:", error)
      }
    }

    // Initial fetch
    fetchStatus()
    
    // Initial polling interval (less frequent)
    interval = setInterval(fetchStatus, 15000)

    // Cleanup function
    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    }
  }, [])

  // First, define the chat hook
  const { messages, input, handleInputChange, handleSubmit, isLoading, error, reload, setMessages } = useChat({
    api: "/api/chat",
    initialMessages: [
      {
        id: "welcome",
        role: "assistant",
        content:
          "Hello! I'm your Inventory Analyst assistant. Ask me anything about your inventory data, and I'll help you analyze it.",
      },
    ],
    onError: (error) => handleErrorWithContext(error, messages, setMessages),
    onResponse: async (response) => {
      // Clear local error when we get a successful response
      if (response.status === 200) {
        setLocalError(null)
        
        try {
          // Try to parse the response as JSON
          const data = await response.clone().json();
          
          // If we have text in the response, manually add it as a message
          if (data && data.text) {
            // Signal that we're handling this response manually
            setIsCustomHandling(true);
            
            // Wait a short time to ensure any pending message updates are processed
            setTimeout(() => {
              // Create a new message ID
              const messageId = Math.random().toString(36).substring(2, 12);
              
              // Add the message manually
              setMessages((currentMessages) => {
                // Only add if there isn't already a matching assistant message at the end
                const lastMessage = currentMessages[currentMessages.length - 1];
                if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content === data.text) {
                  return currentMessages;
                }
                
                return [
                  ...currentMessages,
                  {
                    id: messageId,
                    role: "assistant",
                    content: data.text,
                  },
                ];
              });
              
              // Reset the custom handling flag
              setIsCustomHandling(false);
            }, 100);
          }
        } catch (e) {
          console.error("Error parsing response:", e);
          // Let the default handler try to handle it
        }
      } else {
        // Handle non-200 responses
        setLocalError(new Error(`Server returned status ${response.status}`))
      }
    },
    body: {},
  })

  // Then define the error handler function that uses the context
  const handleErrorWithContext = useCallback((error: Error, currentMessages: Message[], setCurrentMessages: (messages: Message[]) => void) => {
    console.error("Chat error:", error)
    setLocalError(error)
    
    // Check if it's a stream parsing error or JSON parsing error
    if (
      error.message.includes("parse stream") || 
      error.message.includes("Invalid code") ||
      error.message.includes("JSON")
    ) {
      console.log("Parsing error detected - trying fallback response")
      // Get the last user message
      const lastUserMessage = currentMessages.findLast(m => m.role === 'user')
      
      // Add a fallback response based on the query language
      if (lastUserMessage) {
        // Simple language detection - check if it contains non-Latin characters or common non-English words
        const isNonEnglish = /[^\x00-\x7F]/.test(lastUserMessage.content) || 
                            /berapa|jenis|ada|pada/.test(lastUserMessage.content);
        
        let fallbackContent = "";
        if (isNonEnglish) {
          fallbackContent = `Pertanyaan Anda "${lastUserMessage.content}" terdeteksi, tetapi saya mengalami masalah saat memformat respons. Silakan coba ungkapkan pertanyaan Anda dengan cara yang berbeda atau periksa data inventaris Anda.`;
        } else {
          fallbackContent = `I found your query about "${lastUserMessage.content}" but encountered a formatting issue. Please try rephrasing your question.`;
        }
        
        // Create fallback response
        const fallbackResponse: Message = {
          id: `fallback-${Date.now()}`,
          role: 'assistant',
          content: fallbackContent
        }
        
        // Set the message and clear the error
        setCurrentMessages([...currentMessages, fallbackResponse])
        setLocalError(null)
      }
      
      // Show a more helpful toast message
      toast({
        title: "Response Format Error",
        description: "There was an issue with the response format. Using fallback response.",
        variant: "destructive",
      })
    } else {
      // For other errors, show the original error
      toast({
        title: "Chat Error",
        description: error.message || "An error occurred while processing your request.",
        variant: "destructive",
      })
    }
  }, [toast])

  // The legacy handleError function that calls the new one
  const handleError = useCallback((error: Error) => {
    handleErrorWithContext(error, messages, setMessages);
  }, [handleErrorWithContext, messages, setMessages])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Clear any existing errors
    setLocalError(null)
    
    // Don't allow submitting if file processing is happening
    if (processingStatus?.isProcessing) {
      toast({
        title: "Processing in progress",
        description: "Please wait until file processing is complete before sending messages.",
        variant: "destructive",
      })
      return
    }
    
    if (inputValue.trim() && !isLoading) {
      try {
        handleSubmit(e)
        setInputValue("")
      } catch (err) {
        handleError(err instanceof Error ? err : new Error("Failed to send message"))
      }
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
    setLocalError(null)
    if (reload) {
      try {
        reload()
      } catch (err) {
        handleError(err instanceof Error ? err : new Error("Failed to retry"))
      }
    }
  }

  // Manual fallback for when an AI response fails
  const handleManualFallback = () => {
    // Get the last user message
    const lastUserMessage = messages.findLast(m => m.role === 'user')
    
    if (lastUserMessage) {
      // Add a more helpful fallback response with context
      const fallbackResponse: Message = {
        id: `fallback-${Date.now()}`,
        role: 'assistant',
        content: `I found your query about "${lastUserMessage.content}" in our database, but had trouble formatting the response. Please try rephrasing your question or check your inventory data.`
      }
      
      // Set the message and clear the error
      setMessages([...messages, fallbackResponse])
      setLocalError(null)
      
      // Also log this event to help with debugging
      console.log(`Applied fallback response for query: "${lastUserMessage.content}"`)
    }
  }

  if (hasError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Database Connection Error</AlertTitle>
          <AlertDescription>
            There's an issue connecting to the vector database. Please check your database configuration and try again.
          </AlertDescription>
        </Alert>
      </div>
    )
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

        {isLoading && !processingStatus?.isProcessing && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="text-sm">Analyzing inventory data...</p>
          </div>
        )}

        {processingStatus?.isProcessing && (
          <div className="flex items-center gap-2 text-blue-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="text-sm">{processingStatus.progress?.message || "Processing file..."}</p>
          </div>
        )}

        {(error || localError) && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{(error || localError)?.message || "An error occurred while processing your request."}</span>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="outline" onClick={handleRetry} className="self-start">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
                <Button size="sm" variant="outline" onClick={handleManualFallback} className="self-start">
                  Continue anyway
                </Button>
              </div>
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
            placeholder={processingStatus?.isProcessing 
              ? "Please wait until processing completes..." 
              : "Ask about your inventory data..."}
            className="flex-1"
            disabled={isLoading || processingStatus?.isProcessing}
          />
          <Button type="submit" disabled={!inputValue.trim() || isLoading || processingStatus?.isProcessing}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </div>
    </div>
  )
}
