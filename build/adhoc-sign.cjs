// Ad-hoc deep-sign the packaged .app so the whole bundle has a valid (self)
// signature. Without this, electron-builder leaves the outer bundle with a
// broken seal ("code has no resources but signature indicates they must be
// present"), which macOS reports as "Grove is damaged and can't be opened" on
// any machine that downloads it (quarantine then can't be cleared past it).
//
// This is NOT notarization — recipients still clear quarantine on first launch:
//   xattr -dr com.apple.quarantine /Applications/Grove.app
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // --force overwrites the partial signature; --deep signs every nested binary
  // (Electron framework, helpers, node-pty's .node + spawn-helper); "-" = ad-hoc.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  console.log(`  • ad-hoc deep-signed ${app}`)
}
