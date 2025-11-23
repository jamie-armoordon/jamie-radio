import type { VercelRequest, VercelResponse } from '@vercel/node';
import { 
  GoogleGenAI,
} from '@google/genai';
import { Timer } from './_utils/timer.js';
import { logger } from './_utils/logger.js';
import { logAIEvent, truncateField } from './_utils/aiLogger.js';
import {
  TOOLS,
  getSystemInstruction,
  executeToolCalls,
  deriveCommand,
  getOrigin,
  ToolCall,
} from './radioTools.js';

const API_KEY = process.env.GOOGLE_AI_API_KEY || 'AIzaSyDsmn62Ux5MgplmuEwgthbsYp7-G5CIR84';

/**
 * Heuristic to detect bad transcripts (assistant-intro hallucinations)
 */
function isBadTranscript(text: string): boolean {
  if (!text || !text.trim()) return true;
  
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/).filter(w => w.length > 0);
  
  // Too short (< 3 words)
  if (words.length < 3) return true;
  
  // Assistant intro patterns
  const introPatterns = [
    /^hello,?\s*i'?m\s+jarvis/i,
    /^i'?m\s+jarvis/i,
    /^how\s+can\s+i\s+help/i,
    /^hello,?\s*i'?m\s+your\s+ai\s+assistant/i,
  ];
  
  for (const pattern of introPatterns) {
    if (pattern.test(lower)) return true;
  }
  
  return false;
}

