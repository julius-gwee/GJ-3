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
  llmApiKey: '' // Load from environment variable or user settings
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

/**
 * Extract key requirements and skills from job description
 * @param {string} jobDescription - The full job description text
 * @returns {Object} Contains requirements, skills, and qualifications
 */
function extractJobRequirements(jobDescription) {
  const requirements = [];
  const skills = [];
  
  // Extract "Required" section
  const requiredMatch = jobDescription.match(/(?:required|must have|required skills|key qualifications)[\s\n:]*([\s\S]*?)(?:\n\n|$|preferred|nice to have|additional)/i);
  if (requiredMatch) {
    const requiredSection = requiredMatch[1];
    const bulletPoints = requiredSection.match(/[-•*]\s*(.+?)(?=\n[-•*]|\n\n|$)/gi) || [];
    bulletPoints.forEach(point => {
      const cleaned = point.replace(/^[-•*]\s*/, '').trim();
      if (cleaned) requirements.push(cleaned);
    });
  }
  
  // Extract skill keywords (common tech terms, programming languages, tools)
  const skillPatterns = [
    /(?:experience with|proficiency in|knowledge of|familiar with|expertise in)\s+(.+?)(?:\.|,|;|\n)/gi,
    /(?:skills?|technologies?|tools?|frameworks?|languages?)[:\s]+([^.]+)/gi
  ];
  
  skillPatterns.forEach(pattern => {
    const matches = jobDescription.matchAll(pattern);
    for (const match of matches) {
      const skillText = match[1];
      const skillList = skillText.split(/[,;]/).map(s => s.trim()).filter(s => s);
      skills.push(...skillList);
    }
  });
  
  // Extract preferred skills/qualifications
  const preferredMatch = jobDescription.match(/(?:preferred|nice to have|additional qualifications)[\s\n:]*([\s\S]*?)(?:\n\n|$)/i);
  const preferred = [];
  if (preferredMatch) {
    const preferredSection = preferredMatch[1];
    const bulletPoints = preferredSection.match(/[-•*]\s*(.+?)(?=\n[-•*]|\n\n|$)/gi) || [];
    bulletPoints.forEach(point => {
      const cleaned = point.replace(/^[-•*]\s*/, '').trim();
      if (cleaned) preferred.push(cleaned);
    });
  }
  
  return {
    requirements: [...new Set(requirements)].slice(0, 8),
    skills: [...new Set(skills)].slice(0, 10),
    preferred: [...new Set(preferred)].slice(0, 5),
    fullDescription: jobDescription
  };
}

/**
 * Build an enhanced prompt for OpenAI that focuses on matching resume to job requirements
 * Includes structured analysis of key skills, requirements, and experience alignment
 * @param {string} resumeText - The original resume
 * @param {Object} job - Job details (title, company, description, additional)
 * @returns {string} Crafted prompt optimized for OpenAI's GPT-4o-mini
 */
function buildEnhancedPrompt(resumeText, job) {
  const jobRequirements = extractJobRequirements(job.description);
  
  const requirementsList = jobRequirements.requirements
    .map((req, idx) => `  ${idx + 1}. ${req}`)
    .join('\n');
    
  const skillsList = jobRequirements.skills
    .map(skill => `  - ${skill}`)
    .join('\n');
    
  const preferredList = jobRequirements.preferred.length > 0
    ? `\n\nPreferred qualifications:\n${jobRequirements.preferred.map(pref => `  - ${pref}`).join('\n')}`
    : '';
  
  return `You are an expert resume writer specializing in tailoring resumes to job postings.

ORIGINAL RESUME:
${resumeText}

POSITION DETAILS:
- Role: ${job.title}
- Company: ${job.company}
${job.url ? `- URL: ${job.url}` : ''}

KEY REQUIREMENTS TO ADDRESS (PRIORITY):
${requirementsList}

REQUIRED SKILLS & TECHNOLOGIES:
${skillsList}${preferredList}

COMPANY CONTEXT:
${job.additional || '(No additional context provided)'}

INSTRUCTIONS:
1. Analyze each key requirement and identify matching experience in the resume
2. Rewrite sections to emphasize relevant skills and experience
3. Use terminology and keywords from the job description where truthful
4. Reorganize bullet points to highlight most relevant experience first
5. Maintain truthfulness - do NOT invent roles, companies, degrees, dates, or achievements
6. Preserve the overall structure and professional tone
7. Make each bullet point impactful and achievement-focused
8. Remove or de-emphasize less relevant experience
9. Highlight transferable skills that align with the role

OUTPUT:
Return ONLY the tailored resume text. No explanations or markdown formatting.`;
}

/**
 * Build a system message for OpenAI with clear instructions
 * @returns {string} System message for GPT assistant
 */
function buildSystemMessage() {
  return `You are an expert resume writer and recruiter with over 15 years of experience. Your expertise includes:
- Identifying key qualifications and skills from job descriptions
- Highlighting relevant candidate experience to match job requirements
- Maintaining truthfulness and ethical standards in resume tailoring
- Using strong action verbs and achievement-focused language
- Understanding industry-specific terminology and best practices

Your goal is to tailor resumes to job descriptions by strategically emphasizing the most relevant experience and skills while always remaining truthful. Never invent information, but do reorganize and reframe existing content to best match the target role.`;
}

