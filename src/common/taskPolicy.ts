import type { Task } from '../types';

export function isTaskUsingLibraryItem(
  task: Pick<Task, 'status' | 'libraryItemId' | 'standardPackageSnapshot'>,
  itemId: string,
): boolean {
  if (task.status === 'success' || task.status === 'failed') return false;
  return task.libraryItemId === itemId || task.standardPackageSnapshot?.libraryItemId === itemId;
}
