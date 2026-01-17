const openAppButton = document.getElementById('openApp');
const openSettingsButton = document.getElementById('openSettings');

openAppButton.addEventListener('click', async () => {
  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Send message to content script to inject overlay
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' });
  window.close();
});

openSettingsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
