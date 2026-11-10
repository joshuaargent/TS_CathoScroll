'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export interface AdminContentCategory {
  slug: string;
  name: string;
  description: string;
  order_index: number;
  is_published: boolean;
}

export interface AdminContentTopic {
  id: string;
  slug: string;
  category_slug: string;
  order_index: number;
  question: string;
  answer: string;
  explanation: string;
  catechism_paragraphs: string[] | null;
  catechism_text: string;
  scripture_reference: string;
  scripture_text: string;
  is_published: boolean;
}

interface Props {
  categories: AdminContentCategory[];
  topics: AdminContentTopic[];
}

type CategoryForm = Omit<AdminContentCategory, 'is_published' | 'order_index'> & {
  order_index: string;
  is_published: boolean;
};

type TopicForm = Omit<AdminContentTopic, 'order_index' | 'catechism_paragraphs'> & {
  order_index: string;
  catechism_paragraphs: string;
};

const fieldClass =
  'border-border bg-bg-primary focus:border-accent w-full rounded-xl border px-4 py-3 outline-none';
const labelClass = 'text-text-secondary mb-2 block text-sm font-medium';

const emptyCategory: CategoryForm = {
  slug: '',
  name: '',
  description: '',
  order_index: '0',
  is_published: true,
};

const emptyTopic: TopicForm = {
  id: '',
  slug: '',
  category_slug: '',
  order_index: '0',
  question: '',
  answer: '',
  explanation: '',
  catechism_paragraphs: '',
  catechism_text: '',
  scripture_reference: '',
  scripture_text: '',
  is_published: true,
};

function categoryToForm(category: AdminContentCategory): CategoryForm {
  return { ...category, order_index: String(category.order_index) };
}

function topicToForm(topic: AdminContentTopic): TopicForm {
  return {
    ...topic,
    order_index: String(topic.order_index),
    catechism_paragraphs: (topic.catechism_paragraphs ?? []).join('\n'),
  };
}

