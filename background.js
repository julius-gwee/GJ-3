// Import scraper service
import { scrapeUrl } from './scraper/scraperService.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === 'OPEN_APP') {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
    return;
  }

  if (message.type === 'SCRAPE_URL') {
    scrapeUrl(message.url)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
