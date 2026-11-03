// electron-builder afterPack hook. Mac builds aren't signed with a paid Apple developer certificate, so the app is
// "ad-hoc" signed instead: Apple Silicon Macs won't run an app whose signature doesn't match its files at all.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
