const openAppButton = document.getElementById('openApp');
const openSettingsButton = document.getElementById('openSettings');

openAppButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_APP' });
  window.close();
});

openSettingsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
