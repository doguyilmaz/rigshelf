import type { Entry } from '../src/core/model';
import {
  type ClassificationAxis,
  classificationPrefixes,
  classifyEntry,
  isClassificationTag,
  platforms,
  technologies,
  topics,
} from '../src/core/taxonomy';
import { t } from './i18n';
import { MultiSelect } from './MultiSelect';

export function ClassificationEditor({
  entry,
  tags,
  onChange,
}: {
  entry: Pick<Entry, 'name'>;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const detected = classifyEntry({ ...entry, tags });
  const options = { platforms, technologies, topics };
  const labels = { platforms: 'Platform & area', technologies: 'Technology', topics: 'Task' };
  const manual = tags.some(isClassificationTag);
  const update = (axis: ClassificationAxis, values: string[]) => {
    const prefix = classificationPrefixes[axis];
    onChange([
      ...tags.filter((tag) => !tag.startsWith(prefix)),
      ...(values.length ? values : ['unclassified']).map((value) => prefix + value),
    ]);
  };
  return (
    <details className="classification-editor">
      <summary>
        {t('Classification')}
        <span>{manual ? t('Customized') : t('Detected')}</span>
      </summary>
      <p className="field-help">
        {t(
          'These choices organize the library. Changes are saved with relationships and do not alter skill content or project files.',
        )}
      </p>
      {(['platforms', 'technologies', 'topics'] as const).map((axis) => {
        const prefix = classificationPrefixes[axis];
        const overrides = tags.filter((tag) => tag.startsWith(prefix));
        const selected = overrides.length
          ? overrides
              .map((tag) => tag.slice(prefix.length))
              .filter((value) => value !== 'unclassified')
          : detected[axis];
        return (
          <label key={axis} htmlFor={`classification-${axis}`}>
            {t(labels[axis])}
            <MultiSelect
              id={`classification-${axis}`}
              label={t(`Classification ${labels[axis]}`)}
              values={selected}
              options={options[axis].map((item) => ({ value: item.id, label: t(item.label) }))}
              placeholder={t('Unclassified')}
              onChange={(values) => update(axis, values)}
            />
          </label>
        );
      })}
      {manual && (
        <button
          type="button"
          className="text-link"
          onClick={() => onChange(tags.filter((tag) => !isClassificationTag(tag)))}
        >
          {t('Use detected classification')}
        </button>
      )}
    </details>
  );
}
