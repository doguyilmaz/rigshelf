import type { Element, Root, RootContent } from 'hast';

function text(node: RootContent): string {
  if (node.type === 'text') return node.value;
  return node.type === 'element' ? node.children.map(text).join('') : '';
}

function codeExample(pre: Element): Element {
  const code = pre.children.find((child) => child.type === 'element' && child.tagName === 'code');
  const classes = code?.type === 'element' ? code.properties.className : [];
  const language = String(
    pre.properties.dataLanguage ??
      pre.properties['data-language'] ??
      (Array.isArray(classes)
        ? String(classes.find((name) => String(name).startsWith('language-')) ?? '').replace(
            'language-',
            '',
          )
        : ''),
  );
  const labels: Record<string, string> = {
    sh: 'Shell',
    bash: 'Shell',
    shell: 'Shell',
    ts: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    json: 'JSON',
    jsonc: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    toml: 'TOML',
    md: 'Markdown',
  };
  return {
    type: 'element',
    tagName: 'figure',
    properties: { className: ['code-example'] },
    children: [
      {
        type: 'element',
        tagName: 'figcaption',
        properties: { className: ['code-toolbar'] },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: {},
            children: [{ type: 'text', value: labels[language] ?? 'Code' }],
          },
          {
            type: 'element',
            tagName: 'button',
            properties: {
              type: 'button',
              className: ['copy-code'],
              ariaLabel: 'Copy code example',
              hidden: true,
            },
            children: [{ type: 'text', value: 'Copy' }],
          },
        ],
      },
      pre,
    ],
  };
}

export default function markdownLayout() {
  return {
    name: 'rigshelf-reading-layout',
    // The after hook sees the highlighter's final language and code nodes.
    after(tree: Root, context: { replaceNode(node: Element, replacement: Element): void }): void {
      let section = 'Reference',
        tables = 0;
      function visit(parent: Root | Element): void {
        for (const child of parent.children) {
          if (child.type !== 'element') continue;
          if (/^h[1-3]$/.test(child.tagName)) section = text(child);
          visit(child);
          if (child.tagName === 'pre') context.replaceNode(child, codeExample(child));
          if (child.tagName === 'table')
            context.replaceNode(child, {
              type: 'element',
              tagName: 'div',
              properties: {
                className: ['table-scroll'],
                role: 'region',
                ariaLabel: `${section} — table ${++tables}`,
                tabIndex: 0,
              },
              children: [child],
            });
        }
      }
      visit(tree);
    },
  };
}
