// Copy-paste integration snippets for the Integrate tab.

export const KEY_PLACEHOLDER = "gw_live_…"

export interface SnippetBlock {
  title: string
  code: string
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
  /** Model or route the snippets call. */
  model: string
  /** Other routes/models to list in configs that take a model list. */
  extraModels: string[]
}): SnippetTab[] {
  const baseUrl = `${origin}/v1`
  const key = KEY_PLACEHOLDER
  const opencodeModels = Object.fromEntries(
    [...new Set([model, ...extraModels])]
      .slice(0, 8)
      .map((m) => [m, { name: m }])
  )

  return [
    {
      value: "openai-python",
      label: "OpenAI Python",
      blocks: [
        {
          title: "pip install openai",
          code: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${key}",
)

response = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`,
        },
      ],
    },
    {
      value: "openai-ts",
      label: "OpenAI TypeScript",
      blocks: [
        {
          title: "npm install openai",
          code: `import OpenAI from "openai"

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${key}",
})

const completion = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello!" }],
})
console.log(completion.choices[0].message.content)`,
        },
      ],
    },
    {
      value: "langchain-python",
      label: "LangChain Python",
      blocks: [
        {
          title: "pip install langchain-openai",
          code: `from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="${baseUrl}",
    api_key="${key}",
    model="${model}",
)

print(llm.invoke("Hello!").content)`,
        },
      ],
    },
    {
      value: "langchain-js",
      label: "LangChain JS",
      blocks: [
        {
          title: "npm install @langchain/openai",
          code: `import { ChatOpenAI } from "@langchain/openai"

const llm = new ChatOpenAI({
  model: "${model}",
  apiKey: "${key}",
  configuration: { baseURL: "${baseUrl}" },
})

const reply = await llm.invoke("Hello!")
console.log(reply.content)`,
        },
      ],
    },
    {
      value: "anthropic",
      label: "Anthropic-compatible",
      blocks: [
        {
          title: "Claude Code (shell)",
          code: `export ANTHROPIC_BASE_URL="${origin}"
export ANTHROPIC_AUTH_TOKEN="${key}"
export ANTHROPIC_MODEL="${model}"

claude`,
        },
        {
          title: "Anthropic SDK (Python)",
          code: `import anthropic

client = anthropic.Anthropic(
    base_url="${origin}",
    api_key="${key}",
)

message = client.messages.create(
    model="${model}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)`,
        },
      ],
    },
    {
      value: "opencode",
      label: "opencode",
      blocks: [
        {
          title: "opencode.json",
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
          code: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
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
  },
  { method: "POST", path: "/v1/messages", format: "Anthropic Messages" },
  { method: "POST", path: "/v1/embeddings", format: "OpenAI Embeddings" },
  { method: "GET", path: "/v1/models", format: "OpenAI model list" },
] as const
