# Inventory Analyst

Inventory Analyst is an AI-powered application that allows users to upload and analyze inventory data through natural language queries. The application uses Google's Gemini AI to interpret questions and provide insights about uploaded inventory data.

## Features

- **Data Upload**: Upload inventory data in CSV or Excel format
- **Natural Language Chat**: Ask questions about your inventory data in natural language
- **Multi-language Support**: Ask questions and receive answers in multiple languages
- **Vector Database**: Uses Upstash Vector to store and retrieve relevant context for queries
- **Responsive UI**: Modern interface built with Next.js and Tailwind CSS

## Tech Stack

- **Frontend**: Next.js, React, Tailwind CSS, shadcn/ui components
- **Backend**: Next.js API routes
- **AI**: Google Generative AI (Gemini)
- **Vector Database**: Upstash Vector
- **Data Processing**: XLSX library for parsing Excel/CSV files

## How It Works

1. **Data Upload**: Upload inventory data via the web interface
2. **Data Processing**: The application processes the data, chunks it, and generates embeddings using Google's embedding model
3. **Vector Storage**: Embeddings are stored in Upstash Vector database
4. **Natural Language Queries**: Ask questions about your data in natural language
5. **Semantic Search**: The application finds relevant context in the vector database
6. **AI Response**: Gemini AI generates responses based on the relevant context

## Getting Started

### Prerequisites

- Node.js 18 or higher
- pnpm package manager

### Environment Variables

Create a `.env.local` file with the following variables:

```
GOOGLE_API_KEY=your_google_api_key
UPSTASH_VECTOR_REST_URL=your_upstash_vector_url
UPSTASH_VECTOR_REST_TOKEN=your_upstash_vector_token
```

### Installation

```bash
# Install dependencies
pnpm install

# Run the development server
pnpm dev
```

## Limitations

- File size is limited to 1MB to avoid rate limiting issues
- Processing large datasets may take time due to API rate limits

## License

[MIT License](LICENSE) 