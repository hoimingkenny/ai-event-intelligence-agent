import { groupEntitiesByType, type GroupableEntity } from '../lib/group-entities';

type Props = {
  entities: GroupableEntity[];
};

export function WorkspaceEntityList({ entities }: Props) {
  const grouped = groupEntitiesByType(entities);
  if (grouped.length === 0) {
    return <p className="meta">No entities detected.</p>;
  }

  return (
    <ul className="workspace-entity-list">
      {grouped.map((row) => (
        <li key={row.entityType} className="workspace-entity-item">
          <span className="workspace-entity-type">{row.entityType}</span>
          <span className="workspace-entity-value">{row.values.join(', ')}</span>
        </li>
      ))}
    </ul>
  );
}
