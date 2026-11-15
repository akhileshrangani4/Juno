import { getFunctionName } from 'convex/server';

import * as postDescriptions from '../../convex/postDescriptions';

type Doc = Record<string, unknown> & { _id: string };
type Condition = (doc: Doc) => boolean;

// An in-memory stand-in for the parts of Convex the describe functions use, so the real query and mutation
// handlers run in tests: indexed reads become filters, and writes change plain arrays.
class FakeQuery {
  constructor(private docs: Doc[]) {}

  withIndex(_index: string, build?: (q: unknown) => unknown) {
    const conditions: Condition[] = [];
    const q = {
      eq: (field: string, value: unknown) => (conditions.push((doc) => doc[field] === value), q),
      lt: (field: string, value: number) => (conditions.push((doc) => (doc[field] as number) < value), q),
      lte: (field: string, value: number) => (conditions.push((doc) => (doc[field] as number) <= value), q),
      gt: (field: string, value: number) => (conditions.push((doc) => (doc[field] as number) > value), q),
      gte: (field: string, value: number) => (conditions.push((doc) => (doc[field] as number) >= value), q),
    };
    build?.(q);
    return new FakeQuery(this.docs.filter((doc) => conditions.every((condition) => condition(doc))));
  }

  async unique() {
    if (this.docs.length > 1) throw new Error('unique() found more than one document');
    return this.docs[0] ?? null;
  }

  async take(count: number) {
    return this.docs.slice(0, count);
  }

  async collect() {
    return [...this.docs];
  }
}

export class FakeDb {
  readonly tables: Record<string, Doc[]> = {};
  private nextId = 0;

  table(name: string): Doc[] {
    return (this.tables[name] ??= []);
  }

  query(name: string) {
    return new FakeQuery(this.table(name));
  }

  async insert(name: string, fields: Record<string, unknown>) {
    const _id = `${name}:${++this.nextId}`;
    this.table(name).push({ ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)), _id });
    return _id;
  }

  private find(id: string) {
    const doc = this.table(id.split(':')[0]).find((candidate) => candidate._id === id);
    if (!doc) throw new Error(`no document ${id}`);
    return doc;
  }

  async patch(id: string, fields: Record<string, unknown>) {
    const doc = this.find(id);
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) delete doc[field];
      else doc[field] = value;
    }
  }

  async delete(id: string) {
    const table = this.table(id.split(':')[0]);
    table.splice(table.indexOf(this.find(id)), 1);
  }
}

type Handler = { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> };

const handlers: Record<string, Handler> = Object.fromEntries(
  Object.entries(postDescriptions).map(([name, fn]) => [`postDescriptions:${name}`, fn as unknown as Handler]),
);

export function fakeConvex({ ip = '203.0.113.7' }: { ip?: string | null } = {}) {
  const db = new FakeDb();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const scheduled: { ms: number; name: string; args: Record<string, unknown> }[] = [];
  const mutationCtx = {
    db,
    scheduler: { runAfter: async (ms: number, reference: unknown, args: Record<string, unknown>) => void scheduled.push({ ms, name: getFunctionName(reference as never), args }) },
  };
  const call = async (reference: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(reference as never);
    calls.push({ name, args });
    return handlers[name]._handler(mutationCtx, args);
  };
  const ctx = { runQuery: call, runMutation: call, meta: { getRequestMetadata: async () => ({ ip }) } };
  const runScheduled = async () => {
    for (const job of scheduled.splice(0)) await handlers[job.name]._handler(mutationCtx, job.args);
  };
  return { ctx, db, calls, scheduled, runScheduled, mutationCtx };
}
