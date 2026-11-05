'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Package on Windows x64.');
  const root = path.resolve(__dirname, '..');
  const output = path.resolve(process.argv[2] || path.join(root, 'dist', 'StudyDash-Production-Windows-x64'));
  if (output === root || root.startsWith(output + path.sep) || output === path.parse(output).root) throw Error('Choose a dedicated package output folder.');
  const runtime = process.env.STUDYDASH_ELECTRON_RUNTIME || path.dirname(require('electron'));
  if (!fs.existsSync(path.join(runtime, 'electron.exe'))) throw Error('Install the Electron development dependency with npm ci first.');
  fs.mkdirSync(output, { recursive: true });
  for (const entry of fs.readdirSync(runtime, { withFileTypes: true })) {
    if (entry.name === 'resources') continue;
    const name = entry.name === 'electron.exe' ? 'StudyDash.exe' : entry.name === 'electron_wer.dll' ? 'StudyDash_wer.dll' : entry.name;
    fs.cpSync(path.join(runtime, entry.name), path.join(output, name), { recursive: true });
  }
  const app = path.join(output, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  for (const name of ['app.js', 'ui.html', 'workspace.css', 'grab.js', 'reader.js', 'icon.png', 'icon.ico', 'tray.ps1', 'edition.txt', 'assets', 'desktop', 'ext']) {
    fs.cpSync(path.join(root, name), path.join(app, name), { recursive: true });
  }
  fs.mkdirSync(path.join(app, 'music'), { recursive: true });
  for (const entry of fs.readdirSync(path.join(root, 'music'), { withFileTypes: true })) {
    if (entry.isFile() && /\.mp3$/i.test(entry.name)) fs.copyFileSync(path.join(root, 'music', entry.name), path.join(app, 'music', entry.name));
  }
  const { version } = require('../package.json');
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'studydash', productName: 'StudyDash', version, main: 'desktop/entry.cjs', private: true }, null, 2) + '\n');
  for (const name of ['Install.cmd', 'Install.ps1', 'Uninstall.ps1', 'THIRD-PARTY-NOTICES.txt']) fs.copyFileSync(path.join(root, name), path.join(output, name));
  fs.writeFileSync(path.join(output, 'README.txt'), 'StudyDash - #1 Dashboard\r\n\r\nExtract the whole package and run StudyDash.exe. First launch installs the app, creates a Start menu shortcut, and opens it.\r\n\r\nUninstall using Windows Settings > Apps > Installed apps > StudyDash Dashboard. Uninstall removes saved tasks, settings, connections and browser data as well as the program.\r\n\r\nThis Windows x64 build is unsigned.\r\n');
  const { rcedit } = await import('rcedit');
  await rcedit(path.join(output, 'StudyDash.exe'), {
    icon: path.join(root, 'icon.ico'), 'file-version': version + '.0', 'product-version': version + '.0',
    'version-string': { ProductName: 'StudyDash', FileDescription: 'StudyDash', CompanyName: 'StudyDash', OriginalFilename: 'StudyDash.exe', InternalName: 'StudyDash' },
  });
  console.log(output);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
