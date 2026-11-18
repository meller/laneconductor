// Leaves a trace of why the connector's process ends or hits an error it did not expect (track AM-10128, the otralingo finding: a
// user saw "Connection closed" and the server had no way to say why). Everything goes to stderr, never stdout (stdout is MCP only).
//
//   - an uncaught exception or an unhandled rejection is logged with its stack and the process KEEPS SERVING (a tool call is already
//     wrapped by runTool, so what reaches here is a bug in a timer, a stream or a store callback; one such bug must not close the
//     connection for every later call);
//   - every exit leaves one line, `exiting: <reason> (code N)`, where the reason is what the process was told (signal, the client
//     closing stdin, a failed start) or "no reason recorded" when something called process.exit without saying why.
export function installProcessGuards({ log, proc = process } = {}) {
  let reason = null;
  const say = log ?? ((m) => proc.stderr.write(`[lc-connector] ${m}\n`));
  const describe = (e) => String(e?.stack ?? e);
  proc.on('uncaughtException', (e) => say(`uncaught exception, still serving: ${describe(e)}`));
  proc.on('unhandledRejection', (e) => say(`unhandled rejection, still serving: ${describe(e)}`));
  proc.on('exit', (code) => say(`exiting: ${reason ?? 'no reason recorded'} (code ${code})`));
  return {
    /** Records why the process is about to end; the first reason wins. */
    exitBecause(why) {
      if (reason === null) reason = why;
    },
  };
}
