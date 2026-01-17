/**
 * DOCX Processor Module
 * Handles parsing, modifying, and rebuilding DOCX files while preserving formatting
 */

/**
 * Parse DOCX structure to extract text runs with formatting metadata
 * @param {File} file - The DOCX file
 * @returns {Promise<Object>} Structure containing buffer, runs, plainText, and documentXml
 */
export async function parseDocxStructure(file) {
  try {
    const buffer = await file.arrayBuffer();
    
    // Load JSZip (should be available globally via script tag)
    if (typeof window.JSZip === 'undefined') {
      throw new Error('JSZip library not loaded. Please include jszip.min.js in HTML.');
    }
    
    let zip;
    try {
      zip = await window.JSZip.loadAsync(buffer);
    } catch (zipError) {
      throw new Error(`Invalid DOCX file format: ${zipError.message}`);
    }
    
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) {
      throw new Error('DOCX file is missing word/document.xml. File may be corrupted.');
    }
    
    let documentXmlContent;
    try {
      documentXmlContent = await documentFile.async('string');
    } catch (readError) {
      throw new Error(`Failed to read document.xml: ${readError.message}`);
    }
    
    // Parse XML (using DOMParser or fast-xml-parser)
    let xmlDoc;
    let parser;
    
    try {
      if (typeof window.XMLParser !== 'undefined') {
        // Use fast-xml-parser if available
        parser = new window.XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '@_',
          textNodeName: '#text',
          parseAttributeValue: true,
          parseTrueNumberOnly: false,
          arrayMode: false
        });
        xmlDoc = parser.parse(documentXmlContent);
      } else {
        // Fallback to DOMParser
        const domParser = new DOMParser();
        xmlDoc = domParser.parseFromString(documentXmlContent, 'text/xml');
        
        // Check for parsing errors
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
          throw new Error('XML parsing failed. Document may be corrupted.');
        }
      }
    } catch (parseError) {
      throw new Error(`Failed to parse XML: ${parseError.message}`);
    }
    
    // Extract text runs with formatting
    const runs = [];
    let plainText = '';
    let paragraphIndex = 0;
    
    // Handle both parsed XML (fast-xml-parser) and DOM (DOMParser)
    let paragraphs;
    if (xmlDoc.documentElement) {
      // DOM structure
      paragraphs = xmlDoc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p');
    } else if (xmlDoc['w:document'] && xmlDoc['w:document']['w:body']) {
      // fast-xml-parser structure
      const body = xmlDoc['w:document']['w:body'];
      paragraphs = Array.isArray(body['w:p']) ? body['w:p'] : [body['w:p']].filter(Boolean);
    } else {
      throw new Error('Unable to parse DOCX structure. Document may not be a valid Word document.');
    }
    
    if (!paragraphs || paragraphs.length === 0) {
      throw new Error('No paragraphs found in document. Document may be empty or corrupted.');
    }
    
    // Process paragraphs
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const paragraph = paragraphs[pIdx];
      let runIndex = 0;
      
      // Get runs from paragraph
      let runsInPara;
      if (paragraph.getElementsByTagNameNS) {
        // DOM structure
        runsInPara = paragraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'r');
      } else if (paragraph['w:r']) {
        // fast-xml-parser structure
        runsInPara = Array.isArray(paragraph['w:r']) ? paragraph['w:r'] : [paragraph['w:r']].filter(Boolean);
      } else {
        runsInPara = [];
      }
      
      for (let rIdx = 0; rIdx < runsInPara.length; rIdx++) {
        const run = runsInPara[rIdx];
        
        // Extract text
        let text = '';
        let textNodes;
        
        if (run.getElementsByTagNameNS) {
          // DOM structure
          textNodes = run.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't');
          if (textNodes.length > 0) {
            text = Array.from(textNodes).map(t => t.textContent || '').join('');
          }
        } else if (run['w:t']) {
          // fast-xml-parser structure
          const textNode = run['w:t'];
          if (typeof textNode === 'string') {
            text = textNode;
          } else if (textNode['#text']) {
            text = textNode['#text'];
          } else if (Array.isArray(textNode)) {
            text = textNode.map(t => (typeof t === 'string' ? t : t['#text'] || '')).join('');
          }
        }
        
        // Extract run properties (formatting)
        let properties = {};
        let originalRPr = null;
        if (run.getElementsByTagNameNS) {
          // DOM structure
          const rPr = run.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'rPr')[0];
          if (rPr) {
            properties = extractPropertiesFromDOM(rPr);
            // Clone the original rPr element for complete preservation
            originalRPr = rPr.cloneNode(true);
          }
        } else if (run['w:rPr']) {
          // fast-xml-parser structure
          properties = extractPropertiesFromObject(run['w:rPr']);
        }
        
        if (text || Object.keys(properties).length > 0) {
          runs.push({
            text: text || '',
            properties: properties,
            paragraphIndex: paragraphIndex,
            runIndex: runIndex,
            xmlNode: run, // Keep reference for rebuilding
            originalRPr: originalRPr // Store cloned rPr for preservation
          });
          
          plainText += text;
          runIndex++;
        }
      }
      
      // Add paragraph break (except for last paragraph)
      if (pIdx < paragraphs.length - 1) {
        plainText += '\n';
      }
      paragraphIndex++;
    }
    
    if (runs.length === 0 && plainText.trim().length === 0) {
      throw new Error('No text content found in document. Document may be empty or contain only images/tables.');
    }
    
    return {
      buffer: buffer,
      runs: runs,
      plainText: plainText.trim(),
      documentXml: documentXmlContent
    };
  } catch (error) {
    console.error('Error parsing DOCX structure:', error);
    // Re-throw with more context if it's not already our custom error
    if (error.message && error.message.startsWith('JSZip') || 
        error.message && error.message.startsWith('Invalid') ||
        error.message && error.message.startsWith('Failed') ||
        error.message && error.message.startsWith('Unable') ||
        error.message && error.message.startsWith('No')) {
      throw error;
    }
    throw new Error(`Failed to parse DOCX: ${error.message}`);
  }
}

