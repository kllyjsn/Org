import type { ContentRequest, ContentResponse } from './messages';
import { findNextButton, parsePage, parseSalesPeople } from './parsers';

// Runs on linkedin.com pages. Purely reactive: it only reads the DOM when the
// popup asks, and only clicks the pager when the user starts "Sync all pages".

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function firstUrl(): string | null {
  return parseSalesPeople(document, location.href)[0]?.linkedinUrl ?? null;
}

async function goToNextPage(previousFirstUrl: string | null): Promise<ContentResponse> {
  const next = findNextButton(document);
  if (!next) return { type: 'nextPage', ok: false, reason: 'no next page' };
  next.scrollIntoView({ block: 'center' });
  next.click();
  // Sales Navigator swaps the list in place; wait until the first row changes.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await sleep(400);
    const current = firstUrl();
    if (current && current !== previousFirstUrl) {
      await sleep(600); // let lazy cells (title/company) finish rendering
      return { type: 'nextPage', ok: true };
    }
  }
  return { type: 'nextPage', ok: false, reason: 'page did not change' };
}

chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse: (r: ContentResponse) => void) => {
    if (message?.type === 'parse') {
      sendResponse({ type: 'page', context: parsePage(document, location.href) });
      return false;
    }
    if (message?.type === 'nextPage') {
      void goToNextPage(message.previousFirstUrl).then(sendResponse);
      return true;
    }
    return false;
  }
);
