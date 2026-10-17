import { currentUserHasPermission, getSession, getSetting } from 'kempo/server/sdk.js';
import authorize from './authorize.js';

/*
  Who may read the inventory, and whether they may see quantity counts.

  Normally reading needs the `items:read` permission. With the `public_read` setting on, anyone can
  read, signed in or not, so the inventory can be shared as a catalogue. Either way, **quantity counts
  are only for people who manage quantity**: callers without `quantity:adjust` or `items:update` get items
  with no `quantity` and no stock history.

  Resolves to [null, { userId, canSeeQuantity, anonymous }] or [{ code, msg }, null].
*/
export const publicReadEnabled = async () => {
  const [, value] = await getSetting('kempo-inventory', 'public_read', false);
  return value === true || value === 'true';
};

const holds = async (token, permission) => {
  const [, allowed] = await currentUserHasPermission(token, `kempo-inventory:${permission}`);
  return Boolean(allowed);
};

export const authorizeRead = async request => {
  const token = request.cookies?.session_token;
  const [error, auth] = await authorize(request, 'items:read');
  if(!error){
    const canSeeQuantity = (await holds(token, 'quantity:adjust')) || (await holds(token, 'items:update'));
    return [null, { userId: auth.userId, canSeeQuantity, anonymous: false }];
  }
  if(await publicReadEnabled()){
    const [sessionError, session] = token ? await getSession({ token }) : [true, null];
    return [null, { userId: !sessionError && session?.user ? session.user.id : null, canSeeQuantity: false, anonymous: true }];
  }
  return [error, null];
};

/* An item as the caller may see it: no stock count unless they manage quantity. */
export const forCaller = (item, access) => {
  if(access.canSeeQuantity) return item;
  const { quantity, ...rest } = item;
  return rest;
};
