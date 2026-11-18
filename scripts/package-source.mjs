import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, renameSync } from 'node:fs';
// Explicitly exclude generated state, dependencies, environment files and Git metadata.
const files = readdirSync('.').filter(name => !name.startsWith('.') && !['node_modules','dist','outputs','work','public'].includes(name));
files.push('.openai/hosting.json', '.gitignore');
for (const file of readdirSync('public')) if (file !== 'source.tar.gz') files.push(`public/${file}`);
mkdirSync('outputs', {recursive:true});
execFileSync('tar', ['-czf', 'outputs/source.tar.gz', ...files]);
renameSync('outputs/source.tar.gz', 'public/source.tar.gz');
console.log('Prepared downloadable source archive.');
