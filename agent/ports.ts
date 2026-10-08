/** Adapter boundaries. Implementations may propose; only control/gateway authorize. */
export interface TaskDraft {
  intentType: "NATIVE_BALANCE" | "UNSUPPORTED" | "UNCLEAR";
  address: string | null;
  sourceChainId: string | null;
  asset: string | null;
  missingFields: ("address" | "address_selection" | "scope")[];
  clarification: string | null;
  allowFallback: boolean;
}
export interface Orchestrator {
  extract(input: string, signal: AbortSignal): Promise<TaskDraft>;
  choose(
    eligibleIds: readonly string[],
    remainingCalls: number,
    signal: AbortSignal,
  ): Promise<string>;
  explain(
    verifiedFacts: Readonly<Record<string, unknown>>,
    evidenceIds: readonly string[],
  ): Promise<string>;
}
export interface ModelToolContext {
  readonly taskId: string;
  readonly authenticatedOwner: string;
}
export interface ModelTools {
  task_get_scope(context: ModelToolContext): Promise<unknown>;
  service_list_eligible(context: ModelToolContext): Promise<unknown>;
  task_propose_service(
    context: ModelToolContext,
    serviceId: string,
    evidenceIds: string[],
  ): Promise<unknown>;
  task_get_verified_result(context: ModelToolContext): Promise<unknown>;
  evidence_get_summary(context: ModelToolContext): Promise<unknown>;
}
export interface RestrictedRpcTransport {
  call(
    sourceId: string,
    method: "eth_chainId" | "eth_getBlockByNumber" | "eth_getBlockByHash" | "eth_getBalance",
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<{ result: unknown; rawBytes: Uint8Array }>;
}
export interface EvidenceSigner {
  signApprovedReport(
    reportHash: string,
    publicationId: string,
  ): Promise<{ signature: string; signer: string }>;
}

/** PI integration seam. No provider wire protocol or tool permission is assumed. */
export interface PiDraftAdapter {
  extract(
    input: string,
    options: { signal: AbortSignal; maxOutputTokens: 2048 },
  ): Promise<TaskDraft>;
}
