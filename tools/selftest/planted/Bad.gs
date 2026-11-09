const { badA } = { badA: 1 };
let badCount = 0;
const BAD_LOADED = Date.now();
badCount++;
function BadMaker_() { this.x = 1; }
function badNew_() { return new BadMaker_(); }
function badNoNew_() { return BadMaker_(); }
function badThis_() { return this; }
function badCtor_(o) { return o.constructor; }
function badName_() { return 'constructor'; }
function badReflect_(o) { return Reflect.ownKeys(o); }
function badMeta_() { return new.target; }
function badDrive_() { return DriveApp.getRootFolder(); }
function badFree_() { return mysteryName; }
function badGlobal_() { return useFixture_(); }
function badLeak_() { return fixtureLeak_(); }
function badPub_() { return 1; }
function badHelper_() { return 2; }
function badKey_() { return { constructor: 1 }; }
function badKeyStr_() { return { 'constructor': 1 }; }
function badTpl_() { return `uctor`; }
function badEval_() { return eval('1'); }
function badFn_() { return Function('return 1'); }
