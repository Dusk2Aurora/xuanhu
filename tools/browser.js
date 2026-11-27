const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright-core');

const gameUrl = pathToFileURL(path.resolve(__dirname, '../prototype/ui-v4.html')).href;

async function launchBrowser() {
  if (process.env.BROWSER_EXECUTABLE) {
    return chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE });
  }
  if (existsSync(chromium.executablePath())) return chromium.launch({ channel: 'chromium' });
  if (process.platform === 'win32') {
    for (const dir of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]) {
      if (dir && existsSync(path.join(dir, 'Microsoft/Edge/Application/msedge.exe'))) {
        return chromium.launch({ executablePath: path.join(dir, 'Microsoft/Edge/Application/msedge.exe') });
      }
    }
  }
  return chromium.launch();
}

async function enterWard(page) {
  const lobby = page.locator('#lobby');
  if (!await lobby.isVisible()) return;
  const current = lobby.locator('[data-bed][aria-current="true"]');
  const bed = await current.count() ? current : lobby.locator('[data-bed]').first();
  await bed.click();
}

module.exports = { gameUrl, launchBrowser, enterWard };
