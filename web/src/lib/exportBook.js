/**
 * A finished (or in-progress) story as downloadable files: EPUB for
 * e-readers, Word (.docx), Markdown and plain HTML. Built in the browser,
 * nothing is uploaded. Every file ends with the credits.
 *
 * book = {
 *   title, storyId, network, contract,
 *   chapters: [{ number, paragraphs: [string] }],
 *   credits: [{ address, chars, share }],
 *   finished: bool,
 * }
 */
import { zip } from "./zip.js";

/** The book from parts in reading order ({ segment }), skipping removed and hidden parts. */
export function bookFromBlocks(story, ordered, credits, extra = {}) {
  const chapters = [];
  for (const b of ordered) {
    const s = b.segment || {};
    if (Number(s.status) === 2 || s.hidden) continue;
    if (!chapters.length || s.starts_chapter) chapters.push({ number: chapters.length + 1, paragraphs: [] });
    const paras = String(s.text || "").split(/\n+/).map((p) => p.trim()).filter(Boolean);
    chapters[chapters.length - 1].paragraphs.push(...paras);
  }
  return {
    title: String((story && story.title) || "Untitled"),
    chapters,
    credits: credits || [],
    finished: Number(story && story.status) === 4,
    ...extra,
  };
}

export function xmlEscape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Characters XML 1.0 can't hold (the contract refuses most control characters already).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

export function fileBase(title) {
  return String(title || "book").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "book";
}

function creditLine(c) {
  return c.address + " — " + c.share + "% (" + c.chars.toLocaleString("en-US") + " characters)";
}

function footer(book) {
  const where = book.storyId ? "story " + book.storyId + (book.network ? " on " + book.network : "") : "";
  return "Written together on SwarmTales" + (where ? ", " + where : "") + ". Every part is recorded on the Koinos blockchain.";
}

