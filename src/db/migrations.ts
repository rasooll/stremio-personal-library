import type { Knex } from 'knex';

export async function migrate(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('libraries'))) {
    await db.schema.createTable('libraries', (table) => {
      table.increments('id').primary();
      table.text('name').notNullable();
      table.text('local_path').notNullable().unique();
      table.text('public_base_url').notNullable();
      table.boolean('enabled').notNullable().defaultTo(true);
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
      table.timestamp('last_scanned_at').nullable();
    });
  }
  if (!(await db.schema.hasTable('files'))) {
    await db.schema.createTable('files', (table) => {
      table.increments('id').primary();
      table.integer('library_id').notNullable().references('id').inTable('libraries').onDelete('CASCADE');
      table.text('relative_path').notNullable();
      table.text('extension').notNullable();
      table.text('file_type').notNullable();
      table.bigInteger('size').notNullable();
      table.bigInteger('mtime_ms').notNullable();
      table.text('fingerprint').notNullable();
      table.text('status').notNullable();
      table.text('parsed_json').nullable();
      table.text('unresolved_reason').nullable();
      table.timestamp('last_seen_at').notNullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
      table.unique(['library_id', 'relative_path']);
      table.index(['library_id', 'fingerprint']);
      table.index(['library_id', 'status']);
    });
  }
  if (!(await db.schema.hasTable('media'))) {
    await db.schema.createTable('media', (table) => {
      table.increments('id').primary();
      table.text('type').notNullable();
      table.text('title').notNullable();
      table.text('original_title').nullable();
      table.integer('year').nullable();
      table.integer('tmdb_id').nullable();
      table.text('imdb_id').nullable();
      table.text('poster_url').nullable();
      table.text('background_url').nullable();
      table.text('metadata_json').nullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
      table.unique(['type', 'tmdb_id']);
      table.unique(['type', 'imdb_id']);
      table.index(['type', 'title']);
    });
  }
  if (!(await db.schema.hasTable('file_mappings'))) {
    await db.schema.createTable('file_mappings', (table) => {
      table.increments('id').primary();
      table.integer('file_id').notNullable().unique().references('id').inTable('files').onDelete('CASCADE');
      table.integer('media_id').notNullable().references('id').inTable('media').onDelete('CASCADE');
      table.integer('season').nullable();
      table.integer('episode').nullable();
      table.text('subtitle_language').nullable();
      table.text('match_method').notNullable();
      table.float('confidence').nullable();
      table.boolean('manual_override').notNullable().defaultTo(false);
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
      table.index(['media_id', 'season', 'episode']);
    });
  }
  if (!(await db.schema.hasTable('scans'))) {
    await db.schema.createTable('scans', (table) => {
      table.increments('id').primary();
      table.integer('library_id').nullable().references('id').inTable('libraries').onDelete('SET NULL');
      table.text('status').notNullable();
      table.timestamp('started_at').notNullable();
      table.timestamp('finished_at').nullable();
      for (const name of ['discovered', 'analyzed', 'new', 'changed', 'skipped', 'matched', 'unresolved', 'missing', 'tmdb_request', 'ai_request', 'ai_resolved', 'error']) {
        table.integer(`${name}_count`).notNullable().defaultTo(0);
      }
      table.text('errors_json').nullable();
      table.index(['library_id', 'started_at']);
    });
  }
  if (!(await db.schema.hasTable('folder_mappings'))) {
    await db.schema.createTable('folder_mappings', (table) => {
      table.increments('id').primary();
      table.integer('library_id').notNullable().references('id').inTable('libraries').onDelete('CASCADE');
      table.text('relative_folder').notNullable();
      table.integer('media_id').notNullable().references('id').inTable('media').onDelete('CASCADE');
      table.timestamp('created_at').notNullable();
      table.unique(['library_id', 'relative_folder']);
    });
  }
  if (!(await db.schema.hasTable('sessions'))) {
    await db.schema.createTable('sessions', (table) => {
      table.text('id').primary();
      table.text('data').notNullable();
      table.bigInteger('expires_at').notNullable().index();
    });
  }
}
