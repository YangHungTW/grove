/**
 * Stripping terminal escape sequences, so callers can match or store the text a
 * user would actually see.
 *
 * There were two hand-rolled copies of this before (state detection and the
 * sidebar's last-line reader) and the pane output buffer would have made three.
 * This is the union of both: CSI (`ESC[…`), OSC (`ESC]…` up to BEL or ST),
 * two-character escapes, and charset selection — INCLUDING the leading ESC, which
 * an earlier version left behind.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE =
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]|\x1b[()][A-Za-z0-9]/g

export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, '')
}
