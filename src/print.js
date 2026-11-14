import "regenerator-runtime/runtime.js";
import { PDFDocument, PageSizes, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const [width, height] = PageSizes.A4;
const ink = rgb(.08, .12, .19);
const muted = rgb(.29, .34, .42);
const accent = rgb(.16, .31, .71);
const devanagari = /[\u0900-\u097F\uA8E0-\uA8FF]/u;

export async function assembleIssue({ issue, settings, papers }, getBytes, fontBytes) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [latin, hindi] = await Promise.all(fontBytes.map(bytes => pdf.embedFont(bytes, { subset: true })));
  const maps = [new Set(latin.getCharacterSet()), new Set(hindi.getCharacterSet())];
  const fonts = [latin, hindi];
  const parts = value => String(value).normalize('NFC').split(/(\s+|[\u0900-\u097F\uA8E0-\uA8FF\u200C\u200D]+)/u)
    .filter(Boolean).map(part => {
      const index = devanagari.test(part) ? 1 : 0;
      for (const char of part) {
        if (!maps[index].has(char.codePointAt(0)) && char !== '\u200C' && char !== '\u200D') {
          throw new Error('The cover or contents includes a character outside the available fonts: ' + char);
        }
      }
      return [part, fonts[index]];
    });
  const length = (text, size) => parts(text).reduce((sum, [part, font]) => sum + font.widthOfTextAtSize(part, size), 0);
  const draw = (page, text, x, y, size, color = ink) => {
    for (const [part, font] of parts(text)) {
      page.drawText(part, { x, y, font, size, color });
      x += font.widthOfTextAtSize(part, size);
    }
  };
  const wrap = (input, size, maxWidth) => {
    const lines = [];
    let line = '';
    for (const word of String(input).trim().split(/\s+/u)) {
      if (length(word, size) > maxWidth) throw new Error('A cover or contents entry contains a word too long to print.');
      const next = line ? line + ' ' + word : word;
      if (line && length(next, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  const cover = pdf.addPage(PageSizes.A4);
  cover.drawRectangle({ x: 48, y: height - 118, width: 54, height: 5, color: accent });
  draw(cover, 'JOURNAL ISSUE', 48, height - 94, 11, accent);
  let y = height - 190;
  for (const line of wrap(settings.name, 40, width - 96)) {
    draw(cover, line, 48, y, 40);
    y -= 54;
  }
  y -= 24;
  for (const line of wrap(issue.title, 19, width - 96)) {
    draw(cover, line, 48, y, 19, muted);
    y -= 27;
  }
  draw(cover, `Volume ${issue.volume}   /   Issue ${issue.number}   /   ${issue.year}`, 48, y - 26, 14, accent);
  if (settings.publisher) wrap(settings.publisher, 12, width - 96)
    .forEach((line, index) => draw(cover, line, 48, 108 - index * 17, 12, muted));
  if (settings.issn) draw(cover, 'ISSN ' + settings.issn, 48, 48, 11, muted);

  const toc = [];
  let current;
  const contentsPage = () => {
    current = pdf.addPage(PageSizes.A4);
    draw(current, 'Table of contents', 48, height - 70, 27);
    y = height - 120;
  };
  contentsPage();
  for (const paper of papers) {
    const authors = [paper.authorName, paper.coauthors].filter(Boolean).join(', ');
    const titleLines = wrap(paper.title, 13, width - 159);
    const authorLines = wrap(authors, 11, width - 159);
    const entryHeight = titleLines.length * 20 + authorLines.length * 16 + 20;
    if (y - entryHeight < 55) contentsPage();
    toc.push({ page: current, y });
    for (const line of titleLines) { draw(current, line, 48, y, 13); y -= 20; }
    for (const line of authorLines) { draw(current, line, 48, y, 11, muted); y -= 16; }
    y -= 20;
  }
  for (const [index, paper] of papers.entries()) {
    const bytes = await getBytes(paper);
    let article;
    try {
      article = await PDFDocument.load(bytes);
    } catch {
      throw new Error('The final PDF is unreadable or password-protected: ' + paper.title);
    }
    const pages = article.getPages();
    const isA4 = ({ width: w, height: h }) => Math.abs(w - width) < 2 && Math.abs(h - height) < 2;
    if (!pages.length || pages.some(page => page.getRotation().angle % 360 !== 0 ||
      !isA4(page.getSize()) || !isA4(page.getCropBox()) || !isA4(page.getTrimBox()))) {
      throw new Error('Every final article page must be portrait A4 with matching crop and trim size: ' + paper.title);
    }
    const impositionPage = String(pdf.getPageCount() + 1);
    draw(toc[index].page, impositionPage, width - 48 - length(impositionPage, 12), toc[index].y, 12, accent);
    const copies = await pdf.copyPages(article, article.getPageIndices());
    copies.forEach(page => pdf.addPage(page));
  }
  pdf.setTitle(settings.name + ' — ' + issue.title);
  pdf.setSubject(`Volume ${issue.volume}, issue ${issue.number}, ${issue.year}`);
  const date = new Date(issue.publishedAt || issue.createdAt || Date.UTC(issue.year, 0, 1));
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);
  return pdf.save();
}

export async function exportIssue(manifest, getBytes) {
  const fonts = await Promise.all(['NotoSans-Regular.ttf', 'NotoSansDevanagari-Regular.ttf'].map(async name => {
    const response = await fetch('/fonts/' + name);
    if (!response.ok) throw new Error('The print fonts could not be loaded.');
    return response.arrayBuffer();
  }));
  return assembleIssue(manifest, getBytes, fonts);
}
