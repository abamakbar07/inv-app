import { streamText } from "ai"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { checkDataExists, findRelevantContent } from "@/lib/upstash"

export const maxDuration = 60 // Increase timeout to 60 seconds

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    // Check if data exists in Upstash
    const dataExists = await checkDataExists()

    if (!dataExists) {
      return new Response(
        JSON.stringify({
          error: "No data available. Please upload inventory data first.",
        }),
        { status: 400 },
      )
    }

    // Extract the last user message for context retrieval
    const lastUserMessage = messages[messages.length - 1].content

    // Get relevant context first before streaming
    let relevantContext = []
    try {
      console.log("Retrieving relevant context for:", lastUserMessage)
      relevantContext = await findRelevantContent(lastUserMessage)
      console.log(`Found ${relevantContext.length} relevant context items`)
    } catch (error) {
      console.error("Error retrieving context:", error)
      // Continue without context if retrieval fails
    }

    // Format the context for the prompt
    const contextText =
      relevantContext.length > 0
        ? relevantContext
            .map((item, index) => `Context ${index + 1}:\n${item.metadata?.content || "No content available"}`)
            .join("\n\n")
        : "No relevant context found in the inventory data."

    // Create a system prompt with the context
    const systemPrompt = `You are an Inventory Analyst AI assistant. You help users analyze and understand their inventory data.
    Only answer questions based on the provided context from the user's inventory data.
    If you don't have relevant information in the context, say "I don't have enough information about that in your inventory data."
    Be concise, helpful, and accurate.
    
    Here is the relevant inventory data context:
    ${contextText}`

    // Create a new messages array with the system prompt
    const messagesWithContext = [
      { role: "system", content: systemPrompt },
      ...messages.filter((m) => m.role !== "system"),
    ]

    const result = streamText({
      model: {
        provider: "google",
        model: "gemini-2.5-pro-preview-05-06",
        async doGenerate({ messages }) {
          try {
            console.log("Starting doGenerate with Gemini")
            const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "")
            const model = genAI.getGenerativeModel({
              model: "gemini-2.5-pro-preview-05-06",
              generationConfig: {
                temperature: 0.7,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 1024,
              },
            })

            // Format conversation history for Gemini
            const formattedMessages = messages
              .filter((m) => m.role !== "system")
              .map((m) => ({
                role: m.role === "user" ? "user" : "model",
                parts: [{ text: m.content }],
              }))

            // Get the system message
            const systemMessage = messages.find((m) => m.role === "system")?.content || ""

            // Extract the last user message
            const lastUserMessage = messages[messages.length - 1].content

            // Create a chat with history
            console.log("Creating chat with history length:", formattedMessages.length - 1)
            const chat = model.startChat({
              history: formattedMessages.slice(0, -1),
              generationConfig: {
                temperature: 0.7,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 1024,
              },
            })

            // Send the message with the system prompt prepended
            console.log("Sending message to Gemini")
            const prompt = `${systemMessage}\n\nUser query: ${lastUserMessage}`
            const result = await chat.sendMessage(prompt)
            const response = await result.response
            const text = response.text()
            console.log("Received response from Gemini")

            return { text }
          } catch (error) {
            console.error("Error in doGenerate:", error)
            return {
              text: `I'm sorry, I encountered an error processing your request: ${error instanceof Error ? error.message : "Unknown error"}. Please try again in a few minutes.`,
            }
          }
        },
      },
      messages: messagesWithContext,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    console.error("Error in chat API:", error)
    return new Response(
      JSON.stringify({
        error: `An error occurred while processing your request: ${error instanceof Error ? error.message : "Unknown error"}. Please try again later.`,
      }),
      { status: 500 },
    )
  }
}
