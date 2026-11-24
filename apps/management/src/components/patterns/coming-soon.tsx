import { Badge } from "@/components/ui/badge";

/**
 * Marks a feature that is built but not open yet. In live it reads "Not available in live yet", because such features
 * are usable in test first. Pair it with a Notice that says what does work today.
 */
export function ComingSoonBadge({ live = false }: { live?: boolean }) {
  return <Badge variant="secondary">{live ? "Not available in live yet" : "Coming soon"}</Badge>;
}
