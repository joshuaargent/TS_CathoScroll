import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const pageSize = 500;
const topicFields =
  'id,slug,order_index,question,answer,explanation,catechism_paragraphs,catechism_text,scripture_reference,scripture_text,category:categories!inner(slug,name,is_published)';

// Each line is independently importable; the footer detects incomplete or
// corrupted snapshots without assembling the whole catalogue in memory.
export async function exportOfflineCatalogue(supabase, outputPath) {
  const destination = path.resolve(outputPath);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const hash = createHash('sha256');
  let categoryCount = 0;
  let topicCount = 0;
  let file;
  let completed = false;

  await mkdir(path.dirname(destination), { recursive: true });

  try {
    const { data: counts, error: countError } = await supabase.rpc('offline_catalogue_counts');
    if (countError) throw new Error(`Unable to check catalogue counts: ${countError.message}`);
    if (
      !counts ||
      typeof counts.revision !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(counts.revision) ||
      ![counts.categories, counts.topics].every(
        (value) =>
          typeof value === 'string' &&
          /^(0|[1-9][0-9]*)$/.test(value) &&
          BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
      )
    ) {
      throw new Error('The catalogue count response is invalid.');
    }
    file = await open(temporary, 'wx');

    async function writeRecords(records) {
      const chunk = records.map((record) => `${JSON.stringify(record)}\n`).join('');
      hash.update(chunk, 'utf8');
      await file.writeFile(chunk, 'utf8');
    }

    await writeRecords([{ type: 'header', format: 1, exportedAt: new Date().toISOString() }]);

    let categoryCursor = null;
    for (;;) {
      let query = supabase
        .from('categories')
        .select('slug,name,description,order_index')
        .eq('is_published', true)
        .order('slug', { ascending: true })
        .limit(pageSize);
      if (categoryCursor !== null) query = query.gt('slug', categoryCursor);

      const { data, error } = await query;
      if (error) throw new Error(`Unable to export categories: ${error.message}`);
      if (!Array.isArray(data)) throw new Error('The category export returned invalid data.');
      if (
        data.some(
          (row) =>
            typeof row.slug !== 'string' ||
            row.slug.length === 0 ||
            typeof row.name !== 'string' ||
            typeof row.description !== 'string' ||
            !Number.isSafeInteger(row.order_index)
        )
      ) {
        throw new Error('A category has invalid content.');
      }

      await writeRecords(data.map((category) => ({ type: 'category', category })));
      categoryCount += data.length;
      if (data.length < pageSize) break;
      categoryCursor = data[data.length - 1].slug;
    }

    let cursor = null;
    for (;;) {
      let query = supabase
        .from('topics')
        .select(topicFields)
        .eq('is_published', true)
        .eq('category.is_published', true)
        .order('order_index', { ascending: true })
        .order('id', { ascending: true })
        .limit(pageSize);
      if (cursor) {
        query = query.or(
          `order_index.gt.${cursor.orderIndex},and(order_index.eq.${cursor.orderIndex},id.gt.${cursor.id})`
        );
      }

      const { data, error } = await query;
      if (error) throw new Error(`Unable to export topics: ${error.message}`);
      if (!Array.isArray(data)) throw new Error('The topic export returned invalid data.');
      if (
        data.some(
          (row) =>
            !Number.isSafeInteger(row.order_index) ||
            typeof row.id !== 'string' ||
            !/^[a-zA-Z0-9-]{1,100}$/.test(row.id) ||
            !row.category ||
            typeof row.category.slug !== 'string' ||
            typeof row.category.name !== 'string' ||
            row.category.is_published !== true ||
            [
              'slug',
              'question',
              'answer',
              'explanation',
              'catechism_text',
              'scripture_reference',
              'scripture_text',
            ].some((field) => typeof row[field] !== 'string') ||
            (row.catechism_paragraphs !== null &&
              (!Array.isArray(row.catechism_paragraphs) ||
                row.catechism_paragraphs.some((value) => typeof value !== 'string')))
        )
      ) {
        throw new Error('A topic has invalid content, ID, order or category.');
      }

      await writeRecords(data.map((topic) => ({ type: 'topic', topic })));
      topicCount += data.length;
      if (data.length < pageSize) break;
      const last = data[data.length - 1];
      cursor = { orderIndex: last.order_index, id: last.id };
    }

    const { data: head, error: headError } = await supabase.rpc('offline_catalogue_head');
    if (headError) throw new Error(`Unable to check catalogue revision: ${headError.message}`);
    if (
      !head ||
      head.revision !== counts.revision ||
      categoryCount !== Number(counts.categories) ||
      topicCount !== Number(counts.topics)
    ) {
      throw new Error('The catalogue changed or was incomplete during export. Please retry.');
    }

    const footer = {
      type: 'footer',
      categories: categoryCount,
      topics: topicCount,
      sha256: hash.digest('hex'),
    };
    await file.writeFile(`${JSON.stringify(footer)}\n`, 'utf8');
    await file.close();
    file = null;
    await rename(temporary, destination);
    completed = true;
    return footer;
  } finally {
    if (file) await file.close();
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
  const env = loadEnv('production', process.cwd(), ['NEXT_PUBLIC_']);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY first.');
  }
  if (new URL(url).protocol !== 'https:') throw new Error('The Supabase URL must use HTTPS.');

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const output = path.join('build', 'offline', 'catalogue.jsonl');
  const result = await exportOfflineCatalogue(client, output);
  console.log(`Exported ${result.categories} categories and ${result.topics} topics to ${output}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Unable to export the offline catalogue:', error);
    process.exitCode = 1;
  });
}
