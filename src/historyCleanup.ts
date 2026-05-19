import fs from 'fs';
import path from 'path';
import { WORK_DIR_ROOT } from './config';
import { deleteArtifact } from './artifactService';
import { listTasks, replaceTasks } from './taskStore';
import type { Task } from './types';
import { debugLog } from './logger';

const HISTORY_LIMIT_PER_USER = 3;
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function taskTime(task: Task): number {
  const value = Date.parse(task.updatedAt || task.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function historyUserKey(task: Task): string {
  return String(task.userId || 'anonymous').trim() || 'anonymous';
}

function isGeneratedHistoryTask(task: Task): boolean {
  return Boolean(task.outputArtifactId);
}

function removeWorkDir(task: Task): void {
  if (!task.workDir) return;
  const root = path.resolve(WORK_DIR_ROOT);
  const target = path.resolve(task.workDir);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    return;
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // ignore workdir cleanup errors
  }
}

export function cleanupGeneratedHistory(): void {
  const now = Date.now();
  const tasks = listTasks();
  const deleteIds = new Set<string>();
  const byUser = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!isGeneratedHistoryTask(task)) continue;
    if (now - taskTime(task) > HISTORY_TTL_MS) {
      deleteIds.add(task.id);
      continue;
    }
    const userKey = historyUserKey(task);
    const userTasks = byUser.get(userKey) || [];
    userTasks.push(task);
    byUser.set(userKey, userTasks);
  }

  for (const userTasks of byUser.values()) {
    userTasks
      .sort((left, right) => taskTime(right) - taskTime(left))
      .slice(HISTORY_LIMIT_PER_USER)
      .forEach(task => deleteIds.add(task.id));
  }

  if (!deleteIds.size) return;

  let artifactCount = 0;
  let workDirCount = 0;
  const keptTasks = tasks.filter((task) => {
    if (!deleteIds.has(task.id)) return true;
    if (task.outputArtifactId && deleteArtifact(task.outputArtifactId)) {
      artifactCount += 1;
    }
    if (task.workDir) {
      removeWorkDir(task);
      workDirCount += 1;
    }
    return false;
  });
  replaceTasks(keptTasks);
  debugLog('[APK-REBUILDER] generated history cleanup complete', {
    tasksDeleted: deleteIds.size,
    artifactsDeleted: artifactCount,
    workDirsDeleted: workDirCount,
    limitPerUser: HISTORY_LIMIT_PER_USER,
    ttlDays: Math.round(HISTORY_TTL_MS / 86400000),
  });
}
