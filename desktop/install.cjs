'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { app, dialog } = require('electron');

function launchInstalled() {
  if (process.platform !== 'win32' || process.argv.includes('--quit')) return false;
  const target = path.join(process.env.LOCALAPPDATA, 'Programs', 'StudyDash Production', 'StudyDash.exe');
  if (path.resolve(process.execPath).toLowerCase() === path.resolve(target).toLowerCase()) return false;
  const profileRoot = process.env.STUDYDASH_PROFILE_ROOT || process.env.STUDYDASH_DATA
    || path.join(app.getPath('appData'), 'StudyDash Production Desktop');
  app.setPath('userData', path.join(profileRoot, 'window', process.env.STUDYDASH_PORT || '47322'));
  const packageFolder = path.resolve(__dirname, '../../..');
  const shortcut = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/StudyDash Dashboard.lnk');
  const registration = path.join(path.dirname(target), 'install-version.txt');
  const version = require('../package.json').version;
  const fail = error => app.whenReady().then(() => {
    dialog.showErrorBox('StudyDash could not install', 'Extract the entire ZIP into a folder, then run StudyDash.exe again.\n\n' + error.message);
    app.quit();
  });
  const launch = () => {
    const child = spawn(target, process.argv.includes('--background') ? ['--background'] : [], {
      cwd: path.dirname(target), detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
    });
    child.once('error', fail);
    child.once('spawn', () => { child.unref(); app.quit(); });
  };
  try {
    if (fs.existsSync(target) && fs.existsSync(shortcut) && fs.existsSync(path.join(path.dirname(target), 'Uninstall.ps1'))
      && fs.readFileSync(registration, 'utf8').trim() === version) {
      launch();
      return true;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') { fail(error); return true; }
  }
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', path.join(packageFolder, 'Install.ps1'), '-Port', process.env.STUDYDASH_PORT || '47322'],
  { windowsHide: true, timeout: 180000 }, error => error ? fail(error) : launch());
  return true;
}

module.exports = { launchInstalled };
