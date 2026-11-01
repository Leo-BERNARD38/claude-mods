/** Une fenêtre de limite telle que Claude Code la rapporte. */
export type UsageLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** Le garde-fou de la session : relance prévue, appels depuis le dernier rappel, arrêt en cours. */
export type GuardState = {
  /** relance automatique prévue à (ms epoch) */
  paused?: number
  /** appels d'outils depuis le dernier rappel */
  calls: number
  /** un outil a été refusé pendant l'échange en cours */
  stopped: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'usage-pace-guard': {
      limits: UsageLimit[]
      /** qui mène la conversation principale : un agent, ou toi */
      mode: 'agent' | 'you'
      guard: GuardState
    }
  }
}
