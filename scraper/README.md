# Scraper Module Documentation

This folder contains all web scraping logic for the Tailor Resume extension. The scraping functionality is organized into clear, focused modules.

## Architecture Overview

The scraping system uses a multi-stage approach:

```
User provides URL
    ↓
Background Service (scraperService.js)
    ↓ Creates hidden tab, injects content script
Content Script (domExtractor.js)
    ↓ Extracts raw data from DOM
App Context (jobParser.js)
    ↓ Parses raw data into structured format
Result: Structured job data
```

## Module Structure

### 1. `domExtractor.js` - DOM Extraction
**Context:** Content Script (runs on web pages)

**Purpose:** Extracts raw job listing data from web page DOM

**Key Functions:**
- `extractJobData()` - Main function that extracts all job data
- `extractJobText()` - Extracts main job description text
- `extractJobTitle()` - Extracts job title from various sources
- `extractCompanyName()` - Extracts company name
- `isLikelyContent()` - Filters out non-content elements
- `extractTextFromNode()` - Cleans text from DOM nodes

**How it works:**
1. Uses priority-based CSS selectors to find job content
2. Filters out navigation, footer, ads, and other non-content
3. Tries structured data (JSON-LD) first, then meta tags, then DOM selectors
4. Falls back to less specific selectors if priority ones fail

**Example:**
```javascript
// In content script context
const jobData = extractJobData();
// Returns: { title, url, description, metaDescription, company }
```

---

### 2. `jobParser.js` - Job Parsing
**Context:** App (runs in extension popup/app)

**Purpose:** Parses raw scraped text into structured fields

**Key Functions:**
- `parseJobWithLLM()` - Uses LLM to intelligently parse job text
- `fallbackParseJob()` - Uses heuristics when LLM unavailable

**How it works:**

**LLM Parsing:**
1. Truncates long text to stay within token limits
2. Sends structured prompt to LLM asking for JSON extraction
3. Handles both OpenAI-compatible and generic API formats
4. Extracts JSON from markdown code blocks if present
5. Returns structured object with: jobTitle, companyName, description, requirements, additionalContext

**Fallback Parsing:**
1. Uses scraped title/company from DOM extraction
2. Analyzes text for section headings (description, requirements, etc.)
3. Looks for keywords to identify different sections
4. Extracts tech stack and other context information
5. Returns structured object (less accurate than LLM)

**Example:**
```javascript
// With LLM
const parsed = await parseJobWithLLM(rawText, url, settings, callOpenAi, callGeneric);

// Without LLM (fallback)
const parsed = fallbackParseJob(rawText, url, scrapedData);
```

---

### 3. `exaScraper.js` - Exa API Integration
**Context:** App (runs in extension popup/app)

**Purpose:** Deep scraping using Exa API for better content extraction

**Key Functions:**
- `scrapeWithExa()` - Scrapes URL using Exa API

**How it works:**
1. Validates Exa API key and URL
2. Sends POST request to Exa API
3. Extracts text content from response
4. Returns raw text for further processing

**Example:**
```javascript
const text = await scrapeWithExa(url, exaApiKey);
// Returns: Raw text content from the page
```

---

### 4. `scraperService.js` - Background Service
**Context:** Service Worker (background script)

**Purpose:** Coordinates URL scraping by managing tabs and content script injection

**Key Functions:**
- `scrapeUrl()` - Main function that orchestrates the scraping process
- `waitForTabLoad()` - Waits for a tab to finish loading

**How it works:**
1. Creates a hidden tab with the target URL
2. Waits for page to load completely
3. Injects content script into the page
4. Sends message to content script to extract data
5. Returns extracted data
6. Closes the tab (cleanup)

**Example:**
```javascript
// In background service worker
const jobData = await scrapeUrl('https://example.com/job');
// Returns: { title, url, description, metaDescription, company }
```

---

## Data Flow

### Standard Scraping Flow

