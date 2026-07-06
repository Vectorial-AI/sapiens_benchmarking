import type { BaselineMethod, BaselineModel } from "./baselines";
import type {
  BaselineResult,
  EngineResult,
  ReviewSentiment,
} from "./types";

const SESSION_KEY = "sapiens-benchmark-wizard";
const RESTORE_FLAG_KEY = "sapiens-benchmark-wizard-restore";

export type WizardSession = {
  step: number;
  tribeId: string;
  userId: string;
  reviewKey: string | null;
  customProductDesc: string;
  baselineMethod: BaselineMethod;
  useCustomPopulationDef: boolean;
  customPopulationDef: string;
  groundTruth: string | null;
  groundTruthThemes: string[];
  groundTruthSentiment: ReviewSentiment | null;
  sapiens: EngineResult | null;
  baselines: BaselineResult[];
  gatewayConnected: boolean;
};

export function saveWizardSession(state: WizardSession): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    sessionStorage.setItem(RESTORE_FLAG_KEY, "1");
  } catch {
    /* quota / private mode */
  }
}

export function loadWizardSession(): WizardSession | null {
  if (typeof window === "undefined") return null;
  if (sessionStorage.getItem(RESTORE_FLAG_KEY) !== "1") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WizardSession;
  } catch {
    return null;
  }
}

export function clearWizardRestoreFlag(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(RESTORE_FLAG_KEY);
}

export function markWizardRestorePending(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(RESTORE_FLAG_KEY, "1");
}
