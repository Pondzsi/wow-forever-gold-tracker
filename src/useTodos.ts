import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { buildTodos, type Todo } from './todo';
import { useItems, usePriceMap, useSettings } from './ui';

export function useTodos(): Todo[] {
  const items = useItems();
  const prices = usePriceMap();
  const settings = useSettings();
  const data = useLiveQuery(async () => {
    const [inventory, recipes, sessions, goals, lastSync, folder] = await Promise.all([
      db.inventory.toArray(),
      db.recipes.toArray(),
      db.sessions.toArray(),
      db.goals.count(),
      db.meta.get('lastSync'),
      db.meta.get('wowFolder'),
    ]);
    return { inventory, recipes, sessions, goals, lastSync: (lastSync?.value as number) ?? null, folderConnected: !!folder };
  }, []);
  if (!data) return [];
  return buildTodos({ ...data, items: items.byId, prices, settings });
}
