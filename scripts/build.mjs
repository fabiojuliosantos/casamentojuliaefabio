import { readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const targets = [
  { input: 'app.js', output: 'app.min.js', loader: 'js' },
  { input: 'styles.css', output: 'styles.min.css', loader: 'css' },
];

await Promise.all(
  targets.map(async ({ input, output, loader }) => {
    const source = await readFile(input, 'utf8');
    const result = await transform(source, {
      loader,
      minify: true,
      target: loader === 'js' ? 'es2018' : undefined,
    });

    await writeFile(output, result.code);
  }),
);
