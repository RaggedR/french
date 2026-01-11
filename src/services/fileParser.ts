import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';

// Use worker from public folder
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export async function parseFile(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'txt':
      return parseTxt(file);
    case 'html':
    case 'htm':
      return parseHtml(file);
    case 'pdf':
      return parsePdf(file);
    case 'epub':
      return parseEpub(file);
    case 'mobi':
      return parseMobi(file);
    default:
      throw new Error(`Unsupported file format: ${extension}`);
  }
}

async function parseTxt(file: File): Promise<string> {
  return await file.text();
}

async function parseHtml(file: File): Promise<string> {
  const html = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Remove script and style elements
  doc.querySelectorAll('script, style').forEach(el => el.remove());

  return doc.body.textContent || '';
}

async function parsePdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapUrl: '/cmaps/',
    cMapPacked: true,
  }).promise;

  const textParts: string[] = [];
  // Limit to first 50 pages for performance
  const maxPages = Math.min(pdf.numPages, 50);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    textParts.push(pageText);
  }

  if (pdf.numPages > maxPages) {
    textParts.push(`\n\n[... ${pdf.numPages - maxPages} more pages not loaded ...]`);
  }

  return textParts.join('\n\n');
}

async function parseEpub(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Find and parse the container.xml to get the content path
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) {
    throw new Error('Invalid EPUB: missing container.xml');
  }

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'application/xml');
  const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');

  if (!rootfilePath) {
    throw new Error('Invalid EPUB: missing rootfile path');
  }

  // Parse the OPF file to get the spine order
  const opfContent = await zip.file(rootfilePath)?.async('text');
  if (!opfContent) {
    throw new Error('Invalid EPUB: missing OPF file');
  }

  const opfDoc = parser.parseFromString(opfContent, 'application/xml');
  const basePath = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);

  // Get manifest items
  const manifestItems = new Map<string, string>();
  opfDoc.querySelectorAll('manifest item').forEach(item => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifestItems.set(id, href);
    }
  });

  // Get spine order
  const spineItems: string[] = [];
  opfDoc.querySelectorAll('spine itemref').forEach(itemref => {
    const idref = itemref.getAttribute('idref');
    if (idref) {
      const href = manifestItems.get(idref);
      if (href) {
        spineItems.push(href);
      }
    }
  });

  // Extract text from each chapter
  const textParts: string[] = [];

  for (const href of spineItems) {
    const fullPath = basePath + href;
    const content = await zip.file(fullPath)?.async('text');
    if (content) {
      const doc = parser.parseFromString(content, 'application/xhtml+xml');
      doc.querySelectorAll('script, style').forEach(el => el.remove());
      const text = doc.body?.textContent?.trim();
      if (text) {
        textParts.push(text);
      }
    }
  }

  return textParts.join('\n\n');
}

async function parseMobi(_file: File): Promise<string> {
  // MOBI parsing is complex - for now, we'll show a helpful message
  // A full implementation would require a dedicated MOBI parser
  throw new Error(
    'MOBI format is not yet supported. Please convert your file to EPUB using Calibre or a similar tool.'
  );
}

export function getSupportedFormats(): string[] {
  return ['.txt', '.html', '.htm', '.pdf', '.epub'];
}
