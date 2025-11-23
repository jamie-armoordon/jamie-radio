import { askJamieAI } from './ai';
import { SYSTEM_PROMPT } from './aiSystemPrompt';

export interface CommandResult {
  command?: string;
  station?: string;
  action?: string;
  message?: string;
  text?: string;
  error?: string;
}

export async function sendVoiceCommandToAI(text: string): Promise<CommandResult> {
  try {
    const fullPrompt = `${SYSTEM_PROMPT}\n\n${text}`;
    const response = await askJamieAI(fullPrompt);

    // Parse JSON response
    try {
      const parsed = JSON.parse(response) as CommandResult;
      
      // Validate structure
      if (parsed.error) {
        return parsed;
      }

      if (!parsed.command && !parsed.error) {
        return { error: 'invalid_response', text: parsed.text || 'sorry i had trouble understanding that' };
      }

      return parsed;
    } catch (parseError) {
      console.error('Failed to parse AI JSON response:', parseError);
      return { error: 'invalid_json', text: 'sorry i had trouble processing that' };
    }
  } catch (error) {
    console.error('AI command failed:', error);
    return { error: 'ai_error', text: 'sorry i had trouble understanding that' };
  }
}
