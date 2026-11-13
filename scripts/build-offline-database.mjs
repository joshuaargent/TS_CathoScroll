import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const maximumLineBytes = 4 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

async function* lines(filePath) {
  let pending = Buffer.alloc(0);
  for await (const chunk of createReadStream(filePath)) {
    pending = Buffer.concat([pending, chunk]);
    let newline;
    while ((newline = pending.indexOf(10)) !== -1) {
      if (newline > maximumLineBytes) throw new Error('A catalogue record is too large.');
      yield pending.subarray(0, newline + 1);
      pending = pending.subarray(newline + 1);
    }
    if (pending.length > maximumLineBytes) throw new Error('A catalogue record is too large.');
  }
  if (pending.length) throw new Error('The catalogue has an incomplete final line.');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validString(value) {
  return typeof value === 'string' && value.length > 0;
}

export async function buildOfflineDatabase(snapshotPath, outputPath) {
  const destination = path.resolve(outputPath);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(destination), { recursive: true });

  let database;
  let completed = false;
  try {
    database = new DatabaseSync(temporary);
    database.exec(`
      PRAGMA foreign_keys = ON;
      BEGIN;
      CREATE TABLE categories (
        slug TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        order_index INTEGER NOT NULL
      );
      CREATE TABLE topics (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        category_slug TEXT NOT NULL REFERENCES categories(slug),
        order_index INTEGER NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        explanation TEXT NOT NULL,
        catechism_paragraphs TEXT NOT NULL,
        catechism_text TEXT NOT NULL,
        scripture_reference TEXT NOT NULL,
        scripture_text TEXT NOT NULL
      );
      CREATE INDEX categories_order ON categories(order_index, slug);
      CREATE INDEX topics_order ON topics(order_index, id);
      CREATE INDEX topics_category_order ON topics(category_slug, order_index, id);
      CREATE TABLE catalogue_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        format INTEGER NOT NULL,
        exported_at TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        category_count INTEGER NOT NULL,
        topic_count INTEGER NOT NULL
      );
      PRAGMA user_version = 1;
    `);

    const insertCategory = database.prepare(
      'INSERT INTO categories (slug, name, description, order_index) VALUES (?, ?, ?, ?)'
    );
    const insertTopic = database.prepare(`
      INSERT INTO topics (
        id, slug, category_slug, order_index, question, answer, explanation,
        catechism_paragraphs, catechism_text, scripture_reference, scripture_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const findCategory = database.prepare('SELECT name FROM categories WHERE slug = ?');
    const hash = createHash('sha256');
    let header;
    let footer;
    let categoryCount = 0;
    let topicCount = 0;
    let topicsStarted = false;

    for await (const line of lines(snapshotPath)) {
      const record = JSON.parse(decoder.decode(line.subarray(0, -1)));
      if (!isRecord(record) || footer) throw new Error('Invalid catalogue record order.');

      if (record.type === 'footer') {
        if (!header) throw new Error('The catalogue header is missing.');
        footer = record;
        continue;
      }

      hash.update(line);
      if (record.type === 'header') {
        if (
          header ||
          record.format !== 1 ||
          !validString(record.exportedAt) ||
          Number.isNaN(Date.parse(record.exportedAt))
        ) {
          throw new Error('Invalid catalogue header.');
        }
        header = record;
      } else if (record.type === 'category' && header && !topicsStarted) {
        const category = record.category;
        if (
          !isRecord(category) ||
          !validString(category.slug) ||
          !validString(category.name) ||
          typeof category.description !== 'string' ||
          !Number.isSafeInteger(category.order_index)
        ) {
          throw new Error('Invalid catalogue category.');
        }
        insertCategory.run(
          category.slug,
          category.name,
          category.description,
          category.order_index
        );
        categoryCount += 1;
      } else if (record.type === 'topic' && header) {
        topicsStarted = true;
        const topic = record.topic;
        if (
          !isRecord(topic) ||
          !validString(topic.id) ||
          !validString(topic.slug) ||
          !Number.isSafeInteger(topic.order_index) ||
          !isRecord(topic.category) ||
          !validString(topic.category.slug) ||
          !validString(topic.category.name) ||
          topic.category.is_published !== true ||
          [
            'question',
            'answer',
            'explanation',
            'catechism_text',
            'scripture_reference',
            'scripture_text',
          ].some((field) => typeof topic[field] !== 'string') ||
          (topic.catechism_paragraphs !== null &&
            (!Array.isArray(topic.catechism_paragraphs) ||
              topic.catechism_paragraphs.some((value) => typeof value !== 'string')))
        ) {
          throw new Error('Invalid catalogue topic.');
        }
        const category = findCategory.get(topic.category.slug);
        if (!category || category.name !== topic.category.name) {
          throw new Error('A topic references a missing or inconsistent category.');
        }
        insertTopic.run(
          topic.id,
          topic.slug,
          topic.category.slug,
          topic.order_index,
          topic.question,
          topic.answer,
          topic.explanation,
          JSON.stringify(topic.catechism_paragraphs ?? []),
          topic.catechism_text,
          topic.scripture_reference,
          topic.scripture_text
        );
        topicCount += 1;
      } else {
        throw new Error('Invalid catalogue record order or type.');
      }
    }

    const checksum = hash.digest('hex');
    if (
      !footer ||
      footer.categories !== categoryCount ||
      footer.topics !== topicCount ||
      footer.sha256 !== checksum
    ) {
      throw new Error('The catalogue footer, counts or checksum are invalid.');
    }

    database
      .prepare('INSERT INTO catalogue_metadata VALUES (1, ?, ?, ?, ?, ?)')
      .run(1, header.exportedAt, checksum, categoryCount, topicCount);
    database.exec('COMMIT;');
    if (database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
      throw new Error('The generated SQLite database failed its integrity check.');
    }
    database.close();
    database = undefined;
    await rename(temporary, destination);
    completed = true;
    return { categories: categoryCount, topics: topicCount, sha256: checksum };
  } finally {
    if (database) database.close();
    if (!completed) {
      try {
        await unlink(temporary);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}

async function main() {
  const result = await buildOfflineDatabase(
    path.join('build', 'offline', 'catalogue.jsonl'),
    path.join('build', 'offline', 'catalogue.sqlite')
  );
  console.log(
    `Built SQLite catalogue with ${result.categories} categories and ${result.topics} topics.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Unable to build the offline database:', error);
    process.exitCode = 1;
  });
}
