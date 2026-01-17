/**
 * Scraper Service Module
 * 
 * This module handles the background service worker logic for URL scraping.
 * It coordinates between the extension and content scripts to scrape job listings
 * from URLs that the user provides.
 * 
 * The service:
 * 1. Creates a hidden tab with the target URL
 * 2. Waits for the page to load
 * 3. Injects the content script to extract data
 * 4. Returns the extracted data
 * 5. Cleans up by closing the tab
 */

/**
 * Waits for a Chrome tab to finish loading
 * 
 * @param {number} tabId - Chrome tab ID to wait for
 * @param {number} timeoutMs - Maximum time to wait in milliseconds (default: 15000)
 * @returns {Promise<void>} - Resolves when tab is loaded, rejects on timeout
 */
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for tab to load.'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }

    function onUpdated(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        cleanup();
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

/**
 * Scrapes a job listing URL by creating a hidden tab and extracting data
 * 
 * Process:
 * 1. Validates the URL format
 * 2. Creates a hidden tab with the URL
 * 3. Waits for the page to load completely
 * 4. Injects the content script (contentScript.js)
 * 5. Sends a message to the content script to extract job data
 * 6. Returns the extracted data
 * 7. Closes the tab (cleanup)
 * 
 * @param {string} url - Job listing URL to scrape
 * @param {string} contentScriptPath - Path to content script file (default: 'contentScript.js')
 * @returns {Promise<Object>} - Extracted job data object containing:
 *   - title: Job title
 *   - url: Job URL
 *   - description: Job description text
 *   - metaDescription: Meta description
 *   - company: Company name
 * @throws {Error} - If URL is invalid, tab creation fails, or extraction fails
 */
async function scrapeUrl(url, contentScriptPath = 'contentScript.js') {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('Please provide a valid http(s) URL.');
  }

  const tab = await chrome.tabs.create({ url, active: false });
  
  try {
    // Wait for the page to load
    await waitForTabLoad(tab.id);
    
    // Inject the content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [contentScriptPath]
    });
    
    // Send message to content script to extract job data
    const data = await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_JOB' });
    
    return data;
  } finally {
    // Always clean up the tab, even if there was an error
    if (tab.id) {
      chrome.tabs.remove(tab.id);
    }
  }
}

// Export functions
export { scrapeUrl, waitForTabLoad };

// Also support CommonJS for backward compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    scrapeUrl,
    waitForTabLoad
  };
}
