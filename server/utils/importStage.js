import { mkdir, writeFile, readFile, readdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import crypto from 'crypto';

/*
  Holds an uploaded import file between the preview and the import, so the person uploads it once.

  Only a top-tier user ever gets here (the routes check first). The file is written under the system's
  temp directory with a random 128-bit id as its whole name, readable only by the server's own user. It is
  never served, never opened by its content's names, and only the person who staged it can use it. It is
  deleted when the import runs, when they stage another, or after 30 minutes.
*/
const DIR = () => join(tmpdir(), 'kempo-inventory-import');
const TTL_MS = 30 * 60 * 1000;
const MAX_PER_USER = 2;
const ID = /^[a-f0-9]{32}$/;

const metaPath = id => join(DIR(), `${id}.json`);
const dataPath = id => join(DIR(), `${id}.bin`);

const remove = async id => {
  await rm(dataPath(id), { force: true }).catch(() => {});
  await rm(metaPath(id), { force: true }).catch(() => {});
};

const readMeta = async id => {
  try {
    return JSON.parse(await readFile(metaPath(id), 'utf8'));
  } catch {
    return null;
  }
};

/* Deletes everything expired, and a user's oldest files beyond the limit. */
export const sweep = async (userId = null, now = Date.now()) => {
  let names;
  try { names = await readdir(DIR()); } catch { return; }
  const mine = [];
  for(const name of names){
    const match = /^([a-f0-9]{32})\.json$/.exec(name);
    if(!match) continue;
    const meta = await readMeta(match[1]);
    if(!meta || now - meta.createdAt > TTL_MS) await remove(match[1]);
    else if(userId && meta.userId === userId) mine.push({ id: match[1], createdAt: meta.createdAt });
  }
  mine.sort((a, b) => b.createdAt - a.createdAt);
  for(const old of mine.slice(MAX_PER_USER - 1)) await remove(old.id);
};

/* Stores the bytes for `userId` and returns the id to use for the import. */
export const stage = async (bytes, userId, name = '') => {
  await mkdir(DIR(), { recursive: true, mode: 0o700 });
  await sweep(userId);
  const id = crypto.randomBytes(16).toString('hex');
  await writeFile(dataPath(id), bytes, { mode: 0o600 });
  await writeFile(metaPath(id), JSON.stringify({ userId, name: String(name).slice(0, 200), createdAt: Date.now() }), { mode: 0o600 });
  return id;
};

/* The staged bytes, or null when the id is malformed, unknown, expired, or belongs to someone else. */
export const readStaged = async (id, userId) => {
  if(typeof id !== 'string' || !ID.test(id)) return null;
  const meta = await readMeta(id);
  if(!meta || meta.userId !== userId || Date.now() - meta.createdAt > TTL_MS) return null;
  try {
    await stat(dataPath(id));
    return { bytes: await readFile(dataPath(id)), name: meta.name };
  } catch {
    return null;
  }
};

export const discardStaged = async id => {
  if(typeof id === 'string' && ID.test(id)) await remove(id);
};
