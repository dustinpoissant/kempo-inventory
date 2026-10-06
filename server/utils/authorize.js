import { currentUserHasPermission, getSession } from 'kempo/server/sdk.js';

/*
  Resolves to [null, { userId }] when the request's user holds the permission, or [{ code, msg }, null].
*/
export default async (request, permission) => {
  const token = request.cookies.session_token;
  const [sessionError, session] = await getSession({ token });
  if(sessionError || !session?.user) return [{ code: 401, msg: 'Authentication required' }, null];
  const [, allowed] = await currentUserHasPermission(token, `kempo-inventory:${permission}`);
  if(!allowed) return [{ code: 403, msg: 'Insufficient permissions' }, null];
  return [null, { userId: session.user.id }];
};
