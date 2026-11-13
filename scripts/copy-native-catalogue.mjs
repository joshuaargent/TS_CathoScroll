import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const directory = path.join('build', 'native', 'assets', 'databases');
await mkdir(directory, { recursive: true });
await copyFile(
  path.join('build', 'offline', 'catalogue.sqlite'),
  path.join(directory, 'catalogue.db')
);
console.log('Bundled the offline catalogue.');
