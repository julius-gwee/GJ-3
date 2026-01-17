/**
 * Job Parser Module
 * 
 * This module handles parsing raw scraped job listing text into structured data.
 * It provides two parsing strategies:
 * 1. LLM-based parsing (intelligent, requires API key)
 * 2. Fallback parsing (heuristic-based, no API required)
 * 
 * The parser extracts:
 * - jobTitle: The actual job title/role
 * - companyName: The hiring company name
 * - description: Job description and responsibilities
 * - requirements: Required skills, qualifications, experience
 * - additionalContext: Tech stack, location, salary, benefits, culture, etc.
 */

/**
 * Safely parses JSON text, returning null if parsing fails
 * @param {string} text - JSON string to parse
 * @returns {Object|null} - Parsed object or null if invalid
 */
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

/**
 * Parses job listing text using an LLM to extract structured information
 * 
 * This function:
 * 1. Truncates long text to stay within token limits (~8000 chars)
 * 2. Sends a structured prompt to the LLM asking for JSON extraction
 * 3. Handles both OpenAI-compatible and generic LLM endpoints
 * 4. Extracts JSON from markdown code blocks if present
 * 5. Returns structured data object
 * 
 * @param {string} rawText - Raw scraped job listing text
 * @param {string} url - URL of the job listing (for context)
 * @param {Object} settings - LLM settings object containing:
 *   - llmEndpoint: API endpoint URL
 *   - llmApiKey: API key for authentication
 *   - llmMode: 'openai' or 'generic'
 *   - llmModel: Model name (for OpenAI mode)
 * @param {Function} callOpenAi - Function to call OpenAI-compatible API
 * @param {Function} callGeneric - Function to call generic JSON API
 * @returns {Promise<Object>} - Parsed job data with fields: jobTitle, companyName, description, requirements, additionalContext
 * @throws {Error} - If LLM parsing fails or response is invalid
 */
async function parseJobWithLLM(rawText, url, settings, callOpenAi, callGeneric) {
  // Truncate text if too long (keep first ~8000 chars to leave room for prompt and response)
  const maxLength = 8000;
  const truncatedText = rawText.length > maxLength 
    ? rawText.substring(0, maxLength) + '\n\n[... content truncated ...]'
    : rawText;

  const prompt = `Extract structured information from this job listing:

URL: ${url}

Job Listing Text:
${truncatedText}

Extract and return a JSON object with the following fields:
- jobTitle: The actual job title/role name (not the page title)
- companyName: The hiring company name (not the job board name)
- description: Job description, overview, and key responsibilities (clean, well-formatted)
- requirements: Required skills, qualifications, experience, education (separate from description)
- additionalContext: Tech stack, tools, location, salary range, benefits, company culture, team info, etc.

Return ONLY valid JSON in this format:
{
  "jobTitle": "...",
  "companyName": "...",
  "description": "...",
  "requirements": "...",
  "additionalContext": "..."
}

If a field cannot be determined, use an empty string.`;

  try {
    let responseText = '';
    
    if (settings.llmMode === 'generic') {
      responseText = await callGeneric(settings, {
        prompt,
        task: 'parse_job_listing',
        url
      });
    } else {
      const systemMessage = 'You are a helpful assistant that extracts structured information from job listings. Always return valid JSON.';
      responseText = await callOpenAi(settings, prompt, systemMessage);
    }

    // Try to extract JSON from response (might be wrapped in markdown code blocks)
    let jsonText = responseText.trim();
    
    // Remove markdown code blocks if present
    const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    } else {
      // Try to find JSON object in the text
      const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        jsonText = jsonObjectMatch[0];
      }
    }

    const parsed = safeJsonParse(jsonText);
    if (parsed && typeof parsed === 'object') {
      return {
        jobTitle: parsed.jobTitle || '',
        companyName: parsed.companyName || '',
        description: parsed.description || '',
        requirements: parsed.requirements || '',
        additionalContext: parsed.additionalContext || ''
      };
    }
    
    throw new Error('Failed to parse LLM response as JSON');
  } catch (error) {
    console.error('LLM parsing error:', error);
    throw error;
  }
}

/**
 * Fallback parser that uses heuristics to extract structured data without LLM
 * 
 * This function:
 * 1. Uses the scraped title and company from DOM extraction
 * 2. Analyzes text for section headings to separate description/requirements/context
 * 3. Looks for keywords to identify different sections
 * 4. Extracts tech stack mentions
 * 5. Returns structured data (less accurate than LLM but works without API)
 * 
 * @param {string} rawText - Raw scraped job listing text
 * @param {string} url - URL of the job listing (for context, currently unused)
 * @param {Object} scrapedData - Data from DOM extraction containing:
 *   - title: Job title from page
 *   - company: Company name from page
 *   - description: Raw description text
 * @returns {Object} - Parsed job data with fields: jobTitle, companyName, description, requirements, additionalContext
 */
function fallbackParseJob(rawText, url, scrapedData) {
  const result = {
    jobTitle: scrapedData.title || '',
    companyName: scrapedData.company || '',
    description: '',
    requirements: '',
    additionalContext: ''
  };

  // Try to split description and requirements based on common headings
  const text = rawText.toLowerCase();
  const descriptionKeywords = ['description', 'overview', 'about', 'role', 'position', 'responsibilities'];
  const requirementsKeywords = ['requirement', 'qualification', 'skill', 'experience', 'education', 'must have', 'should have'];
  const contextKeywords = ['tech stack', 'technology', 'tools', 'location', 'salary', 'benefit', 'culture', 'team', 'remote', 'hybrid'];

  // Simple heuristic: look for section breaks
  const lines = rawText.split('\n').filter(line => line.trim().length > 0);
  let currentSection = 'description';
  const sections = { description: [], requirements: [], additionalContext: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase().trim();
    
    // Check if this line is a heading
    if (line.length < 100 && (
      requirementsKeywords.some(kw => line.includes(kw)) ||
      line.match(/^(requirements?|qualifications?|skills?|experience|education)/)
    )) {
      currentSection = 'requirements';
    } else if (line.length < 100 && (
      contextKeywords.some(kw => line.includes(kw)) ||
      line.match(/^(location|salary|benefits?|tech stack|technologies?|tools?|culture|team)/)
    )) {
      currentSection = 'additionalContext';
    } else if (line.length < 100 && descriptionKeywords.some(kw => line.includes(kw))) {
      currentSection = 'description';
    }

    sections[currentSection].push(lines[i]);
  }

  result.description = sections.description.join('\n').trim() || rawText.substring(0, Math.min(3000, rawText.length));
  result.requirements = sections.requirements.join('\n').trim();
  
  // Extract context from various parts
  const contextParts = [];
  if (sections.additionalContext.length > 0) {
    contextParts.push(sections.additionalContext.join('\n'));
  }
  
  // Look for tech stack mentions
  const techStackMatch = rawText.match(/(?:tech stack|technologies?|tools?)[\s:]+([^\n]+)/i);
  if (techStackMatch) {
    contextParts.push(`Tech Stack: ${techStackMatch[1]}`);
  }

  result.additionalContext = contextParts.join('\n\n').trim();

  return result;
}

// Export functions
export { parseJobWithLLM, fallbackParseJob, safeJsonParse };

// Also support CommonJS for backward compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseJobWithLLM,
    fallbackParseJob,
    safeJsonParse
  };
}
