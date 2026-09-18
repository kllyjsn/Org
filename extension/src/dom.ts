// Minimal element builder so the popup/options stay framework-free.
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<
    Omit<
      HTMLElementTagNameMap[K],
      'style' | 'children' | 'dataset' | 'onclick' | 'oninput' | 'onchange' | 'onsubmit'
    >
  > & {
    class?: string;
    style?: string;
    dataset?: Record<string, string>;
    onclick?: (ev: MouseEvent) => void;
    oninput?: (ev: Event) => void;
    onchange?: (ev: Event) => void;
    onsubmit?: (ev: SubmitEvent) => void;
    'aria-pressed'?: string;
    'aria-label'?: string;
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'style') el.setAttribute('style', String(value));
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('aria-')) el.setAttribute(key, String(value));
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else {
      (el as unknown as Record<string, unknown>)[key] = value;
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

export function replaceChildren(parent: Element, ...nodes: Child[]): void {
  parent.replaceChildren(
    ...nodes.filter((n): n is Node | string => !!n || n === '')
  );
}
