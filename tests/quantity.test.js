import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toQuantity, checkUnit, MAX_UNIT } from '../server/utils/quantity.js';

test('whole numbers are accepted; fractions only when decimals are allowed', () => {
  assert.equal(toQuantity(3), 3);
  assert.equal(toQuantity('12'), 12);
  assert.equal(toQuantity(-2), -2);
  assert.ok(Number.isNaN(toQuantity(2.5)));
  assert.equal(toQuantity(2.5, true), 2.5);
  assert.equal(toQuantity('12.75', true), 12.75);
});

test('quantities keep at most four decimal places, and sums do not drift', () => {
  assert.equal(toQuantity(0.1 + 0.2, true), 0.3);
  assert.equal(toQuantity(1.123456, true), 1.1235);
});

test('values that are not numbers are refused', () => {
  assert.ok(Number.isNaN(toQuantity('abc', true)));
  assert.ok(Number.isNaN(toQuantity(Infinity, true)));
  assert.ok(Number.isNaN(toQuantity(undefined, true)));
});

test('a unit is trimmed, spacing collapsed, and has a length limit', () => {
  assert.deepEqual(checkUnit('  fl  oz '), [null, 'fl oz']);
  assert.deepEqual(checkUnit(''), [null, '']);
  assert.deepEqual(checkUnit(undefined), [null, '']);
  const [error, unit] = checkUnit('x'.repeat(MAX_UNIT + 1));
  assert.equal(unit, null);
  assert.equal(error.code, 400);
});
