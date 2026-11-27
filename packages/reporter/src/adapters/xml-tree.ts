import { SaxesParser } from 'saxes';

/**
 * A whole XML document as a tree, for the adapters whose schema nests (TRX, NUnit 3, xUnit.net,
 * Robot Framework). JUnit and ZAP stream instead; these four read a test's verdict from a
 * child element that comes after the test opened, which a tree makes direct.
 *
 * Local names only: TRX declares a default namespace on every element, and matching on
 * `TestRun` rather than `{http://microsoft.com/...}TestRun` is what every TRX reader does.
 * A malformed document is refused, never half-read: a test missing from a parse that stopped
 * early would read as a test that did not exist.
 */
export interface XmlElement {
  name: string;
  attributes: Readonly<Record<string, string>>;
  children: XmlElement[];
  /** The element's own text, CDATA included, children's text excluded. */
  text: string;
}

/** The largest document read, so a hostile upload cannot hold a parse open indefinitely. */
const MAX_ELEMENTS = 500_000;

const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

const DISCARDED: XmlElement = { name: '', attributes: {}, children: [], text: '' };

export function parseXmlTree(input: Uint8Array, label: string): XmlElement {
  const parser = new SaxesParser({ xmlns: false });
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let count = 0;
  let failure: Error | undefined;
  let tooLarge = false;
  parser.on('error', (error) => {
    failure ??= error;
  });
  parser.on('opentag', (tag) => {
    count += 1;
    if (count > MAX_ELEMENTS) {
      // Counted and discarded: a shared placeholder keeps open and close tags balanced
      // without holding anything past the limit.
      tooLarge = true;
      stack.push(DISCARDED);
      return;
    }
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(tag.attributes)) {
      attributes[localName(key)] = String(value);
    }
    const element: XmlElement = { name: localName(tag.name), attributes, children: [], text: '' };
    stack.at(-1)?.children.push(element);
    if (stack.length === 0) root ??= element;
    stack.push(element);
  });
  const addText = (text: string): void => {
    const current = stack.at(-1);
    if (current !== undefined && current !== DISCARDED) current.text += text;
  };
  parser.on('text', addText);
  parser.on('cdata', addText);
  parser.on('closetag', () => {
    stack.pop();
  });
  try {
    parser.write(new TextDecoder().decode(input)).close();
  } catch (cause) {
    throw new Error(`${label} is not well-formed XML`, { cause });
  }
  if (tooLarge) throw new Error(`${label} has more than ${String(MAX_ELEMENTS)} elements`);
  if (failure !== undefined || root === undefined) {
    throw new Error(`${label} is not well-formed XML`, { cause: failure });
  }
  return root;
}

/** Direct children named `name`. */
export const childrenNamed = (element: XmlElement, name: string): XmlElement[] =>
  element.children.filter((child) => child.name === name);

/** The first direct child named `name`. */
export const childNamed = (element: XmlElement, name: string): XmlElement | undefined =>
  element.children.find((child) => child.name === name);

/** Every descendant named `name`, in document order. */
export function descendantsNamed(element: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const walk = (node: XmlElement): void => {
    for (const child of node.children) {
      if (child.name === name) found.push(child);
      walk(child);
    }
  };
  walk(element);
  return found;
}

/** The trimmed text of a child path such as `['Output', 'ErrorInfo', 'Message']`, or `''`. */
export function textAt(element: XmlElement, path: readonly string[]): string {
  let node: XmlElement | undefined = element;
  for (const name of path) node = node === undefined ? undefined : childNamed(node, name);
  return node?.text.trim() ?? '';
}
