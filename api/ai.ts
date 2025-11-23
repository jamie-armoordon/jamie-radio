// api/ai.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { config } from 'dotenv';
import { resolve } from 'path';
import { logAIEvent, truncateField } from './_utils/aiLogger.js';
import { randomUUID } from 'crypto';

import {
  TOOLS,
  getSystemInstruction,
  executeToolCalls,
  deriveCommand,
  getOrigin,
  ToolCall,
} from './radioTools.js';

// Explicitly load .env file (in case dotenv/config wasn't loaded before dynamic import)
config({ path: resolve(process.cwd(), '.env') });

// Load API key from environment with fallback
const API_KEY = (process.env.GOOGLE_AI_API_KEY && process.env.GOOGLE_AI_API_KEY.trim()) || 'AIzaSyDsmn62Ux5MgplmuEwgthbsYp7-G5CIR84';

// Debug: Log API key status (without exposing the key)  
if (!process.env.GOOGLE_AI_API_KEY || !process.env.GOOGLE_AI_API_KEY.trim()) {
  console.warn('[AI] GOOGLE_AI_API_KEY not set in environment, using fallback key');
} else {
  console.log('[AI] Using GOOGLE_AI_API_KEY from environment');
}

export default async function handler(req: VercelRequest | any, res: VercelResponse | any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const requestId = `req_${Date.now()}_${randomUUID().substring(0, 8)}`;
  const requestStartTime = Date.now();

  try {
    const { prompt, stations } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const stationNames: string[] = Array.isArray(stations) ? stations : [];
    
    // Log request_received
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'request_received',
      promptLength: prompt.length,
      stationCount: stationNames.length,
      origin: getOrigin(req),
      userAgent: req.headers?.['user-agent'] || 'unknown',
    });

    // Validate API key
    if (!API_KEY || API_KEY.trim().length === 0) {
      return res.status(500).json({ error: 'Server configuration error: API key missing' });
    }

    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const origin = getOrigin(req);

    /* ---------------- PASS 1: TOOL CALLING ---------------- */
    const system = getSystemInstruction(stationNames);
    const pass1StartTime = Date.now();

    // Log pass1_started
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'pass1_started',
      model: 'gemini-2.5-flash',
      systemInstructionLength: system.length,
      stationHintCount: stationNames.length,
      stationHintLength: stationNames.join(', ').length,
    });

    const pass1 = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ text: `${system}\n\nUser: ${prompt}` }],
      config: {
        tools: TOOLS,
        temperature: 0,
        toolConfig: {
          functionCallingConfig: { mode: 'AUTO' as any },
        },
      },
    });

    const functionCalls = (pass1 as any).functionCalls || [];
    const toolCalls: ToolCall[] = functionCalls.map((fc: any) => ({
      name: fc.name || '',
      args: fc.args || {},
    }));
    
    const pass1LatencyMs = Date.now() - pass1StartTime;
    const pass1Text = (pass1 as any).text || '';
    
    // Log pass1_finished
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'pass1_finished',
      latencyMs: pass1LatencyMs,
      model: 'gemini-2.5-flash',
      transcript: truncateField(pass1Text, 500),
      toolCalls: toolCalls.map(tc => ({
        name: tc.name,
        args: truncateField(JSON.stringify(tc.args || {}), 1000),
      })),
      toolCallCount: toolCalls.length,
    });
    
    // Log no_tool_calls warning if Pass-1 returned empty
    if (toolCalls.length === 0) {
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'no_tool_calls',
        transcript: truncateField(pass1Text, 500),
        promptLength: prompt.length,
        systemInstructionLength: system.length,
        stationCount: stationNames.length,
        warning: 'Pass-1 returned no tool calls',
      });
    }
    
    const toolsStartTime = Date.now();
    const toolResults = await executeToolCalls(toolCalls, origin, req);
    const toolsLatencyMs = Date.now() - toolsStartTime;
    
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
    });

    /* ---------------- PASS 2: FINAL TEXT (NO TOOLS) ---------------- */
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
    const userQuery = prompt || 'user query';
    
    const finalPrompt = `
You are Jarvis.

User asked: "${userQuery}"

Tools already ran:

${toolSummary || '(no tools called)'}

Write ONE short helpful reply.
- If tools were called: respond based on the tool results.
- If no tools were called: respond directly to the user's question (don't greet generically).
- If weather was requested: provide the weather information.
No tools. Plain text only.

`.trim();

    const pass2StartTime = Date.now();
    
    // Log pass2_started
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'pass2_started',
      model: 'gemini-2.5-flash',
      toolSummaryLength: toolSummary.length,
      toolSummaryPreview: truncateField(toolSummary, 300),
      userQueryIncluded: true,
      userQueryLength: userQuery.length,
    });

    const final = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ text: finalPrompt }],
      config: {
        toolConfig: {
          functionCallingConfig: { mode: 'NONE' as any },
        },
      },
    });

    const pass2LatencyMs = Date.now() - pass2StartTime;
    const finalText = final.text || '';
    
    // Log pass2_finished
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'pass2_finished',
      latencyMs: pass2LatencyMs,
      model: 'gemini-2.5-flash',
      text: truncateField(finalText, 1000),
    });
    
    const command = deriveCommand(toolCalls, toolResults);
    
    // Log command_derived
    const searchCall = toolCalls.find(c => c.name === 'search_stations' || c.name === 'list_stations');
    const playCall = toolCalls.find(c => c.name === 'play_station');
    const searchResultForCommand = toolResults.find(
      (r) => r.name === 'search_stations' || r.name === 'list_stations'
    );
    const searchResultData = searchResultForCommand?.result as any;
    const derivedFromTool = playCall ? 'play_station' : 
                           (searchCall && searchResultData?.bestMatch && searchResultData.confidence >= 0.75) ? 'search_stations_fallback' : 
                           'unknown';
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'command_derived',
      command,
      derivedFromTool,
      usedFallback: !playCall && derivedFromTool === 'search_stations_fallback',
      fallbackReason: !playCall && derivedFromTool === 'search_stations_fallback' ? 'no play_station call, using bestMatch from search' : null,
    });

    return res.status(200).json({
      text: finalText,
      command,
    });
  } catch (e: any) {
    // Log error event
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'error',
      errorType: e?.name || 'unknown',
      errorMessage: truncateField(e?.message || 'unknown error', 500),
      stack: truncateField(e?.stack || '', 1000),
    });
    
    return res.status(500).json({
      error: 'Failed to generate response',
      message: e?.message || 'unknown_error',
    });
  }
}
