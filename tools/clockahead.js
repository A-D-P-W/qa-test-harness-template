// Clock-ahead shim (M100, seeded from MailToDrive L100). Loaded with NODE_OPTIONS="--require <this file>" and MTD_CLOCK_AHEAD_DAYS=<n>, it moves every
// clock a test can read n days forward: Date.now(), new Date() with no arguments, and the Date of every vm context
// (vm.createContext / vm.runInNewContext get the shifted Date unless the sandbox brings its own). runall's FULL run reruns
// the suites this way, so a fixture with a fixed date that ages out of a lookback window fails n days before it would
// fail for real (2026-11-10: core crashed when 2026-09-10 fixtures passed the state prune window).
// Dates built from an explicit value (new Date(ms), Date.parse, Date.UTC) are unchanged.
'use strict';
const days = Number(process.env.MTD_CLOCK_AHEAD_DAYS);
if (!(days > 0 && days <= 3660)) throw new Error('clockahead: MTD_CLOCK_AHEAD_DAYS must be 1..3660 (got ' + process.env.MTD_CLOCK_AHEAD_DAYS + ')');
const off = days * 864e5, Real = Date;
// M110 (seeded from MailToDrive L110): a function, not a class. A class cannot be called without `new`, so a bare Date()
// threw (real Date() returns the current time as a string). Called: the shifted time's string. Constructed (also by a
// subclass): a real Date.
function Ahead(...a) {
  if (!new.target) return new Real(Real.now() + off).toString();
  return Reflect.construct(Real, a.length ? a : [Real.now() + off], new.target === Ahead ? Real : new.target);
}
Object.setPrototypeOf(Ahead, Real);                 // Date.parse, Date.UTC, … unchanged
Ahead.prototype = Real.prototype;                   // instanceof Date, Date.prototype methods unchanged
Ahead.now = function now() { return Real.now() + off; };
globalThis.Date = Ahead;
const vm = require('vm'), cc = vm.createContext, rn = vm.runInNewContext;
const give = o => { if (o && typeof o === 'object' && !Object.prototype.hasOwnProperty.call(o, 'Date')) o.Date = Ahead; return o; };
vm.createContext = function (o = {}, ...r) { return cc.call(vm, give(o), ...r); };
vm.runInNewContext = function (c, o = {}, ...r) { return rn.call(vm, c, give(o), ...r); };
