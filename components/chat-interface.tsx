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

// Define types for different message sources
type MessageSource = 'ai' | 'system-error' | 'model-error' | 'user';

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
  const [lastQuery, setLastQuery] = useState("")
  const [enhancedMessages, setEnhancedMessages] = useState<EnhancedMessage[]>([])

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
        // Always clear errors on successful response
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
        try {
          // Try to parse the error response as JSON
          const errorData = await response.clone().json();
          
          // Check if this is our enhanced error format
          if (errorData && errorData.error) {
            let errorMessage = errorData.error;
            const errorType = errorData.errorType || "system";
            
            setLocalError(new Error(errorMessage));
            
            // Add appropriate error message based on type
            if (errorType === "model") {
              // AI model error
              addEnhancedMessage({
                id: `model-error-${Date.now()}`,
                role: 'assistant',
                content: errorMessage,
                source: 'model-error'
              });
              
              // Also add a system error with details if available
              if (errorData.errorDetails) {
                addEnhancedMessage({
                  id: `system-error-${Date.now()}`,
                  role: 'assistant',
                  content: errorData.errorDetails,
                  source: 'system-error'
                });
              }
            } else if (errorType === "data") {
              // Data-related error (like missing inventory data)
              addEnhancedMessage({
                id: `system-error-${Date.now()}`,
                role: 'assistant',
                content: errorMessage,
                source: 'system-error'
              });
            } else {
              // System error (default)
              addEnhancedMessage({
                id: `system-error-${Date.now()}`,
                role: 'assistant',
                content: errorMessage,
                source: 'system-error'
              });
              
              // Add details if available
              if (errorData.errorDetails) {
                const detailsId = `error-details-${Date.now()}`;
                addEnhancedMessage({
                  id: detailsId,
                  role: 'assistant',
                  content: errorData.errorDetails,
                  source: 'system-error'
                });
              }
            }
          } else {
            // Fallback for non-JSON error responses
            const errorMessageContent = response.status === 400 
              ? "No data available. Please upload inventory data first."
              : `Server error (${response.status}). Please try again later.`;
            
            setLocalError(new Error(`Server returned status ${response.status}: ${response.statusText}`));
            
            addEnhancedMessage({
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: errorMessageContent,
              source: 'system-error'
            });
          }
        } catch (e) {
          // If we can't parse the JSON, just show a generic error
          console.error("Error parsing error response:", e);
          
          const errorMessageContent = `Server error (${response.status}). Please try again later.`;
          setLocalError(new Error(`Server returned status ${response.status}: ${response.statusText}`));
          
          addEnhancedMessage({
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: errorMessageContent,
            source: 'system-error'
          });
        }
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
                        (currentMessages.findLast(m => m.role === 'user')?.content || "your query");
      
      // Simple language detection - check if it contains non-Latin characters or common non-English words
      const isNonEnglish = /[^\x00-\x7F]/.test(queryText) || 
                          /berapa|jenis|ada|pada/.test(queryText);
      
      let fallbackContent = "";
      if (isNonEnglish) {
        fallbackContent = `Pertanyaan Anda "${queryText}" terdeteksi, tetapi saya mengalami masalah saat memformat respons. Silakan coba ungkapkan pertanyaan Anda dengan cara yang berbeda atau periksa data inventaris Anda.`;
      } else {
        fallbackContent = `I found your query about "${queryText}" but encountered a formatting issue. Please try rephrasing your question.`;
      }
      
      // Add as a model error message
      addEnhancedMessage({
        id: `model-error-${Date.now()}`,
        role: 'assistant',
        content: fallbackContent,
        source: 'model-error'
      });
      
      // Also add a specific error message
      addEnhancedMessage({
        id: `system-error-${Date.now()}`,
        role: 'assistant',
        content: `Failed to parse stream string. Invalid code {"text".`,
        source: 'system-error'
      });
      
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
  }, [lastQuery, toast])

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
          "Hello! I'm your Inventory Analyst assistant. Ask me anything about your inventory data, and I'll help you analyze it.",
      },
    ]);
    
    // Reset enhanced messages
    setEnhancedMessages([{
      id: "welcome",
      role: "assistant",
      content: "Hello! I'm your Inventory Analyst assistant. Ask me anything about your inventory data, and I'll help you analyze it.",
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
      switch (message.source) {
        case 'user':
          return "bg-primary text-primary-foreground";
        case 'ai':
          return "bg-muted";
        case 'model-error':
          return "bg-amber-50 border border-amber-200 text-amber-800";
        case 'system-error':
          return "bg-red-50 border border-red-200 text-red-800";
        default:
          return "bg-muted";
      }
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
    
    // Message container with appropriate styling
    return (
      <div
        key={message.id}
        className={cn(
          "flex items-start gap-3 max-w-[80%]", 
          message.source === "user" ? "ml-auto" : "",
          message.source === "system-error" ? "w-full max-w-full" : ""
        )}
      >
        {message.source !== "user" && getAvatar()}
        <div
          className={cn(
            "rounded-lg px-4 py-2 text-sm",
            getMessageStyles()
          )}
        >
          {message.content}
          
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
        {message.source === "user" && getAvatar()}
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
