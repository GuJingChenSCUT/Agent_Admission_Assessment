import { fault } from "./control.js";
import { parseIntent } from "./domain.js";
import { validateDefinition } from "./schema.js";

// Provider-neutral boundary reserved for PI. The remote protocol is not assumed.
// Only server startup can inject an adapter; browser input cannot select a URL/key.
export async function extractModelDraft({
  adapter,
  text,
  allowFallback,
  signal,
  timeoutMs = 10_000,
}) {
  if (!adapter || typeof adapter.extract !== "function")
    throw fault("PI_ADAPTER_NOT_CONFIGURED", 503);
  if (signal?.aborted) throw fault("MODEL_REQUEST_ABORTED", 408);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let timer, onAbort;
  signal?.addEventListener("abort", cancel, { once: true });
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(fault("MODEL_REQUEST_ABORTED", 408));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(fault("MODEL_TIMEOUT", 504));
      controller.abort();
    }, timeoutMs);
  });
  try {
    if (controller.signal.aborted) throw fault("MODEL_REQUEST_ABORTED", 408);
    const draft = await Promise.race([
      Promise.resolve().then(() =>
        adapter.extract(text, {
          signal: controller.signal,
          maxOutputTokens: 2048,
        }),
      ),
      timeout,
      aborted,
    ]);
    if (!validateDefinition("TaskDraft", draft).valid)
      throw fault("MODEL_DRAFT_INVALID", 502);
    // A model cannot widen the supported operation, guess an address, or enable fallback.
    const grounded = parseIntent(text, allowFallback);
    if (draft.allowFallback !== allowFallback)
      throw fault("MODEL_SCOPE_VIOLATION", 502);
    if (
      draft.intentType === "NATIVE_BALANCE" &&
      (grounded.intentType !== "NATIVE_BALANCE" ||
        draft.address?.toLowerCase() !== grounded.address ||
        draft.sourceChainId !== "1" ||
        draft.asset !== "ETH" ||
        draft.missingFields.length !== 0 ||
        draft.clarification !== null)
    )
      throw fault("MODEL_SCOPE_VIOLATION", 502);
    if (
      draft.intentType !== "NATIVE_BALANCE" &&
      (draft.address !== null ||
        draft.sourceChainId !== null ||
        draft.asset !== null ||
        !draft.clarification ||
        (draft.intentType === "UNCLEAR" && !draft.missingFields.length))
    )
      throw fault("MODEL_DRAFT_INVALID", 502);
    return structuredClone(draft);
  } catch (error) {
    // Never expose a provider's raw error: it may contain credentials or prompts.
    const codes = [
      "MODEL_DRAFT_INVALID",
      "MODEL_SCOPE_VIOLATION",
      "MODEL_TIMEOUT",
      "MODEL_REQUEST_ABORTED",
    ];
    if (codes.includes(error.message))
      throw fault(
        error.message,
        error.message === "MODEL_TIMEOUT"
          ? 504
          : error.message === "MODEL_REQUEST_ABORTED"
            ? 408
            : 502,
      );
    throw fault("MODEL_UPSTREAM_FAILED", 502);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
