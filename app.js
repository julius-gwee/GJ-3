// --- UI references and shared state ---
const elements = {
  originalDoc: document.getElementById('originalDoc'),
  tailoredDoc: document.getElementById('tailoredDoc'),
  extractOriginal: document.getElementById('extractOriginal'),
  extractTailored: document.getElementById('extractTailored'),
  jobUrl: document.getElementById('jobUrl'),
  jobTitle: document.getElementById('jobTitle'),
  companyName: document.getElementById('companyName'),
  jobDescription: document.getElementById('jobDescription'),
  additionalContext: document.getElementById('additionalContext'),
  scrapeJob: document.getElementById('scrapeJob'),
  deepScrape: document.getElementById('deepScrape'),
  generateResume: document.getElementById('generateResume'),
  status: document.getElementById('status'),
  diffList: document.getElementById('diffList'),
  applyDiff: document.getElementById('applyDiff'),
  toggleInlineDiff: document.getElementById('toggleInlineDiff'),
  exportPdf: document.getElementById('exportPdf'),
  copyText: document.getElementById('copyText'),
  exportStatus: document.getElementById('exportStatus'),
  openSettings: document.getElementById('openSettings'),
  pdfTemplate: document.getElementById('pdfTemplate'),
  pdfContent: document.getElementById('pdfContent')
};

const defaults = {
  exaApiKey: '',
  llmEndpoint: 'https://api.openai.com/v1/chat/completions',
  llmModel: 'gpt-4o-mini',
  llmMode: 'openai',
  llmApiKey: ''
};

const state = {
  resumeText: '',
  tailoredText: '',
  diffsWithGroup: [],
  diffGroups: [],
  finalText: '',
  finalHtml: '',
  inlineDiff: false
};

let resumeQuill;
let finalQuill;

// --- Settings + text helpers ---
function setStatus(message, tone = 'info') {
  elements.status.textContent = message;
  elements.status.style.color = tone === 'error' ? '#b42318' : '#1b7f79';
}

function setExportStatus(message, tone = 'info') {
  elements.exportStatus.textContent = message;
  elements.exportStatus.style.color = tone === 'error' ? '#b42318' : '#1b7f79';
}

async function getSettings() {
  return chrome.storage.sync.get(defaults);
}

function normalizeText(text) {
  return text
    .replace(/\r/g, '')
    .replace(/-\s+\n/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text) {
  if (!text) {
    return '';
  }

  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function getEditorText(quill) {
  if (!quill) {
    return '';
  }
  return normalizeText(quill.getText() || '');
}

function setEditorText(quill, text) {
  if (!quill) {
    return;
  }
  quill.setText('');
  quill.clipboard.dangerouslyPasteHTML(textToHtml(text));
}

function setEditorHtml(quill, html) {
  if (!quill) {
    return;
  }
  quill.setText('');
  quill.clipboard.dangerouslyPasteHTML(html || '');
}

// --- Word extraction ---
async function extractDocxText(file) {
  const buffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
  return normalizeText(result.value || '');
}

// --- Job scraping (URL-based) ---
async function prefillActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      elements.jobUrl.value = tab.url;
    }
  } catch (error) {
    // Ignore if tabs permission is unavailable.
  }
}

async function scrapeCurrentTab() {
  setStatus('Scraping job URL...');
  console.log('Scraping URL:', elements.jobUrl.value);
  try {
    const url = elements.jobUrl.value.trim();
    if (!url) {
      setStatus('Add a job URL first.', 'error');
      console.log('No job URL provided.');
      return;
    }

    const response = await chrome.runtime.sendMessage({ type: 'SCRAPE_URL', url });
    if (!response || !response.ok) {
      setStatus(response && response.error ? response.error : 'Scrape failed.', 'error');
      console.log('Scrape failed:', response && response.error);
      return;
    }

    const data = response.data;
    if (!data) {
      setStatus('Could not read this page.', 'error');
      console.log('No data returned from background scrape.');
      return;
    }

    elements.jobTitle.value = data.title || elements.jobTitle.value;
    elements.companyName.value = data.company || elements.companyName.value;
    const combinedDescription = [data.description, data.metaDescription]
      .filter(Boolean)
      .join('\n\n');
    if (combinedDescription) {
      elements.jobDescription.value = combinedDescription;
    }
    console.log('Scraped data:', data);

    setStatus('Job details pulled from the URL.');
  } catch (error) {
    setStatus('Scrape failed. Check the URL and try again.', 'error');
    console.log('Scrape error:', error);
  }
}

