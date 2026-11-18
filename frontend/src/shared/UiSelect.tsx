import { Select, ListBox, ListBoxItem } from "@heroui/react";

type Option = { value: string; label: string };
export function UiSelect({
  name,
  value,
  defaultValue,
  options,
  onChange,
  disabled,
  required,
  className = "",
  "aria-label": ariaLabel,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: Option[];
  className?: string;
  onChange?: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  required?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Select
      aria-label={ariaLabel}
      name={name}
      isDisabled={disabled}
      isRequired={required}
      defaultSelectedKey={defaultValue}
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key != null) onChange?.({ target: { value: String(key) } });
      }}
    >
      <Select.Trigger
        className={`inline-flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-matcha-border bg-matcha-bg px-3.5 pe-10 text-[15px] font-normal leading-none text-matcha-text ${className}`}
      >
        <Select.Value className="flex min-w-0 flex-1 items-center text-left leading-none" />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBoxItem key={o.value} id={o.value}>
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
