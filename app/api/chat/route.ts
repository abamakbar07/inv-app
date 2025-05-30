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

// Error response interface
interface ErrorResponse {
  error: string;
  errorType?: "system" | "model" | "data";
  errorDetails?: string;
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: ChatMessage[] } = await req.json()

    // Check if data exists in Upstash
    const dataExists = await checkDataExists()

    if (!dataExists) {
      const errorResponse: ErrorResponse = {
        error: "No data available. Please upload inventory data first.",
        errorType: "data",
        errorDetails: "The vector database has no inventory records to query."
      }
      
      return new Response(
        JSON.stringify(errorResponse),
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
      const errorResponse: ErrorResponse = {
        error: `Error retrieving context: ${error instanceof Error ? error.message : "Unknown error"}. Please try again.`,
        errorType: "system",
        errorDetails: "Failed to search vector database for relevant inventory data."
      }
      
      return new Response(
        JSON.stringify(errorResponse),
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
    const systemPrompt = `You are a professional Inventory Analyst AI assistant named "InventBot". You help users analyze and understand their inventory data.
    
    ## Response Guidelines:
    1. Be concise, professional, and direct. Focus on providing accurate inventory information.
    2. Format information in an easily scannable way using:
       - Bullet points for lists of items/locations/quantities
       - Tables when presenting multiple data points (using markdown format)
       - Bold text for important values, SKUs, or quantities
    3. When presenting location and quantity data, always organize in descending order by quantity.
    
    ## Query Response Protocol:
    1. Material/SKU queries:
       - If found: List all warehouse locations and quantities in a clean table format
       - If not found: Clearly state "I couldn't find any data about [material code/name] in the inventory database."
    
    2. Location queries:
       - If found: List all materials at that location with their quantities
       - If not found: State "No inventory data found for location [location]"
    
    3. Quantity queries:
       - Present total quantities and breakdown by location
       - Use numerical representations (not spelled out numbers)
    
    ## Language Support:
    - Respond in the same language the user used for their query
    - For Indonesian queries:
      - Use "Berdasarkan data inventaris:" as an introduction
      - Use "ditemukan di lokasi berikut:" for location listings
      - Use "unit" for quantity units
      - Use "Maaf, saya tidak menemukan data tentang..." for not found responses
    
    ## Here is the relevant inventory data context:
    ${contextText}`

    try {
      // Initialize the Gemini API
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "")
      
      if (!process.env.GOOGLE_API_KEY) {
        const errorResponse: ErrorResponse = {
          error: "Google API Key is not configured. Please check server environment.",
          errorType: "system",
          errorDetails: "Missing API credentials for the AI model service."
        }
        
        return new Response(
          JSON.stringify(errorResponse),
          { status: 500, headers: { "Content-Type": "application/json" } }
        )
      }
      
      // Use the model with free tier quota instead of the preview version
      const model = genAI.getGenerativeModel({
        // model: "gemini-2.5-flash-preview-04-17", // Use the Experimental model with free tier
        // model: "gemini-2.5-pro-preview-05-06", // Use the Experimental model with free tier
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
      
      // Check if we're dealing with a non-English response (likely if query was non-English)
      const containsNonLatinChars = /[^\x00-\x7F]/.test(text);
      
      // For responses with special characters, especially non-Latin ones,
      // we need to be extra careful with JSON encoding
      let safeJsonString;
      
      if (containsNonLatinChars) {
        // For non-English text, use direct JSON.stringify for safer handling
        safeJsonString = JSON.stringify({ text });
      } else {
        // For regular English text, continue with manual escaping approach
        // Ensure the response text is properly escaped for JSON
        // Handle any characters that might break JSON
        const safeText = text
          .replace(/\\/g, '\\\\')  // Escape backslashes first
          .replace(/"/g, '\\"')    // Escape quotes
          .replace(/\n/g, '\\n')   // Escape newlines
          .replace(/\r/g, '\\r')   // Escape carriage returns
          .replace(/\t/g, '\\t')   // Escape tabs
          .replace(/\f/g, '\\f');  // Escape form feeds
        
        // Construct a valid JSON response manually to ensure it's complete
        safeJsonString = `{"text":"${safeText}"}`;
      }
      
      // Verify that we have valid JSON before sending
      try {
        JSON.parse(safeJsonString);
      } catch (jsonError) {
        console.error("Error with constructed JSON:", jsonError);
        // Use robust JSON creation for fallback
        return new Response(JSON.stringify({ 
          text: containsNonLatinChars 
            ? "Saya memproses permintaan Anda tetapi mengalami masalah format. Silakan coba lagi."
            : "I processed your request but encountered a formatting issue. Please try again." 
        }), { 
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      // Log the successful response for debugging
      console.log("Successfully formatted response as valid JSON");
      
      // Return the validated response as properly formatted JSON
      return new Response(safeJsonString, { 
        status: 200,
        headers: { 
          "Content-Type": "application/json"
        }
      });
      
    } catch (error) {
      console.error("Error generating response:", error)
      
      // Determine if this is a model error or a system error
      let errorType: "system" | "model" = "system";
      let errorDetails = "Unknown system error occurred while processing request";
      
      // Check for common model errors
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      if (
        errorMessage.includes("rate limit") || 
        errorMessage.includes("quota") || 
        errorMessage.includes("limit exceeded")
      ) {
        errorType = "model";
        errorDetails = "The AI model service has reached its rate limit. Please try again later.";
      } else if (
        errorMessage.includes("blocked") || 
        errorMessage.includes("harmful") || 
        errorMessage.includes("safety")
      ) {
        errorType = "model";
        errorDetails = "The AI model rejected this query due to content safety policies.";
      } else if (errorMessage.includes("token") || errorMessage.includes("too long")) {
        errorType = "model";
        errorDetails = "The query or context exceeded the token limit for the AI model.";
      }
      
      const errorResponse: ErrorResponse = {
        error: `Error generating response: ${errorMessage}`,
        errorType,
        errorDetails
      }
      
      return new Response(
        JSON.stringify(errorResponse),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }
  } catch (error) {
    console.error("Error in chat API:", error)
    
    const errorResponse: ErrorResponse = {
      error: `An error occurred while processing your request: ${error instanceof Error ? error.message : "Unknown error"}. Please try again later.`,
      errorType: "system",
      errorDetails: "The server encountered an unexpected error when processing the request."
    }
    
    return new Response(
      JSON.stringify(errorResponse),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
}
