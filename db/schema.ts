import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  name: text('name').notNull(), description: text('description').notNull(), createdAt: integer('created_at').notNull(),
}, table => [index('characters_user').on(table.userId)]);
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), kind: text('kind').notNull(),
  prompt: text('prompt').notNull(), negative: text('negative').notNull(), mode: text('mode').notNull(),
  aspect: text('aspect').notNull(), seed: integer('seed').notNull(), duration: integer('duration'), parentJobId: text('parent_job_id'), status: text('status').notNull(), remoteId: text('remote_id'),
  message: text('message'), media: text('media').notNull().default('[]'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, table => [index('jobs_user').on(table.userId), uniqueIndex('one_active_job_per_user').on(table.userId).where(sql`${table.status} in ('submitting','queued','running','archiving','uncertain')`)]);
