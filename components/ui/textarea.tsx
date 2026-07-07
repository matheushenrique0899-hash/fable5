import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/40",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
