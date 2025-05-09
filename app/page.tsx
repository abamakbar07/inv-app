import { Suspense } from "react"
import UploadForm from "@/components/upload-form"
import ChatInterface from "@/components/chat-interface"
import { DataStatus } from "@/components/data-status"
import { checkDataExists } from "@/lib/upstash"

export default async function Home() {
  // This runs on the server
  let dataExists = false;
  let checkError = false;
  
  try {
    dataExists = await checkDataExists();
    console.log("Data exists check result:", dataExists);
  } catch (error) {
    console.error("Error checking if data exists:", error);
    checkError = true;
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl">
      <h1 className="text-3xl font-bold text-center mb-8">Inventory Analyst</h1>

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Data Management</h2>
        <div className="bg-white rounded-lg shadow p-6">
          <Suspense fallback={<div>Checking data status...</div>}>
            <DataStatus initialStatus={dataExists} hasError={checkError} />
          </Suspense>
          <UploadForm />
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Chat with Your Inventory Data</h2>
        <div className="bg-white rounded-lg shadow">
          <ChatInterface dataExists={dataExists} hasError={checkError} />
        </div>
      </div>
    </main>
  )
}
