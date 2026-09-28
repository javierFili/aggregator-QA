/**
 * Script evaluated inside every frame of the game. It is kept as a plain JavaScript string on purpose:
 * transpilers (tsx/esbuild) inject helpers into compiled functions, which breaks Playwright serialisation.
 * Returns the in-frame part of a FrameSnapshot.
 */
export const FRAME_COLLECTOR_SOURCE = String.raw`
(maxText) => {
  const BET_WORDS = /(bet|stake|wager|apuesta|aposta|miza|pariu|einsatz|mise|puntata|coin|chip|ficha)/i;
  const LIMIT_ATTRS = ['min', 'max', 'value', 'step', 'data-min', 'data-max', 'data-default', 'data-value', 'data-bet', 'data-min-bet', 'data-max-bet', 'data-default-bet'];
  const ARIA_ATTRS = ['aria-label', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'];
  const all = Array.from(document.querySelectorAll('*'));

  const describe = (el) => {
    const attributes = {};
    for (const name of [...LIMIT_ATTRS, ...ARIA_ATTRS, 'title', 'placeholder']) {
      const v = el.getAttribute(name);
      if (v !== null && v !== '') attributes[name] = v.slice(0, 200);
    }
    const info = { tag: el.tagName.toLowerCase(), attributes };
    if (el.type) info.type = String(el.type);
    if (el.id) info.id = el.id.slice(0, 100);
    const name = el.getAttribute('name');
    if (name) info.name = name.slice(0, 100);
    if (typeof el.className === 'string' && el.className) info.className = el.className.slice(0, 200);
    const role = el.getAttribute('role');
    if (role) info.role = role;
    if (typeof el.value === 'string' && el.value) info.value = el.value.slice(0, 100);
    const text = el.innerText || el.textContent || '';
    if (text) info.text = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    return info;
  };

  const betElements = [];
  const ariaElements = [];
  let visibleCanvasCount = 0;
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'canvas') {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > 10000) visibleCanvasCount++;
    }
    if (betElements.length < 150) {
      const dataNames = Array.from(el.attributes).filter((a) => a.name.startsWith('data-')).map((a) => a.name).join(' ');
      const identity = [el.id, el.getAttribute('name') || '', typeof el.className === 'string' ? el.className : '', el.getAttribute('aria-label') || '', dataNames].join(' ');
      const hasLimitAttr = LIMIT_ATTRS.some((a) => el.hasAttribute(a));
      if (hasLimitAttr && BET_WORDS.test(identity)) betElements.push(describe(el));
    }
    const ariaLabel = el.getAttribute('aria-label') || '';
    if (ariaElements.length < 150 && (el.hasAttribute('aria-valuenow') || el.hasAttribute('aria-valuemin') || el.hasAttribute('aria-valuemax') || (ariaLabel && BET_WORDS.test(ariaLabel)))) {
      ariaElements.push(describe(el));
    }
  }
  const body = document.body;
  const text = body ? (body.innerText || body.textContent || '').replace(/[ \t]+/g, ' ').trim().slice(0, maxText) : '';
  return {
    text,
    elementCount: all.length,
    visibleCanvasCount,
    videoCount: document.querySelectorAll('video').length,
    iframeCount: document.querySelectorAll('iframe,frame').length,
    betElements,
    ariaElements,
  };
}
`;
