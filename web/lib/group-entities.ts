export type GroupableEntity = {
  entityType: string;
  entityValue: string;
  confidence?: number | null;
  role?: string | null;
};

export type GroupedEntityRow = {
  entityType: string;
  values: string[];
};

/** Group extracted entities by type, preserving first-seen type order. */
export function groupEntitiesByType(entities: GroupableEntity[]): GroupedEntityRow[] {
  const order: string[] = [];
  const byType = new Map<string, string[]>();

  for (const entity of entities) {
    if (!byType.has(entity.entityType)) {
      order.push(entity.entityType);
      byType.set(entity.entityType, []);
    }
    let label = entity.entityValue;
    if (entity.role) label += ` (${entity.role})`;
    if (entity.confidence != null && !Number.isNaN(entity.confidence)) {
      label += ` · ${Math.round(entity.confidence * 100)}%`;
    }
    byType.get(entity.entityType)!.push(label);
  }

  return order.map((entityType) => ({
    entityType,
    values: byType.get(entityType) ?? [],
  }));
}
