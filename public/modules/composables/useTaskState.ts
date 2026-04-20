import type { AppState, RuntimeModeValue, TaskStageValue } from '../types';

type TaskStateDeps = {
  state: AppState;
  runtimeMode: { HOST: RuntimeModeValue };
  taskStatus: { IDLE: AppState['status'] };
  taskStage: { IDLE: TaskStageValue; PARSE: TaskStageValue };
  modProgress: { IDLE: AppState['modProgress'] };
};

export function useTaskState({ state, runtimeMode, taskStatus, taskStage, modProgress }: TaskStateDeps) {
  function setRuntimeMode(mode: RuntimeModeValue | '' | null | undefined): void {
    state.runtimeMode = mode || runtimeMode.HOST;
  }

  function resetTaskExecutionState(taskId = '', sourceName = ''): void {
    state.id = taskId;
    state.status = taskStatus.IDLE;
    state.apkInfo = null;
    state.activeFlow = taskId ? 'upload' : '';
    state.stage = taskId ? taskStage.PARSE : taskStage.IDLE;
    state.modProgress = modProgress.IDLE;
    state.currentBrowseApkName = sourceName || '';
  }

  function resetFileWorkspaceState(): void {
    state.fileTreeLoadedTaskId = '';
    state.fileTreeData = null;
    state.fileActivePath = '';
    state.filePatchTasks = [];
    state.filePathCandidates = [];
    state.fileTreeSearch = '';
  }

  function resetIconState(): void {
    state.iconFile = null;
    state.iconPreviewUrl = '';
  }

  function replaceTaskPollTimer(timer: ReturnType<typeof setInterval> | null): void {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
    }
    state.pollTimer = timer || null;
  }

  return {
    state,
    setRuntimeMode,
    resetTaskExecutionState,
    resetFileWorkspaceState,
    resetIconState,
    replaceTaskPollTimer,
  };
}
