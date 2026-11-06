import { Combobox } from '@base-ui/react/combobox';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown, Search } from 'lucide-react';
import { type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from './components';
import { getLocale, t } from './i18n';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  count?: number;
  disabled?: boolean;
}
interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  id?: string;
  searchable?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  loading?: boolean;
  emptyText?: string;
  placeholder?: string;
}
interface ControlProps extends SelectProps {
  container?: HTMLElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Select(props: SelectProps) {
  const root = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLElement>();
  const [open, setOpen] = useState(false);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    props.onOpenChange?.(next);
  };
  useLayoutEffect(() => {
    setContainer(root.current?.closest('dialog') || undefined);
  }, []);
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    changeOpen(false);
  };
  const control = { ...props, container, open, onOpenChange: changeOpen };
  return (
    <div ref={root} className="select-control" onKeyDownCapture={handleEscape}>
      {props.searchable ? <SearchableSelect {...control} /> : <SimpleSelect {...control} />}
    </div>
  );
}

function SelectionText({
  value,
  options,
  placeholder,
}: Pick<SelectProps, 'value' | 'options' | 'placeholder'>) {
  const selected =
    options.find((option) => option.value === value)?.label ||
    value ||
    placeholder ||
    t('Choose an option');
  return (
    <>
      <span className="select-value" title={selected}>
        {selected}
      </span>
      <ChevronDown size={15} aria-hidden="true" />
    </>
  );
}

function SearchableSelect({
  value,
  options,
  label,
  id,
  disabled,
  container,
  open,
  onOpenChange,
  onValueChange,
  loading,
  emptyText,
  placeholder,
}: ControlProps) {
  const items = useMemo(() => options.map((option) => option.value), [options]);
  const labels = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  return (
    <Combobox.Root
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      open={open}
      onOpenChange={onOpenChange}
      itemToStringLabel={(item) => labels.get(item)?.label || item}
    >
      <Combobox.Trigger id={id} aria-label={label} className="select-trigger" disabled={disabled}>
        <SelectionText value={value} options={options} placeholder={placeholder} />
      </Combobox.Trigger>
      <Combobox.Portal container={container}>
        <Combobox.Positioner
          className="select-positioner"
          data-searchable
          sideOffset={6}
          align="start"
          positionMethod="fixed"
        >
          <SearchableOptions
            label={label}
            labels={labels}
            loading={loading}
            emptyText={emptyText}
          />
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

function SearchableOptions({
  label,
  labels,
  loading,
  emptyText,
}: {
  label: string;
  labels: Map<string, SelectOption>;
  loading?: boolean;
  emptyText?: string;
}) {
  return (
    <Combobox.Popup className="select-popup">
      <div className="select-search">
        <Search size={15} aria-hidden="true" />
        <Combobox.Input
          aria-label={t('Search {{label}}', { label: t(label).toLocaleLowerCase(getLocale()) })}
          placeholder={t('Type to filter…')}
        />
      </div>
      {loading && (
        <div className="select-loading" role="status">
          <Spinner text={t('Loading options…')} />
        </div>
      )}
      {!loading && (
        <Combobox.Empty className="select-empty">
          {emptyText || t('No matching options.')}
        </Combobox.Empty>
      )}
      <Combobox.List className="select-list">
        {(item: string) => (
          <Combobox.Item
            key={item}
            value={item}
            disabled={labels.get(item)?.disabled}
            className="select-option"
            aria-label={labels.get(item)?.label || item}
          >
            <span className="select-option-copy" title={labels.get(item)?.label || item}>
              <span>{labels.get(item)?.label || item}</span>
              {labels.get(item)?.group && <small>{t(labels.get(item)?.group || '')}</small>}
            </span>
            <span className="select-option-mark" aria-hidden="true">
              <Combobox.ItemIndicator className="select-check">
                <Check size={14} />
              </Combobox.ItemIndicator>
            </span>
          </Combobox.Item>
        )}
      </Combobox.List>
    </Combobox.Popup>
  );
}

function SimpleSelect({
  value,
  options,
  label,
  id,
  disabled,
  container,
  open,
  onOpenChange,
  onValueChange,
  loading,
  emptyText,
  placeholder,
}: ControlProps) {
  return (
    <SelectPrimitive.Root
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      open={open}
      onOpenChange={onOpenChange}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={label}
        className="select-trigger"
        disabled={disabled}
      >
        <SelectionText value={value} options={options} placeholder={placeholder} />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={container}>
        <SelectPrimitive.Positioner
          className="select-positioner"
          sideOffset={6}
          align="start"
          alignItemWithTrigger={false}
          positionMethod="fixed"
        >
          <SelectPrimitive.Popup className="select-popup">
            <SelectPrimitive.List className="select-list">
              {loading && (
                <div className="select-loading" role="status">
                  <Spinner text={t('Loading options…')} />
                </div>
              )}
              {!loading && !options.length && (
                <div className="select-empty" role="status">
                  {emptyText || t('No matching options.')}
                </div>
              )}
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="select-option"
                >
                  <SelectPrimitive.ItemText className="select-option-copy" title={option.label}>
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <span className="select-option-mark" aria-hidden="true">
                    <SelectPrimitive.ItemIndicator className="select-check">
                      <Check size={14} />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
