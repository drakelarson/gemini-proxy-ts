# Gemini Proxy (TypeScript)

OpenAI-compatible API proxy for Google Gemini/Gemma models. Deploy to Vercel Edge.

## Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- Streaming and non-streaming support
- Multimodal support (text + images)
- System prompts supported
- Maps OpenAI parameters to Gemini equivalents

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

| OpenAI Model Name | Gemini Model |
|-------------------|--------------|
| `gemini-2.5-pro` | gemini-2.5-pro-preview-06-05 |
| `gemini-2.5-flash` | gemini-2.5-flash-preview-05-20 |
| `gemini-2.0-flash` | gemini-2.0-flash |
| `gemini-1.5-pro` | gemini-1.5-pro |
| `gemini-1.5-flash` | gemini-1.5-flash |
| `gemma-3-27b-it` | gemma-3-27b-it |

## Parameter Mapping

| OpenAI | Gemini |
|--------|--------|
| `temperature` | `temperature` |
| `top_p` | `topP` |
| `max_tokens` | `maxOutputTokens` |
| `stop` | `stopSequences` |

## Get API Key

1. Go to https://aistudio.google.com/apikey
2. Create an API key
3. Add to Vercel environment variables as `GEMINI_API_KEY`

## Notes

- Free tier: 1,500 requests/day, 15 RPM
- Supports multimodal input (text + images via `image_url`)
- System prompts become `systemInstruction` in Gemini