/** Story text as plain Markdown text: no raw HTML, links or images can come from a part. */
export function mdText(text) {
  return String(text)
    .replace(/[\\`*_[\]<>&|!]/g, (c) => "\\" + c)
    .replace(/^([#>+-]|\d+\.)/, "\\$1");
}

export function toMarkdown(book) {
  const lines = ["# " + mdText(book.title), ""];
  for (const ch of book.chapters) {
    lines.push("## Chapter " + ch.number, "");
    for (const p of ch.paragraphs) lines.push(mdText(p), "");
  }
  lines.push("## Written by", "");
  for (const c of book.credits) lines.push("- " + creditLine(c));
  lines.push("", footer(book), "");
  return lines.join("\n");
}

function chapterXhtml(title, inner) {
  return '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">\n' +
    "<head><meta charset=\"utf-8\"/><title>" + xmlEscape(title) + '</title><link rel="stylesheet" href="book.css"/></head>\n' +
    "<body>\n" + inner + "\n</body>\n</html>\n";
}

function creditsHtml(book) {
  return "<section><h2>Written by</h2><ul>" +
    book.credits.map((c) => "<li>" + xmlEscape(creditLine(c)) + "</li>").join("") +
    "</ul><p>" + xmlEscape(footer(book)) + "</p></section>";
}

export function toHtml(book) {
  const body = ["<h1>" + xmlEscape(book.title) + "</h1>"];
  for (const ch of book.chapters) {
    body.push("<h2>Chapter " + ch.number + "</h2>");
    for (const p of ch.paragraphs) body.push("<p>" + xmlEscape(p) + "</p>");
  }
  body.push(creditsHtml(book));
  return "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>" + xmlEscape(book.title) +
    "</title><style>body{max-width:38em;margin:2em auto;padding:0 1em;font-family:Georgia,serif;line-height:1.6}h1,h2{text-align:center}</style></head><body>\n" +
    body.join("\n") + "\n</body></html>\n";
}

/** A stable id for the EPUB, from the story and title (no randomness: the same book gives the same file). */
function bookId(book) {
  return "urn:swarmtales:" + (book.contract || "local") + ":" + (book.storyId || fileBase(book.title));
}

export function toEpub(book) {
  const css = "body{font-family:serif;line-height:1.5}h1,h2{text-align:center}p{text-indent:1.2em;margin:0 0 .4em}";
  const chapters = book.chapters.map((ch) => ({
    file: "chapter-" + ch.number + ".xhtml",
    title: "Chapter " + ch.number,
    html: chapterXhtml("Chapter " + ch.number, "<h2>Chapter " + ch.number + "</h2>\n" + ch.paragraphs.map((p) => "<p>" + xmlEscape(p) + "</p>").join("\n")),
  }));
  const titlePage = chapterXhtml(book.title, "<h1>" + xmlEscape(book.title) + "</h1><p style=\"text-align:center;text-indent:0\">Written together on SwarmTales</p>");
  const credits = chapterXhtml("Written by", creditsHtml(book));
  const nav = chapterXhtml("Contents", '<nav epub:type="toc" id="toc"><h2>Contents</h2><ol>' +
    '<li><a href="title.xhtml">' + xmlEscape(book.title) + "</a></li>" +
    chapters.map((c) => '<li><a href="' + c.file + '">' + xmlEscape(c.title) + "</a></li>").join("") +
    '<li><a href="credits.xhtml">Written by</a></li></ol></nav>');
  const items = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="book.css" media-type="text/css"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...chapters.map((c, i) => '<item id="c' + (i + 1) + '" href="' + c.file + '" media-type="application/xhtml+xml"/>'),
    '<item id="credits" href="credits.xhtml" media-type="application/xhtml+xml"/>',
  ];
  const spine = ['<itemref idref="title"/>', ...chapters.map((c, i) => '<itemref idref="c' + (i + 1) + '"/>'), '<itemref idref="credits"/>'];
  const creators = book.credits.map((c, i) => '<dc:creator id="w' + (i + 1) + '">' + xmlEscape(c.address) + "</dc:creator>").join("\n    ");
  const opf = '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">\n' +
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    '    <dc:identifier id="bookid">' + xmlEscape(bookId(book)) + "</dc:identifier>\n" +
    "    <dc:title>" + xmlEscape(book.title) + "</dc:title>\n" +
    "    <dc:language>en</dc:language>\n" +
    "    <dc:publisher>SwarmTales</dc:publisher>\n" +
    (creators ? "    " + creators + "\n" : "") +
    '    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>\n' +
    "  </metadata>\n  <manifest>\n    " + items.join("\n    ") + "\n  </manifest>\n" +
    "  <spine>\n    " + spine.join("\n    ") + "\n  </spine>\n</package>\n";
  const container = '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n';
  return zip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: container },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    { name: "OEBPS/book.css", data: css },
    { name: "OEBPS/title.xhtml", data: titlePage },
    ...chapters.map((c) => ({ name: "OEBPS/" + c.file, data: c.html })),
    { name: "OEBPS/credits.xhtml", data: credits },
  ]);
}

function docxParagraph(text, style, pageBreakBefore) {
  const props = style || pageBreakBefore
    ? "<w:pPr>" + (style ? '<w:pStyle w:val="' + style + '"/>' : "") + (pageBreakBefore ? "<w:pageBreakBefore/>" : "") + "</w:pPr>"
    : "";
  return "<w:p>" + props + '<w:r><w:t xml:space="preserve">' + xmlEscape(text) + "</w:t></w:r></w:p>";
}

export function toDocx(book) {
  const body = [docxParagraph(book.title, "Title")];
  for (const ch of book.chapters) {
    body.push(docxParagraph("Chapter " + ch.number, "Heading1", ch.number > 1));
    for (const p of ch.paragraphs) body.push(docxParagraph(p));
  }
  body.push(docxParagraph("Written by", "Heading1", true));
  for (const c of book.credits) body.push(docxParagraph(creditLine(c)));
  body.push(docxParagraph(footer(book)));
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + W + "><w:body>" + body.join("") +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ' + W + ">" +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="480"/></w:pPr><w:rPr><w:sz w:val="56"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
    "</w:styles>";
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    "</Types>";
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  return zip([
    { name: "[Content_Types].xml", data: types },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: styles },
    { name: "word/_rels/document.xml.rels", data: docRels },
  ]);
}

export const FORMATS = [
  { id: "epub", label: "EPUB (e-readers)", ext: "epub", type: "application/epub+zip", make: toEpub },
  { id: "docx", label: "Word (.docx)", ext: "docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", make: toDocx },
  { id: "md", label: "Markdown", ext: "md", type: "text/markdown;charset=utf-8", make: toMarkdown },
  { id: "html", label: "Web page (.html)", ext: "html", type: "text/html;charset=utf-8", make: toHtml },
];
