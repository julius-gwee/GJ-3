/**
 * Exa Scraper Module
 * 
 * This module handles deep scraping using the Exa API.
 * Exa is a service that can extract content from web pages more reliably
 * than basic DOM scraping, especially for JavaScript-rendered content.
 * 
 * The Exa API:
 * - Requires an API key (configured in settings)
 * - Returns clean text content from URLs
 * - Supports highlights and structured extraction
 * - Works well with dynamic/SPA pages
 */

/**
 * Performs deep scraping of a job listing URL using the Exa API
 * 
 * Process:
 * 1. Validates that Exa API key is configured
 * 2. Sends request to Exa API with the job URL
 * 3. Extracts text content from Exa response
 * 4. Returns raw text for further processing
 * 
 * @param {string} url - Job listing URL to scrape
 * @param {string} exaApiKey - Exa API key for authentication
 * @returns {Promise<string>} - Raw text content from the job listing
 * @throws {Error} - If API key is missing, request fails, or no content is returned
 */
async function scrapeWithExa(url, exaApiKey) {
  if (!exaApiKey) {
    throw new Error('Exa API key is required');
  }

  if (!url || !url.trim()) {
    throw new Error('URL is required');
  }

  const response = await fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': exaApiKey
    },
    body: JSON.stringify({
      urls: [url],
      text: true,
      highlights: true
    })
  });

  if (!response.ok) {
    throw new Error(`Exa API request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // Handle different response formats from Exa API
  const result = (data.results && data.results[0]) || 
                 (data.data && data.data[0]) || 
                 data.result;
  
  const text = result && (result.text || result.contents || result.content || '');
  
  if (!text) {
    throw new Error('No text content returned from Exa API');
  }

  return text;
}

// Export function
export { scrapeWithExa };

// Also support CommonJS for backward compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    scrapeWithExa
  };
}
