function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function getMetaContent(selector) {
  const element = document.querySelector(selector);
  return element ? element.getAttribute('content') : '';
}

function extractJobText() {
  const selectors = [
    '[data-automation-id*="job"]',
    '[class*="job"]',
    '[id*="job"]',
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
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      const text = normalize(node.innerText || '');
      if (text.length > 200) {
        candidates.push(text);
      }
    });
  });

  const fallback = normalize(document.body ? document.body.innerText || '' : '');
  if (!candidates.length) {
    return fallback;
  }

  candidates.sort((a, b) => b.length - a.length);
  const longest = candidates[0];
  return longest.length > 0 ? longest : fallback;
}

function extractJobData() {
  const title = document.title || '';
  const url = window.location.href;
  const description = extractJobText();
  const metaDescription = getMetaContent('meta[name="description"]');
  const ogDescription = getMetaContent('meta[property="og:description"]');
  const siteName = getMetaContent('meta[property="og:site_name"]');
  const author = getMetaContent('meta[name="author"]');
  const company = siteName || author || '';

  return {
    title,
    url,
    description,
    metaDescription: metaDescription || ogDescription,
    company
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'SCRAPE_JOB') {
    sendResponse(extractJobData());
  }
});
