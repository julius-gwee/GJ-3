const openAppButton = document.getElementById('openApp');
const openSettingsButton = document.getElementById('openSettings');

openAppButton.addEventListener('click', async () => {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      console.error('No active tab found');
      return;
    }

    // Send message to content script to inject overlay
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' });
    } catch (error) {
      // If content script isn't available, inject it first
      console.log('Content script not available, injecting...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['contentScript.js']
      });
      // Try sending message again
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' });
    }
    window.close();
  } catch (error) {
    console.error('Error opening app:', error);
  }
});

openSettingsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
