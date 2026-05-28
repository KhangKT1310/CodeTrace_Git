const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'src', 'webviews', 'commitGraph');
const outputDir = path.join(rootDir, 'dist', 'webviews', 'commitGraph');

fs.mkdirSync(outputDir, { recursive: true });

for (const asset of ['index.html', 'styles.css']) {
  fs.copyFileSync(path.join(sourceDir, asset), path.join(outputDir, asset));
}

const source = fs.readFileSync(path.join(sourceDir, 'main.ts'), 'utf8');
const result = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
    lib: ['ES2020', 'DOM'],
    removeComments: false
  }
});

fs.writeFileSync(path.join(outputDir, 'main.js'), result.outputText, 'utf8');
