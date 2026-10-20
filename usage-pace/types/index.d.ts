/** Une fenêtre de limite telle que Claude Code la rapporte. */
export type UsageLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** Les grandes familles de ce qui occupe le contexte. */
export type CtxPart = 'conversation' | 'système' | 'MCP' | 'instructions' | 'skills'

/** Dernière mesure des limites et du contexte. */
export type UsageSnapshot = {
  limits: UsageLimit[]
  ctx?: number
  ctxTokens?: number
  ctxWindow?: number
  usd?: number
  /** ce qui occupe le contexte, regroupé par famille, du plus gros au plus petit */
  ctxParts?: { key: CtxPart; tokens: number }[]
  /** le serveur MCP qui pèse le plus */
  mcpTop?: { name: string; tokens: number }
  /** seuil de compaction automatique, en tokens */
  compactAt?: number
  /** taille du contexte aux derniers échanges, pour estimer sa croissance */
  ctxSeries?: number[]
}

/** Ce qui s'est passé dans cette session Claude Code. */
export type SessionStats = {
  startedAt: number
  turns: number
  tools: number
  files: string[]
  /** tokens d'entrée lus depuis le cache, et tokens d'entrée au total */
  cacheRead: number
  inputTotal: number
  /** temps passé (ms) : Claude qui réfléchit et écrit, outils qui tournent, attente de ton accord */
  time: { claude: number; tools: number; you: number }
  /** temps cumulé par outil ("npm test", "Read"…) */
  slow: Record<string, { ms: number; n: number }>
  /** % des limites au premier relevé de la session, pour savoir ce qu'elle a pris */
  base: Record<string, { p: number; resetsAt?: string }>
}

/** Un appel d'outil de l'échange en cours : début, fin, et s'il a attendu ton accord. */
export type ToolSpan = { start: number; end: number; asked: boolean }

/** L'échange en cours, gardé dans l'état pour survivre à un rechargement du mod. */
export type PendingTurn = { spans: ToolSpan[]; asked: string[] }

/** Le garde-fou de la session : relance prévue, appels depuis le dernier rappel, intervention en cours. */
export type GuardState = {
  /** relance automatique prévue à (ms epoch) */
  paused?: number
  /** appels d'outils depuis le dernier rappel */
  calls: number
  /** le garde-fou a rappelé ou refusé pendant l'échange en cours */
  intervened: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'usage-pace': {
      usage: UsageSnapshot | null
      stats: SessionStats | null
      pending: PendingTurn
      tick: number
      guard: GuardState
    }
  }
}
