const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJson = require(path.join(rootDir, 'package.json'));
const extensionId = packageJson.name;
const extensionVersion = packageJson.version;
const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codetrace-extension-'));
const outputFile = path.join(rootDir, `${extensionId}-${extensionVersion}.vsix`);
const vsceBin = path.join(rootDir, 'node_modules', '.bin', 'vsce');

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function copyIfPresent(relativePath) {
  const sourcePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  const destinationPath = path.join(stagingDir, relativePath);
  const stats = fs.statSync(sourcePath);
  if (stats.isDirectory()) {
    copyDirectory(sourcePath, destinationPath);
    return;
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

try {
  copyIfPresent('dist');
  copyIfPresent('resources');
  copyIfPresent('README.md');
  copyIfPresent('LICENSE');
  copyIfPresent('LICENSE.md');
  copyIfPresent('.vscodeignore');
  copyIfPresent('package.json');

  cp.execFileSync(vsceBin, ['package', '--no-dependencies', '--out', outputFile], {
    cwd: stagingDir,
    stdio: 'inherit'
  });
} finally {
  if (typeof fs.rmSync === 'function') {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } else {
    fs.rmdirSync(stagingDir, { recursive: true });
  }
}
