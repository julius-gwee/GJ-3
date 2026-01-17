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

let overlayIframe = null;

function toggleOverlay() {
  if (overlayIframe) {
    // Remove existing overlay
    overlayIframe.remove();
    overlayIframe = null;
    return;
  }

  // Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'tailorresume-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.2s ease;
  `;

  // Create iframe for the app
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('app.html');
  iframe.style.cssText = `
    width: 90%;
    max-width: 1100px;
    height: 90%;
    border: none;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    background: white;
    animation: slideUp 0.3s ease;
  `;

  // Close overlay when clicking outside
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      toggleOverlay();
    }
  });

  // Add close button
  const closeButton = document.createElement('button');
  closeButton.innerHTML = '✕';
  closeButton.style.cssText = `
    position: absolute;
    top: 20px;
    right: 20px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.95);
    color: #1f1b16;
    font-size: 20px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 1;
    transition: transform 0.2s ease, background 0.2s ease;
  `;
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.transform = 'scale(1.1)';
    closeButton.style.background = '#fff';
  });
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.transform = 'scale(1)';
    closeButton.style.background = 'rgba(255, 255, 255, 0.95)';
  });
  closeButton.addEventListener('click', toggleOverlay);

  overlay.appendChild(iframe);
  overlay.appendChild(closeButton);
  document.body.appendChild(overlay);

  overlayIframe = overlay;

  // Add animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `;
  document.head.appendChild(style);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'SCRAPE_JOB') {
    sendResponse(extractJobData());
  } else if (message && message.type === 'TOGGLE_OVERLAY') {
    toggleOverlay();
  }
});
