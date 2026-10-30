import type { ReactNode } from "react";
import {
  Button as RadixButton,
  Dialog,
  Select,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { X } from "lucide-react";

export type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date" | "number" | "password";
  autoComplete?: string;
  multiline?: boolean;
  required?: boolean;
  options?: { value: string; label: string }[];
  error?: string;
};
export type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  secondary?: boolean;
  disabled?: boolean;
  className?: string;
};
export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

export function Field(p: FieldProps) {
  const shared = {
    id: p.id,
    value: p.value,
    placeholder: p.placeholder,
    required: p.required,
    autoComplete: p.autoComplete,
    "aria-describedby": p.error ? `${p.id}-error` : undefined,
    "aria-invalid": !!p.error,
  };
  return (
    <div className="ui-field">
      <label htmlFor={p.id}>{p.label}</label>
      {p.options ? (
        <Select.Root
          size="3"
          value={p.value}
          onValueChange={p.onChange}
          required={p.required}
        >
          <Select.Trigger id={p.id} aria-label={p.label} />
          <Select.Content position="popper">
            {p.options.map((o) => (
              <Select.Item key={o.value} value={o.value}>
                {o.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      ) : p.multiline ? (
        <TextArea
          {...shared}
          size="3"
          rows={3}
          onChange={(e) => p.onChange(e.target.value)}
        />
      ) : (
        <TextField.Root
          {...shared}
          type={p.type || "text"}
          step={p.type === "number" ? "any" : undefined}
          size="3"
          onChange={(e) => p.onChange(e.target.value)}
        />
      )}
      {p.error && (
        <span id={`${p.id}-error`} className="form-error" role="alert">
          {p.error}
        </span>
      )}
    </div>
  );
}

export function Button(p: ButtonProps) {
  return (
    <RadixButton
      type={p.type || "button"}
      onClick={p.onClick}
      disabled={p.disabled}
      variant={p.secondary ? "surface" : "solid"}
      color={p.secondary ? "gray" : undefined}
      size="3"
      className={p.className}
    >
      {p.children}
    </RadixButton>
  );
}

export function Modal(p: ModalProps) {
  return (
    <Dialog.Root
      open={p.open}
      onOpenChange={(v) => {
        if (!v) p.onClose();
      }}
    >
      <Dialog.Content maxWidth="490px" className="app-dialog">
        <div className="modal-heading">
          <Dialog.Title>{p.title}</Dialog.Title>
          <Dialog.Close>
            <button
              className="icon-button"
              aria-label="Close dialog"
              type="button"
            >
              <X size={19} />
            </button>
          </Dialog.Close>
        </div>
        <Dialog.Description className="sr-only">
          Review and update your workspace records.
        </Dialog.Description>
        {p.children}
      </Dialog.Content>
    </Dialog.Root>
  );
}