```
1. User clicks "Scrape job URL" in app
   ↓
2. app.js calls chrome.runtime.sendMessage({ type: 'SCRAPE_URL', url })
   ↓
3. background.js receives message, calls scrapeUrl(url)
   ↓
4. scraperService.js creates hidden tab, waits for load
   ↓
5. Content script (contentScript.js) is injected
   ↓
6. Content script calls extractJobData() from domExtractor.js
   ↓
7. domExtractor.js extracts raw data from DOM
   ↓
8. Data returned to background.js, then to app.js
   ↓
9. app.js calls parseJobWithLLM() or fallbackParseJob()
   ↓
10. jobParser.js parses raw text into structured data
   ↓
11. Structured data populates form fields
```

### Exa Deep Scraping Flow

```
1. User clicks "Deep scrape (Exa)" in app
   ↓
2. app.js calls scrapeWithExa() from exaScraper.js
   ↓
3. exaScraper.js sends request to Exa API
   ↓
4. Exa returns clean text content
   ↓
5. app.js calls parseJobWithLLM() or fallbackParseJob()
   ↓
6. jobParser.js parses text into structured data
   ↓
7. Structured data populates form fields
```

## Usage Examples

### In Content Script (contentScript.js)

```javascript
// Import DOM extractor functions
// (In extension, these are loaded as separate script tags)

// Extract job data from current page
const jobData = extractJobData();
chrome.runtime.sendMessage({ type: 'SCRAPE_JOB', data: jobData });
```

### In App Context (app.js)

```javascript
// Import parser functions
import { parseJobWithLLM, fallbackParseJob } from './scraper/jobParser.js';
import { scrapeWithExa } from './scraper/exaScraper.js';

// Parse with LLM
const settings = await getSettings();
const parsed = await parseJobWithLLM(rawText, url, settings, callOpenAi, callGeneric);

// Or use fallback
const parsed = fallbackParseJob(rawText, url, scrapedData);

// Deep scrape with Exa
const exaText = await scrapeWithExa(url, settings.exaApiKey);
```

### In Background Service (background.js)

```javascript
// Import scraper service
import { scrapeUrl } from './scraper/scraperService.js';

// Scrape a URL
const jobData = await scrapeUrl('https://example.com/job');
```

## Configuration

### Required Settings

- **LLM API Key** (optional but recommended): For intelligent parsing
- **LLM Endpoint**: API endpoint URL (e.g., `https://api.openai.com/v1/chat/completions`)
- **LLM Model**: Model name (e.g., `gpt-4o-mini`)
- **LLM Mode**: `'openai'` or `'generic'`
- **Exa API Key** (optional): For deep scraping

### Settings Location

Settings are stored in `chrome.storage.sync` and can be configured in the extension's options page.

## Error Handling

All modules include error handling:

- **DOM Extraction**: Returns empty strings if extraction fails, never throws
- **LLM Parsing**: Throws errors that should be caught and fallback to heuristic parsing
- **Exa Scraping**: Throws errors for missing API key, invalid URL, or API failures
- **Scraper Service**: Throws errors for invalid URLs or tab creation failures

## Performance Considerations

1. **DOM Extraction**: Fast, runs synchronously in content script
2. **LLM Parsing**: Slower, requires API call (typically 2-5 seconds)
3. **Exa Scraping**: Slower, requires API call (typically 3-10 seconds)
4. **Tab Management**: Hidden tabs are created and destroyed quickly

## Future Improvements

Potential enhancements:
- Cache scraped data to avoid re-scraping same URLs
- Support for more job board formats
- Better handling of JavaScript-rendered content
- Parallel scraping of multiple URLs
- Offline fallback parsing improvements

## Dependencies

- **Chrome Extension APIs**: `chrome.tabs`, `chrome.scripting`, `chrome.runtime`
- **Fetch API**: For Exa API calls
- **No external libraries**: All code is vanilla JavaScript
