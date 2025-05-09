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

    // Extract the last user message for context retrieval
    const lastUserMessage = messages[messages.length - 1].content

    // Get relevant context first before streaming
    let relevantContext: ContextItem[] = []
    try {
      console.log("Retrieving relevant context for:", lastUserMessage)
      relevantContext = await findRelevantContent(lastUserMessage)
      console.log(`Found ${relevantContext.length} relevant context items`)
    } catch (error) {
      console.error("Error retrieving context:", error)
      // Continue without context if retrieval fails
      relevantContext = []
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

      // For the first chat interaction, don't use history
      // Avoid the error "First content should be with role 'user', got model"
      let chat;
      
      // Check if this is the first message or if we have previous history
      const previousUserMessages = messages.filter((m: ChatMessage) => 
        m.role === "user" && m.id !== messages[messages.length - 1].id
      );
      
      if (previousUserMessages.length === 0) {
        // First interaction - no history needed
        console.log("First interaction - starting chat without history");
        chat = model.startChat();
      } else {
        // We have prior messages - create a simplified history
        // Just take the most recent user-assistant exchange if available
        console.log("Creating chat with simplified history");
        
        // Find the latest user message before the current one
        const prevUserMessage = previousUserMessages[previousUserMessages.length - 1];
        
        // Find the assistant response to that message if it exists
        const assistantIndex = messages.findIndex((m: ChatMessage) => m.id === prevUserMessage.id);
        const prevAssistantMessage = assistantIndex >= 0 && assistantIndex + 1 < messages.length - 1 
          ? messages[assistantIndex + 1] 
          : null;
        
        // Create a simple history with just one exchange to avoid errors
        const history = [
          {
            role: "user",
            parts: [{ text: prevUserMessage.content }]
          }
        ];
        
        // Only add assistant message if we found a valid one
        if (prevAssistantMessage && prevAssistantMessage.role === "assistant") {
          history.push({
            role: "model",
            parts: [{ text: prevAssistantMessage.content }]
          });
        }
        
        chat = model.startChat({ history });
      }
      
      // Prepare the final prompt with system message + user query
      const finalPrompt = `${systemPrompt}\n\nUser query: ${lastUserMessage}`
      
      // Send the message and get a response
      console.log("Sending message to Gemini");
      const result = await chat.sendMessage(finalPrompt);
      const text = await result.response.text();
      console.log("Received response from Gemini");
      
      // Create a proper format for Vercel AI SDK
      // The Vercel AI SDK expects a specific format with "data: " prefix for each line
      const encoder = new TextEncoder();
      
      // Format the response in the exact format expected by the Vercel AI SDK
      return new Response(
        encoder.encode(
          // Start with open delimiter
          `data: ${JSON.stringify({ type: "open", content: "" })}\n\n` +
          // Then add a chunk with the full response text
          `data: ${JSON.stringify({ type: "chunk", content: text })}\n\n` +
          // End with close delimiter
          `data: ${JSON.stringify({ type: "close", content: "" })}\n\n`
        ),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        }
      );
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
