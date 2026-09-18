import type { PageContext } from './parsers';

// Popup ⇄ content-script protocol. Everything is user-initiated from the
// popup; the content script never acts on its own.
export type ContentRequest =
  | { type: 'parse' }
  | { type: 'nextPage'; previousFirstUrl: string | null };

export type ContentResponse =
  | { type: 'page'; context: PageContext }
  | { type: 'nextPage'; ok: boolean; reason?: string };

export function sendToTab<T extends ContentResponse>(
  tabId: number,
  message: ContentRequest
): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}
