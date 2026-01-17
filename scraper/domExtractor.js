/**
 * DOM Extractor Module
 * 
 * This module contains all functions for extracting job listing data from web pages.
 * It runs in the content script context and has access to the page's DOM.
 * 
 * The extraction process:
 * 1. Filters out non-content elements (nav, footer, ads, etc.)
 * 2. Uses priority selectors to find job-related content
 * 3. Extracts structured data (title, company, description) from various sources
 * 4. Falls back to less specific selectors if priority ones fail
 */

/**
 * Normalizes whitespace in text by collapsing multiple spaces into one
 * @param {string} text - Raw text to normalize
 * @returns {string} - Normalized text with single spaces
 */
function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Gets the content attribute value from a meta tag
 * @param {string} selector - CSS selector for the meta tag
 * @returns {string} - Content value or empty string
 */
function getMetaContent(selector) {
  const element = document.querySelector(selector);
  return element ? element.getAttribute('content') : '';
}

/**
 * Determines if a DOM node is likely to contain actual content (not navigation/ads)
 * Filters out common non-content elements like nav, footer, sidebar, ads, etc.
 * 
 * @param {Node} node - DOM node to check
 * @returns {boolean} - True if node likely contains content
 */
function isLikelyContent(node) {
  const tagName = node.tagName?.toLowerCase();
  const className = node.className?.toLowerCase() || '';
  const id = node.id?.toLowerCase() || '';
  
  // Exclude navigation, footer, sidebar, header elements
  const excludePatterns = [
    'nav', 'footer', 'header', 'sidebar', 'menu', 'cookie',
    'banner', 'ad', 'advertisement', 'social', 'share', 'comment',
    'related', 'recommended', 'similar', 'breadcrumb'
  ];
  
  for (const pattern of excludePatterns) {
    if (className.includes(pattern) || id.includes(pattern)) {
      return false;
    }
  }
  
  // Exclude script, style, noscript, iframe
  if (['script', 'style', 'noscript', 'iframe', 'svg'].includes(tagName)) {
    return false;
  }
  
  return true;
}

/**
 * Extracts clean text from a DOM node, removing non-content elements
 * Clones the node to avoid modifying the original DOM
 * 
 * @param {Node} node - DOM node to extract text from
 * @returns {string} - Clean, normalized text content
 */
function extractTextFromNode(node) {
  if (!node || !isLikelyContent(node)) {
    return '';
  }
  
  // Clone to avoid modifying the original
  const clone = node.cloneNode(true);
  
  // Remove script, style, and other non-content elements
  const toRemove = clone.querySelectorAll('script, style, noscript, iframe, nav, footer, header, [class*="nav"], [class*="footer"], [class*="header"], [class*="sidebar"], [class*="ad"]');
  toRemove.forEach(el => el.remove());
  
  return normalize(clone.innerText || clone.textContent || '');
}

/**
 * Extracts the main job description text from the page
 * Uses a priority-based selector system to find the most relevant content
 * 
 * Strategy:
 * 1. Try specific job-related selectors first (data-automation-id, job-description, etc.)
 * 2. Filter candidates by length (must be > 200 chars to be considered)
 * 3. Return the longest matching candidate (likely the main content)
 * 4. Fallback to main/article elements if no specific selectors match
 * 5. Last resort: filtered body text
 * 
 * @returns {string} - Extracted job description text
 */
function extractJobText() {
  // Priority selectors for job content (most specific first)
  const prioritySelectors = [
    '[data-automation-id*="job"]',
    '[class*="job-description"]',
    '[id*="job-description"]',
    '[class*="job-detail"]',
    '[id*="job-detail"]',
    '[class*="job-content"]',
    '[id*="job-content"]',
    '[itemprop="description"]',
    '[data-testid*="job"]',
    'article[class*="job"]',
    'section[class*="job"]',
    '[class*="description"]',
    '[id*="description"]',
    '[class*="responsib"]',
    '[id*="responsib"]',
    '[class*="requirement"]',
    '[id*="requirement"]',
    'article',
    'main'
  ];

  const candidates = [];
  
  // Try priority selectors first
  for (const selector of prioritySelectors) {
    try {
      const nodes = document.querySelectorAll(selector);
      nodes.forEach((node) => {
        if (isLikelyContent(node)) {
          const text = extractTextFromNode(node);
          if (text.length > 200) {
            candidates.push({ text, selector, length: text.length });
          }
        }
      });
    } catch (e) {
      // Invalid selector, skip
    }
  }

  // If we found candidates, return the longest one
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0].text;
  }

  // Fallback: try to get main content area
  const mainContent = document.querySelector('main, article, [role="main"], .content, #content');
  if (mainContent) {
    const text = extractTextFromNode(mainContent);
    if (text.length > 200) {
      return text;
    }
  }

  // Last resort: body text with filtering
  const bodyText = extractTextFromNode(document.body);
  return bodyText.length > 0 ? bodyText : '';
}

