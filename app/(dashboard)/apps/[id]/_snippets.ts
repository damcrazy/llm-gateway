// Copy-paste integration snippets for the Integrate tab.

export const KEY_PLACEHOLDER = "gw_live_…"

export type SnippetMode = "full" | "stream"

export interface SnippetBlock {
  title: string
  code: string
  /** Shown only in this mode; omitted = both. */
  mode?: SnippetMode
}

export interface SnippetTab {
  value: string
  label: string
  blocks: SnippetBlock[]
}

export function buildSnippets({
  origin,
  model,
  extraModels,
}: {
  origin: string
  /** Model, bucket or route the snippets call. */
  model: string
  /** Other names to list in configs that take a model list. */
  extraModels: string[]
}): SnippetTab[] {
  const baseUrl = `${origin}/v1`
  const key = KEY_PLACEHOLDER
  const opencodeModels = Object.fromEntries(
    [...new Set([model, ...extraModels])]
      .slice(0, 8)
      .map((m) => [m, { name: m }])
  )

  const openAIPythonClient = `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${key}",
)`
  const openAITsClient = `import OpenAI from "openai"

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${key}",
})`
  const langchainPythonClient = `from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="${baseUrl}",
    api_key="${key}",
    model="${model}",
)`
  const langchainJsClient = `import { ChatOpenAI } from "@langchain/openai"

const llm = new ChatOpenAI({
  model: "${model}",
  apiKey: "${key}",
  configuration: { baseURL: "${baseUrl}" },
})`
  const anthropicClient = `import anthropic

client = anthropic.Anthropic(
    base_url="${origin}",
    api_key="${key}",
)`

  return [
    {
      value: "openai-python",
      label: "OpenAI Python",
      blocks: [
        {
          title: "pip install openai",
          mode: "full",
          code: `${openAIPythonClient}

response = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`,
        },
        {
          title: "pip install openai · streaming",
          mode: "stream",
          code: `${openAIPythonClient}

stream = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices:
        print(chunk.choices[0].delta.content or "", end="", flush=True)`,
        },
      ],
    },
    {
      value: "openai-ts",
      label: "OpenAI TypeScript",
      blocks: [
        {
          title: "npm install openai",
          mode: "full",
          code: `${openAITsClient}

const completion = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello!" }],
})
console.log(completion.choices[0].message.content)`,
        },
        {
          title: "npm install openai · streaming",
          mode: "stream",
          code: `${openAITsClient}

const stream = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello!" }],
  stream: true,
})
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "")
}`,
        },
      ],
    },
    {
      value: "langchain-python",
      label: "LangChain Python",
      blocks: [
        {
          title: "pip install langchain-openai",
          mode: "full",
          code: `${langchainPythonClient}

print(llm.invoke("Hello!").content)`,
        },
        {
          title: "pip install langchain-openai · streaming",
          mode: "stream",
          code: `${langchainPythonClient}

for chunk in llm.stream("Hello!"):
    print(chunk.content, end="", flush=True)`,
        },
      ],
    },
    {
      value: "langchain-js",
      label: "LangChain JS",
      blocks: [
        {
          title: "npm install @langchain/openai",
          mode: "full",
          code: `${langchainJsClient}

const reply = await llm.invoke("Hello!")
console.log(reply.content)`,
        },
        {
          title: "npm install @langchain/openai · streaming",
          mode: "stream",
          code: `${langchainJsClient}

for await (const chunk of await llm.stream("Hello!")) {
  process.stdout.write(String(chunk.content))
}`,
        },
      ],
    },
    {
      value: "anthropic",
      label: "Anthropic-compatible",
      blocks: [
        {
          title: "Claude Code (shell) · streams automatically",
          code: `export ANTHROPIC_BASE_URL="${origin}"
export ANTHROPIC_AUTH_TOKEN="${key}"
export ANTHROPIC_MODEL="${model}"

claude`,
        },
        {
          title: "Anthropic SDK (Python)",
          mode: "full",
          code: `${anthropicClient}

message = client.messages.create(
    model="${model}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)`,
        },
        {
          title: "Anthropic SDK (Python) · streaming",
          mode: "stream",
          code: `${anthropicClient}

with client.messages.stream(
    model="${model}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)`,
        },
      ],
    },
    {
      value: "opencode",
      label: "opencode",
      blocks: [
        {
          title: "opencode.json · streams automatically",
          code: JSON.stringify(
            {
              $schema: "https://opencode.ai/config.json",
              provider: {
                gateway: {
                  npm: "@ai-sdk/openai-compatible",
                  name: "LLM Gateway",
                  options: { baseURL: baseUrl, apiKey: key },
                  models: opencodeModels,
                },
              },
              model: `gateway/${model}`,
            },
            null,
            2
          ),
        },
      ],
    },
    {
      value: "curl",
      label: "curl",
      blocks: [
        {
          title: "Chat completion",
          mode: "full",
          code: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
        },
        {
          title:
            "Chat completion · streaming (-N prints events as they arrive)",
          mode: "stream",
          code: `curl -N ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "stream": true,
    "stream_options": {"include_usage": true},
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# data: {"choices":[{"delta":{"content":"Hel"}}], …}
# data: {"choices":[{"delta":{"content":"lo!"}}], …}
# data: {"choices":[], "usage":{"prompt_tokens":9,"completion_tokens":3, …}}
# data: [DONE]`,
        },
        {
          title: "List models",
          code: `curl ${baseUrl}/models \\
  -H "Authorization: Bearer ${key}"`,
        },
      ],
    },
  ]
}

export const ENDPOINTS = [
  {
    method: "POST",
    path: "/v1/chat/completions",
    format: "OpenAI Chat Completions",
    streaming: 'SSE with "stream": true',
  },
  {
    method: "POST",
    path: "/v1/responses",
    format: "OpenAI Responses (stateless: send the whole conversation)",
    streaming: 'Response events with "stream": true',
  },
  {
    method: "POST",
    path: "/v1/messages",
    format: "Anthropic Messages",
    streaming: 'Anthropic events with "stream": true',
  },
  {
    method: "POST",
    path: "/v1/embeddings",
    format: "OpenAI Embeddings",
    streaming: null,
  },
  {
    method: "POST",
    path: "/v1/images/generations",
    format: "OpenAI Images (image models)",
    streaming: null,
  },
  {
    method: "POST",
    path: "/v1/audio/speech",
    format: "OpenAI text to speech (speech models)",
    streaming: "Audio bytes as they're generated",
  },
  {
    method: "POST",
    path: "/v1/audio/transcriptions",
    format: "OpenAI transcription, multipart (transcription models)",
    streaming: null,
  },
  {
    method: "POST",
    path: "/v1/rerank",
    format: "Rerank: query + documents (Cohere / Jina style)",
    streaming: null,
  },
  {
    method: "GET",
    path: "/v1/models",
    format: "OpenAI model list",
    streaming: null,
  },
] as const
