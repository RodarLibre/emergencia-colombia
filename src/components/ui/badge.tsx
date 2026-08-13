import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Badge tones carry meaning, not decoration:
 *
 * - `official` marks a government source, on the fields it actually publishes.
 * - `warn` marks staleness — "nobody has reconfirmed this", never "this is false".
 * - `closed` marks a place the source says is shut.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-border bg-bg text-muted",
        official: "border-transparent bg-official-bg text-official-text font-semibold",
        warn: "border-warn-border bg-warn-bg text-warn-text",
        closed: "border-danger-border bg-danger-bg text-danger-text",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
