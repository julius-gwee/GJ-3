/**
 * Scraper Module Index
 * 
 * Main entry point for all scraping functionality.
 * Re-exports all scraping modules for easy importing.
 */

// Note: In a browser extension context, these will be loaded as separate scripts
// This index file is for documentation and potential future bundling

export {
  // DOM extraction (runs in content script context)
  extractJobData,
  extractJobText,
  extractJobTitle,
  extractCompanyName
} from './domExtractor.js';

export {
  // Job parsing (runs in app context)
  parseJobWithLLM,
  fallbackParseJob
} from './jobParser.js';

export {
  // Exa API scraping (runs in app context)
  scrapeWithExa
} from './exaScraper.js';

export {
  // Background service (runs in service worker context)
  scrapeUrl,
  waitForTabLoad
} from './scraperService.js';
