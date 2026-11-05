import { Autocomplete } from '@base-ui/react/autocomplete';
import { ChevronDown, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { t } from './i18n';

interface ProjectOption {
  name: string;
  path: string;
}
export function ProjectPathInput({
  value,
  onValueChange,
  projects,
}: {
  value: string;
  onValueChange: (value: string) => void;
  projects: ProjectOption[];
}) {
  const [open, setOpen] = useState(false);
  const { contains } = Autocomplete.useFilter();
  return (
    <div
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <Autocomplete.Root
        items={projects}
        value={value}
        onValueChange={onValueChange}
        itemToStringValue={(project) => project.path}
        filter={(project, query) => contains(project.name, query) || contains(project.path, query)}
        open={open}
        onOpenChange={setOpen}
        openOnInputClick
      >
        <Autocomplete.InputGroup className="path-input">
          <FolderOpen size={18} aria-hidden="true" />
          <Autocomplete.Input id="project-path" placeholder="~/Developer/my-next-project" />
          <Autocomplete.Trigger className="path-trigger" aria-label={t('Show known projects')}>
            <ChevronDown size={15} />
          </Autocomplete.Trigger>
        </Autocomplete.InputGroup>
        <Autocomplete.Portal>
          <Autocomplete.Positioner
            className="select-positioner"
            sideOffset={6}
            align="start"
            positionMethod="fixed"
          >
            <Autocomplete.Popup className="select-popup">
              <Autocomplete.Empty className="select-empty">
                {t('New folder? Keep typing its path.')}
              </Autocomplete.Empty>
              <Autocomplete.List className="select-list">
                {(project: ProjectOption) => (
                  <Autocomplete.Item className="select-option" key={project.path} value={project}>
                    <span className="select-option-copy">
                      <span>{project.name}</span>
                      <small>{project.path}</small>
                    </span>
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </div>
  );
}
