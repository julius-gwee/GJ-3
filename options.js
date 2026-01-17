const form = document.getElementById('settingsForm');
const status = document.getElementById('status');

const fields = {
  exaKey: document.getElementById('exaKey'),
  llmEndpoint: document.getElementById('llmEndpoint'),
  llmModel: document.getElementById('llmModel'),
  llmMode: document.getElementById('llmMode'),
  llmKey: document.getElementById('llmKey')
};

const defaults = {
  exaApiKey: '',
  llmEndpoint: 'https://api.openai.com/v1/chat/completions',
  llmModel: 'gpt-4o-mini',
  llmMode: 'openai',
  llmApiKey: ''
};

function setStatus(message, tone = 'neutral') {
  status.textContent = message;
  status.style.color = tone === 'error' ? '#b42318' : '#1b7f79';
}

async function loadSettings() {
  const saved = await chrome.storage.sync.get(defaults);
  fields.exaKey.value = saved.exaApiKey || '';
  fields.llmEndpoint.value = saved.llmEndpoint || '';
  fields.llmModel.value = saved.llmModel || '';
  fields.llmMode.value = saved.llmMode || 'openai';
  fields.llmKey.value = saved.llmApiKey || '';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await chrome.storage.sync.set({
    exaApiKey: fields.exaKey.value.trim(),
    llmEndpoint: fields.llmEndpoint.value.trim(),
    llmModel: fields.llmModel.value.trim(),
    llmMode: fields.llmMode.value,
    llmApiKey: fields.llmKey.value.trim()
  });
  setStatus('Settings saved.');
});

loadSettings().catch(() => {
  setStatus('Failed to load settings.', 'error');
});
