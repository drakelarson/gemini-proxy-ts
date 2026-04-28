# Gemma Proxy (TypeScript)

OpenAI-compatible API proxy for Google Gemma models deployed to Vercel Edge. Optimized for Zo BYOK compatibility.

## Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- Streaming and non-streaming support
- **Tool/Function calling with multi-turn support**
- System prompts supported
- **Gemma 4 thinking/reasoning support** (`thinkingLevel: "high"`)
- Hardcoded defaults: `temperature: 1.0`, `top_p: 0.9`
- Thoughts hidden from client output (NVIDIA-style) but model sees them for better reasoning

## Quick Deploy (Vercel)

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create gemma-proxy-ts --public --source=. --push
   ```

2. **Deploy to Vercel**
   - Go to https://vercel.com/new
   - Import your repository
   - Add environment variable: `GEMINI_API_KEY` (get from https://aistudio.google.com/apikey)
   - Deploy

## Local Development

```bash
# Set your API key
export GEMINI_API_KEY=your-key-here

# Run locally
bun run api/index.ts
```

## Usage

### List Models
```bash
curl https://your-proxy.vercel.app/v1/models
```

### Chat Completion (Non-streaming)
```bash
curl -X POST https://your-proxy.vercel.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma-4-31b-it",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Chat Completion (Streaming)
```bash
curl -X POST https://your-proxy.vercel.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma-4-31b-it",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### Tool Calling
```bash
curl -X POST https://your-proxy.vercel.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma-4-31b-it",
    "messages": [{"role": "user", "content": "What is the weather in Tokyo?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a city",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {"type": "string"}
          },
          "required": ["city"]
        }
      }
    }]
  }'
```

### With OpenAI SDK (Python)
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-proxy.vercel.app/v1",
    api_key="any"  # Proxy uses GEMINI_API_KEY env var
)

response = client.chat.completions.create(
    model="gemma-4-31b-it",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)
```

## Supported Models

| Model ID | Description |
|----------|-------------|
| `gemma-4-31b-it` | Gemma 4 31B (thinking enabled) |
| `gemma-4-26b-a4b-it` | Gemma 4 26B A4B (thinking enabled) |
| `gemma-3-27b-it` | Gemma 3 27B |
| `gemma-3-12b-it` | Gemma 3 12B |

## Hardcoded Parameters

These cannot be overridden by incoming requests:

| Parameter | Value |
|-----------|-------|
| `temperature` | `1.0` |
| `top_p` | `0.9` |

## Thinking/Reasoning Support

**Gemma 4 models** (`gemma-4-*`) automatically get `thinkingConfig: { thinkingLevel: "high" }` for better reasoning quality.

**How it works:**
- Model generates internal reasoning (thoughts)
- Thoughts are sent back to the model in subsequent turns for context
- Thoughts are **not** exposed to the client output (prevents Zo BYOK "invalid response" errors)
- This matches NVIDIA's approach for reasoning models

## Get API Key

1. Go to https://aistudio.google.com/apikey
2. Create an API key
3. Add to Vercel environment variables as `GEMINI_API_KEY`

---

## Gemma API Gotchas & Lessons Learned

### 1. URL Format for API Key

**Wrong:**
```
generateContent&key=API_KEY  ❌
streamGenerateContent?alt=sse&key=API_KEY  ✓ (but tricky)
```

**Correct:**
```
generateContent?key=API_KEY  ✓
streamGenerateContent?alt=sse&key=API_KEY  ✓
```

Non-streaming uses `?key=` (first query param). Streaming uses `&key=` after `alt=sse`.

### 2. Streaming Requires `alt=sse`

Gemma's `streamGenerateContent` returns a JSON array by default, not SSE. To get proper SSE format:

```
streamGenerateContent?alt=sse&key=API_KEY
```

Without `alt=sse`, the response is buffered as a JSON array, which breaks real-time streaming.

### 3. Tool Schema Incompatibilities

Gemma rejects several OpenAI-specific JSON schema fields:

| Field | Reason |
|-------|--------|
| `additionalProperties` | Not supported |
| `$schema` | Not supported |
| `strict` | Not supported |
| Empty string in `enum` arrays | `"enum[2]: cannot be empty"` |

**Solution:** Strip these fields before sending to Gemma:

```typescript
function stripOpenAIFields(schema: any): any {
  if (key === 'additionalProperties' || key === '$schema' || key === 'strict') continue
  if (key === 'enum' && Array.isArray(value)) {
    result[key] = value.filter(v => v !== '')  // Remove empty strings
  }
}
```

### 4. Function Calling Format

Gemma uses `functionCall` in response parts:

```json
{
  "parts": [{
    "functionCall": {
      "name": "get_weather",
      "args": {"city": "Tokyo"}
    }
  }]
}
```

Convert to OpenAI's `tool_calls` format:

```json
{
  "choices": [{
    "message": {
      "tool_calls": [{
        "id": "call_xxx",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"city\": \"Tokyo\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

**Important:** Use generated `call_xxx` IDs, not Gemini's internal IDs.

### 5. Tool Response Format

When returning tool results back to the model:

**OpenAI:**
```json
{"role": "tool", "tool_call_id": "xxx", "name": "get_weather", "content": "{\"temp\": 25}"}
```

**Gemma:**
```json
{"role": "user", "parts": [{"functionResponse": {"name": "get_weather", "response": {"temp": 25}}}]}
```

### 6. Finish Reason for Tool Calls

When model makes a tool call, `finish_reason` must be `"tool_calls"`, not `"stop"`:

```json
{"finish_reason": "tool_calls"}  ✓
```

### 7. Retry on 500 Errors

Gemma API occasionally returns 500 errors. Implement retry logic:

```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  if (res.status === 500 && attempt < 2) {
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    continue  // Retry with exponential backoff
  }
}
```

### 8. Thought Handling for Zo BYOK

Zo BYOK doesn't support `reasoning_content` field. Solutions:

1. **Skip thought output** - Don't send thoughts to client (current approach)
2. **Send as regular content** - Wrap in `<thinking>` tags (alternative)

The model still sees its own thoughts in subsequent turns because they're included in the conversation history sent back to Gemma.

---

## Notes

- Free tier: 1,500 requests/day, 15 RPM
- System prompts become `systemInstruction` in Gemma
- Tool calls supported on all Gemma models
- Thoughts hidden from client but preserved in conversation history for model context

## License

MIT