/**
 * Extract run properties from DOM element
 */
function extractPropertiesFromDOM(rPr) {
  const props = {};
  if (!rPr) return props;
  
  // Check for common formatting properties
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  
  if (rPr.getElementsByTagNameNS(ns, 'b').length > 0) props.bold = true;
  if (rPr.getElementsByTagNameNS(ns, 'i').length > 0) props.italic = true;
  if (rPr.getElementsByTagNameNS(ns, 'u').length > 0) props.underline = true;
  
  const color = rPr.getElementsByTagNameNS(ns, 'color')[0];
  if (color && color.getAttribute('w:val')) props.color = color.getAttribute('w:val');
  
  const sz = rPr.getElementsByTagNameNS(ns, 'sz')[0];
  if (sz && sz.getAttribute('w:val')) props.fontSize = sz.getAttribute('w:val');
  
  const rFonts = rPr.getElementsByTagNameNS(ns, 'rFonts')[0];
  if (rFonts && rFonts.getAttribute('w:ascii')) props.font = rFonts.getAttribute('w:ascii');
  
  // Store raw XML for complete preservation
  props._rawXml = rPr.outerHTML || new XMLSerializer().serializeToString(rPr);
  
  return props;
}

/**
 * Extract run properties from parsed object
 */
function extractPropertiesFromObject(rPr) {
  const props = {};
  if (!rPr) return props;
  
  if (rPr['w:b']) props.bold = true;
  if (rPr['w:i']) props.italic = true;
  if (rPr['w:u']) props.underline = true;
  if (rPr['w:color'] && rPr['w:color']['@_w:val']) props.color = rPr['w:color']['@_w:val'];
  if (rPr['w:sz'] && rPr['w:sz']['@_w:val']) props.fontSize = rPr['w:sz']['@_w:val'];
  if (rPr['w:rFonts'] && rPr['w:rFonts']['@_w:ascii']) props.font = rPr['w:rFonts']['@_w:ascii'];
  
  return props;
}

