import db from 'kempo/server/db/index.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { kempoInventoryItem, kempoInventoryMovement } from '../db/schema.js';
import { EVENTS, guard, notify } from './hooks.js';

/*
  Held stock: units that are set aside for something that has not finished — an order waiting for
  its payment, a job waiting for its materials.

  An item has two figures:

    quantity   what is **available**: what can be sold or used now. This is the figure everything
               else already reads, so a hold lowers availability everywhere without anything else
               having to know holds exist.
    held       what is set aside. Nobody can take it as available, and it is still the store's.

  The stock an item really has is `quantity + held`. Three moves, each all-or-nothing across every
  item in the call, each recorded as a movement:

    holdStock      available → held     (an order is placed)
    releaseStock   held → available     (it was cancelled, expired or failed)
    consumeHeld    held → gone          (it was fulfilled: the units have left)

  Every move is one conditional UPDATE, so concurrent callers cannot hold what is not there, release
  what is not held, or take a figure below zero.

    const [error, { items }] = await holdStock([{ id: resin.id, quantity: 175 }], { ref: 'order-1042', owner: 'my-extension' });
    // ...paid:
    await consumeHeld([{ id: resin.id, quantity: 175 }], { ref: 'order-1042', owner: 'my-extension' });
    // ...or not:
    await releaseStock([{ id: resin.id, quantity: 175 }], { ref: 'order-1042', owner: 'my-extension' });

  `ref` is written on every movement, so what was held for an order can be found and given back
  later. A refusal is a 409 that names the item, and nothing has changed.
*/

const newId = () => crypto.randomBytes(8).toString('hex');

class Refusal {
  constructor(error){
    this.error = error;
  }
}

/* What each move does to `quantity` and to `held`, per unit. */
const MOVES = {
  hold: { available: -1, held: 1 },
  release: { available: 1, held: -1 },
  consume: { available: 0, held: -1 },
};

const move = async (kind, input, { reason = '', note = '', ref = '', userId = '', owner = '' } = {}) => {
  const list = Array.isArray(input) ? input : [input];
  if(!list.length || list.some(entry => !entry || typeof entry !== 'object')) return [{ code: 400, msg: 'changes must be a non-empty list of { id, quantity }' }, null];

  const totals = new Map();
  for(const entry of list){
    const id = String(entry.id ?? '');
    const quantity = Number(entry.quantity);
    if(!id) return [{ code: 400, msg: 'Every change needs an item id' }, null];
    if(!Number.isInteger(quantity) || quantity <= 0) return [{ code: 400, msg: 'Every quantity must be a whole number above zero' }, null];
    totals.set(id, (totals.get(id) ?? 0) + quantity);
  }
  /* In a fixed order, so two overlapping calls lock rows the same way round and cannot deadlock. */
  const wanted = [...totals.entries()].map(([id, quantity]) => ({ id, quantity })).sort((a, b) => a.id.localeCompare(b.id));

  let rows;
  try {
    rows = await db.select().from(kempoInventoryItem).where(inArray(kempoInventoryItem.id, wanted.map(entry => entry.id)));
  } catch {
    return [{ code: 500, msg: `Failed to ${kind} stock` }, null];
  }
  const existing = new Map(rows.map(row => [row.id, row]));
  if(wanted.some(entry => !existing.has(entry.id))) return [{ code: 404, msg: 'An item in this change no longer exists' }, null];

  const drafts = new Map();
  for(const entry of wanted){
    const draft = { kind, quantity: entry.quantity, reason: reason || kind, note };
    const refused = await guard(EVENTS.stockBeforeHold, { item: existing.get(entry.id), draft, userId, actor: owner });
    if(refused) return [refused, null];
    const quantity = Number(draft.quantity);
    if(!Number.isInteger(quantity) || quantity <= 0) return [{ code: 400, msg: 'quantity must be a whole number above zero' }, null];
    drafts.set(entry.id, { quantity, reason: String(draft.reason || kind), note: String(draft.note || '') });
  }

  const { available, held } = MOVES[kind];

  try {
    const applied = await db.transaction(async tx => {
      const results = [];
      for(const entry of wanted){
        const { quantity, reason: why, note: text } = drafts.get(entry.id);
        const availableDelta = available * quantity;
        const heldDelta = held * quantity;
        const [row] = await tx.update(kempoInventoryItem)
          .set({
            quantity: sql`${kempoInventoryItem.quantity} + ${availableDelta}`,
            held: sql`${kempoInventoryItem.held} + ${heldDelta}`,
            updated: new Date(),
          })
          .where(and(
            eq(kempoInventoryItem.id, entry.id),
            sql`${kempoInventoryItem.quantity} + ${availableDelta} >= 0`,
            sql`${kempoInventoryItem.held} + ${heldDelta} >= 0`,
          ))
          .returning();
        if(!row){
          const name = existing.get(entry.id).name;
          throw new Refusal({
            code: 409,
            msg: kind === 'hold' ? `Not enough of ${name} is available to hold` : `${name} does not have that much on hold`,
          });
        }
        const [movement] = await tx.insert(kempoInventoryMovement).values({
          id: newId(), itemId: entry.id, delta: availableDelta, quantityAfter: row.quantity, heldDelta, heldAfter: row.held,
          reason: why, note: ref ? `${text ? `${text} ` : ''}[${ref}]` : text, userId, created: new Date(),
        }).returning();
        results.push({ row, movement, availableDelta, heldDelta, quantity });
      }
      return results;
    });

    const items = [];
    for(const { row, movement, availableDelta, heldDelta, quantity } of applied){
      const item = { id: row.id, sku: row.sku, name: row.name, quantity: row.quantity, held: row.held, category: row.category, owner: row.owner };
      items.push(item);
      await notify(EVENTS.stockHeld, {
        item, kind, quantity, previousQuantity: row.quantity - availableDelta, previousHeld: row.held - heldDelta,
        movement, userId, actor: owner,
      });
      /* What is available changed, so everything listening for that is told in the usual way. */
      if(availableDelta !== 0){
        await notify(EVENTS.stockAdjusted, {
          item, previousQuantity: row.quantity - availableDelta, delta: availableDelta,
          reason: movement.reason, note: movement.note, movement, userId, actor: owner,
        });
      }
    }
    return [null, { items }];
  } catch(error) {
    if(error instanceof Refusal) return [error.error, null];
    return [{ code: 500, msg: `Failed to ${kind} stock` }, null];
  }
};

/* Sets units aside: they stop being available and are counted as held. */
export const holdStock = (changes, options) => move('hold', changes, options);

/* Gives held units back: they are available again. */
export const releaseStock = (changes, options) => move('release', changes, options);

/* Finishes with held units: they were used or sold, so they are no longer held and not available. */
export const consumeHeld = (changes, options) => move('consume', changes, options);
