type PageResult<T> = { data: T[] | null; error: { code?: string; message: string } | null; count: number | null };

/** Largest page number accepted from a URL (keeps row offsets in a safe range). */
const MAX_PAGE = 100_000;

export function parsePage(value: unknown): number {
  const page = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(page) && page > 0 && page <= MAX_PAGE ? page : 1;
}

/**
 * One page of a counted query. A page past the end makes the API answer
 * "range not satisfiable" (PGRST103), for example after rows were removed or
 * from a hand-edited URL, so fall back to the last page that exists.
 * `query` must build a fresh request with `{ count: "exact" }` on each call.
 */
export async function fetchPage<T>(
  query: (from: number, to: number) => PromiseLike<PageResult<T>>,
  page: number,
  size: number,
): Promise<{ rows: T[]; total: number; page: number }> {
  const range = (p: number) => query((p - 1) * size, p * size - 1);
  let current = page;
  let result = await range(current);

  if (result.error?.code === "PGRST103") {
    const { count, error } = await query(0, 0);
    if (error) throw new Error(error.message);
    current = Math.max(1, Math.ceil((count ?? 0) / size));
    result = await range(current);
  }
  if (result.error) throw new Error(result.error.message);
  return { rows: result.data ?? [], total: result.count ?? 0, page: current };
}