function slugify(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseOrder(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : -1;
}

export function AdminContentManager({ categories, topics }: Props) {
  const router = useRouter();
  const [categoryForm, setCategoryForm] = useState<CategoryForm | null>(null);
  const [topicForm, setTopicForm] = useState<TopicForm | null>(null);
  const [topicFilter, setTopicFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const categoryBySlug = useMemo(
    () => new Map(categories.map((category) => [category.slug, category])),
    [categories]
  );
  const filteredTopics = useMemo(() => {
    const filter = topicFilter.trim().toLowerCase();
    return topics.filter((topic) => {
      if (!filter) return true;
      return (
        topic.question.toLowerCase().includes(filter) ||
        topic.slug.toLowerCase().includes(filter) ||
        topic.category_slug.toLowerCase().includes(filter)
      );
    });
  }, [topics, topicFilter]);

  function startCategory(category?: AdminContentCategory) {
    setError('');
    setSuccess('');
    setCategoryForm(category ? categoryToForm(category) : { ...emptyCategory });
  }

  function startTopic(topic?: AdminContentTopic) {
    setError('');
    setSuccess('');
    setTopicForm(
      topic ? topicToForm(topic) : { ...emptyTopic, category_slug: categories[0]?.slug ?? '' }
    );
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryForm) return;
    const orderIndex = parseOrder(categoryForm.order_index);
    if (orderIndex < 0) {
      setError('Order must be a whole number greater than or equal to zero.');
      return;
    }

    await save(
      {
        kind: 'category',
        slug: categoryForm.slug,
        name: categoryForm.name,
        description: categoryForm.description,
        orderIndex,
        isPublished: categoryForm.is_published,
      },
      Boolean(categoryBySlug.get(categoryForm.slug))
    );
  }

  async function saveTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!topicForm) return;
    const orderIndex = parseOrder(topicForm.order_index);
    if (orderIndex < 0) {
      setError('Order must be a whole number greater than or equal to zero.');
      return;
    }
    if (!topicForm.category_slug) {
      setError('Create a category before adding a topic.');
      return;
    }

    const payload = {
      kind: 'topic' as const,
      ...(topicForm.id ? { id: topicForm.id } : {}),
      slug: topicForm.slug,
      categorySlug: topicForm.category_slug,
      orderIndex,
      question: topicForm.question,
      answer: topicForm.answer,
      explanation: topicForm.explanation,
      catechismParagraphs: topicForm.catechism_paragraphs
        .split(/\r?\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean),
      catechismText: topicForm.catechism_text,
      scriptureReference: topicForm.scripture_reference,
      scriptureText: topicForm.scripture_text,
      isPublished: topicForm.is_published,
    };

    await save(payload, Boolean(topicForm.id));
  }

  async function save(payload: Record<string, unknown>, editing: boolean) {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const response = await fetch('/api/admin/content', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? 'Unable to save this content.');
        return;
      }

      setCategoryForm(null);
      setTopicForm(null);
      setSuccess('Content saved and the shared content cache was cleared.');
      router.refresh();
    } catch (requestError) {
      console.error('Unable to save admin-managed content:', requestError);
      setError('Unable to save this content. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="border-border bg-bg-secondary/40 rounded-3xl border p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-accent text-sm font-semibold tracking-wider uppercase">Library</p>
            <h2 className="mt-2 text-2xl font-bold">Categories</h2>
            <p className="text-text-secondary mt-2 max-w-2xl text-sm">
              Organise the learning library and control which categories appear publicly.
            </p>
          </div>
          <button
            type="button"
            onClick={() => startCategory()}
            className="bg-accent rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Add category
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {categories.map((category) => (
            <article key={category.slug} className="border-border rounded-2xl border p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{category.name}</h3>
                  <p className="text-text-muted mt-1 text-xs">{category.slug}</p>
                </div>
                <span className="bg-bg-secondary rounded-full px-3 py-1 text-xs">
                  {category.is_published ? 'Published' : 'Draft'}
                </span>
              </div>
              <p className="text-text-secondary mt-3 line-clamp-3 text-sm">
                {category.description || 'No description'}
              </p>
              <button
                type="button"
                onClick={() => startCategory(category)}
                className="text-accent mt-4 text-sm font-medium hover:underline"
              >
                Edit category
              </button>
            </article>
          ))}
          {categories.length === 0 && (
            <p className="text-text-secondary text-sm">
              No categories yet. Add one to get started.
            </p>
          )}
        </div>
      </section>

      <section className="border-border bg-bg-secondary/40 rounded-3xl border p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-accent text-sm font-semibold tracking-wider uppercase">Curriculum</p>
            <h2 className="mt-2 text-2xl font-bold">Topics</h2>
            <p className="text-text-secondary mt-2 max-w-2xl text-sm">
              Edit every learning field, category, display order, and publication status.
              Unpublishing hides a topic without breaking progress, bookmark, or comment references.
            </p>
          </div>
          <button
            type="button"
            onClick={() => startTopic()}
            disabled={categories.length === 0}
            className="bg-accent rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Add topic
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label>
            <span className={labelClass}>Find a topic</span>
            <input
              value={topicFilter}
              onChange={(event) => setTopicFilter(event.target.value)}
              className={fieldClass}
              placeholder="Search title, slug, or category"
            />
          </label>
          <p className="text-text-muted self-end pb-3 text-sm">
            {filteredTopics.length} of {topics.length} topics
          </p>
        </div>

        <div className="mt-4 max-h-[34rem] space-y-2 overflow-y-auto">
          {filteredTopics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              onClick={() => startTopic(topic)}
              className="border-border hover:bg-bg-secondary flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-left"
            >
              <span>
                <span className="block font-medium">{topic.question}</span>
                <span className="text-text-muted mt-1 block text-xs">
                  {categoryBySlug.get(topic.category_slug)?.name ?? topic.category_slug} ·{' '}
                  {topic.slug}
                </span>
              </span>
              <span className="bg-bg-secondary rounded-full px-3 py-1 text-xs">
                {topic.is_published ? 'Published' : 'Draft'}
              </span>
            </button>
          ))}
          {filteredTopics.length === 0 && (
            <p className="text-text-secondary py-6 text-center text-sm">No matching topics.</p>
          )}
        </div>
      </section>

      {(error || success) && (
        <p
          role="status"
          className={`rounded-xl p-4 text-sm ${error ? 'bg-red-500/10 text-red-600' : 'bg-accent/10 text-accent'}`}
        >
          {error || success}
        </p>
      )}

      {categoryForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-editor-title"
          className="bg-bg-primary/80 fixed inset-0 z-50 overflow-y-auto p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={saveCategory}
            className="border-border bg-bg-primary mx-auto my-6 max-w-2xl space-y-5 rounded-3xl border p-6 shadow-2xl md:p-8"
          >
            <div>
              <p className="text-accent text-sm font-semibold tracking-wider uppercase">
                {categoryBySlug.has(categoryForm.slug)
                  ? 'Edit library section'
                  : 'New library section'}
              </p>
              <h2 id="category-editor-title" className="mt-2 text-2xl font-bold">
                {categoryBySlug.has(categoryForm.slug) ? 'Category details' : 'Create category'}
              </h2>
            </div>
            {error && (
              <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-sm text-red-600">
                {error}
              </p>
            )}
            <label>
              <span className={labelClass}>Name</span>
              <input
                required
                maxLength={100}
                value={categoryForm.name}
                onChange={(event) => {
                  const name = event.target.value;
                  setCategoryForm((form) =>
                    form
                      ? {
                          ...form,
                          name,
                          slug: categoryBySlug.has(form.slug) ? form.slug : slugify(name),
                        }
                      : form
                  );
                }}
                className={fieldClass}
              />
            </label>
            <label>
              <span className={labelClass}>URL slug (fixed after creation)</span>
              <input
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                value={categoryForm.slug}
                readOnly={categoryBySlug.has(categoryForm.slug)}
                onChange={(event) =>
                  setCategoryForm((form) => (form ? { ...form, slug: event.target.value } : form))
                }
                className={`${fieldClass} read-only:opacity-70`}
              />
            </label>
            <label>
              <span className={labelClass}>Description</span>
              <textarea
                rows={3}
                maxLength={1000}
                value={categoryForm.description}
                onChange={(event) =>
                  setCategoryForm((form) =>
                    form ? { ...form, description: event.target.value } : form
                  )
                }
                className={fieldClass}
              />
            </label>
            <div className="grid gap-5 sm:grid-cols-2">
              <label>
                <span className={labelClass}>Display order</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={categoryForm.order_index}
                  onChange={(event) =>
                    setCategoryForm((form) =>
                      form ? { ...form, order_index: event.target.value } : form
                    )
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex items-center gap-3 self-end pb-3">
                <input
                  type="checkbox"
                  checked={categoryForm.is_published}
                  onChange={(event) =>
                    setCategoryForm((form) =>
                      form ? { ...form, is_published: event.target.checked } : form
                    )
                  }
                  className="accent-accent size-4"
                />
                <span className="text-sm font-medium">Published publicly</span>
              </label>
            </div>
            <FormActions saving={saving} onCancel={() => setCategoryForm(null)} />
          </form>
        </div>
      )}

      {topicForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="topic-editor-title"
          className="bg-bg-primary/80 fixed inset-0 z-50 overflow-y-auto p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={saveTopic}
            className="border-border bg-bg-primary mx-auto my-6 max-w-4xl space-y-5 rounded-3xl border p-6 shadow-2xl md:p-8"
          >
            <div>
              <p className="text-accent text-sm font-semibold tracking-wider uppercase">
                {topicForm.id ? 'Edit curriculum' : 'New curriculum'}
              </p>
              <h2 id="topic-editor-title" className="mt-2 text-2xl font-bold">
                {topicForm.id ? 'Topic details' : 'Create topic'}
              </h2>
              <p className="text-text-muted mt-2 text-sm">
                The topic’s internal ID is fixed so existing learning activity remains connected.
              </p>
            </div>
            {error && (
              <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="grid gap-5 md:grid-cols-2">
              <label>
                <span className={labelClass}>Question / title</span>
                <input
                  required
                  maxLength={500}
                  value={topicForm.question}
                  onChange={(event) => {
                    const question = event.target.value;
                    setTopicForm((form) =>
                      form
                        ? {
                            ...form,
                            question,
                            slug: form.id ? form.slug : slugify(question),
                          }
                        : form
                    );
                  }}
                  className={fieldClass}
                />
              </label>
              <label>
                <span className={labelClass}>
                  URL slug{topicForm.id ? ' (fixed after creation)' : ''}
                </span>
                <input
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={topicForm.slug}
                  readOnly={Boolean(topicForm.id)}
                  onChange={(event) =>
                    setTopicForm((form) => (form ? { ...form, slug: event.target.value } : form))
                  }
                  className={`${fieldClass} read-only:opacity-70`}
                />
              </label>
              <label>
                <span className={labelClass}>Category</span>
                <select
                  required
                  value={topicForm.category_slug}
                  onChange={(event) =>
                    setTopicForm((form) =>
                      form ? { ...form, category_slug: event.target.value } : form
                    )
                  }
                  className={fieldClass}
                >
                  {categories.map((category) => (
                    <option key={category.slug} value={category.slug}>
                      {category.name}
                      {category.is_published ? '' : ' (draft)'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelClass}>Display order</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={topicForm.order_index}
                  onChange={(event) =>
                    setTopicForm((form) =>
                      form ? { ...form, order_index: event.target.value } : form
                    )
                  }
                  className={fieldClass}
                />
              </label>
            </div>
            <label>
              <span className={labelClass}>Short answer</span>
              <textarea
                required
                rows={3}
                maxLength={20_000}
                value={topicForm.answer}
                onChange={(event) =>
                  setTopicForm((form) => (form ? { ...form, answer: event.target.value } : form))
                }
                className={fieldClass}
              />
            </label>
            <label>
              <span className={labelClass}>Detailed explanation</span>
              <textarea
                rows={7}
                maxLength={30_000}
                value={topicForm.explanation}
                onChange={(event) =>
                  setTopicForm((form) =>
                    form ? { ...form, explanation: event.target.value } : form
                  )
                }
                className={fieldClass}
              />
            </label>
            <div className="grid gap-5 md:grid-cols-2">
              <label>
                <span className={labelClass}>Catechism paragraph references (one per line)</span>
                <textarea
                  rows={4}
                  value={topicForm.catechism_paragraphs}
                  onChange={(event) =>
                    setTopicForm((form) =>
                      form ? { ...form, catechism_paragraphs: event.target.value } : form
                    )
                  }
                  className={fieldClass}
                  placeholder={'1\n2\n3'}
                />
              </label>
              <label>
                <span className={labelClass}>Catechism text</span>
                <textarea
                  rows={4}
                  maxLength={30_000}
                  value={topicForm.catechism_text}
                  onChange={(event) =>
                    setTopicForm((form) =>
                      form ? { ...form, catechism_text: event.target.value } : form
                    )
                  }
                  className={fieldClass}
                />
              </label>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <label>
                <span className={labelClass}>Scripture reference</span>
                <input
                  maxLength={500}
                  value={topicForm.scripture_reference}
                  onChange={(event) =>
                    setTopicForm((form) =>
                      form ? { ...form, scripture_reference: event.target.value } : form
                    )
                  }
                  className={fieldClass}
                />
              </label>
              <label>
                <span className={labelClass}>Scripture text</span>
                <textarea
                  rows={3}
                  maxLength={20_000}
                  value={topicForm.scripture_text}
                  onChange={(event) =>
                    setTopicForm((form) =>
                      form ? { ...form, scripture_text: event.target.value } : form
                    )
                  }
                  className={fieldClass}
                />
              </label>
            </div>
            <div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={topicForm.is_published}
                  onChange={(event) =>
                    setTopicForm((form) =>
                      form ? { ...form, is_published: event.target.checked } : form
                    )
                  }
                  className="accent-accent size-4"
                />
                <span className="text-sm font-medium">Published publicly</span>
              </label>
            </div>
            <FormActions saving={saving} onCancel={() => setTopicForm(null)} />
          </form>
        </div>
      )}
    </div>
  );
}

function FormActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className="border-border flex flex-wrap justify-end gap-3 border-t pt-5">
      <button
        type="button"
        disabled={saving}
        onClick={onCancel}
        className="border-border hover:bg-bg-secondary rounded-xl border px-5 py-3 text-sm font-medium"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        className="bg-accent rounded-xl px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
