"use client"

import type React from "react"

import { useState, useRef, useEffect, useCallback } from "react"
import { useChat, type Message } from "ai/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Send, AlertCircle, RefreshCw, Trash2, AlertTriangle, Bot } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import type { ProcessingStatus } from "@/lib/file-processing-status"
import ReactMarkdown from 'react-markdown'

// Define types for different message sources
type MessageSource = 'ai' | 'system-error' | 'model-error' | 'user' | 'no-data-found';

// Enhanced message type with source information
interface EnhancedMessage extends Message {
  source: MessageSource;
}

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
  const [isCustomHandling, setIsCustomHandling] = useState(false)
  const [fallbackMessages, setFallbackMessages] = useState<Message[]>([])
  const [lastQuery, setLastQuery] = useState<string>("")
  const [enhancedMessages, setEnhancedMessages] = useState<EnhancedMessage[]>([])
  const [jsonBuffer, setJsonBuffer] = useState<string>("")

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
          "# Welcome to InventBot! 👋\n\nI'm your intelligent Inventory Analyst assistant. Ask me questions about your inventory in **English** or **Indonesian**.\n\n## Example questions:\n\n- Where is material `KRC161282/2` located?\n- What quantities of `ABC123` do we have?\n- Show inventory in warehouse `IDMRD51`\n- Berapa jumlah material `XYZ789`?\n- Lokasi dan qty material `KRC161282/2`\n\nI'll provide formatted responses with tables and lists for better readability.",
      },
    ],
    onError: (error) => handleErrorWithContext(error, messages, setMessages),
    onResponse: async (response) => {
      // Clear local error when we get a successful response
      setLocalError(null)
      
      try {
        // Clone the response so we can read it multiple times
        const clonedResponse = response.clone()
        
        // Try to parse the response body
        const text = await clonedResponse.text()
        let data
        
        try {
          // Attempt to parse the complete response
          data = JSON.parse(text)
        } catch (jsonError) {
          // If direct parsing fails, try adding to our buffer and parsing that
          const updatedBuffer = jsonBuffer + text
          setJsonBuffer(updatedBuffer)
          
          try {
            // Try to parse the complete buffer
            data = JSON.parse(updatedBuffer)
            
            // If successful, clear the buffer
            setJsonBuffer("")
          } catch (bufferError) {
            // If still not valid JSON, check if it's a complete text response without JSON structure
            if (updatedBuffer.trim() && !updatedBuffer.startsWith('{') && !updatedBuffer.includes('{"text":')) {
              // This might be a direct text response - handle as plain text
              data = { text: updatedBuffer.trim() }
              setJsonBuffer("")
            } else {
              // Try to recover any valid JSON from the buffer by cleaning it
              try {
                // Look for a JSON-like pattern in the buffer
                const jsonMatch = updatedBuffer.match(/\{.*\}/s);
                if (jsonMatch && jsonMatch[0]) {
                  // If we found something that looks like JSON, try to parse it
                  data = JSON.parse(jsonMatch[0]);
                  setJsonBuffer("");
                } else {
                  // If no valid JSON pattern, keep buffering
                  console.log("Buffering incomplete JSON chunk, waiting for more data...");
                  return;
                }
              } catch (recoveryError) {
                // If all recovery attempts fail, keep the buffer for the next chunk
                console.log("Buffering incomplete JSON chunk, waiting for more data...");
                return;
              }
            }
          }
        }
        
        // If we have text in the response, manually add it as a message
        if (data && data.text) {
          // Signal that we're handling this response manually
          setIsCustomHandling(true)
          
          // Wait a short time to ensure any pending message updates are processed
          setTimeout(() => {
            // Create a new message ID
            const messageId = Math.random().toString(36).substring(2, 12)
            
            // Check if the response indicates "not found" and mark it as such
            const isNoDataFound = 
              (data.text.includes("couldn't find any data about") || 
               data.text.includes("tidak dapat menemukan data tentang") ||
               data.text.includes("tidak ditemukan")) &&
              !data.text.includes(" is at ");
              
            // Add the message manually with appropriate source
            setMessages((currentMessages) => {
              // Only add if there isn't already a matching assistant message at the end
              const lastMessage = currentMessages[currentMessages.length - 1]
              if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content === data.text) {
                return currentMessages
              }
              
              return [
                ...currentMessages,
                {
                  id: messageId,
                  role: "assistant",
                  content: data.text,
                },
              ]
            })
            
            // Add the enhanced message with the appropriate source
            addEnhancedMessage({
              id: messageId,
              role: "assistant",
              content: data.text,
              source: isNoDataFound ? 'no-data-found' : 'ai'
            });
            
            // Reset the custom handling flag
            setIsCustomHandling(false)
          }, 100)
        }
      } catch (e) {
        console.error("Error parsing response:", e)
        // Let the default handler try to handle it
      }
    },
    body: {},
  })
  
  // Initialize enhancedMessages with the initial welcome message
  useEffect(() => {
    if (messages.length === 1 && messages[0].id === "welcome") {
      setEnhancedMessages([{
        ...messages[0],
        source: 'ai'
      }]);
    }
  }, []);

  // Update enhancedMessages whenever messages change
  useEffect(() => {
    // Convert standard messages to enhanced messages
    // Skip if we're doing custom handling
    if (isCustomHandling) return;
    
    setEnhancedMessages(prevEnhanced => {
      // Map existing messages to enhanced messages
      // But preserve any existing source information
      const newEnhanced = messages.map(msg => {
        // Find if this message already exists in our enhanced collection
        const existingEnhanced = prevEnhanced.find(e => e.id === msg.id);
        
        if (existingEnhanced) {
          // Keep the existing source if already set
          return existingEnhanced;
        } else {
          // For new messages, assign a source based on role
          return {
            ...msg,
            source: msg.role === 'user' ? 'user' : 'ai' as MessageSource
          } as EnhancedMessage;
        }
      });
      
      return newEnhanced;
    });
  }, [messages, isCustomHandling]);

  // Helper to add an enhanced message
  const addEnhancedMessage = (message: EnhancedMessage) => {
    setEnhancedMessages(prev => {
      // Check if this message already exists
      if (prev.some(m => m.id === message.id)) {
        return prev;
      }
      return [...prev, message];
    });
  };

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
      console.log("Parsing error detected - adding as model error")
      
      // Get the last user message, prioritizing the lastQuery state which is more reliable
      const queryText = lastQuery || 
                        (currentMessages.findLast(m => m.role === 'user')?.content || "your query")
      
      // Improved language detection - more robust patterns for Indonesian and other languages
      const isIndonesian = /[^\x00-\x7F]/.test(queryText) || 
                          /berapa|jenis|ada|pada|dimana|lokasi|beritahu|aku|beserta|tidak|bisa|dapat|diketahui/.test(queryText.toLowerCase())
      
      // First, try to recover from the buffer if possible
      if (jsonBuffer && jsonBuffer.length > 5) {
        try {
          // Try several approaches to extract valid JSON
          let extractedJson = null;
          
          // Try to find complete JSON objects
          const jsonMatch = jsonBuffer.match(/\{.*\}/s);
          if (jsonMatch && jsonMatch[0]) {
            try {
              extractedJson = JSON.parse(jsonMatch[0]);
            } catch (e) {
              // Try to clean the JSON and parse again
              const cleanedJson = jsonMatch[0]
                .replace(/\\(?!["\\/bfnrt])/g, '\\\\') // Fix escaped backslashes
                .replace(/([^\\])"/g, '$1\\"')         // Fix unescaped quotes
                .replace(/^([^{]*)({.*})(.*$)/s, '$2');  // Extract just the JSON part
              
              try {
                extractedJson = JSON.parse(cleanedJson);
              } catch (e2) {
                // Last resort: manual extraction
                const textMatch = jsonBuffer.match(/"text"\s*:\s*"([^"]*)"/);
                if (textMatch && textMatch[1]) {
                  extractedJson = { text: textMatch[1] };
                }
              }
            }
          }
          
          // If we successfully extracted some valid data
          if (extractedJson && extractedJson.text) {
            // Clear the buffer
            setJsonBuffer("");
            
            // Add the recovered message
            addEnhancedMessage({
              id: `recovered-${Date.now()}`,
              role: 'assistant',
              content: extractedJson.text,
              source: 'ai'
            });
            
            // Log the recovery
            console.log("Successfully recovered response from buffer");
            return;
          }
        } catch (e) {
          console.log("Failed to recover response from buffer:", e);
          // Continue with fallback response
        }
      }
      
      // Clear the buffer since we're now handling this as an error
      setJsonBuffer("");
      
      let fallbackContent = ""
      if (isIndonesian) {
        // More specific Indonesian fallback message for material queries
        if (queryText.toLowerCase().includes("material") || queryText.toLowerCase().includes("lokasi") || /[A-Z0-9]{3,}/.test(queryText)) {
          fallbackContent = `Maaf, saya mengalami masalah saat mencari material "${queryText.replace(/lokasi|dimana|berada|beritahu|aku/gi, '').trim()}". Pastikan kode material yang Anda masukkan benar dan ada di database inventaris. Coba pertanyaan lain atau perbaiki kode material.`
        } else {
          fallbackContent = `Pertanyaan Anda "${queryText}" terdeteksi, tetapi saya mengalami masalah saat memformat respons. Silakan coba ungkapkan pertanyaan Anda dengan cara yang berbeda atau periksa data inventaris Anda.`
        }
      } else {
        // More specific English fallback message for material queries
        if (queryText.toLowerCase().includes("material") || queryText.toLowerCase().includes("location") || /[A-Z0-9]{3,}/.test(queryText)) {
          fallbackContent = `Sorry, I had trouble finding material "${queryText.replace(/where|is|location|of/gi, '').trim()}". Please verify the material code is correct and exists in your inventory database. Try another question or correct the material code.`
        } else {
          fallbackContent = `I found your query about "${queryText}" but encountered a formatting issue. Please try rephrasing your question.`
        }
      }
      
      // Add as a model error message
      addEnhancedMessage({
        id: `model-error-${Date.now()}`,
        role: 'assistant',
        content: fallbackContent,
        source: 'model-error'
      })
      
      // Also add a specific error message for debugging if in development
      if (process.env.NODE_ENV === 'development') {
        addEnhancedMessage({
          id: `system-error-${Date.now()}`,
          role: 'assistant',
          content: `Failed to parse stream response. Error: ${error.message}`,
          source: 'system-error'
        })
      }
      
      // Show a more helpful toast message
      toast({
        title: "Response Format Error",
        description: "There was an issue with the response format from the AI model.",
        variant: "destructive",
      })
    } else {
      // For other errors, show a system error message
      addEnhancedMessage({
        id: `system-error-${Date.now()}`,
        role: 'assistant',
        content: error.message || "An unknown error occurred while processing your request.",
        source: 'system-error'
      });
      
      // For other errors, show the original error
      toast({
        title: "Chat Error",
        description: error.message || "An error occurred while processing your request.",
        variant: "destructive",
      })
    }
  }, [lastQuery, toast, jsonBuffer, addEnhancedMessage])

  // The legacy handleError function that calls the new one
  const handleError = useCallback((error: Error) => {
    handleErrorWithContext(error, messages, setMessages);
  }, [handleErrorWithContext, messages, setMessages])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [enhancedMessages])

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
    
    const trimmedInput = inputValue.trim();
    if (trimmedInput && !isLoading) {
      try {
        // Store the query for potential error handling
        setLastQuery(trimmedInput);
        
        // Check for duplicate queries
        const isDuplicateQuery = 
          messages.length >= 2 && 
          messages[messages.length - 2].role === 'user' && 
          messages[messages.length - 2].content === trimmedInput;
        
        if (isDuplicateQuery) {
          toast({
            description: "You just sent the same message. The AI will still respond, but consider rephrasing for better results.",
          });
        }
        
        // Submit the form
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
    // Remove the last system error message
    setEnhancedMessages(prev => {
      const lastErrorIndex = [...prev].reverse().findIndex(m => m.source === 'system-error');
      if (lastErrorIndex >= 0) {
        const newMessages = [...prev];
        newMessages.splice(prev.length - 1 - lastErrorIndex, 1);
        return newMessages;
      }
      return prev;
    });
    
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
      addEnhancedMessage({
        id: `model-error-${Date.now()}`,
        role: 'assistant',
        content: `I found your query about "${lastUserMessage.content}" in our database, but had trouble formatting the response. Please try rephrasing your question or check your inventory data.`,
        source: 'model-error'
      });
      
      // Clear the error
      setLocalError(null)
      
      // Also log this event to help with debugging
      console.log(`Applied fallback response for query: "${lastUserMessage.content}"`)
    }
  }

  // Ensure the error gets cleared when a new message comes in
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      // Clear any errors when we receive a new assistant message
      setLocalError(null);
    }
  }, [messages]);

  // Add a function to clear the chat history
  const handleClearChat = useCallback(() => {
    // Keep only the welcome message
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content:
          "# Welcome to InventBot! 👋\n\nI'm your intelligent Inventory Analyst assistant. Ask me questions about your inventory in **English** or **Indonesian**.\n\n## Example questions:\n\n- Where is material `KRC161282/2` located?\n- What quantities of `ABC123` do we have?\n- Show inventory in warehouse `IDMRD51`\n- Berapa jumlah material `XYZ789`?\n- Lokasi dan qty material `KRC161282/2`\n\nI'll provide formatted responses with tables and lists for better readability.",
      },
    ]);
    
    // Reset enhanced messages
    setEnhancedMessages([{
      id: "welcome",
      role: "assistant",
      content: "# Welcome to InventBot! 👋\n\nI'm your intelligent Inventory Analyst assistant. Ask me questions about your inventory in **English** or **Indonesian**.\n\n## Example questions:\n\n- Where is material `KRC161282/2` located?\n- What quantities of `ABC123` do we have?\n- Show inventory in warehouse `IDMRD51`\n- Berapa jumlah material `XYZ789`?\n- Lokasi dan qty material `KRC161282/2`\n\nI'll provide formatted responses with tables and lists for better readability.",
      source: 'ai'
    }]);
    
    // Clear any errors
    setLocalError(null);
    
    // Show a toast notification
    toast({
      title: "Chat Cleared",
      description: "The conversation has been reset.",
    });
  }, [setMessages, toast]);

  // Add keyboard shortcut (Escape to clear input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Clear input on Escape
      if (e.key === 'Escape' && document.activeElement === document.querySelector('input')) {
        setInputValue('');
      }
      
      // Clear chat on Ctrl+Shift+Delete
      if (e.key === 'Delete' && e.ctrlKey && e.shiftKey) {
        handleClearChat();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClearChat]);

  // Helper to dismiss the last error
  const dismissLastError = () => {
    // Remove the last system error message
    setEnhancedMessages(prev => {
      const lastErrorIndex = [...prev].reverse().findIndex(m => m.source === 'system-error');
      if (lastErrorIndex >= 0) {
        const newMessages = [...prev];
        newMessages.splice(prev.length - 1 - lastErrorIndex, 1);
        return newMessages;
      }
      return prev;
    });
    
    // Also clear the local error state
    setLocalError(null);
  };

  const showError = Boolean(error || localError);

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

  // Function to render a message based on its source
  const renderMessage = (message: EnhancedMessage) => {
    // Base styling for different message types
    const getMessageStyles = () => {
      // Base styles
      const baseStyles = "px-4 py-3 rounded-lg mb-3 max-w-[85%] border-2 whitespace-pre-wrap"
      
      // User message styles - make more flat and high contrast
      if (message.role === "user") {
        return cn(
          baseStyles,
          "ml-auto bg-primary text-primary-foreground border-primary",
          "shadow-sm"
        )
      }
      
      // AI message styles based on source
      if (message.source === "ai") {
        return cn(
          baseStyles,
          "mr-auto bg-white text-black border-slate-300",
          "shadow-sm"
        )
      }
      
      if (message.source === "system-error") {
        return cn(
          baseStyles,
          "mr-auto bg-destructive/10 text-destructive border-destructive",
          "shadow-sm"
        )
      }
      
      if (message.source === "model-error") {
        return cn(
          baseStyles,
          "mr-auto bg-amber-50 text-amber-900 border-amber-500",
          "shadow-sm"
        )
      }
      
      if (message.source === "no-data-found") {
        return cn(
          baseStyles,
          "mr-auto bg-slate-50 text-slate-700 border-slate-300",
          "shadow-sm"
        )
      }
      
      // Default assistant styles
      return cn(
        baseStyles,
        "mr-auto bg-white text-black border-slate-300",
        "shadow-sm"
      )
    };
    
    // Get appropriate avatar for different message sources
    const getAvatar = () => {
      switch (message.source) {
        case 'ai':
          return (
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground">AI</AvatarFallback>
            </Avatar>
          );
        case 'model-error':
          return (
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-amber-200 text-amber-800">
                <Bot className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
          );
        case 'system-error':
          return (
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-red-200 text-red-800">
                <AlertTriangle className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
          );
        case 'no-data-found':
          return (
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-orange-200 text-orange-800">
                <AlertCircle className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
          );
        case 'user':
          return (
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-gray-200">U</AvatarFallback>
            </Avatar>
          );
        default:
          return null;
      }
    };
    
    // Format message content if it's from the AI
    const formatMessageContent = () => {
      if (message.role === "assistant") {
        return (
          <ReactMarkdown components={{
            p: ({ children }) => <p className="my-1.5">{children}</p>,
            h1: ({ children }) => <h1 className="text-xl font-bold my-2">{children}</h1>,
            h2: ({ children }) => <h2 className="text-lg font-bold my-2">{children}</h2>,
            ul: ({ children }) => <ul className="my-1 pl-6 list-disc">{children}</ul>,
            li: ({ children }) => <li className="my-0.5">{children}</li>,
            table: ({ children }) => <table className="table-auto border-collapse my-2">{children}</table>,
            th: ({ children }) => <th className="border border-slate-300 px-2 py-1 bg-slate-100">{children}</th>,
            td: ({ children }) => <td className="border border-slate-300 px-2 py-1">{children}</td>,
            code: ({ children }) => <code className="bg-slate-100 px-1 py-0.5 rounded text-sm">{children}</code>
          }}>
            {message.content}
          </ReactMarkdown>
        )
      }
      return message.content
    }

    return (
      <div
        id={`message-${message.id}`}
        className={cn(
          "flex items-start gap-2 mx-0",
          message.role === "user" ? "justify-end" : "justify-start"
        )}
      >
        {message.source !== "user" && getAvatar()}
        <div
          className={getMessageStyles()}
        >
          {formatMessageContent()}
          
          {/* Add retry/dismiss buttons for system errors */}
          {message.source === 'system-error' && (
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="outline" onClick={handleRetry} className="bg-white">
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry
              </Button>
              <Button size="sm" variant="outline" onClick={dismissLastError} className="bg-white">
                Dismiss
              </Button>
            </div>
          )}
        </div>
        {message.role === "user" && getAvatar()}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[600px]">
      <div className="flex justify-between items-center border-b p-2">
        <h3 className="text-sm font-medium">Inventory Analyst Chat</h3>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleClearChat}
          title="Clear chat history"
          className="text-gray-500 hover:text-red-500"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          <span className="text-xs">Clear Chat</span>
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {enhancedMessages.map(renderMessage)}

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
