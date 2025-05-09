import { GoogleGenerativeAI } from "@google/generative-ai"
import { Message } from "ai"
import { checkDataExists, findRelevantContent } from "@/lib/upstash"

export const maxDuration = 60 // Increase timeout to 60 seconds

// Type for context items from Upstash
interface ContextItem {
  id: string | number;
  metadata?: {
    content?: string;
  };
  score?: number;
}

// Interface for chat messages
interface ChatMessage {
  id: string;
  role: string;
  content: string;
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: ChatMessage[] } = await req.json()

    // Check if data exists in Upstash
    const dataExists = await checkDataExists()

    if (!dataExists) {
      return new Response(
        JSON.stringify({
          error: "No data available. Please upload inventory data first.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    // Extract only the last user message - don't send entire history to the model
    const lastUserMessage = messages[messages.length - 1].content

    // Get relevant context first before streaming
    let relevantContext: ContextItem[] = []
    try {
      console.log("Retrieving relevant context for:", lastUserMessage)
      relevantContext = await findRelevantContent(lastUserMessage)
      console.log(`Found ${relevantContext.length} relevant context items`)
      
      // If no relevant context found, we should provide a specific message
      if (relevantContext.length === 0) {
        console.log("No relevant context found, but proceeding with empty context")
      }
    } catch (error) {
      console.error("Error retrieving context:", error)
      // Instead of continuing with empty context, we'll return an error response
      return new Response(
        JSON.stringify({
          error: `Error retrieving context: ${error instanceof Error ? error.message : "Unknown error"}. Please try again.`,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }

    // Format the context for the prompt, with careful null/undefined checks
    const contextText =
      relevantContext && relevantContext.length > 0
        ? relevantContext
            .map((item, index) => {
              // Safely access nested properties
              const content = item?.metadata?.content || "No content available"
              return `Context ${index + 1}:\n${content}`
            })
            .join("\n\n")
        : "No relevant context found in the inventory data."

    // Create a system prompt with the context
    const systemPrompt = `You are an Inventory Analyst AI assistant. You help users analyze and understand their inventory data.
    Only answer questions based on the provided context from the user's inventory data.
    If you don't have relevant information in the context, say "I don't have enough information about that in your inventory data."
    Be concise, helpful, and accurate.
    
    Important: You can respond in multiple languages. If the user asks in a language other than English, 
    respond in the same language they used for their query.
    
    Here is the relevant inventory data context:
    ${contextText}`

    try {
      // Initialize the Gemini API
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "")
      
      // Use the model with free tier quota instead of the preview version
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-pro-exp-03-25", // Use the Experimental model with free tier
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 1024,
        },
      })

      // Don't use chat history - this is a stateless implementation
      // Create a fresh chat for each query
      const chat = model.startChat();
      
      // Prepare the final prompt with system message + user query
      const finalPrompt = `${systemPrompt}\n\nUser query: ${lastUserMessage}`
      
      // Send the message and get a response
      console.log("Sending message to Gemini");
      const result = await chat.sendMessage(finalPrompt);
      const text = await result.response.text();
      console.log("Received response from Gemini");
      
      // Use a safe JSON.stringify approach to ensure valid JSON
      const responseObj = { text };
      const safeJsonString = JSON.stringify(responseObj);
      
      // Return the response as properly formatted JSON
      return new Response(safeJsonString, { 
        status: 200,
        headers: { 
          "Content-Type": "application/json"
        }
      });
      
    } catch (error) {
      console.error("Error generating response:", error)
      return new Response(
        JSON.stringify({
          error: `Error generating response: ${error instanceof Error ? error.message : "Unknown error"}`,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }
  } catch (error) {
    console.error("Error in chat API:", error)
    return new Response(
      JSON.stringify({
        error: `An error occurred while processing your request: ${error instanceof Error ? error.message : "Unknown error"}. Please try again later.`,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
}
