/**
 * Test parseRecord function handles single and double-encoded JSON
 */
import { parseRecord } from '../api/_lib/keyVault.ts';

const validRecord = {
  iv: 'aGVsbG8=',        // "hello" base64
  tag: 'd29ybGQ=',       // "world" base64
  ciphertext: 'dGVzdA==' // "test" base64
};

console.log('Test 1: Direct object');
let result = parseRecord(validRecord);
console.assert(result !== null, 'Should parse direct object');
console.assert(result.iv === validRecord.iv, 'iv matches');
console.assert(result.tag === validRecord.tag, 'tag matches');
console.assert(result.ciphertext === validRecord.ciphertext, 'ciphertext matches');
console.log('✓ PASS');

console.log('\nTest 2: Single-encoded JSON string');
const singleEncoded = JSON.stringify(validRecord);
result = parseRecord(singleEncoded);
console.assert(result !== null, 'Should parse single-encoded string');
console.assert(result.iv === validRecord.iv, 'iv matches');
console.assert(result.tag === validRecord.tag, 'tag matches');
console.assert(result.ciphertext === validRecord.ciphertext, 'ciphertext matches');
console.log('✓ PASS');

console.log('\nTest 3: Double-encoded JSON string');
const doubleEncoded = JSON.stringify(JSON.stringify(validRecord));
result = parseRecord(doubleEncoded);
console.assert(result !== null, 'Should parse double-encoded string');
console.assert(result.iv === validRecord.iv, 'iv matches');
console.assert(result.tag === validRecord.tag, 'tag matches');
console.assert(result.ciphertext === validRecord.ciphertext, 'ciphertext matches');
console.log('✓ PASS');

console.log('\nTest 4: Triple-encoded JSON string');
const tripleEncoded = JSON.stringify(JSON.stringify(JSON.stringify(validRecord)));
result = parseRecord(tripleEncoded);
console.assert(result !== null, 'Should parse triple-encoded string');
console.assert(result.iv === validRecord.iv, 'iv matches');
console.assert(result.tag === validRecord.tag, 'tag matches');
console.assert(result.ciphertext === validRecord.ciphertext, 'ciphertext matches');
console.log('✓ PASS');

console.log('\nTest 5: Invalid - missing fields');
result = parseRecord({ iv: 'a', tag: 'b' });
console.assert(result === null, 'Should reject missing ciphertext');
console.log('✓ PASS');

console.log('\nTest 6: Invalid - empty strings');
result = parseRecord({ iv: '', tag: 'b', ciphertext: 'c' });
console.assert(result === null, 'Should reject empty iv');
console.log('✓ PASS');

console.log('\nTest 7: Invalid - not an object');
result = parseRecord('not json');
console.assert(result === null, 'Should reject non-JSON string');
console.log('✓ PASS');

console.log('\nTest 8: Invalid - null');
result = parseRecord(null);
console.assert(result === null, 'Should reject null');
console.log('✓ PASS');

console.log('\nAll tests passed!');