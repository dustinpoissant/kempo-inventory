import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEntry, tokenMatch, tokensOf } from '../server/utils/searchScore.js';

test('a search is cut into lowercase words, each once, at most eight', () => {
  assert.deepEqual(tokensOf('  Blue   FILAMENT blue '), ['blue', 'filament']);
  assert.deepEqual(tokensOf(''), []);
  assert.deepEqual(tokensOf(null), []);
  assert.equal(tokensOf('a b c d e f g h i j').length, 8);
});

test('a word matches best when it is the whole text, then a whole word of it, then the start of a word, then inside one', () => {
  const scores = [tokenMatch('blue', 'Blue'), tokenMatch('blue', 'Navy blue ink'), tokenMatch('blue', 'Blueberry'), tokenMatch('blue', 'Cobalt-bluer')];
  assert.deepEqual(scores, [1, 0.95, 0.85, 0.85]);
  assert.equal(tokenMatch('lue', 'Blue'), 0.6);
  assert.equal(tokenMatch('red', 'Blue'), 0);
  assert.equal(tokenMatch('blue', null), 0);
});

test('each word takes its best field, and the score is the mean of the words', () => {
  const fields = [{ text: 'Blue' }, { text: 'Filament', weight: 0.8 }];
  assert.equal(scoreEntry({ tokens: ['blue', 'filament'], fields }), 0.9);
  assert.equal(scoreEntry({ tokens: ['blue'], fields }), 1);
  assert.equal(scoreEntry({ tokens: ['filament'], fields }), 0.8);
});

test('every word must match somewhere, or the entry scores nothing', () => {
  const fields = [{ text: 'Blue' }, { text: 'Paint', weight: 0.8 }];
  assert.equal(scoreEntry({ tokens: ['blue', 'filament'], fields }), 0);
  assert.equal(scoreEntry({ tokens: [], fields }), 0);
});

test('a match in a more important field is worth more than one in a less important field', () => {
  const inName = scoreEntry({ tokens: ['pla'], fields: [{ text: 'PLA' }, { text: 'other', weight: 0.4 }] });
  const inNotes = scoreEntry({ tokens: ['pla'], fields: [{ text: 'other' }, { text: 'PLA', weight: 0.4 }] });
  assert.ok(inName > inNotes, `${inName} should beat ${inNotes}`);
});

test('two words can match in the same field or in different ones', () => {
  assert.equal(scoreEntry({ tokens: ['matte', 'black'], fields: [{ text: 'Matte Black' }] }), 0.95);
  assert.equal(scoreEntry({ tokens: ['matte', 'black'], fields: [{ text: 'Black' }, { text: 'Matte finish', weight: 0.5 }] }), 0.7375);
});
