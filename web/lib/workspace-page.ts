export const WORKSPACE_PAGE_SIZE = 25;

export function parseWorkspacePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = Number.parseInt(value ?? '1', 10);
  if (!Number.isFinite(page) || page < 1) return 1;
  return page;
}

export function workspacePageOffset(page: number, pageSize = WORKSPACE_PAGE_SIZE): number {
  return (page - 1) * pageSize;
}

export function workspaceTotalPages(total: number, pageSize = WORKSPACE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
