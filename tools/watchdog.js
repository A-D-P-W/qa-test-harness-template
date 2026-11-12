'use strict';
// Hang watchdog for test suites (M106 and M112, seeded from MailToDrive L106 and L112; ported from MailToDrive 3.12.8).
// runall preloads it into every node suite (NODE_OPTIONS=--require) with MTD_WATCHDOG_S=<seconds> (default 180; 0 = off,
// as for the type check, whose npm ci and tsc steps are long and silent). A suite that writes nothing to stdout/stderr for
// that long is stuck: a super-linear regex on a pathological input never returns, so no in-suite timer can fire and the
// suite would hang with no FAIL line (in MailToDrive a one-character regex change hung three suites at 300 s). A worker
// thread watches the time of the last write; past the limit it prints one FAIL line (the last line the suite wrote, so the
// stuck case is the one after it) and kills the process: runall reports the FAIL and the suite as CRASHED.
// Every case sits between two PASS/FAIL lines, so the silence limit is a per-case limit, but only for a suite that prints
// per case: a suite with a long silent step needs its own limit in runall (MailToDrive's runtime suite runs at 600 s, M112).
// Main thread only: workers inherit the NODE_OPTIONS preload, and a watchdog inside its own worker (or a suite's worker)
// would time out on that worker's silence and kill a healthy suite (M106).
const limit = Number(process.env.MTD_WATCHDOG_S || 0), { Worker, isMainThread } = require('worker_threads');
if (limit > 0 && isMainThread && !globalThis.__mtdWatchdog) {
  const sab = new SharedArrayBuffer(8 + 4 + 512), last = new Float64Array(sab, 0, 1), len = new Int32Array(sab, 8, 1), txt = new Uint8Array(sab, 12);
  Object.defineProperty(globalThis, '__mtdWatchdog', { value: true });
  const touch = chunk => {
    last[0] = Number(process.hrtime.bigint() / 1000000n);   // monotonic, one clock for both threads: tests stub and shift Date.now
    const s = String(chunk || '').split('\n').filter(l => l.trim()).pop();
    if (s) { const b = Buffer.from(s.slice(0, 160)); txt.set(b.subarray(0, 512)); Atomics.store(len, 0, Math.min(b.length, 512)); }
  };
  for (const st of [process.stdout, process.stderr]) { const w = st.write.bind(st); st.write = (c, ...a) => { touch(c); return w(c, ...a); }; }
  touch('');
  const w = new Worker(`
    const { workerData: { sab, limit, pid } } = require('worker_threads'), fs = require('fs');
    const last = new Float64Array(sab, 0, 1), len = new Int32Array(sab, 8, 1), txt = new Uint8Array(sab, 12), tick = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
      Atomics.wait(tick, 0, 0, 250);
      if (Number(process.hrtime.bigint() / 1000000n) - last[0] > limit * 1000) {
        const after = Buffer.from(txt.subarray(0, Atomics.load(len, 0))).toString();
        try { fs.writeSync(1, '\\nFAIL watchdog: no output for ' + limit + ' s (a hang, M106) after: ' + (after || '(start of suite)') + '\\n'); } catch (e) {}
        process.kill(pid, 'SIGKILL');
      }
    }`, { eval: true, workerData: { sab, limit, pid: process.pid } });
  w.unref();
}
module.exports = {};
