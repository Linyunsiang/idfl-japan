/**
 * Offset-based XML scanner.
 *
 * Produces a tree of elements annotated with their exact character offsets in the source
 * string, so callers can splice bytes surgically. Nothing is ever re-serialised: every byte
 * outside a splice survives exactly — attribute order, whitespace, self-closing forms,
 * namespace declarations and Word's rsid attributes included.
 *
 * A DOM round-trip (DOMParser + XMLSerializer) would normalise all of those, which is why
 * this exists instead.
 */

/**
 * @typedef {Object} XmlNode
 * @property {string} name        qualified name, e.g. "w:sdt"
 * @property {number} start       index of '<'
 * @property {number} end         index just past the element's final '>'
 * @property {number} openEnd     index just past the opening tag's '>'
 * @property {number} contentStart
 * @property {number} contentEnd
 * @property {boolean} selfClosing
 * @property {XmlNode|null} parent
 * @property {XmlNode[]} children
 */

const NAME_RE = /[^\s/>]+/y;
const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;
const BAD_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** Parse the attributes of an element from its raw opening tag. */
export function attrs(xml, node) {
  const tag = xml.slice(node.start, node.openEnd);
  const out = {};
  const re = /([^\s=/<>]+)\s*=\s*"([^"]*)"|([^\s=/<>]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(tag))) {
    out[m[1] ?? m[3]] = m[2] ?? m[4];
  }
  return out;
}

/** Byte range of one attribute's VALUE (inside the quotes), or null. */
export function attrValueRange(xml, node, attrName) {
  const tag = xml.slice(node.start, node.openEnd);
  const re = new RegExp(`(?:^|\\s)${attrName.replace(RE_ESCAPE, '\\$&')}\\s*=\\s*"([^"]*)"`);
  const m = re.exec(tag);
  if (!m) return null;
  const valueStart = node.start + m.index + m[0].length - m[1].length - 1;
  return { start: valueStart, end: valueStart + m[1].length, value: m[1] };
}

/**
 * Scan the whole document.
 * @returns {{root: XmlNode, all: XmlNode[]}}
 */
export function scan(xml) {
  const root = {
    name: '#root', start: 0, end: xml.length, openEnd: 0,
    contentStart: 0, contentEnd: xml.length, selfClosing: false,
    parent: null, children: [],
  };
  const all = [];
  const stack = [root];
  let i = 0;
  const n = xml.length;

  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;

    // non-element constructs
    if (xml.startsWith('<!--', lt)) { i = xml.indexOf('-->', lt) + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { i = xml.indexOf(']]>', lt) + 3; continue; }
    if (xml.startsWith('<?', lt)) { i = xml.indexOf('?>', lt) + 2; continue; }
    if (xml.startsWith('<!', lt)) { i = xml.indexOf('>', lt) + 1; continue; }

    const closing = xml[lt + 1] === '/';
    NAME_RE.lastIndex = lt + (closing ? 2 : 1);
    const nm = NAME_RE.exec(xml);
    if (!nm) { i = lt + 1; continue; }
    const name = nm[0];

    // find the end of this tag, skipping quoted attribute values
    let j = NAME_RE.lastIndex;
    let quote = '';
    while (j < n) {
      const ch = xml[j];
      if (quote) { if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    if (j >= n) throw new Error(`XML: unterminated tag at ${lt}`);
    const gt = j;
    const selfClosing = xml[gt - 1] === '/';

    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) {
        throw new Error(`XML: mismatched </${name}> at ${lt} (open was ${open && open.name})`);
      }
      open.contentEnd = lt;
      open.end = gt + 1;
      i = gt + 1;
      continue;
    }

    const node = {
      name, start: lt, openEnd: gt + 1,
      contentStart: gt + 1, contentEnd: gt + 1,
      end: selfClosing ? gt + 1 : -1,
      selfClosing, parent: stack[stack.length - 1], children: [],
    };
    node.parent.children.push(node);
    all.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }

  if (stack.length !== 1) {
    throw new Error(`XML: ${stack.length - 1} unclosed element(s), innermost <${stack[stack.length - 1].name}>`);
  }
  return { root, all };
}

/** First descendant with the given qualified name (depth-first), or null. */
export function firstDescendant(node, name) {
  for (const c of node.children) {
    if (c.name === name) return c;
    const deep = firstDescendant(c, name);
    if (deep) return deep;
  }
  return null;
}

/** Direct child with the given name, or null. */
export function child(node, name) {
  return node.children.find((c) => c.name === name) || null;
}

/** All descendants with the given name, in document order. */
export function descendants(node, name, out = []) {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

/** Text content of an element (concatenated character data, entities decoded). */
export function textOf(xml, node) {
  if (node.selfClosing) return '';
  let out = '';
  const walk = (parent) => {
    let cursor = parent.contentStart;
    for (const c of parent.children) {
      out += decode(xml.slice(cursor, c.start));
      if (!c.selfClosing) walk(c);
      cursor = c.end;
    }
    out += decode(xml.slice(cursor, parent.contentEnd));
  };
  walk(node);
  return out;
}

export function decode(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(?:amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g, (m, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[m];
  });
}

export function escapeXml(s) {
  return String(s)
    .replace(BAD_XML_CHARS, '')   // characters XML 1.0 forbids outright
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Apply splices to a string. Each edit is {start, end, text}.
 * Applied right-to-left so earlier offsets stay valid. Overlaps are rejected.
 */
export function applyEdits(xml, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error(
        `XML: overlapping edits at ${sorted[i - 1].start}-${sorted[i - 1].end} and ${sorted[i].start}-${sorted[i].end}`
      );
    }
  }
  let out = xml;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}
