import { redact } from './safety';

interface ContentPreview {
  text: string;
  bytes: number;
  binary: boolean;
  redacted: boolean;
  truncated: boolean;
}
export function contentPreview(content: string, limit = 25000): ContentPreview {
  const bytes = Buffer.from(content, 'base64');
  if (bytes.includes(0))
    return {
      text: `Binary resource · ${bytes.length} bytes`,
      bytes: bytes.length,
      binary: true,
      redacted: false,
      truncated: false,
    };
  const original = bytes.toString('utf8'),
    text = redact(original);
  return {
    text: text.slice(0, limit),
    bytes: bytes.length,
    binary: false,
    redacted: text !== original,
    truncated: text.length > limit,
  };
}