/**
 * Extracts the job title from the page
 * Uses multiple strategies in order of reliability:
 * 1. Structured data (JSON-LD with JobPosting schema)
 * 2. Open Graph meta tags
 * 3. Common job title selectors (h1, job-title classes, etc.)
 * 4. Page title (cleaned to remove job board suffixes)
 * 
 * @returns {string} - Extracted job title
 */
function extractJobTitle() {
  // Try structured data first (most reliable)
  const jsonLd = document.querySelector('script[type="application/ld+json"]');
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd.textContent);
      if (data['@type'] === 'JobPosting' && data.title) {
        return data.title;
      }
      if (Array.isArray(data) && data[0]?.['@type'] === 'JobPosting' && data[0].title) {
        return data[0].title;
      }
    } catch (e) {
      // Invalid JSON, continue
    }
  }

  // Try meta tags
  const ogTitle = getMetaContent('meta[property="og:title"]');
  if (ogTitle && !ogTitle.toLowerCase().includes('job board')) {
    return ogTitle;
  }

  // Try common job title selectors
  const titleSelectors = [
    'h1[class*="job"]',
    'h1[class*="title"]',
    '[class*="job-title"]',
    '[id*="job-title"]',
    '[data-automation-id*="job-title"]',
    '[itemprop="title"]',
    'h1'
  ];

  for (const selector of titleSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const text = normalize(element.innerText || element.textContent || '');
        if (text.length > 0 && text.length < 200) {
          return text;
        }
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }

  // Fallback to page title, but try to clean it
  const pageTitle = document.title || '';
  // Remove common suffixes like " | LinkedIn", " - Indeed", etc.
  return pageTitle.split('|')[0].split('-')[0].trim();
}

/**
 * Extracts the company name from the page
 * Uses multiple strategies:
 * 1. Structured data (JSON-LD with hiringOrganization)
 * 2. Company-specific meta tags
 * 3. Common company name selectors in the DOM
 * 4. Site name from meta tags (less reliable, often the job board name)
 * 
 * @returns {string} - Extracted company name
 */
function extractCompanyName() {
  // Try structured data first
  const jsonLd = document.querySelector('script[type="application/ld+json"]');
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd.textContent);
      if (data['@type'] === 'JobPosting' && data.hiringOrganization?.name) {
        return data.hiringOrganization.name;
      }
      if (Array.isArray(data) && data[0]?.['@type'] === 'JobPosting' && data[0].hiringOrganization?.name) {
        return data[0].hiringOrganization.name;
      }
    } catch (e) {
      // Invalid JSON, continue
    }
  }

  // Try meta tags (but prefer content over site name)
  const companyMeta = getMetaContent('meta[property="og:company"]') || 
                      getMetaContent('meta[name="company"]');
  if (companyMeta) {
    return companyMeta;
  }

  // Try common company selectors
  const companySelectors = [
    '[class*="company-name"]',
    '[id*="company-name"]',
    '[class*="employer"]',
    '[id*="employer"]',
    '[itemprop="hiringOrganization"]',
    '[data-automation-id*="company"]'
  ];

  for (const selector of companySelectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const text = normalize(element.innerText || element.textContent || '');
        if (text.length > 0 && text.length < 100) {
          return text;
        }
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }

  // Fallback to site name, but this is often the job board
  const siteName = getMetaContent('meta[property="og:site_name"]');
  const author = getMetaContent('meta[name="author"]');
  return siteName || author || '';
}

/**
 * Main extraction function that combines all extractors
 * Extracts all available job data from the current page
 * 
 * @returns {Object} - Object containing:
 *   - title: Job title
 *   - url: Current page URL
 *   - description: Main job description text
 *   - metaDescription: Meta description or OG description
 *   - company: Company name
 */
function extractJobData() {
  const title = extractJobTitle();
  const url = window.location.href;
  const description = extractJobText();
  const metaDescription = getMetaContent('meta[name="description"]');
  const ogDescription = getMetaContent('meta[property="og:description"]');
  const company = extractCompanyName();

  return {
    title,
    url,
    description,
    metaDescription: metaDescription || ogDescription,
    company
  };
}

// Make functions available globally for content scripts
// Content scripts load this as a regular script (not module), so functions are in global scope
if (typeof window !== 'undefined') {
  window.extractJobData = extractJobData;
  window.extractJobText = extractJobText;
  window.extractJobTitle = extractJobTitle;
  window.extractCompanyName = extractCompanyName;
  window.normalize = normalize;
  window.getMetaContent = getMetaContent;
  window.isLikelyContent = isLikelyContent;
  window.extractTextFromNode = extractTextFromNode;
}

// Export functions for use in ES6 modules
export {
  normalize,
  getMetaContent,
  isLikelyContent,
  extractTextFromNode,
  extractJobText,
  extractJobTitle,
  extractCompanyName,
  extractJobData
};

// Also support CommonJS for backward compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalize,
    getMetaContent,
    isLikelyContent,
    extractTextFromNode,
    extractJobText,
    extractJobTitle,
    extractCompanyName,
    extractJobData
  };
}
