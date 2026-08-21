import fs from 'fs/promises';
import path from 'path';

export type VinylMeta = {
  albumId: string;
  pressingId?: string;
  pressingLabel?: string;
  catalogNumber?: string;
  country?: string;
  releaseYear?: number;
  vinylColor?: string;
  condition?: string;
  acquiredAt?: string;
  notes?: string;
  crate?: string;
  sideBreakAfterTrack?: number;
  updatedAt: string;
};

type Store = { albums: Record<string,VinylMeta> };
const dir = process.env.NEEDLEDROP_DATA_DIR || path.join(process.cwd(), 'data');
const file = path.join(dir, 'needledrop.json');

async function read(): Promise<Store> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return { albums: {} }; }
}
async function write(data: Store) {
  await fs.mkdir(dir, { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}
export async function getMeta(id: string) { return (await read()).albums[id] ?? null; }
export async function saveMeta(id: string, patch: Partial<VinylMeta>) {
  const db = await read();
  db.albums[id] = { ...(db.albums[id] || {}), ...patch, albumId: id, updatedAt: new Date().toISOString() };
  await write(db); return db.albums[id];
}
