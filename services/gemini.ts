import { Email, FollowUpTone, GeneratedDraft, SmartCampaignResult, EmailAnalysisResult, BrandBible, StoryIdea, OfferFitAnalysis } from '../types';

// Replicate SDK Type enum for schema definition compatibility
const Type = {
  TYPE_UNSPECIFIED: 'TYPE_UNSPECIFIED',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  OBJECT: 'OBJECT',
  NULL: 'NULL'
} as const;

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';
const PROXY_URL = `${API_URL}/api/gemini/generate`;

const cleanJsonString = (text: string): string => {
  // Remove markdown code block syntax
  return text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
};

// Helper to call backend proxy
const callGeminiProxy = async (model: string, contents: any, config?: any) => {
  try {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, contents, config })
    });

    if (!response.ok) {
      throw new Error(`Gemini Proxy Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data; // Expected { text: "..." }
  } catch (error) {
    console.error("Gemini Proxy Call Failed:", error);
    throw error;
  }
};

export const generateFollowUpDraft = async (
  originalEmail: Email, 
  tone: FollowUpTone,
  additionalContext?: string,
  pastEmailExamples?: string[],
  signature?: string
): Promise<GeneratedDraft> => {
  
  let prompt = `
    You are an expert professional sales and communication assistant.
    Your task is to write a follow-up email based on a previously sent email that has received no reply.
    
    Original Email Details:
    - To: ${originalEmail.recipientName} (${originalEmail.company || 'Client'})
    - Subject: ${originalEmail.subject}
    - Sent Date: ${new Date(originalEmail.sentDate).toLocaleDateString()}
    - Body: "${originalEmail.body}"
    
    Configuration:
    - Desired Tone: ${tone}
    ${additionalContext ? `- Additional User Context/Instruction: "${additionalContext}"` : ''}
    
    Instructions:
    1. Generate a new subject line (usually "Re: [Original Subject]" or a variation).
    2. Generate the body of the follow-up email.
    3. Keep it concise, polite, and effective.
    4. Sign off as "${signature || 'Alex'}" (the sender).
  `;

  if (pastEmailExamples && pastEmailExamples.length > 0) {
    prompt += `
      Here are 3 examples of my previous writing style. Mimic the tone, sign-offs, and sentence length exactly:

      ${pastEmailExamples.join('\n---\n')}
    `;
  }

  try {
    const response = await callGeminiProxy('gemini-2.5-flash', prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING },
            tone: { type: Type.STRING }
          },
          required: ["subject", "body", "tone"]
        }
    });

    if (!response.text) {
      throw new Error("No response text from Gemini Proxy");
    }

    const jsonStr = cleanJsonString(response.text);
    const data = JSON.parse(jsonStr);
    
    return {
      subject: data.subject,
      body: data.body,
      tone: tone
    };

  } catch (error) {
    console.error("Error generating follow-up:", error);
    // Fallback if JSON parsing fails or API errors
    return {
      subject: `Re: ${originalEmail.subject}`,
      body: `I wanted to bump this to the top of your inbox. Let me know if you have any questions.\n\nBest,\n${signature || 'Alex'}`,
      tone: tone
    };
  }
};

export const parseSmartCampaign = async (rawText: string): Promise<SmartCampaignResult> => {
  const today = new Date().toISOString().split('T')[0];
  
  const prompt = `
    You are an intelligent email campaign parser. 
    The user has provided a raw, unstructured description of an email campaign they want to send.
    Your task is to extract the structured data.

    Current Date: ${today}

    Rules:
    1. Extract recipient email and name if present.
    2. Extract the Subject and Body of the MAIN email.
    3. Extract any follow-ups.
    4. CRITICAL: The system uses 'delayDays' (number of days after previous email) to schedule follow-ups.
       - If the user provides specific dates (e.g., "Followup 1 on Nov 25th"), calculate the approximate days from the *previous* step.
       - If the user provides a start date for the main email, put it in 'scheduledDate' (ISO YYYY-MM-DD).
       - If no dates are provided, infer reasonable delays (e.g., 3 days).
    
    User Input:
    """
    ${rawText}
    """
  `;

  try {
    const response = await callGeminiProxy('gemini-2.5-flash', prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recipientEmail: { type: Type.STRING },
            recipientName: { type: Type.STRING },
            subject: { type: Type.STRING },
            body: { type: Type.STRING },
            scheduledDate: { type: Type.STRING, description: "ISO Date YYYY-MM-DD" },
            followUps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  content: { type: Type.STRING },
                  delayDays: { type: Type.NUMBER, description: "Days to wait after previous email" },
                }
              }
            }
          }
        }
    });

    if (!response.text) return {};
    const jsonStr = cleanJsonString(response.text);
    return JSON.parse(jsonStr) as SmartCampaignResult;
  } catch (error) {
    console.error("Error parsing smart campaign:", error);
    return {};
  }
};

export const analyzeSpamLikelihood = async (subject: string, body: string): Promise<EmailAnalysisResult | null> => {
  const prompt = `
    You are an expert Cold Email Deliverability and Copywriting Specialist.
    Analyze the following email draft for spam triggers, deliverability issues, and cold outreach best practices.

    Subject: "${subject}"
    Body: "${body}"

    Evaluation Criteria:
    1. SPAM FILTERS: Look for trigger words (e.g., "Guarantee", "Free", "Urgent", "100%", all caps).
    2. STRUCTURE: Is it too long? Too many links? Too many images?
    3. TONE: Is it pushy? Salesy? Or conversational and value-driven?
    
    Output Requirements:
    - 'score': 0 to 100. (100 = Perfect/Safe, <50 = High Spam Risk).
    - 'spamLikelihood': 'LOW', 'MEDIUM', or 'HIGH'.
    - 'triggerWords': List specific words found in the text that might trigger filters.
    - 'suggestions': Actionable advice to improve deliverability and open rates.
    - 'toneAudit': A brief 1-sentence description of how the email sounds to a stranger.
  `;

  try {
    const response = await callGeminiProxy('gemini-2.5-flash', prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            spamLikelihood: { type: Type.STRING, enum: ['LOW', 'MEDIUM', 'HIGH'] },
            triggerWords: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            toneAudit: { type: Type.STRING }
          },
          required: ['score', 'spamLikelihood', 'triggerWords', 'suggestions', 'toneAudit']
        }
    });

    if (!response.text) return null;
    const jsonStr = cleanJsonString(response.text);
    return JSON.parse(jsonStr) as EmailAnalysisResult;
  } catch (error) {
    console.error("Error analyzing spam:", error);
    return null;
  }
};

export const generateBrandBible = async (clientNotes: string, contentSamples: string): Promise<BrandBible | null> => {
  const prompt = `
    You are a World-Class Brand Strategist and Creative Director.
    Your goal is to analyze raw client notes and content examples to build a comprehensive "Brand OS" (Brand Bible).
    
    Inputs:
    1. Client Discovery Notes: "${clientNotes}"
    2. Content Samples: "${contentSamples}"

    Task:
    Analyze the inputs to extract the brand's soul, voice, and visual direction.
    
    Output a JSON object with:
    - voiceProfile: 
      - archetype: (e.g., The Sage, The Rebel, The Caregiver)
      - keywords: 3-5 adjectives describing the voice (e.g., "Witty", "Authoritative")
      - description: A paragraph explaining how they should sound.
    - visualRules:
      - colorPalette: 4-5 Hex codes that match the vibe (infer them if not explicit).
      - typography: A description of recommended font styles (e.g., "Clean Sans-Serif headings with Serif body").
      - vibeDescription: A sentence describing the aesthetic (e.g., "Minimalist tech-noir").
    - doAndDonts:
      - dos: 3-5 specific rules for writing (e.g., "Use emojis sparingly", "Start sentences with verbs").
      - donts: 3-5 specific prohibitions (e.g., "Never use passive voice", "Don't be overly formal").
    - exampleScriptPrompts: 3 AI prompts the user could use later to generate content in this specific style.
  `;

  try {
    const response = await callGeminiProxy('gemini-2.5-flash', prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            voiceProfile: {
              type: Type.OBJECT,
              properties: {
                archetype: { type: Type.STRING },
                keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                description: { type: Type.STRING }
              },
              required: ["archetype", "keywords", "description"]
            },
            visualRules: {
              type: Type.OBJECT,
              properties: {
                colorPalette: { type: Type.ARRAY, items: { type: Type.STRING } },
                typography: { type: Type.STRING },
                vibeDescription: { type: Type.STRING }
              },
              required: ["colorPalette", "typography", "vibeDescription"]
            },
            doAndDonts: {
              type: Type.OBJECT,
              properties: {
                dos: { type: Type.ARRAY, items: { type: Type.STRING } },
                donts: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["dos", "donts"]
            },
            exampleScriptPrompts: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["voiceProfile", "visualRules", "doAndDonts", "exampleScriptPrompts"]
        }
    });

    if (!response.text) return null;
    const jsonStr = cleanJsonString(response.text);
    return JSON.parse(jsonStr) as BrandBible;
  } catch (error) {
    console.error("Error generating brand bible:", error);
    return null;
  }
};

export const processStoryDump = async (rawText: string): Promise<StoryIdea[]> => {
  const prompt = `
    Analyze this raw story/brain dump from a content creator. 
    Extract distinct content pieces or ideas.
    
    For each distinct idea found in the text, identify:
    1. The Hook: A catchy opening line.
    2. The Core Story: A brief summary of the point or narrative.
    3. The Emotion: Classify as Funny, Painful, Inspiring, Educational, or Controversial.
    4. The Format: Best suited for Reel, Long-form, Carousel, or Story.

    Raw Text:
    """
    ${rawText}
    """
  `;

  try {
    const response = await callGeminiProxy('gemini-2.5-flash', prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              hook: { type: Type.STRING },
              coreStory: { type: Type.STRING },
              emotion: { type: Type.STRING, enum: ['Funny', 'Painful', 'Inspiring', 'Educational', 'Controversial'] },
              format: { type: Type.STRING, enum: ['Reel', 'Long-form', 'Carousel', 'Story'] }
            },
            required: ["hook", "coreStory", "emotion", "format"]
          }
        }
    });

    if (!response.text) return [];
    
    const jsonStr = cleanJsonString(response.text);
    const rawIdeas = JSON.parse(jsonStr);
    // Add client-side IDs
    return rawIdeas.map((idea: any) => ({ ...idea, id: `idea-${Date.now()}-${Math.random()}` }));
  } catch (error) {
    console.error("Error processing story dump:", error);
    return [];
  }
};

export const analyzeOfferFit = async (leadContext: string): Promise<OfferFitAnalysis | null> => {
  const prompt = `
    Analyze this text (Twitter bio, About page, or Content). 
    Determine: 
    1. What do they sell? 
    2. Content Maturity (Beginner/Mid/Pro). 
    3. Fit Score (0-100) for a high-ticket video editing offer. 
    4. A specific "Pitch Angle" connecting their offer to better video. 
    
    Input Text:
    """
    ${leadContext}
    """
  `;

  try {
    const response = await callGeminiProxy('gemini-2.5-flash', prompt, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            product: { type: Type.STRING },
            maturity: { type: Type.STRING, enum: ['Beginner', 'Mid', 'Pro'] },
            score: { type: Type.NUMBER },
            angle: { type: Type.STRING }
          },
          required: ["product", "maturity", "score", "angle"]
        }
    });

    if (!response.text) return null;
    const jsonStr = cleanJsonString(response.text);
    return JSON.parse(jsonStr) as OfferFitAnalysis;
  } catch (error) {
    console.error("Error analyzing offer fit:", error);
    return null;
  }
};