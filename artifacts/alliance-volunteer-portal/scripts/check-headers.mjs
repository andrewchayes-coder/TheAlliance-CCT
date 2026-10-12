import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../src');
function findComponents(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? findComponents(join(directory, entry.name)) :
      entry.name.endsWith('.tsx') ? [join(directory, entry.name)] : []);
}
const files = ['pages', 'components', 'auth'].flatMap(directory => findComponents(join(root, directory)));
// The style guide intentionally contains heading samples, separate from its PageHeader.
const exceptions = ['style-guide.tsx', 'page-header.tsx', 'auth-ui.tsx'];
const bad = files.filter(file => !exceptions.some(name => file.endsWith(name)) && /<h1[\s>]/.test(readFileSync(file, 'utf8')));
if (bad.length) { console.error('Raw <h1> outside PageHeader:\n' + bad.join('\n')); process.exit(1); }
if (!readFileSync(join(root, 'pages/style-guide.tsx'), 'utf8').includes('<PageHeader')) {
  console.error('The style guide page introduction must also use PageHeader.');
  process.exit(1);
}
console.log(`Header consistency check passed (${files.length} components; shared page/auth headings, typography samples excluded).`);
