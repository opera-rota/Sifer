import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractAt,
  extractFocus,
  extractPage,
  maxReadingLength,
  normalizeText,
  probePoints,
  type Box,
  type Geometry,
} from './extract';

const point = { x: 50, y: 50 };
const under: Box = { left: 0, top: 40, right: 200, bottom: 60 };
const away: Box = { left: 0, top: 200, right: 200, bottom: 220 };
const belowView: Box = { left: 0, top: 900, right: 200, bottom: 920 };

interface Scene {
  hit: string | null;
  caret?: { selector: string; child?: number };
  boxes?: Box[];
  inline?: string[];
  outside?: string[];
  hidden?: string[];
}

function geometryFor(scene: Scene): Geometry {
  const textAt = (selector: string, child = 0): Text => {
    const node = document.querySelector(selector)?.childNodes[child];
    if (!(node instanceof Text)) {
      throw new Error(`no text node in ${selector}`);
    }
    return node;
  };
  return {
    elementAt: () => (scene.hit ? document.querySelector(scene.hit) : null),
    caretAt: () =>
      scene.caret ? { node: textAt(scene.caret.selector, scene.caret.child), offset: 0 } : null,
    boxesOf: (node) =>
      scene.outside?.some((selector) => node.parentElement?.closest(selector))
        ? [belowView]
        : (scene.boxes ?? [under]),
    displayOf: (element) =>
      scene.inline?.some((selector) => element.matches(selector)) ? 'inline' : 'block',
    hidden: (element) => scene.hidden?.some((selector) => element.matches(selector)) ?? false,
    viewport: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
  };
}

function render(html: string): void {
  document.body.innerHTML = html;
}

describe('extractAt', () => {
  beforeEach(() => render(''));

  it('reads the whole paragraph around the text under the point', () => {
    render('<p id="p">Sifer reads <b id="b">this</b> sentence.</p>');
    const outcome = extractAt(
      geometryFor({ hit: '#b', caret: { selector: '#b' }, inline: ['#b'] }),
      point,
    );
    expect(outcome).toEqual({
      ok: true,
      reading: {
        source: 'dom',
        kind: 'text',
        control: 'Paragraph',
        text: 'Sifer reads this sentence.',
      },
    });
  });

  it('names headings, list items and links by their role', () => {
    render('<h2 id="h">Latest from our changelog</h2><ul><li id="li">First item</li></ul>');
    expect(extractAt(geometryFor({ hit: '#h', caret: { selector: '#h' } }), point)).toMatchObject({
      reading: { control: 'Heading', text: 'Latest from our changelog' },
    });
    expect(extractAt(geometryFor({ hit: '#li', caret: { selector: '#li' } }), point)).toMatchObject(
      { reading: { control: 'List item', text: 'First item' } },
    );
  });

  it('does not read text that is not under the point', () => {
    render('<div id="card"><p id="p">far away</p></div>');
    expect(
      extractAt(geometryFor({ hit: '#card', caret: { selector: '#p' }, boxes: [away] }), point),
    ).toEqual({ ok: false, reason: 'nothing' });
  });

  it('reads a field with its label', () => {
    render('<label for="city">City</label><input id="city" value="Kigali" />');
    expect(extractAt(geometryFor({ hit: '#city' }), point)).toEqual({
      ok: true,
      reading: { source: 'dom', kind: 'value', control: 'Field', text: 'City: Kigali' },
    });
  });

  it('names an empty field by its placeholder', () => {
    render('<input id="q" placeholder="Search" />');
    expect(extractAt(geometryFor({ hit: '#q' }), point)).toMatchObject({
      reading: { kind: 'name', control: 'Field', text: 'Search' },
    });
  });

  it('reads the chosen option of a select and the state of a checkbox', () => {
    render(
      '<select id="s" aria-label="Country"><option>Kenya</option><option selected>Rwanda</option></select>' +
        '<label><input id="c" type="checkbox" checked /> Remember me</label>',
    );
    expect(extractAt(geometryFor({ hit: '#s' }), point)).toMatchObject({
      reading: { text: 'Country: Rwanda' },
    });
    expect(extractAt(geometryFor({ hit: '#c' }), point)).toMatchObject({
      reading: { control: 'Choice', text: 'Remember me: selected' },
    });
  });

  it('never reads a password field', () => {
    render('<input id="pw" type="password" value="hunter2" />');
    expect(extractAt(geometryFor({ hit: '#pw' }), point)).toEqual({
      ok: false,
      reason: 'protected',
    });
  });

  it('reads a table row with its column headers', () => {
    render(
      '<table><thead><tr><th>Name</th><th>City</th></tr></thead>' +
        '<tbody><tr><td id="n">Ninette</td><td>Kigali</td></tr></tbody></table>',
    );
    expect(extractAt(geometryFor({ hit: '#n', caret: { selector: '#n' } }), point)).toEqual({
      ok: true,
      reading: {
        source: 'dom',
        kind: 'text',
        control: 'Table row',
        text: 'Name: Ninette\nCity: Kigali',
      },
    });
  });

  it('falls back to an accessible name for icons and images', () => {
    render(
      '<button id="btn" aria-label="Close"><svg id="icon"></svg></button><img id="img" alt="Sifer logo" />',
    );
    expect(extractAt(geometryFor({ hit: '#icon' }), point)).toMatchObject({
      reading: { kind: 'name', control: 'Button', text: 'Close' },
    });
    expect(extractAt(geometryFor({ hit: '#img' }), point)).toMatchObject({
      reading: { kind: 'name', text: 'Sifer logo' },
    });
  });

  it('reads text the orb covers even when its centre sits just past the words', () => {
    render('<h1 id="h">Murakaza neza</h1>');
    const beside = { x: 50, y: 75 };
    const scene = geometryFor({ hit: '#h', caret: { selector: '#h' } });
    expect(extractAt(scene, beside)).toEqual({ ok: false, reason: 'nothing' });
    expect(extractAt(scene, beside, 20)).toMatchObject({
      ok: true,
      reading: { control: 'Heading', text: 'Murakaza neza' },
    });
    expect(extractAt(scene, beside, 5)).toEqual({ ok: false, reason: 'nothing' });
  });

  it('probes the centre first and then rings out to the reach', () => {
    const points = probePoints({ x: 10, y: 10 }, 30);
    expect(points[0]).toEqual({ x: 10, y: 10 });
    expect(points).toHaveLength(25);
    const farthest = Math.max(...points.map((probe) => Math.hypot(probe.x - 10, probe.y - 10)));
    expect(farthest).toBeCloseTo(30);
    expect(probePoints({ x: 10, y: 10 }, 0)).toEqual([{ x: 10, y: 10 }]);
  });

  it('reports nothing for empty space', () => {
    render('<div id="space"></div>');
    expect(extractAt(geometryFor({ hit: '#space' }), point)).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(extractAt(geometryFor({ hit: null }), point)).toEqual({ ok: false, reason: 'nothing' });
  });
});

