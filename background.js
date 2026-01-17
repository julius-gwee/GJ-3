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

async function scrapeUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('Please provide a valid http(s) URL.');
  }

  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabLoad(tab.id);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['contentScript.js']
    });
    const data = await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_JOB' });
    return data;
  } finally {
    if (tab.id) {
      chrome.tabs.remove(tab.id);
    }
  }
}

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
