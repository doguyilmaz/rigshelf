import ts from 'typescript';
import english from '../web/locales/en.json';
import turkish from '../web/locales/tr.json';

const failures: string[] = [];
const keys = new Set(Object.keys(english));
for (const key of keys)
  if (!Object.hasOwn(turkish, key)) failures.push(`Missing Turkish translation: ${key}`);
for (const key of Object.keys(turkish))
  if (!keys.has(key)) failures.push(`Unknown Turkish key: ${key}`);
for (const path of new Bun.Glob('web/**/*.ts{,x}').scanSync('.')) {
  const file = ts.createSourceFile(path, await Bun.file(path).text(), ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 't') {
      const source = node.arguments[0];
      if (source && ts.isStringLiteral(source) && !keys.has(source.text.trim()))
        failures.push(`${path}: Missing catalog message: ${source.text}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
}
if (failures.length) throw new Error(failures.join('\n'));
process.stdout.write(`${keys.size} messages have matching English/Turkish catalogs.\n`);
