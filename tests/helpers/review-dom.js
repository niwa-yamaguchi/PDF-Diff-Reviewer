// Minimal DOM boundary for node tests. The view and event controller remain real.
export function reviewDocument() {
  const document = { activeElement: null, detachedActiveCount: 0 };
  document.createElement = tag => {
    const attributes = new Map();
    const listeners = new Map();
    const classes = new Set();
    const node = {
      tagName: tag.toUpperCase(), ownerDocument: document, children: [], dataset: {}, style: {},
      value: "", hidden: false, text: "", open: false, parentElement: null,
      classList: { toggle(name, force) {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      }, contains: name => classes.has(name) },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      append(...nodes) { for (const child of nodes) { child.parentElement = node; node.children.push(child); } },
      insertBefore(child, reference) {
        if (child === reference) return child;
        child.parentElement?.removeChild(child);
        const index = reference ? node.children.indexOf(reference) : node.children.length;
        if (index < 0) throw new Error("Reference is not a child");
        node.children.splice(index, 0, child);
        child.parentElement = node;
        return child;
      },
      removeChild(child) {
        const index = node.children.indexOf(child);
        if (index < 0) throw new Error("Node is not a child");
        node.children.splice(index, 1);
        child.parentElement = null;
        if (child.contains(document.activeElement)) {
          document.detachedActiveCount += 1;
          document.activeElement = document.body;
        }
        return child;
      },
      replaceChildren(...nodes) { node.children = []; node.text = ""; node.append(...nodes); },
      contains(other) { return other === node || node.children.some(child => child.contains(other)); },
      matches(selector) {
        return selector.split(",").some(part => {
          const match = part.trim().match(/^(\w+)?(?:\[data-([\w-]+)(?:="([^"]*)")?\])?$/);
          if (!match) return false;
          const [, name, data, value] = match;
          const key = data?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          return (!name || node.tagName === name.toUpperCase())
            && (!data || (key in node.dataset && (value === undefined || node.dataset[key] === value)));
        });
      },
      closest(selector) { return node.matches(selector) ? node : node.parentElement?.closest(selector) || null; },
      querySelectorAll(selector) {
        return node.children.flatMap(child => [ ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector) ]);
      },
      querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
      focus() { document.activeElement = node; },
      setSelectionRange(start, end, direction) {
        node.selectionStart = start; node.selectionEnd = end; node.selectionDirection = direction;
      },
      addEventListener(type, handler) { const list = listeners.get(type) || []; list.push(handler); listeners.set(type, list); },
      removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) || []).filter(value => value !== handler)); },
      emit(type, event = {}) { for (const handler of listeners.get(type) || []) handler(event); },
      listeners,
    };
    Object.defineProperty(node, "textContent", {
      get: () => node.text + node.children.map(child => child.textContent).join(""),
      set: value => { node.text = String(value); node.children = []; },
    });
    return node;
  };
  document.body = document.createElement("body");
  return document;
}

export function reviewDom(document = reviewDocument()) {
  const names = ["reviewPanel", "reviewToggle", "reviewClose", "reviewBackdrop", "reviewPrev", "reviewNext",
    "reviewTotal", "reviewProgress", "reviewIndexStatus", "reviewNotice", "reviewList"];
  const dom = Object.fromEntries(names.map(name => [name, document.createElement(name === "reviewList" ? "div" : "button")]));
  document.body.append(dom.reviewPanel, dom.reviewToggle, dom.reviewBackdrop);
  dom.reviewPanel.append(dom.reviewClose, dom.reviewPrev, dom.reviewNext, dom.reviewTotal, dom.reviewProgress,
    dom.reviewIndexStatus, dom.reviewNotice, dom.reviewList);
  return { document, dom };
}