export default async function handler(req: VercelRequest | any, res: VercelResponse | any) {
  // Create timer for this request
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const timer = new Timer(requestId);

  // Handle both Express and Vercel request formats
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    timer.mark('request received');
    
    if (!req.body) {
      logger.error('AI Text API', 'Request body is undefined!');
      return res.status(400).json({ 
        error: 'Request body is missing',
        command: { type: 'unknown' },
        speak_text: 'sorry i had trouble processing that',
      });
    }
    
    const { text, stations, location, radioIsPlaying, playerVolume } = req.body;
    
    // Log request_received event
    const stationNames: string[] = Array.isArray(stations) ? stations : [];
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'request_received',
      textLength: text?.length || 0,
      stationCount: stationNames.length,
      origin: getOrigin(req),
      userAgent: req.headers?.['user-agent'] || 'unknown',
      hasLocation: !!(location?.lat && location?.lon),
      radioIsPlaying: radioIsPlaying ?? undefined,
      playerVolume: playerVolume ?? undefined,
    });

    if (!text || typeof text !== 'string') {
      logger.error('AI Text API', 'Missing or invalid text data');
      return res.status(400).json({ 
        error: 'Text data is required',
        command: { type: 'unknown' },
        speak_text: 'sorry i had trouble processing that',
      });
    }
    
    if (text.length === 0) {
      logger.error('AI Text API', 'Empty text data received');
      return res.status(400).json({ 
        error: 'Empty text data',
        command: { type: 'unknown' },
        speak_text: 'sorry i didn\'t hear anything',
      });
    }
    
    const transcribedText = text.trim();
    
    timer.mark('text received and validated');

    // Initialize Google GenAI
    const ai = new GoogleGenAI({ apiKey: API_KEY });

    // Set up SSE headers
    if (res.setHeader) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    const origin = getOrigin(req);

    // Check if transcript is bad
    if (!transcribedText || isBadTranscript(transcribedText)) {
      logger.warn('[AI Text API] Bad transcript detected');
      
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'transcript_bad_generic',
        transcript: truncateField(transcribedText || '', 500),
        wordCount: transcribedText ? transcribedText.split(/\s+/).filter(w => w.length > 0).length : 0,
      });

      // Return retry response
      const speak_text = "I couldn't quite hear that. Try again?";
      const command = { type: 'unknown' as const };
      
      if (res.write) {
        res.write(`data: ${JSON.stringify({ type: 'speak_text', text: speak_text })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'command', command })}\n\n`);
        res.write('data: [DONE]\n\n');
      }
      if (res.end) {
        res.end();
      }
      return;
    }

    /* ---------------- STAGE C: INTENT + TOOLS (TEXT-BASED) ---------------- */
    const systemInstruction = getSystemInstruction(stationNames);
    
    // Add strict router instruction for Pass-1
    const pass1RouterInstruction = `You are a routing engine. Do NOT respond with natural language. Your ONLY valid output is calling tool(s). If unsure, call list_stations/search_stations first, then play_station.`;
    
    const pass1Prompt = `${systemInstruction}\n\n${pass1RouterInstruction}\n\nUser: ${transcribedText || '(no transcript available)'}`;
    
    const intentStartTime = Date.now();

    timer.mark('Stage C: Intent started');
    logger.log('[AI Text API] Stage C: Intent detection (text-based tool calling)...');
    
    // Log intent_started
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'intent_started',
      model: 'gemini-2.5-flash-preview-09-2025',
      systemInstructionLength: systemInstruction.length,
      stationHintCount: stationNames.length,
      transcriptLength: transcribedText.length,
      transcriptPreview: truncateField(transcribedText, 200),
    });
    
    try {
      // Stage C: Intent detection operates on TEXT only
      const pass1 = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-09-2025',
        contents: [{ text: pass1Prompt }],
        config: {
          tools: TOOLS,
          temperature: 0,
          toolConfig: {
            functionCallingConfig: { mode: 'AUTO' as any },
          },
        },
      });

      // Extract function calls from Pass-1 (should not have text response)
      const functionCalls = (pass1 as any).functionCalls || [];
      const toolCalls: ToolCall[] = functionCalls.map((fc: any) => ({
        name: fc.name || '',
        args: fc.args || {},
      }));
      
      const intentLatencyMs = Date.now() - intentStartTime;
      
      // Log intent results for debugging
      logger.log('[AI Text API] Stage C toolCalls:', toolCalls.map(tc => ({ name: tc.name, args: tc.args })));
      
      // Log intent_finished
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'intent_finished',
        latencyMs: intentLatencyMs,
        model: 'gemini-2.5-flash-preview-09-2025',
        transcript: truncateField(transcribedText, 500),
        toolCalls: toolCalls.map(tc => ({
          name: tc.name,
          args: truncateField(JSON.stringify(tc.args || {}), 1000),
        })),
        toolCallCount: toolCalls.length,
        intentLatencyMs,
      });
      
      // Log intent_no_tool_calls if Pass-1 returned empty
      if (toolCalls.length === 0) {
        logAIEvent({
          ts: new Date().toISOString(),
          reqId: requestId,
          event: 'intent_no_tool_calls',
          transcript: truncateField(transcribedText, 500),
          systemInstructionLength: systemInstruction.length,
          stationCount: stationNames.length,
          warning: 'Pass-1 returned no tool calls',
        });
      }
      
      timer.mark('Pass 1 complete, executing tools');

      const toolsStartTime = Date.now();
      const toolResults = await executeToolCalls(toolCalls, origin, req);
      const toolsLatencyMs = Date.now() - toolsStartTime;
      timer.mark('Tools executed');
      
      // Log tools_executed
      const searchResult = toolResults.find(
        (r) => r.name === 'search_stations' || r.name === 'list_stations'
      );
      const bestMatch = searchResult?.result as any;
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'tools_executed',
        tools: toolCalls.map((tc, idx) => ({
          name: tc.name,
          args: truncateField(JSON.stringify(tc.args || {}), 500),
          resultSummary: truncateField(JSON.stringify(toolResults[idx]?.result || {}), 1000),
          hasError: !!(toolResults[idx]?.result as any)?.error,
        })),
        overallLatencyMs: toolsLatencyMs,
        bestMatch: bestMatch?.bestMatch ? {
          stationName: bestMatch.bestMatch.stationName || bestMatch.bestMatch.name,
          stationId: bestMatch.bestMatch.stationId || bestMatch.bestMatch.id,
          score: bestMatch.bestMatch.score,
          confidence: bestMatch.confidence,
        } : null,
        confidence: bestMatch?.confidence ?? undefined,
      });

      // Log tool sequence and bestMatch for debugging
      logger.log('[Pass1] toolCalls', {
        calls: toolCalls.map((c) => ({ name: c.name, args: c.args })),
        bestMatch:
          (searchResult?.result as any)?.bestMatch?.stationName ||
          (searchResult?.result as any)?.bestMatch?.name,
      });

      /* ---------------- PASS 2: STREAM SPOKEN TEXT (NO TOOLS) -------------- */
      const toolSummary = toolResults
        .map((r) => {
          const { name, args, result } = r;
          // Special formatting for station search tools
          if (name === 'search_stations' || name === 'list_stations') {
            const res = result as any;
            let summary = `${name}("${res.query || args?.query || ''}"):\n`;
            if (res.bestMatch) {
              summary += `  bestMatch: "${res.bestMatch.stationName || res.bestMatch.name}" (id=${res.bestMatch.stationId || res.bestMatch.id}, score=${res.bestMatch.score}, confidence=${res.confidence})\n`;
            } else {
              summary += `  bestMatch: null\n`;
            }
            if (res.matches?.length) {
              summary += `  otherMatches: ${res.matches.slice(0, 3).map((m: any) => `"${m.stationName || m.name}"`).join(', ')}\n`;
            }
            return summary;
          }
          // Default formatting for other tools
          return `${name}(${JSON.stringify(args)}) => ${JSON.stringify(result)}`;
        })
        .join('\n');

      // Include user query in Pass-2 prompt for context
      const userQuery = transcribedText || '';
      const hasValidTranscript = transcribedText && !isBadTranscript(transcribedText) && transcribedText.trim().length > 0;
      
      // Build fallback guidance based on state
      let fallbackGuidance = '';
      if (toolCalls.length === 0) {
        if (hasValidTranscript) {
          fallbackGuidance = '- Since no tools were called but the user query seems valid, politely ask the user to rephrase their request.';
        } else {
          fallbackGuidance = '- Since no tools were called and the transcript is invalid/empty, say you didn\'t catch that and ask them to try again.';
        }
      }
      
      const finalPrompt = `
You are Jarvis, a friendly UK radio voice assistant.

User asked: "${userQuery || '(transcript unavailable)'}"

The system already ran these tools:

${toolSummary || '(no tools called)'}

Now produce ONE short spoken reply for the user.
- If tools were called: respond based on the tool results.
- If switching stations: say you're switching and name it.
- If volume change: acknowledge it.
- If now playing fetched: mention artist + title.
- If weather was requested: provide the weather information.
${fallbackGuidance}
- If intent is unclear: ask ONE short clarifying question.
DO NOT call tools. Output plain text only.

`.trim();

      const pass2StartTime = Date.now();
      timer.mark('Gemini Pass 2 started');
      logger.log('[AI Text API] Calling Gemini generateContentStream (Pass 2: spoken text)...');
      
      // Log pass2_started
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'pass2_started',
        model: 'gemini-2.5-flash-preview-09-2025',
        toolSummaryLength: toolSummary.length,
        toolSummaryPreview: truncateField(toolSummary, 300),
        userQueryIncluded: true,
        userQueryLength: userQuery.length,
      });

      const stream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash-preview-09-2025',
        contents: [{ text: finalPrompt }],
        config: {
          temperature: 0.8,
          toolConfig: {
            functionCallingConfig: { mode: 'NONE' as any },
          },
        },
      });

      let speakText = '';
      let chunkCount = 0;
      for await (const chunk of stream) {
        if (chunk.text) {
          speakText += chunk.text;
          chunkCount++;
        }
      }

      const pass2LatencyMs = Date.now() - pass2StartTime;
      timer.mark('Pass 2 complete');
      
      // Log pass2_finished
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'pass2_finished',
        latencyMs: pass2LatencyMs,
        model: 'gemini-2.5-flash-preview-09-2025',
        speakText: truncateField(speakText.trim(), 1000),
        chunkCount,
        userQueryIncluded: true,
        userQueryLength: userQuery.length,
      });

      // Emit speak_text first
      if (res.write) {
        res.write(
          `data: ${JSON.stringify({
            type: 'speak_text',
            text: speakText.trim(),
          })}\n\n`
        );
        logger.log('[AI Text API] Emitted speak_text via SSE:', speakText.trim().substring(0, 50));
      }

      // Derive + emit command
      const command = deriveCommand(toolCalls, toolResults);
      
      // Log command_derived
      const searchCall = toolCalls.find(c => c.name === 'search_stations' || c.name === 'list_stations');
      const playCall = toolCalls.find(c => c.name === 'play_station');
      const searchResultForCommand = toolResults.find(
        (r) => r.name === 'search_stations' || r.name === 'list_stations'
      );
      const searchResultData = searchResultForCommand?.result as any;
      // Updated threshold to match deriveCommand (0.6 instead of 0.75)
      const derivedFromTool = playCall ? 'play_station' : 
                             (searchCall && searchResultData?.bestMatch && searchResultData.confidence >= 0.6) ? 'search_stations_fallback' : 
                             'unknown';
      const usedFallback = !playCall && derivedFromTool === 'search_stations_fallback';
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'command_derived',
        command,
        derivedFromTool,
        usedFallback,
        fallbackReason: usedFallback ? 'no play_station call, using bestMatch from search/list_stations (confidence >= 0.6)' : null,
        fallbackConfidence: usedFallback ? searchResultData?.confidence : null,
      });
      
      if (res.write) {
        res.write(`data: ${JSON.stringify({ type: 'command', command })}\n\n`);
        logger.log('[AI Text API] Emitted command via SSE:', JSON.stringify(command));
        res.write('data: [DONE]\n\n');
      }
      if (res.end) {
        logger.log('[AI Text API] Ending SSE stream');
        res.end();
      }
      
      // Log sse_completed
      const totalLatencyMs = Date.now() - intentStartTime;
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'sse_completed',
        totalLatencyMs,
      });

    } catch (geminiError: any) {
      logger.error('[AI Text API] Gemini API error:', geminiError);
      timer.mark('Gemini error', { error: geminiError.message });
      
      // Log error event
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'error',
        errorType: geminiError?.name || 'unknown',
        errorMessage: truncateField(geminiError?.message || 'unknown error', 500),
        stack: truncateField(geminiError?.stack || '', 1000),
      });
      
      if (res.write) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: geminiError.message })}\n\n`);
      }
      if (res.end) {
        res.end();
      }
    }

  } catch (error: any) {
    logger.error('[AI Text API] Error:', error);
    timer.mark('handler error', { error: error.message });
    
    if (res.write) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to process text' })}\n\n`);
    }
    if (res.end) {
      res.end();
    }
  }
}

