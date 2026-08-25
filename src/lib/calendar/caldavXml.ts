/**
 * A deliberately tiny, namespace-flattening XML reader for CalDAV
 * multistatus bodies.
 *
 * CalDAV servers disagree wildly about namespace prefixes — `<d:response>`,
 * `<D:response>`, `<response xmlns="DAV:">` and `<ns0:response>` are all
 * the same element in the wild — so this parser drops prefixes and matches
 * on local names, which is exactly how every field we read is identified.
 *
 * It is not a general-purpose XML parser and does not pretend to be: no
 * namespace resolution, no DTDs, no entity definitions. That is the point.
 * External entity handling is where XML parsers grow XXE holes, and the
 * only entities recognised here are the five predefined ones plus numeric
 * character references. A `<!DOCTYPE …>` declaration is skipped as inert
 * text, never followed.
 */

export interface XmlNode {
  name: string; // local name, lower-cased
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string; // direct text content, entity-decoded
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function localName(qualified: string): string {
  const colon = qualified.lastIndexOf(":");
  return (colon === -1 ? qualified : qualified.slice(colon + 1)).toLowerCase();
}

/** Parses a document into a root node. Throws on input it cannot make sense of. */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) break;

    if (lt > i) {
      const chunk = source.slice(i, lt);
      if (chunk.trim()) {
        const current = stack[stack.length - 1];
        current.text += decodeEntities(chunk);
      }
    }

    // Comments, CDATA, processing instructions and DOCTYPE: skipped whole.
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt);
      const body = source.slice(lt + 9, end === -1 ? source.length : end);
      stack[stack.length - 1].text += body; // CDATA is literal, not decoded
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith("<!", lt)) {
      // DOCTYPE and friends — advance past the declaration without
      // interpreting anything inside it. Nested brackets are handled so an
      // internal subset cannot smuggle us into element parsing.
      let depth = 0;
      let j = lt + 2;
      for (; j < source.length; j++) {
        const ch = source[j];
        if (ch === "[") depth++;
        else if (ch === "]") depth--;
        else if (ch === ">" && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }

    const gt = source.indexOf(">", lt);
    if (gt === -1) break;
    const raw = source.slice(lt + 1, gt).trim();

    if (raw.startsWith("/")) {
      // Closing tag: unwind to the matching open element, tolerating the
      // occasional mismatched document rather than throwing the whole
      // response away.
      const name = localName(raw.slice(1).trim());
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].name === name) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const nameMatch = body.match(/^([^\s/>]+)/);
    if (!nameMatch) {
      i = gt + 1;
      continue;
    }
    const node: XmlNode = {
      name: localName(nameMatch[1]),
      attrs: {},
      children: [],
      text: "",
    };
    for (const attr of body.slice(nameMatch[1].length).matchAll(
      /([^\s=]+)\s*=\s*"([^"]*)"|([^\s=]+)\s*=\s*'([^']*)'/g
    )) {
      const key = localName(attr[1] ?? attr[3] ?? "");
      const value = decodeEntities(attr[2] ?? attr[4] ?? "");
      if (key) node.attrs[key] = value;
    }
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }

  return root;
}

/** Direct children with the given local name. */
export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

/** First descendant (breadth-first) with the given local name, or undefined. */
export function findFirst(node: XmlNode, name: string): XmlNode | undefined {
  const queue = [...node.children];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.name === name) return current;
    queue.push(...current.children);
  }
  return undefined;
}

/** Every descendant with the given local name. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const queue = [...node.children];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.name === name) out.push(current);
    queue.push(...current.children);
  }
  return out;
}

/** All text under a node, descendants included, trimmed. */
export function textOf(node: XmlNode | undefined): string {
  if (!node) return "";
  let out = node.text;
  for (const child of node.children) out += textOf(child);
  return out.trim();
}
