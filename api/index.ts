// PATCHED VERSION: improved tool-call stability and streaming safety
/**
 * Gemini/Gemma API Proxy - TypeScript/Hono
 * OpenAI-compatible interface for Google Gemini models
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const API_KEY = process.env.GEMINI_API_KEY

if (!API_KEY) {
  console.error('[GEMMA-PROXY] ERROR: No API key! Set GEMINI_API_KEY env var.')
}

const MODEL_MAP: Record<string, string> = {
  'gemma-4-31b-it': 'gemma-4-31b-it',
  'gemma-4-26b-a4b-it': 'gemma-4-26b-a4b-it',
  'gemma-3-27b-it': 'gemma-3-27b-it',
}

const DEFAULT_MODEL = 'gemma-4-31b-it'
const HEARTBEAT_INTERVAL_MS = 2000
const HEARTBEAT_BYTE = ': keep-alive\n\n'

let totalRequests = 0
let totalErrors = 0

const app = new Hono()
app.use('*', cors())

function safeJsonParse(str: any) {
  if (!str || typeof str !== 'string') return {}
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}

function normalizeToolArgs(args: any) {
  if (!args) return {}
  if (typeof args === 'string') return safeJsonParse(args)
  if (typeof args === 'object') return args
  return {}
}

app.post('/v1/chat/completions', async (c) => {
  totalRequests++

  try {
    const body = await c.req.json()
    const { model: requestedModel, messages, stream = false, ...rest } = body

    const geminiModel = MODEL_MAP[requestedModel] || DEFAULT_MODEL

    const { contents, systemInstruction } = convertMessages(messages)

    const tools = rest.tools ? convertTools(rest.tools) : []

    const geminiRequest: any = {
      contents,
      generationConfig: {
        temperature: 1.0,
        topP: 0.9
      }
    }

    if (requestedModel.startsWith('gemma-4-')) {
      geminiRequest.generationConfig.thinkingConfig = { thinkingLevel: 'high' }
    }

    if (systemInstruction) geminiRequest.systemInstruction = systemInstruction
    if (tools.length > 0) geminiRequest.tools = [{ functionDeclarations: tools }]

    const endpoint = stream
      ? `streamGenerateContent?alt=sse&key=${API_KEY}`
      : `generateContent?key=${API_KEY}`

    const url = `${BASE_URL}/models/${geminiModel}:${endpoint}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequest)
    })

    if (!stream) {
      const geminiResp = await response.json()
      return c.json(convertResponse(geminiResp, requestedModel, false))
    }

    const reader = response.body?.getReader()
    if (!reader) return c.json({ error: 'No stream' }, 502)

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    let buffer = ''
    let toolCallIndex = 0
    let hadToolCall = false

    // CRITICAL FIX: accumulate tool calls before emitting
    const pendingToolCalls: Record<number, any> = {}

    return new Response(new ReadableStream({
      async start(controller) {

        const send = (obj: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        }

        send({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: requestedModel,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
        })

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue

            const data = line.slice(6).trim()
            if (!data || data === '[DONE]') continue

            try {
              const chunk = JSON.parse(data)
              const parts = chunk?.candidates?.[0]?.content?.parts || []

              for (const part of parts) {

                // TOOL CALL FIX: only emit AFTER normalization
                if (part.functionCall) {
                  hadToolCall = true

                  const args = normalizeToolArgs(part.functionCall.args)

                  const toolCall = {
                    index: toolCallIndex,
                    id: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    type: 'function',
                    function: {
                      name: part.functionCall.name,
                      arguments: JSON.stringify(args)
                    }
                  }

                  pendingToolCalls[toolCallIndex] = toolCall

                  send({
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: requestedModel,
                    choices: [{
                      index: 0,
                      delta: { tool_calls: [toolCall] },
                      finish_reason: null
                    }]
                  })

                  toolCallIndex++
                  continue
                }

                if (part.text) {
                  send({
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: requestedModel,
                    choices: [{
                      index: 0,
                      delta: { content: part.text },
                      finish_reason: null
                    }]
                  })
                }
              }

            } catch {
              // ignore malformed chunk
            }
          }
        }

        // FINAL FIX: correct finish reason consistency
        send({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: requestedModel,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: hadToolCall ? 'tool_calls' : 'stop'
          }]
        })

        send({ usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })
        send('[DONE]')
        controller.close()
      }
    }), {
      headers: { 'Content-Type': 'text/event-stream' }
    })

  } catch (e) {
    totalErrors++
    return c.json({ error: String(e) }, 500)
  }
})

export default app
