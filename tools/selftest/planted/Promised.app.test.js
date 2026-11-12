// Planted contract test (tools/guard_selftest.sh, M107): [Promised.G1] appears only in this comment, which GUARD (d) must
// not count; G4 is cited in a template literal, which it must count; G9 is not in the contract.
console.log(`PASS [Promised.G4] planted citation in a template literal`);
console.log('PASS [Promised.G9] planted citation of an ID the contract does not have');
