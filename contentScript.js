/**
 * Content Script - Handles message passing and overlay UI
 * 
 * DOM extraction functions are now imported from scraper/domExtractor.js
 * which is loaded before this script in the manifest.
 */

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
