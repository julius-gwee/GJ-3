# Tailor Resume Extension

Chrome extension to tailor a resume to a job description, review diffs, and export a DOCX file with preserved formatting.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.

## Configure

Open **Settings** from the popup or at `chrome-extension://<id>/options.html`.

- **Exa API key** for deep scrape (optional).
- **LLM endpoint + key** for tailoring.

## Usage

1. Open the job listing in a tab.
2. Click the extension icon and open the workspace.
3. Upload a resume DOCX and extract text.
4. Scrape the current tab (or paste details manually).
5. Generate a tailored resume.
6. Review the diff, apply selections, and export a DOCX file with preserved formatting.

## Notes

- Resume input expects `.docx` files (Word).
- If no LLM key is set, the extension uses a lightweight keyword-based fallback.
- Diff review lets you accept or reject each change block.
- DOCX export preserves original formatting (fonts, colors, bold, italic, etc.) while applying text changes.
- The extension uses JSZip (loaded via CDN) for DOCX manipulation. For production, consider downloading `jszip.min.js` locally to `vendor/` directory and updating `app.html` to use the local file instead of the CDN link.