describe('extractPage', () => {
  beforeEach(() => render(''));

  it('reads the visible page one block per line and skips scripts and styles', () => {
    render(
      '<h1>Weekly report</h1><p>Sales rose <b id="b">twelve</b> percent.</p>' +
        '<script>var hidden = 1;</script><style>p { color: red; }</style>' +
        '<ul><li>Kigali</li><li>Musanze</li></ul>',
    );
    expect(extractPage(geometryFor({ hit: null, inline: ['#b'] }), document)).toEqual({
      ok: true,
      reading: {
        source: 'dom',
        kind: 'text',
        control: 'Page',
        text: 'Weekly report\nSales rose twelve percent.\nKigali\nMusanze',
      },
    });
  });

  it('leaves out text that is scrolled out of view', () => {
    render('<p>On screen</p><p id="below">Further down</p>');
    expect(extractPage(geometryFor({ hit: null, outside: ['#below'] }), document)).toMatchObject({
      reading: { text: 'On screen' },
    });
  });

  it('leaves out hidden blocks', () => {
    render('<nav id="menu"><p>Closed menu</p></nav><p>Article body</p>');
    expect(
      extractPage(geometryFor({ hit: null, hidden: ['#menu', '#menu p'] }), document),
    ).toMatchObject({ reading: { text: 'Article body' } });
  });

  it('never includes passwords or field contents and reports nothing for an empty page', () => {
    render(
      '<input type="password" value="hunter2" /><textarea>private draft</textarea>' +
        '<select><option>Rwanda</option></select>',
    );
    expect(extractPage(geometryFor({ hit: null }), document)).toEqual({
      ok: false,
      reason: 'nothing',
    });
  });
});

describe('extractFocus', () => {
  beforeEach(() => {
    render('');
    document.getSelection()?.removeAllRanges();
  });

  const focusOn = (selector: string): void => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) {
      throw new Error(`no ${selector}`);
    }
    element.focus();
  };

  it('reads the focused field with its label', () => {
    render('<label for="d">District</label><input id="d" value="Gasabo" />');
    focusOn('#d');
    expect(extractFocus(geometryFor({ hit: null }), document)).toEqual({
      ok: true,
      reading: { source: 'dom', kind: 'value', control: 'Field', text: 'District: Gasabo' },
    });
  });

  it('never reads a focused password field', () => {
    render('<input id="p" type="password" value="hunter2" />');
    focusOn('#p');
    expect(extractFocus(geometryFor({ hit: null }), document)).toEqual({
      ok: false,
      reason: 'protected',
    });
  });

  it('prefers selected page text, and reports nothing when nothing is focused', () => {
    render('<p id="p">Applications close on Friday.</p>');
    expect(extractFocus(geometryFor({ hit: null }), document)).toEqual({
      ok: false,
      reason: 'nothing',
    });
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#p') as Node);
    document.getSelection()?.addRange(range);
    expect(extractFocus(geometryFor({ hit: null }), document)).toEqual({
      ok: true,
      reading: {
        source: 'dom',
        kind: 'text',
        control: 'Selection',
        text: 'Applications close on Friday.',
      },
    });
  });

  it('reads the paragraph at the caret inside a rich editor', () => {
    render(
      '<div id="e" contenteditable="true" tabindex="0"><p>First draft.</p><p id="second">Second paragraph.</p></div>',
    );
    focusOn('#e');
    const caret = document.createRange();
    caret.setStart(document.querySelector('#second')?.firstChild as Node, 3);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(caret);
    expect(extractFocus(geometryFor({ hit: null }), document)).toMatchObject({
      reading: { kind: 'text', control: 'Paragraph', text: 'Second paragraph.' },
    });
  });

  it('names a focused button', () => {
    render('<button id="b">Submit application</button>');
    focusOn('#b');
    expect(extractFocus(geometryFor({ hit: null }), document)).toMatchObject({
      reading: { kind: 'name', control: 'Button', text: 'Submit application' },
    });
  });
});

describe('normalizeText', () => {
  it('cleans spacing and caps the length', () => {
    expect(
      normalizeText(`a${String.fromCharCode(160)}b \r\n\n\n\nc${String.fromCharCode(0xfffc)}`),
    ).toBe('a b\n\nc');
    expect(normalizeText('x'.repeat(maxReadingLength + 1))).toHaveLength(maxReadingLength);
  });
});
