export type Phase = 'PRE_MIGRATION' | 'MIGRATED';
export type NarrativeState = 'FLAT' | 'BUILDING' | 'ACCELERATING';
export type AlertLevel = 'NONE' | 'WATCHLIST' | 'SIGNAL' | 'A' | 'A_PLUS';
export type AlertKind = 'EARLY' | 'POST_MIGRATION' | 'RE_ENTRY';

/** Événement de création émis par une source d'ingestion. */
export interface TokenCreation {
  ts: number;
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  /** Métadonnées off-chain (pump.fun), optionnel. */
  uri?: string;
  /** Compte de bonding curve pump.fun, optionnel. */
  bondingCurve?: string;
}

/** Trade normalisé. Seule source de vérité pour toutes les métriques. */
export interface Trade {
  ts: number;
  mint: string;
  wallet: string;
  isBuy: boolean;
  solAmount: number;
  tokenAmount: number;
  usdAmount: number;
  virtualSolReserves?: number;
  virtualTokenReserves?: number;
}

/**
 * Métriques calculées sur FENÊTRES GLISSANTES horodatées.
 * Pas de moyenne cumulée depuis la création : elle masquerait un retournement.
 */
export interface VolumeMetrics {
  volume15s?: number;
  volume30s?: number;
  volume1m?: number;
  volume3m?: number;
  volume5m?: number;
  buyVolume?: number;
  sellVolume?: number;
  buySellRatio?: number;
  /** volume de la dernière minute / minute précédente. > 1 = accélération. */
  volumeAcceleration?: number;
  uniqueBuyers?: number;
  uniqueSellers?: number;
  uniqueBuyers1m?: number;
  averageBuySize?: number;
  medianBuySize?: number;
  largestBuy?: number;
  tradeCount1m?: number;
}

export interface ScorePart {
  key: string;
  label: string;
  value: number;
  max: number;
}

export interface ScoreBreakdown {
  total: number;
  parts: ScorePart[];
}

export interface SmartWalletStats {
  entered: number;
  holding: number;
  tracked: number;
}

export interface TokenState {
  mint: string;
  symbol: string;
  name: string;
  creator: string;

  createdAt: number;
  firstSeenAt: number;
  lastTradeAt: number;
  migratedAt?: number;
  athAt?: number;

  phase: Phase;

  marketCap?: number;
  athMarketCap?: number;
  migrationMarketCap?: number;
  liquidityUsd?: number;

  /** 0..1 */
  bondingCurveProgress?: number;
  bondingCurveDelta1m?: number;

  holders?: number;
  /** Variations relatives (0.18 = +18%). */
  holdersDelta?: number;
  uniqueBuyersDelta?: number;

  volume: VolumeMetrics;
  smartWallets?: SmartWalletStats;
  narrative?: NarrativeState;
  devSoldPct?: number;

  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  reentryScore?: number;
  reentryBreakdown?: ScoreBreakdown;

  // Anti-spam
  lastAlertLevel: AlertLevel;
  lastAlertScore: number;
  enrichedAt?: number;
  firstMarketCap?: number;
  alertPrice?: number;
  alertMcap?: number;
  alertedAt?: number;
  lastProfitLevel?: number;
  lastAlertTimestamp: number;
  lastAlertKind?: AlertKind;
  alertCount: number;

  watched: boolean;
  ignoredUntil?: number;
}

export interface AlertEvent {
  kind: AlertKind;
  level: AlertLevel;
  token: TokenState;
  score: number;
  breakdown: ScoreBreakdown;
  reason: string;
  ts: number;
}

export interface SourceStatus {
  name: string;
  connected: boolean;
  detail?: string;
}

/** Contrat commun HeliusScanner / MockScanner. */
export interface IngestionSource {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
}

export interface ProfitUpdate {
  mint: string;
  symbol: string;
  status: 'milestone' | 'stopped';
  multiplier?: number;
  elapsed?: number;
  mcapStart?: number;
  mcapCurrent?: number;
  reason?: string;
}
