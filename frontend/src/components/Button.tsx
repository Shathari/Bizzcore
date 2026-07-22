import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-maroon text-white hover:bg-maroon-dark",
  secondary: "border border-neutral-300 text-neutral-700 hover:bg-neutral-50",
  danger: "bg-red-50 text-red-700 hover:bg-red-100",
  ghost: "text-neutral-600 hover:text-maroon",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:opacity-60 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