/**
 * Map text changes from LLM output back to original XML runs
 * @param {string} originalText - Original plain text
 * @param {string} newText - New text from LLM/user edits
 * @param {Array} runs - Original run mapping
 * @returns {Array} Modified runs with preserved formatting
 */
export function mapTextToRuns(originalText, newText, runs) {
  if (!runs || runs.length === 0) {
    console.warn('No runs provided to mapTextToRuns');
    return [];
  }
  
  if (!originalText || !newText) {
    console.warn('Empty text provided to mapTextToRuns');
    return runs; // Return original runs if text is empty
  }
  
  // If text is completely unchanged, return original runs with all properties preserved
  if (originalText === newText) {
    return runs.map(run => ({
      text: run.text,
      properties: run.properties,
      paragraphIndex: run.paragraphIndex,
      runIndex: run.runIndex,
      originalRPr: run.originalRPr // Preserve original rPr
    }));
  }
  
  // Use diff-match-patch to align changes
  if (typeof window.diff_match_patch === 'undefined') {
    throw new Error('diff-match-patch library not loaded');
  }
  
  const dmp = new window.diff_match_patch();
  const diffs = dmp.diff_main(originalText, newText);
  dmp.diff_cleanupSemantic(diffs);
  
  // Apply diffs to create new runs, preserving original run boundaries when possible
  const newRuns = [];
  let currentRunIdx = 0;
  let currentRunCharIdx = 0; // Character position within current run
  let currentRun = runs[0];
  
  diffs.forEach(([op, text]) => {
    if (op === window.DIFF_EQUAL) {
      // Text unchanged - preserve original runs exactly
      let remaining = text;
      while (remaining.length > 0 && currentRunIdx < runs.length) {
        currentRun = runs[currentRunIdx];
        const runRemaining = currentRun.text.length - currentRunCharIdx;
        const take = Math.min(remaining.length, runRemaining);
        
        // If we're at the start of a run and taking the whole run, preserve it exactly
        if (currentRunCharIdx === 0 && take === currentRun.text.length) {
          newRuns.push({
            text: currentRun.text,
            properties: currentRun.properties,
            paragraphIndex: currentRun.paragraphIndex,
            runIndex: newRuns.length,
            originalRPr: currentRun.originalRPr // Preserve original rPr
          });
          remaining = remaining.substring(take);
          currentRunIdx++;
          currentRunCharIdx = 0;
        } else {
          // Partial run - need to split
          const runText = currentRun.text.substring(currentRunCharIdx, currentRunCharIdx + take);
          newRuns.push({
            text: runText,
            properties: currentRun.properties,
            paragraphIndex: currentRun.paragraphIndex,
            runIndex: newRuns.length,
            originalRPr: currentRun.originalRPr // Preserve original rPr
          });
          currentRunCharIdx += take;
          remaining = remaining.substring(take);
          
          if (currentRunCharIdx >= currentRun.text.length) {
            currentRunIdx++;
            currentRunCharIdx = 0;
          }
        }
      }
    } else if (op === window.DIFF_INSERT) {
      // New text - use formatting from current run
      const sourceRun = currentRunIdx < runs.length ? runs[currentRunIdx] : runs[runs.length - 1];
      newRuns.push({
        text: text,
        properties: sourceRun?.properties || {},
        paragraphIndex: sourceRun?.paragraphIndex || 0,
        runIndex: newRuns.length,
        originalRPr: sourceRun?.originalRPr || null // Preserve original rPr if available
      });
    } else if (op === window.DIFF_DELETE) {
      // Text deleted - advance through runs
      let remaining = text;
      while (remaining.length > 0 && currentRunIdx < runs.length) {
        currentRun = runs[currentRunIdx];
        const runRemaining = currentRun.text.length - currentRunCharIdx;
        const skip = Math.min(remaining.length, runRemaining);
        remaining = remaining.substring(skip);
        currentRunCharIdx += skip;
        
        if (currentRunCharIdx >= currentRun.text.length) {
          currentRunIdx++;
          currentRunCharIdx = 0;
        }
      }
    }
  });
  
  return newRuns;
}

