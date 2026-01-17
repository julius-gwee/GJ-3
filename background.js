chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'OPEN_APP') {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
  }
});