/**
 * Build a legacy prompt for backward compatibility
 * @param {string} resumeText - The original resume
 * @param {Object} job - Job details (title, company, description, additional)
 * @returns {string} Crafted prompt for LLM
 */
function buildPrompt(resumeText, job) {
  return buildEnhancedPrompt(resumeText, job);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

async function callOpenAi(settings, prompt, systemMessage = 'You are an expert resume writer and recruiter. Your goal is to tailor resumes to job descriptions by highlighting the most relevant experience and skills, while always remaining truthful and never inventing information. Focus on matching the candidate\'s background to the specific requirements of the role.') {
  // LINE 1: Validate API key and endpoint
  if (!settings.llmApiKey || !settings.llmEndpoint) {
    throw new Error('OpenAI API key and endpoint are required');
  }
  
  // LINE 2: Prepare request headers with Bearer token authentication
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${settings.llmApiKey}`
  };
  
  // LINE 3: Build request body with OpenAI API format
  const requestBody = {
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
    temperature: 0.3,  // LINE 4: Lower temperature for more consistent, focused responses
    max_tokens: 4000   // LINE 5: Set token limit for cost control and reasonable response length
  };
  
  // LINE 6: Make POST request to OpenAI API endpoint
  const response = await fetch(settings.llmEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody)
  });

  // LINE 7: Check for HTTP errors and provide helpful error messages
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message || `OpenAI API error: ${response.status}`;
    throw new Error(errorMessage);
  }

  // LINE 8: Parse response JSON and extract message content
  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';

  // LINE 9: Return trimmed content or throw error if empty
  if (!content) {
    throw new Error('Empty response from OpenAI API');
  }
  
  return content.trim();
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
  // Extract job requirements for better matching
  const jobRequirements = extractJobRequirements(job.description);
  const keywords = extractKeywords(`${job.description} ${job.additional}`);
  
  if (!keywords.length && jobRequirements.skills.length === 0) {
    return resumeText;
  }

  // Build a tailored summary based on extracted requirements
  let tailoredResume = resumeText;
  
  // Extract matching keywords from resume
  const resumeKeywords = extractKeywords(resumeText);
  const matchedKeywords = keywords.filter(kw => 
    resumeText.toLowerCase().includes(kw.toLowerCase())
  );
  
  // Add a summary section highlighting matched requirements
  let summary = '\n--- TAILORED FOR THIS ROLE ---\n';
  
  if (matchedKeywords.length > 0) {
    summary += `Relevant expertise: ${matchedKeywords.slice(0, 8).join(', ')}\n`;
  }
  
  if (jobRequirements.skills.length > 0) {
    summary += `Target skills: ${jobRequirements.skills.slice(0, 6).join(', ')}\n`;
  }
  
  if (jobRequirements.requirements.length > 0) {
    summary += `Key focus areas:\n`;
    jobRequirements.requirements.slice(0, 5).forEach((req, idx) => {
      summary += `  ${idx + 1}. ${req}\n`;
    });
  }
  
  return tailoredResume + summary;
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
    // LINE 1: Check if OpenAI API key is configured
    if (!settings.llmApiKey) {
      setStatus('OpenAI API key not configured. Using fallback method.', 'info');
      tailoredText = fallbackTailor(resumeText, job);
    } 
    // LINE 2: Use OpenAI API with enhanced prompt for better accuracy
    else if (settings.llmMode === 'openai') {
      const prompt = buildEnhancedPrompt(resumeText, job);
      const responseText = await callOpenAi(settings, prompt, buildSystemMessage());
      // LINE 3: Parse response and extract tailored text
      const parsed = safeJsonParse(responseText);
      tailoredText = parsed && parsed.tailoredText ? parsed.tailoredText : responseText;
    } 
    // LINE 4: Fallback to generic LLM endpoint if specified
    else if (settings.llmMode === 'generic') {
      tailoredText = await callGeneric(settings, {
        resumeText,
        job,
        instructions: 'Tailor the resume to the job while remaining truthful and highlighting relevant experience.'
      });
    }

    if (!tailoredText) {
      throw new Error('Empty response from LLM');
    }

    // LINE 5: Store original and tailored text in state for diffing
    state.resumeText = resumeText;
    state.tailoredText = tailoredText;
    
    // LINE 6: Compute differences between original and tailored resume
    const diffResult = computeDiffs(resumeText, tailoredText);
    state.diffsWithGroup = diffResult.diffsWithGroup;
    state.diffGroups = diffResult.groups;
    
    // LINE 7: Render diffs to UI for user review
    renderDiffs();
    elements.finalText.value = buildFinalText();
    setStatus('Tailored resume ready. Review changes below.');
  } catch (error) {
    console.error('Resume tailoring error:', error);
    setStatus('Tailoring failed. Check your OpenAI API key and try again.', 'error');
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
