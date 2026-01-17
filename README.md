# Tailor Resume Extension

Chrome extension to tailor a resume to a job description, review diffs, and export a PDF.

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
3. Upload a resume PDF and extract text.
4. Scrape the current tab (or paste details manually).
5. Generate a tailored resume.
6. Review the diff, apply selections, and export a PDF.

## Notes

- If no LLM key is set, the extension uses a lightweight keyword-based fallback.
- Diff review lets you accept or reject each change block.
- PDF export uses a clean template with preserved line breaks.
