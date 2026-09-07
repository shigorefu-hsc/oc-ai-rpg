import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export type Table = 'auth' | 'data';
export type Row<T = Record<string, unknown>> = {
  pk: string;
  sk: string;
  revision: number;
  data: T;
  ttl?: number;
};
export type Change = {
  table: Table;
  pk: string;
  sk: string;
  expected: number | null;
  data?: unknown;
  ttl?: number;
  remove?: boolean;
};
export type Page<T> = { items: Row<T>[]; cursor?: string };
export interface Store {
  get<T>(table: Table, pk: string, sk?: string): Promise<Row<T> | null>;
  query<T>(
    table: Table,
    pk: string,
    prefix: string,
    limit?: number,
    cursor?: string,
    reverse?: boolean,
  ): Promise<Page<T>>;
  commit(changes: Change[]): Promise<void>;
}
export class Conflict extends Error {
  constructor() {
    super('Concurrent update');
    this.name = 'Conflict';
  }
}
export function put(
  table: Table,
  pk: string,
  sk: string,
  data: unknown,
  row: Row<unknown> | null,
  ttl?: number,
): Change {
  return {
    table,
    pk,
    sk,
    data,
    expected: row?.revision ?? null,
    ...(ttl === undefined ? {} : { ttl }),
  };
}
export class DynamoStore implements Store {
  private db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  constructor(private names: Record<Table, string>) {}
  async get<T>(table: Table, pk: string, sk = 'META'): Promise<Row<T> | null> {
    const r = await this.db.send(
      new GetCommand({ TableName: this.names[table], Key: { pk, sk }, ConsistentRead: true }),
    );
    return (r.Item as Row<T>) ?? null;
  }
  async query<T>(
    table: Table,
    pk: string,
    prefix: string,
    limit = 40,
    cursor?: string,
    reverse = false,
  ): Promise<Page<T>> {
    let start: Record<string, unknown> | undefined;
    if (cursor) {
      try {
        start = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      } catch {
        throw new Error('Invalid cursor');
      }
      if (start?.pk !== pk || typeof start?.sk !== 'string' || !start.sk.startsWith(prefix))
        throw new Error('Invalid cursor');
    }
    const r = await this.db.send(
      new QueryCommand({
        TableName: this.names[table],
        KeyConditionExpression: 'pk = :p AND begins_with(sk,:s)',
        ExpressionAttributeValues: { ':p': pk, ':s': prefix },
        Limit: Math.min(limit, 100),
        ExclusiveStartKey: start,
        ScanIndexForward: !reverse,
        ConsistentRead: true,
      }),
    );
    return {
      items: (r.Items as Row<T>[]) ?? [],
      ...(r.LastEvaluatedKey
        ? { cursor: Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString('base64url') }
        : {}),
    };
  }
  async commit(changes: Change[]) {
    try {
      await this.db.send(
        new TransactWriteCommand({
          ClientRequestToken: crypto.randomUUID(),
          TransactItems: changes.map((c) => {
            const common = {
              TableName: this.names[c.table],
              ConditionExpression:
                c.expected === null ? 'attribute_not_exists(pk)' : 'revision = :v',
              ...(c.expected === null ? {} : { ExpressionAttributeValues: { ':v': c.expected } }),
            };
            return c.remove
              ? { Delete: { ...common, Key: { pk: c.pk, sk: c.sk } } }
              : {
                  Put: {
                    ...common,
                    Item: {
                      pk: c.pk,
                      sk: c.sk,
                      revision: (c.expected ?? 0) + 1,
                      data: c.data,
                      ...(c.ttl === undefined ? {} : { ttl: c.ttl }),
                    },
                  },
                };
          }),
        }),
      );
    } catch (e) {
      if (
        e instanceof Error &&
        ['TransactionCanceledException', 'ConditionalCheckFailedException'].includes(e.name)
      )
        throw new Conflict();
      throw e;
    }
  }
}
export class MemoryStore implements Store {
  private rows = new Map<string, Row<unknown>>();
  private serial: Promise<void> = Promise.resolve();
  constructor(private file?: string) {}
  async load() {
    if (!this.file) return;
    try {
      this.rows = new Map(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  private key(t: Table, p: string, s: string) {
    return JSON.stringify([t, p, s]);
  }
  async get<T>(table: Table, pk: string, sk = 'META'): Promise<Row<T> | null> {
    await this.serial;
    return structuredClone((this.rows.get(this.key(table, pk, sk)) as Row<T>) ?? null);
  }
  async query<T>(
    table: Table,
    pk: string,
    prefix: string,
    limit = 40,
    cursor?: string,
    reverse = false,
  ): Promise<Page<T>> {
    await this.serial;
    let rows = [...this.rows.entries()]
      .filter(([key, v]) => JSON.parse(key)[0] === table && v.pk === pk && v.sk.startsWith(prefix))
      .map(([, v]) => v)
      .sort((a, b) => a.sk.localeCompare(b.sk));
    if (reverse) rows.reverse();
    if (cursor) {
      const s = Buffer.from(cursor, 'base64url').toString();
      const idx = rows.findIndex((x) => x.sk === s);
      if (idx < 0) throw new Error('Invalid cursor');
      rows = rows.slice(idx + 1);
    }
    const selected = rows.slice(0, limit);
    return {
      items: structuredClone(selected) as Row<T>[],
      ...(rows.length > limit
        ? { cursor: Buffer.from(selected.at(-1)!.sk).toString('base64url') }
        : {}),
    };
  }
  async commit(changes: Change[]) {
    const op = this.serial.then(async () => {
      for (const c of changes) {
        const old = this.rows.get(this.key(c.table, c.pk, c.sk));
        if ((old?.revision ?? null) !== c.expected) throw new Conflict();
      }
      const next = new Map(this.rows);
      for (const c of changes) {
        const k = this.key(c.table, c.pk, c.sk);
        if (c.remove) next.delete(k);
        else
          next.set(k, {
            pk: c.pk,
            sk: c.sk,
            revision: (c.expected ?? 0) + 1,
            data: structuredClone(c.data),
            ...(c.ttl === undefined ? {} : { ttl: c.ttl }),
          });
      }
      if (this.file) {
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(this.file + '.tmp', JSON.stringify([...next]), { mode: 0o600 });
        await rename(this.file + '.tmp', this.file);
      }
      this.rows = next;
    });
    this.serial = op.catch(() => {});
    return op;
  }
}
