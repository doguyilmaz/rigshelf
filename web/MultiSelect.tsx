import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { foldSearch } from '../src/core/taxonomy';
import { t } from './i18n';
import type { SelectOption } from './Select';

export function MultiSelect({
  label,
  values,
  options,
  onChange,
  placeholder,
  id,
}: {
  label: string;
  values: string[];
  options: SelectOption[];
  onChange: (values: string[]) => void;
  placeholder: string;
  id?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLElement>();
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    setContainer(root.current?.closest('dialog') || undefined);
  }, []);
  const labels = useMemo(() => new Map(options.map((item) => [item.value, item])), [options]);
  const items = useMemo(() => options.map((item) => item.value), [options]);
  const selected = values.map((value) => labels.get(value)?.label ?? value);
  return (
    <div
      className="select-control"
      ref={root}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <Combobox.Root
        multiple
        items={items}
        value={values}
        onValueChange={(next) => onChange(next.slice(0, 20))}
        open={open}
        onOpenChange={setOpen}
        itemToStringLabel={(value) => labels.get(value)?.label || value}
        filter={(value, query) =>
          foldSearch(`${labels.get(value)?.label} ${labels.get(value)?.group || ''}`).includes(
            foldSearch(query),
          )
        }
      >
        <Combobox.Trigger id={id} aria-label={label} className="select-trigger">
          <span className="select-value" title={selected.join(', ')}>
            {selected.length
              ? selected.length === 1
                ? selected[0]
                : t('{{first}} + {{count}}', { first: selected[0]!, count: selected.length - 1 })
              : placeholder}
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </Combobox.Trigger>
        <Combobox.Portal container={container}>
          <Combobox.Positioner
            className="select-positioner"
            sideOffset={6}
            positionMethod="fixed"
            align="start"
          >
            <Combobox.Popup className="select-popup">
              <div className="select-search">
                <Search size={15} aria-hidden="true" />
                <Combobox.Input
                  aria-label={t('Search {{label}}', { label })}
                  placeholder={t('Type to filter…')}
                />
              </div>
              <p className="multi-select-hint">{t('Match any selected option')}</p>
              <Combobox.Empty className="select-empty">{t('No matching options.')}</Combobox.Empty>
              <Combobox.List className="select-list">
                {(value: string) => (
                  <Combobox.Item
                    key={value}
                    value={value}
                    className="select-option"
                    aria-label={labels.get(value)?.label || value}
                  >
                    <span className="select-option-copy">
                      <span>{labels.get(value)?.label || value}</span>
                      {labels.get(value)?.group && <small>{labels.get(value)?.group}</small>}
                    </span>
                    <Combobox.ItemIndicator className="select-check">
                      <Check size={15} />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
              {values.length > 0 && (
                <button type="button" className="multi-select-clear" onClick={() => onChange([])}>
                  {t('Clear selection')}
                </button>
              )}
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
