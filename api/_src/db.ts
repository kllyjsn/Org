import { MongoClient, type Db, type Collection } from 'mongodb';
import type {
  UserRow,
  SessionRow,
  WorkspaceRow,
  MemberRow,
  MapRow,
  ShareLinkRow,
  CommentRow,
} from './types.js';

let client: MongoClient | null = null;
let db: Db | null = null;
let indexed = false;

export function now(): string {
  return new Date().toISOString();
}

async function ensureIndexes(d: Db) {
  if (indexed) return;
  indexed = true;
  await Promise.all([
    d.collection('users').createIndex({ email: 1 }, { unique: true }),
    d.collection('sessions').createIndex({ token: 1 }, { unique: true }),
    d.collection('sessions').createIndex({ user_id: 1 }),
    d
      .collection('workspace_members')
      .createIndex({ workspace_id: 1, user_id: 1 }, { unique: true }),
    d.collection('maps').createIndex({ workspace_id: 1 }),
    d.collection('comments').createIndex({ map_id: 1 }),
    d.collection('share_links').createIndex({ token: 1 }, { unique: true }),
    d.collection('share_links').createIndex({ map_id: 1 }),
  ]).catch((e) => {
    indexed = false;
    throw e;
  });
}

export async function getDb(): Promise<Db> {
  if (!db) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');
    client = new MongoClient(uri, { maxPoolSize: 4 });
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'topdown');
  }
  await ensureIndexes(db);
  return db;
}

export async function col<T extends object>(name: string): Promise<Collection<T>> {
  const d = await getDb();
  return d.collection<T>(name);
}

export const users = () => col<UserRow & { _id?: unknown }>('users');
export const sessions = () => col<SessionRow & { _id?: unknown }>('sessions');
export const workspaces = () => col<WorkspaceRow & { _id?: unknown }>('workspaces');
export const members = () => col<MemberRow & { _id?: unknown }>('workspace_members');
export const maps = () => col<MapRow & { _id?: unknown }>('maps');
export const shareLinks = () => col<ShareLinkRow & { _id?: unknown }>('share_links');
export const comments = () => col<CommentRow & { _id?: unknown }>('comments');
