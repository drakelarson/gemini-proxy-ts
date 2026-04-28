# Gemma Proxy (TypeScript)

OpenAI-compatible API proxy for Google Gemma/Gemma models. Deploy to Vercel Edge.

## Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- Streaming and non-streaming support
- **Tool/Function calling support**
- Multimodal support (text + images)
- System prompts supported
- Gemma 4 thinking/reasoning support (`reasoning_content`)
- Maps OpenAI parameters to Gemma equivalents

## Quick Deploy (Vercel)

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create gemini-proxy-ts --public --source=. --push
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
bun run dev
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
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Chat Completion (Streaming)
```bash
curl -X POST https://your-proxy.vercel.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### Tool Calling
```bash
curl -X POST https://your-proxy.vercel.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
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
    api_key="any"  # Doesn't matter
)

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)
```

## Supported Models

| OpenAI Model Name | Gemma Model |
|-------------------|--------------|
| `gemini-2.5-pro` | gemini-2.5-pro |
| `gemini-2.5-flash` | gemini-2.5-flash |
| `gemini-2.5-flash-lite` | gemini-2.5-flash-lite |
| `gemini-3-flash-preview` | gemini-3-flash-preview |
| `gemini-3.1-pro-preview` | gemini-3.1-pro-preview |
| `gemini-1.5-pro` | gemini-1.5-pro |
| `gemini-1.5-flash` | gemini-1.5-flash |
| `gemini-2.0-flash` | gemini-2.0-flash |
| `gemma-4-31b-it` | gemma-4-31b-it |
| `gemma-4-26b-a4b-it` | gemma-4-26b-a4b-it |
| `gemma-3-27b-it` | gemma-3-27b-it |

## Parameter Mapping

| OpenAI | Gemma |
|--------|--------|
| `temperature` | `temperature` |
| `top_p` | `topP` |
| `max_tokens` | `maxOutputTokens` |
| `stop` | `stopSequences` |

## Get API Key

1. Go to https://aistudio.google.com/apikey
2. Create an API key
3. Add to Vercel environment variables as `GEMINI_API_KEY`

---

## Gemma API Gotchas & Lessons Learned If You Want To Build Something Similar 

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

### 4. Gemma 4 Thinking/Reasoning

Gemma 4 models (e.g., `gemma-4-31b-it`) return reasoning as separate parts with `thought: true`:

```json
{
  "parts": [
    {"text": "Let me think...", "thought": true},
    {"text": "The answer is 42."}
  ]
}
```

**Solution:** Separate thoughts from content:
- Thoughts → `reasoning_content` field
- Regular text → `content` field

This matches how reasoning models like DeepSeek-R1 work.

### 5. Function Calling Format

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

### 6. Tool Response Format

When returning tool results back to the model:

**OpenAI:**
```json
{"role": "tool", "tool_call_id": "xxx", "name": "get_weather", "content": "{\"temp\": 25}"}
```

**Gemma:**
```json
{"role": "user", "parts": [{"functionResponse": {"name": "get_weather", "response": {"temp": 25}}}]}
```

### 7. Finish Reason for Tool Calls

When model makes a tool call, `finish_reason` must be `"tool_calls"`, not `"stop"`:

```json
{"finish_reason": "tool_calls"}  ✓
```

### 8. Retry on 500 Errors

Gemma API occasionally returns 500 errors. Implement retry logic:

```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  if (res.status === 500 && attempt < 2) {
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    continue  // Retry with exponential backoff
  }
}
```

---

## Notes

- Free tier: 1,500 requests/day, 15 RPM
- Supports multimodal input (text + images via `image_url`)
- System prompts become `systemInstruction` in Gemma
- Tool calls supported on both Gemma and Gemma 4 models

## Array Wrapping

When returning tool responses, ensure that the response is wrapped in an array if it is a single object. This is required by the Gemma API.