// --- Exa deep scrape ---
async function deepScrapeExa() {
  setStatus('Deep scraping with Exa...');
  const settings = await getSettings();
  if (!settings.exaApiKey) {
    setStatus('Add your Exa API key in Settings.', 'error');
    return;
  }

  const url = elements.jobUrl.value.trim();
  if (!url) {
    setStatus('Add a job URL first.', 'error');
    return;
  }

  try {
    const response = await fetch('https://api.exa.ai/contents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.exaApiKey
      },
      body: JSON.stringify({
        urls: [url],
        text: true,
        highlights: true
      })
    });

    if (!response.ok) {
      throw new Error('Exa request failed.');
    }

    const data = await response.json();
    const result = (data.results && data.results[0]) || (data.data && data.data[0]) || data.result;
    const text = result && (result.text || result.contents || result.content || '');
    if (text) {
      elements.jobDescription.value = text;
      setStatus('Exa content loaded.');
    } else {
      setStatus('No text returned from Exa.', 'error');
    }
  } catch (error) {
    setStatus('Exa scrape failed. Check your key and URL.', 'error');
  }
}

// --- LLM tailoring + diffing ---
function buildPrompt(resumeText, job) {
  return `Resume:\n${resumeText}\n\nJob description:\n${job.description}\n\nCompany: ${job.company}\nRole: ${job.title}\nURL: ${job.url}\nAdditional context:\n${job.additional}\n\nInstructions:\n- Tailor the resume to highlight relevant skills and experience.\n- Do not invent roles, companies, degrees, or metrics.\n- Keep the same overall structure and tone when possible.\n- Return only the revised resume text.`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

async function callOpenAi(settings, prompt) {
  const response = await fetch(settings.llmEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.llmApiKey}`
    },
    body: JSON.stringify({
      model: settings.llmModel || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You tailor resumes to job descriptions while staying truthful.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error('LLM request failed.');
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';

  return content ? content.trim() : '';
}

async function callGeneric(settings, payload) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (settings.llmApiKey) {
    headers.Authorization = `Bearer ${settings.llmApiKey}`;
  }

  const response = await fetch(settings.llmEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('Generic LLM request failed.');
  }

  const data = await response.json();
  return data.tailoredText || data.text || '';
}

function extractKeywords(text, limit = 14) {
  const stopwords = new Set([
    'the', 'and', 'with', 'for', 'that', 'this', 'from', 'are', 'you', 'your', 'will', 'our',
    'into', 'about', 'able', 'have', 'has', 'had', 'job', 'role', 'team', 'work', 'can', 'use',
    'using', 'who', 'what', 'when', 'where', 'why', 'how', 'per', 'via', 'all', 'any', 'not',
    'but', 'out', 'in', 'on', 'of', 'to', 'a', 'an', 'or', 'as', 'be', 'by', 'is', 'at'
  ]);

  const words = (text || '').toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) || [];
  const counts = {};
  words.forEach((word) => {
    if (stopwords.has(word)) {
      return;
    }
    counts[word] = (counts[word] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function fallbackTailor(resumeText, job) {
  const keywords = extractKeywords(`${job.description} ${job.additional}`);
  if (!keywords.length) {
    return resumeText;
  }

  const keywordLine = `Targeted keywords: ${keywords.join(', ')}`;
  return `${resumeText}\n\n${keywordLine}`;
}

function computeDiffs(originalText, tailoredText) {
  const dmp = new window.diff_match_patch();
  const diffs = dmp.diff_main(originalText, tailoredText);
  dmp.diff_cleanupSemantic(diffs);

  let groupId = -1;
  const diffsWithGroup = diffs.map((diff, index) => {
    const [op, text] = diff;
    if (op === window.DIFF_EQUAL) {
      return { op, text, groupId: null };
    }

    const prev = diffs[index - 1];
    if (!prev || prev[0] === window.DIFF_EQUAL) {
      groupId += 1;
    }

    return { op, text, groupId };
  });

  const groups = [];
  diffsWithGroup.forEach((segment) => {
    if (segment.groupId === null) {
      return;
    }

    let group = groups.find((item) => item.id === segment.groupId);
    if (!group) {
      group = {
        id: segment.groupId,
        deleteText: '',
        insertText: '',
        accepted: true
      };
      groups.push(group);
    }

    if (segment.op === window.DIFF_DELETE) {
      group.deleteText += segment.text;
    } else if (segment.op === window.DIFF_INSERT) {
      group.insertText += segment.text;
    }
  });

  return { diffsWithGroup, groups };
}

function buildInlineDiffDelta(originalText, tailoredText) {
  const dmp = new window.diff_match_patch();
  const diffs = dmp.diff_main(originalText, tailoredText);
  dmp.diff_cleanupSemantic(diffs);

  const Delta = window.Quill.import('delta');
  let delta = new Delta();

  diffs.forEach(([op, text]) => {
    if (!text) {
      return;
    }

    if (op === window.DIFF_INSERT) {
      delta = delta.insert(text, { background: '#d7f5f0', color: '#0f5b57' });
    } else if (op === window.DIFF_DELETE) {
      delta = delta.insert(text, { background: '#f8d7d4', color: '#a02525', strike: true });
    } else {
      delta = delta.insert(text);
    }
  });

  return delta;
}

function buildFinalText() {
  if (!state.diffsWithGroup.length) {
    return state.tailoredText || state.resumeText;
  }

  const acceptance = new Map(state.diffGroups.map((group) => [group.id, group.accepted]));
  let result = '';

  state.diffsWithGroup.forEach((segment) => {
    if (segment.groupId === null) {
      result += segment.text;
      return;
    }

    const accepted = acceptance.get(segment.groupId);
    if (accepted && segment.op === window.DIFF_INSERT) {
      result += segment.text;
    } else if (!accepted && segment.op === window.DIFF_DELETE) {
      result += segment.text;
    }
  });

  return result;
}

function renderDiffs() {
  elements.diffList.innerHTML = '';

  if (!state.diffGroups.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No changes to review.';
    empty.className = 'hint';
    elements.diffList.appendChild(empty);
    return;
  }

  state.diffGroups.forEach((group, index) => {
    const item = document.createElement('div');
    item.className = 'diff-item';

    const header = document.createElement('div');
    header.className = 'diff-header';

    const title = document.createElement('div');
    title.className = 'diff-title';
    title.textContent = `Change ${index + 1}`;

    const toggle = document.createElement('label');
    toggle.className = 'diff-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = group.accepted;
    checkbox.addEventListener('change', () => {
      group.accepted = checkbox.checked;
    });
    toggle.appendChild(checkbox);
    const toggleText = document.createElement('span');
    toggleText.textContent = 'Accept';
    toggle.appendChild(toggleText);

    header.appendChild(title);
    header.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'diff-body';

    const originalBlock = document.createElement('div');
    originalBlock.className = 'diff-block diff-delete';
    const originalPre = document.createElement('pre');
    originalPre.textContent = group.deleteText || '(no text)';
    originalBlock.appendChild(originalPre);

    const newBlock = document.createElement('div');
    newBlock.className = 'diff-block diff-insert';
    const newPre = document.createElement('pre');
    newPre.textContent = group.insertText || '(no text)';
    newBlock.appendChild(newPre);

    body.appendChild(originalBlock);
    body.appendChild(newBlock);

    item.appendChild(header);
    item.appendChild(body);
    elements.diffList.appendChild(item);
  });
}

async function generateTailoredResume() {
  setStatus('Generating tailored resume...');
  const resumeText = getEditorText(resumeQuill);
  if (!resumeText) {
    setStatus('Please upload and extract a resume DOCX first.', 'error');
    return;
  }

  const job = {
    url: elements.jobUrl.value.trim(),
    title: elements.jobTitle.value.trim(),
    company: elements.companyName.value.trim(),
    description: elements.jobDescription.value.trim().slice(0, 6000),
    additional: elements.additionalContext.value.trim().slice(0, 2000)
  };

  if (!job.description) {
    setStatus('Add a job description first.', 'error');
    return;
  }

  const settings = await getSettings();
  let tailoredText = '';

  try {
    if (!settings.llmEndpoint || !settings.llmApiKey) {
      tailoredText = fallbackTailor(resumeText, job);
    } else if (settings.llmMode === 'generic') {
      tailoredText = await callGeneric(settings, {
        resumeText,
        job,
        instructions: 'Tailor the resume to the job while remaining truthful.'
      });
    } else {
      const prompt = buildPrompt(resumeText, job);
      const responseText = await callOpenAi(settings, prompt);
      const parsed = safeJsonParse(responseText);
      tailoredText = parsed && parsed.tailoredText ? parsed.tailoredText : responseText;
    }

    if (!tailoredText) {
      throw new Error('Empty response');
    }

    state.resumeText = resumeText;
    state.tailoredText = tailoredText;
    const diffResult = computeDiffs(resumeText, tailoredText);
    state.diffsWithGroup = diffResult.diffsWithGroup;
    state.diffGroups = diffResult.groups;
    renderDiffs();
    const finalText = buildFinalText();
    state.finalText = finalText;
    state.inlineDiff = false;
    setEditorText(finalQuill, finalText);
    state.finalHtml = finalQuill.root.innerHTML;
    finalQuill.enable(true);
    updateInlineDiffButton();
    setStatus('Tailored resume ready. Review changes below.');
  } catch (error) {
    setStatus('Tailoring failed. Check your LLM settings.', 'error');
  }
}

// --- Export actions ---
async function exportPdf() {
  const text = state.inlineDiff ? state.finalText : getEditorText(finalQuill);
  if (!text) {
    setExportStatus('Add final text before exporting.', 'error');
    return;
  }

  const html = state.inlineDiff ? state.finalHtml : finalQuill.root.innerHTML;
  elements.pdfContent.innerHTML = html || textToHtml(text);
  elements.pdfTemplate.hidden = false;
  elements.pdfTemplate.style.display = 'block';

  try {
    await window.html2pdf()
      .set({
        margin: 12,
        filename: 'tailored-resume.pdf',
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      })
      .from(elements.pdfContent)
      .save();
    setExportStatus('PDF exported.');
  } catch (error) {
    setExportStatus('Export failed.', 'error');
  } finally {
    elements.pdfTemplate.style.display = 'none';
    elements.pdfTemplate.hidden = true;
  }
}

async function copyFinalText() {
  const text = state.inlineDiff ? state.finalText : getEditorText(finalQuill);
  if (!text) {
    setExportStatus('Nothing to copy.', 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setExportStatus('Copied to clipboard.');
  } catch (error) {
    setExportStatus('Copy failed.', 'error');
  }
}

async function handleExtractOriginal() {
  setStatus('Extracting resume...');
  const file = elements.originalDoc.files[0];
  if (!file) {
    setStatus('Select an original DOCX file first.', 'error');
    return;
  }

  try {
    const text = await extractDocxText(file);
    setEditorText(resumeQuill, text);
    state.resumeText = text;
    setStatus('Original resume loaded.');
    refreshDiffsFromUploads();
  } catch (error) {
    setStatus('DOCX extraction failed.', 'error');
  }
}

async function handleExtractTailored() {
  setStatus('Extracting tailored resume...');
  const file = elements.tailoredDoc.files[0];
  if (!file) {
    setStatus('Select a tailored DOCX file first.', 'error');
    return;
  }

  try {
    const text = await extractDocxText(file);
    state.tailoredText = text;
    setEditorText(finalQuill, text);
    state.finalText = text;
    state.finalHtml = finalQuill.root.innerHTML;
    finalQuill.enable(true);
    updateInlineDiffButton();
    setStatus('Tailored resume loaded.');
    refreshDiffsFromUploads();
  } catch (error) {
    setStatus('DOCX extraction failed.', 'error');
  }
}

function refreshDiffsFromUploads() {
  if (!state.resumeText || !state.tailoredText) {
    return;
  }

  const diffResult = computeDiffs(state.resumeText, state.tailoredText);
  state.diffsWithGroup = diffResult.diffsWithGroup;
  state.diffGroups = diffResult.groups;
  renderDiffs();

  const finalText = buildFinalText();
  state.finalText = finalText;
  state.inlineDiff = false;
  setEditorText(finalQuill, finalText);
  state.finalHtml = finalQuill.root.innerHTML;
  finalQuill.enable(true);
  updateInlineDiffButton();
}

function applyDiffSelections() {
  const finalText = buildFinalText();
  state.finalText = finalText;
  state.inlineDiff = false;
  setEditorText(finalQuill, finalText);
  state.finalHtml = finalQuill.root.innerHTML;
  finalQuill.enable(true);
  updateInlineDiffButton();
  setExportStatus('Applied selected changes.');
}

function updateInlineDiffButton() {
  elements.toggleInlineDiff.textContent = state.inlineDiff ? 'Hide inline diff' : 'Show inline diff';
}

function toggleInlineDiff() {
  if (!state.resumeText || !state.tailoredText) {
    setExportStatus('Generate a tailored resume first.', 'error');
    return;
  }

  if (!state.inlineDiff) {
    state.inlineDiff = true;
    state.finalText = getEditorText(finalQuill);
    state.finalHtml = finalQuill.root.innerHTML;
    const diffDelta = buildInlineDiffDelta(state.resumeText, state.tailoredText);
    finalQuill.setContents(diffDelta);
    finalQuill.enable(false);
  } else {
    state.inlineDiff = false;
    finalQuill.enable(true);
    setEditorHtml(finalQuill, state.finalHtml || textToHtml(state.finalText || state.tailoredText));
  }

  updateInlineDiffButton();
}

function initEditors() {
  resumeQuill = new window.Quill('#resumeEditor', {
    theme: 'snow',
    placeholder: 'Extracted resume content appears here...',
    modules: { toolbar: '#resumeToolbar' }
  });

  finalQuill = new window.Quill('#finalEditor', {
    theme: 'snow',
    placeholder: 'Final resume content...',
    modules: { toolbar: '#finalToolbar' }
  });
}

// --- UI wiring ---
function attachListeners() {
  elements.extractOriginal.addEventListener('click', handleExtractOriginal);
  elements.extractTailored.addEventListener('click', handleExtractTailored);
  elements.scrapeJob.addEventListener('click', scrapeCurrentTab);
  elements.deepScrape.addEventListener('click', deepScrapeExa);
  elements.generateResume.addEventListener('click', generateTailoredResume);
  elements.applyDiff.addEventListener('click', applyDiffSelections);
  elements.toggleInlineDiff.addEventListener('click', toggleInlineDiff);
  elements.exportPdf.addEventListener('click', exportPdf);
  elements.copyText.addEventListener('click', copyFinalText);
  elements.openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

attachListeners();
initEditors();
updateInlineDiffButton();
prefillActiveTab();
