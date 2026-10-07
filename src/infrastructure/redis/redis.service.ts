import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SecondaryStorage } from 'better-auth';
import { Redis } from 'ioredis';
import type { AppConfig } from '../../config/configuration.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<AppConfig>('app').redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }

  /** SCAN-based delete; never KEYS in production. */
  async delByPrefix(prefix: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        200,
      );
      cursor = next;
      if (keys.length) await this.client.del(...keys);
    } while (cursor !== '0');
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  /** Better Auth `secondaryStorage`: sessions + rate-limit counters. getAndDelete/increment must be atomic. */
  asSecondaryStorage(): SecondaryStorage {
    const r = this.client;
    const k = (key: string) => `ba:${key}`;
    return {
      get: (key) => r.get(k(key)),
      getAndDelete: (key) => r.getdel(k(key)),
      increment: async (key, ttl) => {
        // TTL applies on creation only (fixed window), as Better Auth expects.
        const [[, value]] = (await r.multi().incr(k(key)).exec()) as [
          [Error | null, number],
        ];
        if (value === 1) await r.expire(k(key), ttl);
        return value;
      },
      set: async (key, value, ttl) => {
        if (ttl) await r.set(k(key), value, 'EX', ttl);
        else await r.set(k(key), value);
      },
      delete: async (key) => {
        await r.del(k(key));
      },
    };
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
