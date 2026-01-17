// Import scraping modules
import { parseJobWithLLM, fallbackParseJob } from './scraper/jobParser.js';
import { scrapeWithExa } from './scraper/exaScraper.js';

// --- UI references and shared state ---
const elements = {
  resumeFile: document.getElementById('resumeFile'),
  extractResume: document.getElementById('extractResume'),
  resumeText: document.getElementById('resumeText'),
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
  finalText: document.getElementById('finalText'),
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
  diffGroups: []
};

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

    const scrapedData = response.data;
    if (!scrapedData) {
      setStatus('Could not read this page.', 'error');
      console.log('No data returned from background scrape.');
      return;
    }

    // Combine all text for parsing
    const rawText = [
      scrapedData.description,
      scrapedData.metaDescription
    ].filter(Boolean).join('\n\n');

    if (!rawText) {
      setStatus('No content found on this page.', 'error');
      return;
    }

    // Try LLM parsing if available
    const settings = await getSettings();
    let parsedData = null;

    if (settings.llmEndpoint && settings.llmApiKey) {
      try {
        setStatus('Parsing job details with LLM...');
        parsedData = await parseJobWithLLMWrapper(rawText, url, settings);
        console.log('LLM parsed data:', parsedData);
      } catch (error) {
        console.log('LLM parsing failed, using fallback:', error);
        // Fall through to fallback parsing
      }
    }

    // Use fallback parsing if LLM parsing failed or isn't available
    if (!parsedData) {
      setStatus('Parsing job details...');
      parsedData = fallbackParseJobWrapper(rawText, url, scrapedData);
      console.log('Fallback parsed data:', parsedData);
    }

    // Populate fields
    if (parsedData.jobTitle) {
      elements.jobTitle.value = parsedData.jobTitle;
    } else if (scrapedData.title) {
      elements.jobTitle.value = scrapedData.title;
    }

    if (parsedData.companyName) {
      elements.companyName.value = parsedData.companyName;
    } else if (scrapedData.company) {
      elements.companyName.value = scrapedData.company;
    }

    // Combine description and requirements for job description field
    const jobDescriptionParts = [
      parsedData.description,
      parsedData.requirements
    ].filter(Boolean);

    if (jobDescriptionParts.length > 0) {
      elements.jobDescription.value = jobDescriptionParts.join('\n\n');
    } else if (rawText) {
      // Fallback to raw text if parsing didn't extract description
      elements.jobDescription.value = rawText;
    }

    // Populate additional context
    if (parsedData.additionalContext) {
      elements.additionalContext.value = parsedData.additionalContext;
    }

    setStatus('Job details extracted and populated.');
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
    // Use Exa scraper module
    const rawText = await scrapeWithExa(url, settings.exaApiKey);

    // Try LLM parsing if available
    let parsedData = null;

    if (settings.llmEndpoint && settings.llmApiKey) {
      try {
        setStatus('Parsing Exa content with LLM...');
        parsedData = await parseJobWithLLMWrapper(rawText, url, settings);
        console.log('LLM parsed Exa data:', parsedData);
      } catch (error) {
        console.log('LLM parsing failed, using fallback:', error);
        // Fall through to fallback parsing
      }
    }

    // Use fallback parsing if LLM parsing failed or isn't available
    if (!parsedData) {
      setStatus('Parsing Exa content...');
      // Create a minimal scrapedData object for fallback
      const scrapedData = {
        title: elements.jobTitle.value || '',
        company: elements.companyName.value || '',
        description: rawText
      };
      parsedData = fallbackParseJobWrapper(rawText, url, scrapedData);
      console.log('Fallback parsed Exa data:', parsedData);
    }

    // Populate fields
    if (parsedData.jobTitle && !elements.jobTitle.value) {
      elements.jobTitle.value = parsedData.jobTitle;
    }

    if (parsedData.companyName && !elements.companyName.value) {
      elements.companyName.value = parsedData.companyName;
    }

    // Combine description and requirements for job description field
    const jobDescriptionParts = [
      parsedData.description,
      parsedData.requirements
    ].filter(Boolean);

    if (jobDescriptionParts.length > 0) {
      elements.jobDescription.value = jobDescriptionParts.join('\n\n');
    } else {
      // Fallback to raw text if parsing didn't extract description
      elements.jobDescription.value = rawText;
    }

    // Populate additional context
    if (parsedData.additionalContext) {
      elements.additionalContext.value = parsedData.additionalContext;
    }

    setStatus('Exa content parsed and populated.');
  } catch (error) {
    setStatus('Exa scrape failed. Check your key and URL.', 'error');
    console.log('Exa error:', error);
  }
}

// Job parsing functions are now imported from scraper/jobParser.js
// Wrapper functions to maintain compatibility with existing code
async function parseJobWithLLMWrapper(rawText, url, settings) {
  return parseJobWithLLM(rawText, url, settings, callOpenAi, callGeneric);
}

function fallbackParseJobWrapper(rawText, url, scrapedData) {
  return fallbackParseJob(rawText, url, scrapedData);
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

async function callOpenAi(settings, prompt, systemMessage = 'You tailor resumes to job descriptions while staying truthful.') {
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
          content: systemMessage
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
  // Support multiple response formats
  if (typeof data === 'string') {
    return data;
  }
  return data.tailoredText || data.text || data.response || data.content || '';
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
  const resumeText = elements.resumeText.value.trim();
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
    elements.finalText.value = buildFinalText();
    setStatus('Tailored resume ready. Review changes below.');
  } catch (error) {
    setStatus('Tailoring failed. Check your LLM settings.', 'error');
  }
}

// --- Export actions ---
async function exportPdf() {
  const text = elements.finalText.value.trim();
  if (!text) {
    setExportStatus('Add final text before exporting.', 'error');
    return;
  }

  elements.pdfContent.textContent = text;
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
  const text = elements.finalText.value.trim();
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

async function handleExtractResume() {
  setStatus('Extracting resume...');
  const file = elements.resumeFile.files[0];
  if (!file) {
    setStatus('Select a DOCX file first.', 'error');
    return;
  }

  try {
    const text = await extractDocxText(file);
    elements.resumeText.value = text;
    state.resumeText = text;
    setStatus('Resume extracted.');
  } catch (error) {
    setStatus('DOCX extraction failed.', 'error');
  }
}

function applyDiffSelections() {
  elements.finalText.value = buildFinalText();
  setExportStatus('Applied selected changes.');
}

// --- UI wiring ---
function attachListeners() {
  elements.extractResume.addEventListener('click', handleExtractResume);
  elements.scrapeJob.addEventListener('click', scrapeCurrentTab);
  elements.deepScrape.addEventListener('click', deepScrapeExa);
  elements.generateResume.addEventListener('click', generateTailoredResume);
  elements.applyDiff.addEventListener('click', applyDiffSelections);
  elements.exportPdf.addEventListener('click', exportPdf);
  elements.copyText.addEventListener('click', copyFinalText);
  elements.openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

attachListeners();
prefillActiveTab();
