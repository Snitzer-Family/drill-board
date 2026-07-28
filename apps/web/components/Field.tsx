// Form primitives. Hand-built rather than pulled from a component library —
// the auth pages are the most brand-visible surface after the home page, and a
// vendor's default input is exactly the generic look the design system exists
// to avoid.

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required = true,
  defaultValue,
  hint,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
  placeholder?: string;
}) {
  const id = `f-${name}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-faint"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-2 w-full rounded-card border border-line-strong bg-panel px-3.5 py-2.5 text-[0.95rem] text-ink placeholder:text-ink-faint"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-card border border-danger-border bg-danger-bg px-3.5 py-2.5 text-sm text-danger"
    >
      {message}
    </p>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="w-full rounded-card bg-accent px-5 py-3 text-sm font-semibold text-on-accent puck-shadow active:translate-y-px"
    >
      {children}
    </button>
  );
}
