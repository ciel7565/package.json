// =============================================================================
// tests/lecture-fixtures.mjs — crafted lecture files for the Node suites (CONTRACT §17.3): a small real pdf, a real
// presentation (.pptx) built part by part, a png, and a zip writer in which every field can lie (names that leave the
// archive, declared sizes, flags, counts, bytes before / after) — the same shapes tests/lecture-unit.php builds in PHP.
// Used by tests/admin-lock.mjs (section lecture), tests/security-e2e.mjs (S14 lecture checks) and
// tests/lecture-client.mjs (the viewer opens a pptx built here). Test tooling only; never deployed.
// =============================================================================
import zlib from 'node:zlib';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const B = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8'));

/** a one-page pdf with a line of text (ASCII); `extra` = one more object (e.g. an action) */
export function pdfBytes(text = 'Lecture', extra = '') {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 225] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
  const stream = `BT /F1 24 Tf 30 100 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  if (extra) objs.push(extra);
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * A zip made by hand. entries: [{ name, data, method = 8 | 0, flags = 0, usize (declared), csize (declared in the
 * directory), lname (another name in the local header) }]; o: { prefix, suffix, comment, total (declared count), zip64 }.
 */
export function zipBytes(entries, o = {}) {
  const parts = [];
  let off = 0;
  const push = (b) => { parts.push(b); off += b.length; };
  if (o.prefix) push(B(o.prefix));
  const cd = [];
  for (const e of entries) {
    const name = B(e.name), data = B(e.data ?? ''), method = e.method ?? 8;
    const packed = method === 8 ? zlib.deflateRawSync(data, { level: 9 }) : data;
    const flags = e.flags ?? 0, usize = e.usize ?? data.length, crc = crc32(data), at = off, lname = B(e.lname ?? e.name);
    const lh = Buffer.alloc(30);
    lh.write('PK\x03\x04', 0, 'latin1'); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x5821, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(usize >>> 0, 22); lh.writeUInt16LE(lname.length, 26); lh.writeUInt16LE(0, 28);
    push(lh); push(lname); push(packed);
    const ch = Buffer.alloc(46);
    ch.write('PK\x01\x02', 0, 'latin1'); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x5821, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE((e.csize ?? packed.length) >>> 0, 20); ch.writeUInt32LE(usize >>> 0, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(at, 42);
    cd.push(ch, name);
  }
  const cdBuf = Buffer.concat(cd), cdOff = off, n = o.total ?? entries.length, comment = B(o.comment ?? '');
  push(cdBuf);
  const end = Buffer.alloc(22);
  end.write('PK\x05\x06', 0, 'latin1'); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(o.zip64 ? 0xffffffff : cdOff, 16); end.writeUInt16LE(comment.length, 20);
  push(end); push(comment);
  if (o.suffix) push(B(o.suffix));
  return Buffer.concat(parts);
}

/** a w × h png of one colour (optionally with a text chunk — a place to hide markup) */
export function pngBytes(w = 64, h = 36, rgb = [200, 120, 40], text = null) {
  const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const parts = [Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr)];
  if (text !== null) parts.push(chunk('tEXt', Buffer.concat([Buffer.from('Comment\0', 'latin1'), B(text)])));
  parts.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/**
 * One slide part. spec: { title, body: [text | { text, lvl }], pictures: n (uses rId1…), notes, raw (replaces the shapes) }.
 * The title and the body are placeholders, the way PowerPoint writes them.
 */
export function slideXml(spec = {}) {
  const para = (b) => { const o = typeof b === 'string' ? { text: b } : b; return `<a:p>${o.lvl ? `<a:pPr lvl="${o.lvl}"/>` : ''}<a:r><a:rPr lang="ko-KR"/><a:t>${xesc(o.text)}</a:t></a:r></a:p>`; };
  let shapes = spec.raw ?? '';
  if (spec.raw == null) {
    if (spec.title != null) shapes += `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${xesc(spec.title)}</a:t></a:r></a:p></p:txBody></p:sp>`;
    if (spec.body?.length) shapes += `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${spec.body.map(para).join('')}</p:txBody></p:sp>`;
    for (let i = 1; i <= (spec.pictures || 0); i++) shapes += `<p:pic><p:nvPicPr><p:cNvPr id="${10 + i}" name="Picture ${i}" descr="그림 ${i}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId${i}"/></p:blipFill><p:spPr/></p:pic>`;
  }
  return `${XML}<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`;
}

/**
 * The parts of a real presentation. slides: a number (plain numbered slides) or a list of slideXml specs.
 * more: extra entries; o: { types (the main content type), order (slide numbers in show order), media (name → bytes) }.
 */
export function pptxEntries(slides = 2, more = [], o = {}) {
  const specs = typeof slides === 'number' ? Array.from({ length: slides }, (_, i) => ({ title: `슬라이드 ${i + 1}`, body: ['첫째 줄', { text: '둘째 줄', lvl: 1 }], pictures: 1 })) : slides;
  const type = o.types || 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
  let ct = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="${type}"/>`;
  let ids = '', rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
  const order = o.order || specs.map((_, i) => i + 1);
  const e = [];
  specs.forEach((spec, i) => {
    const n = i + 1;
    ct += `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
    e.push({ name: `ppt/slides/slide${n}.xml`, data: slideXml(spec) });
    const pics = spec.pictures || 0;
    let sr = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
    for (let k = 1; k <= pics; k++) sr += `<Relationship Id="rId${k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${k}.png"/>`;
    if (spec.rels) sr += spec.rels;
    e.push({ name: `ppt/slides/_rels/slide${n}.xml.rels`, data: sr + '</Relationships>' });
  });
  order.forEach((n, i) => { ids += `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`; rels += `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`; });
  const head = [
    { name: '[Content_Types].xml', data: ct + '</Types>' },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>` },
    { name: 'ppt/presentation.xml', data: `${XML}<p:presentation ${NS}><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels + '</Relationships>' },
  ];
  const media = o.media || { 'image1.png': pngBytes(160, 90, [214, 160, 102]), 'image2.png': pngBytes(160, 90, [90, 150, 110]) };
  for (const [name, bytes] of Object.entries(media)) e.push({ name: `ppt/media/${name}`, data: bytes, method: 0 });
  return [...head, ...e, ...more];
}
export const pptxBytes = (slides = 2, more = [], o = {}) => zipBytes(pptxEntries(slides, more, o));

/** the hostile files of the suites: [label, kind the form says, bytes, the refusal expected (a regex on the flash / error text)] */
export function hostileFiles() {
  const pdf = pdfBytes('Lecture');
  const zeros = Buffer.alloc(20 * 1048576);
  const many = Array.from({ length: 3001 }, (_, i) => ({ name: `ppt/media/f${i}.txt`, data: '', method: 0 }));
  return [
    ['html named pdf', 'pdf', Buffer.from('<html><script>alert(1)</script></html>')],
    ['php named pdf', 'pdf', Buffer.from('<?php system($_GET["c"]); ?>')],
    ['pdf with a markup head', 'pdf', Buffer.concat([Buffer.from('%PDF-1.4\n<script>alert(1)</script>\n'), pdf.subarray(9)])],
    ['pdf with an auto-run script', 'pdf', pdfBytes('x', '<< /Type /Action /S /JavaScript /JS (app.alert(1)) >>')],
    ['pdf with an auto-run script (name spelled with #xx)', 'pdf', pdfBytes('x', '<< /Type /Action /S /J#61v#61Script /JS (app.alert(1)) >>')],
    ['pdf with php inside', 'pdf', Buffer.from(pdf.toString('latin1').replace('endstream', 'A'.repeat(9000) + '<?php system("id"); ?>\nendstream'), 'latin1')],
    ['zip named pptx', 'pptx', zipBytes([{ name: 'readme.txt', data: 'hi' }])],
    ['pptx with ../ names', 'pptx', pptxBytes(1, [{ name: '../../evil.php', data: '<?php echo 1;' }])],
    ['pptx with an absolute name', 'pptx', pptxBytes(1, [{ name: '/etc/cron.d/evil', data: 'x' }])],
    ['pptx with a backslash name', 'pptx', pptxBytes(1, [{ name: '..\\..\\evil.txt', data: 'x' }])],
    ['zip bomb (20 MB of zeros)', 'pptx', pptxBytes(1, [{ name: 'ppt/media/zeros.bin', data: zeros }])],
    ['zip bomb (2 GB declared)', 'pptx', pptxBytes(1, [{ name: 'ppt/media/big.bin', data: 'x', usize: 0x7fffffff }])],
    ['too many entries', 'pptx', pptxBytes(1, many)],
    ['pptx with macros', 'pptx', pptxBytes(1, [{ name: 'ppt/vbaProject.bin', data: 'x' }])],
    ['pptx with an executable', 'pptx', pptxBytes(1, [{ name: 'ppt/media/setup.exe', data: 'MZ' }])],
    ['pptx with php appended', 'pptx', zipBytes(pptxEntries(1), { suffix: '<?php system("id");' })],
    ['pptx behind a gif header', 'pptx', zipBytes(pptxEntries(1), { prefix: 'GIF89a<script>alert(1)</script>' })],
    ['script in a png', 'images', pngBytes(64, 36, [1, 2, 3], '<script>alert(document.domain)</script>')],
    ['php in a png', 'images', pngBytes(64, 36, [1, 2, 3], '<?php system($_GET["c"]); ?>')],
    ['svg named png', 'images', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['html named jpg', 'images', Buffer.from('<html><body onload=alert(1)>')],
  ];
}
