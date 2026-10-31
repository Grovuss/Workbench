const os = require('node:os');

function osName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}

function ruleMatches(rule, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== osName()) return false;
    // Mojang's "x86" means 32-bit.
    if (rule.os.arch && !(rule.os.arch === 'x86' && process.arch === 'ia32')) return false;
    if (rule.os.version && !new RegExp(rule.os.version).test(os.release())) return false;
  }
  if (rule.features) {
    for (const [key, value] of Object.entries(rule.features)) {
      if (Boolean(features[key]) !== value) return false;
    }
  }
  return true;
}

/** Evaluates a version JSON `rules` array: the last matching rule wins. */
function isAllowed(rules, features = {}) {
  if (!rules?.length) return true;
  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, features)) allowed = rule.action === 'allow';
  }
  return allowed;
}

module.exports = { osName, isAllowed };
