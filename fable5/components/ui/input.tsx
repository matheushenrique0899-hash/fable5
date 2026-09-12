import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