/**
 * Rebuild DOCX from modified runs
 * @param {ArrayBuffer} originalBuffer - Original DOCX buffer
 * @param {Array} modifiedRuns - Modified runs with preserved formatting
 * @returns {Promise<Blob>} New DOCX file as Blob
 */
export async function rebuildDocx(originalBuffer, modifiedRuns) {
  try {
    if (typeof window.JSZip === 'undefined') {
      throw new Error('JSZip library not loaded');
    }
    
    if (!originalBuffer) {
      throw new Error('Original DOCX buffer is missing');
    }
    
    if (!modifiedRuns || modifiedRuns.length === 0) {
      throw new Error('No modified runs provided');
    }
    
    let zip;
    try {
      zip = await window.JSZip.loadAsync(originalBuffer);
    } catch (zipError) {
      throw new Error(`Failed to load DOCX: ${zipError.message}`);
    }
    
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) {
      throw new Error('Document structure corrupted: missing word/document.xml');
    }
    
    let documentXmlContent;
    try {
      documentXmlContent = await documentFile.async('string');
    } catch (readError) {
      throw new Error(`Failed to read document: ${readError.message}`);
    }
    
    // Parse XML
    const domParser = new DOMParser();
    const xmlDoc = domParser.parseFromString(documentXmlContent, 'text/xml');
    
    // Check for parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error('XML parsing failed during rebuild. Document may be corrupted.');
    }
    
    // Get all paragraphs
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paragraphs = xmlDoc.getElementsByTagNameNS(ns, 'p');
    
    if (paragraphs.length === 0) {
      throw new Error('No paragraphs found in document during rebuild');
    }
    
    // Group runs by paragraph
    const runsByPara = {};
    modifiedRuns.forEach(run => {
      if (!runsByPara[run.paragraphIndex]) {
        runsByPara[run.paragraphIndex] = [];
      }
      runsByPara[run.paragraphIndex].push(run);
    });
    
    // Replace text in runs
    let runIndex = 0;
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const paragraph = paragraphs[pIdx];
      const runsInPara = paragraph.getElementsByTagNameNS(ns, 'r');
      
      const paraRuns = runsByPara[pIdx] || [];
      let paraRunIdx = 0;
      
      for (let rIdx = 0; rIdx < runsInPara.length; rIdx++) {
        const run = runsInPara[rIdx];
        const textNodes = run.getElementsByTagNameNS(ns, 't');
        
        if (paraRunIdx < paraRuns.length) {
          const newRun = paraRuns[paraRunIdx];
          
          // Preserve original rPr if available (complete formatting preservation)
          const existingRPr = run.getElementsByTagNameNS(ns, 'rPr')[0];
          if (newRun.originalRPr) {
            // Import the cloned rPr into the current document context
            const clonedRPr = xmlDoc.importNode(newRun.originalRPr, true);
            // Replace rPr with the original cloned version
            if (existingRPr) {
              run.replaceChild(clonedRPr, existingRPr);
            } else {
              run.insertBefore(clonedRPr, run.firstChild);
            }
          }
          
          // Update text content
          if (textNodes.length > 0) {
            // Preserve xml:space if it exists
            const xmlSpace = textNodes[0].getAttribute('xml:space');
            textNodes[0].textContent = newRun.text;
            if (xmlSpace) {
              textNodes[0].setAttribute('xml:space', xmlSpace);
            } else if (newRun.text.includes('  ') || newRun.text.startsWith(' ') || newRun.text.endsWith(' ')) {
              // Preserve whitespace if needed
              textNodes[0].setAttribute('xml:space', 'preserve');
            }
            
            // Remove extra text nodes if any
            for (let i = 1; i < textNodes.length; i++) {
              textNodes[i].parentNode.removeChild(textNodes[i]);
            }
          } else {
            // Create new text node if it doesn't exist
            const textNode = xmlDoc.createElementNS(ns, 't');
            textNode.textContent = newRun.text;
            if (newRun.text.includes('  ') || newRun.text.startsWith(' ') || newRun.text.endsWith(' ')) {
              textNode.setAttribute('xml:space', 'preserve');
            }
            run.appendChild(textNode);
          }
          
          paraRunIdx++;
        } else {
          // Remove extra runs
          run.parentNode.removeChild(run);
          rIdx--; // Adjust index
        }
      }
      
      // Add new runs if we have more than original
      if (paraRunIdx < paraRuns.length) {
        const fragment = xmlDoc.createDocumentFragment();
        for (let i = paraRunIdx; i < paraRuns.length; i++) {
          const newRun = paraRuns[i];
          const runElement = xmlDoc.createElementNS(ns, 'r');
          
          // Add run properties - use original if available, otherwise reconstruct
          if (newRun.originalRPr) {
            // Import the original rPr into the current document context for complete preservation
            const clonedRPr = xmlDoc.importNode(newRun.originalRPr, true);
            runElement.appendChild(clonedRPr);
          } else if (Object.keys(newRun.properties).length > 0) {
            // Fallback: reconstruct from properties (incomplete but better than nothing)
            const rPr = xmlDoc.createElementNS(ns, 'rPr');
            if (newRun.properties.bold) {
              const b = xmlDoc.createElementNS(ns, 'b');
              rPr.appendChild(b);
            }
            if (newRun.properties.italic) {
              const i = xmlDoc.createElementNS(ns, 'i');
              rPr.appendChild(i);
            }
            if (newRun.properties.underline) {
              const u = xmlDoc.createElementNS(ns, 'u');
              u.setAttributeNS(ns, 'w:val', 'single');
              rPr.appendChild(u);
            }
            if (newRun.properties.color) {
              const color = xmlDoc.createElementNS(ns, 'color');
              color.setAttributeNS(ns, 'w:val', newRun.properties.color);
              rPr.appendChild(color);
            }
            if (newRun.properties.fontSize) {
              const sz = xmlDoc.createElementNS(ns, 'sz');
              sz.setAttributeNS(ns, 'w:val', newRun.properties.fontSize);
              rPr.appendChild(sz);
            }
            if (newRun.properties.font) {
              const rFonts = xmlDoc.createElementNS(ns, 'rFonts');
              rFonts.setAttributeNS(ns, 'w:ascii', newRun.properties.font);
              rPr.appendChild(rFonts);
            }
            runElement.appendChild(rPr);
          }
          
          // Add text node
          const textNode = xmlDoc.createElementNS(ns, 't');
          textNode.textContent = newRun.text;
          if (newRun.text.includes('  ') || newRun.text.startsWith(' ') || newRun.text.endsWith(' ')) {
            textNode.setAttribute('xml:space', 'preserve');
          }
          runElement.appendChild(textNode);
          
          fragment.appendChild(runElement);
        }
        paragraph.appendChild(fragment);
      }
    }
    
    // Serialize back to XML
    const serializer = new XMLSerializer();
    const newDocumentXml = serializer.serializeToString(xmlDoc);
    
    // Update ZIP
    zip.file('word/document.xml', newDocumentXml);
    
    // Generate blob
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    
    return blob;
  } catch (error) {
    console.error('Error rebuilding DOCX:', error);
    // Re-throw with more context if it's not already our custom error
    if (error.message && (
        error.message.startsWith('JSZip') ||
        error.message.startsWith('Original') ||
        error.message.startsWith('No modified') ||
        error.message.startsWith('Failed to load') ||
        error.message.startsWith('Document structure') ||
        error.message.startsWith('Failed to read') ||
        error.message.startsWith('XML parsing') ||
        error.message.startsWith('No paragraphs')
      )) {
      throw error;
    }
    throw new Error(`Failed to rebuild DOCX: ${error.message}`);
  }
}
