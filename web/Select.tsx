import { Combobox } from '@base-ui/react/combobox';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown, Search } from 'lucide-react';
import { type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}
interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  id?: string;
  searchable?: boolean;
  disabled?: boolean;
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
  useLayoutEffect(() => {
    setContainer(root.current?.closest('dialog') || undefined);
  }, []);
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  };
  const control = { ...props, container, open, onOpenChange: setOpen };
  return (
    <div ref={root} className="select-control" onKeyDownCapture={handleEscape}>
      {props.searchable ? <SearchableSelect {...control} /> : <SimpleSelect {...control} />}
    </div>
  );
}

function SelectionText({ value, options }: Pick<SelectProps, 'value' | 'options'>) {
  const selected =
    options.find((option) => option.value === value)?.label || value || 'Choose an option';
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
        <SelectionText value={value} options={options} />
      </Combobox.Trigger>
      <Combobox.Portal container={container}>
        <Combobox.Positioner
          className="select-positioner"
          sideOffset={6}
          align="start"
          positionMethod="fixed"
        >
          <SearchableOptions label={label} labels={labels} />
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

function SearchableOptions({
  label,
  labels,
}: {
  label: string;
  labels: Map<string, SelectOption>;
}) {
  return (
    <Combobox.Popup className="select-popup">
      <div className="select-search">
        <Search size={15} aria-hidden="true" />
        <Combobox.Input
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder="Type to filter…"
        />
      </div>
      <Combobox.Empty className="select-empty">No matching options.</Combobox.Empty>
      <Combobox.List className="select-list">
        {(item: string) => (
          <Combobox.Item
            key={item}
            value={item}
            className="select-option"
            aria-label={labels.get(item)?.label || item}
          >
            <span className="select-option-copy">
              <span>{labels.get(item)?.label || item}</span>
              {labels.get(item)?.group && <small>{labels.get(item)?.group}</small>}
            </span>
            <Combobox.ItemIndicator className="select-check">
              <Check size={15} />
            </Combobox.ItemIndicator>
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
        <SelectionText value={value} options={options} />
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
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="select-option"
                >
                  <SelectPrimitive.ItemText className="select-option-copy">
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="select-check">
                    <Check size={15} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
