import { ChevronLeft } from "lucide-react";
import { Button } from "./button";

export interface CursorPaginationProps {
  hasMore: boolean;
  loading?: boolean;
  onLoadMore: () => void;
  loadedCount: number;
  className?: string;
}

/**
 * Every list endpoint in this product is cursor-paginated (`packages/contracts`'s
 * `cursorPageSchema`), never page-numbered — there is no total-count/page-N
 * concept server-side to build numbered pagination against. "تحميل المزيد"
 * (load more) is the only pattern that matches the actual API shape.
 */
export function CursorPagination({ hasMore, loading, onLoadMore, loadedCount, className }: CursorPaginationProps) {
  if (!hasMore && loadedCount === 0) return null;
  return (
    <div className={className ?? "flex items-center justify-center py-4"}>
      {hasMore ? (
        <Button variant="outline" size="sm" onClick={onLoadMore} loading={loading}>
          تحميل المزيد
          {/* This app is RTL-only in V1 (§6) — "forward" in an RTL reading
              direction points left, so ChevronLeft (‹) alone is correct
              with no LTR variant to swap. */}
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
      ) : (
        <p className="text-xs text-text-tertiary">تم عرض كل النتائج ({loadedCount})</p>
      )}
    </div>
  );
}
