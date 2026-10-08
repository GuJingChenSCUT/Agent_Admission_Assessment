import crypto from "node:crypto";
import { failure } from "./net.js";

export function quantity(value) {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value)
  )
    throw failure("RPC_QUANTITY_INVALID");
  return BigInt(value);
}
function header(value) {
  if (
    !value ||
    typeof value.hash !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(value.hash)
  )
    throw failure("RPC_BLOCK_INVALID");
  quantity(value.number);
  const seconds = quantity(value.timestamp);
  if (seconds > BigInt(Math.floor(Date.now() / 1000) + 120))
    throw failure("RPC_BLOCK_TIME_INVALID");
  return { hash: value.hash, number: value.number, timestamp: value.timestamp };
}

// All URLs come from the server configuration. The browser/model supplies no URLs.
export function createRpcClient({ config, request, record, signal }) {
  let calls = 0;
  const counts = { reference: 0, probe: 0, provider: 0 };
  const limits = { reference: 12, probe: 4, provider: 2 };
  const call = async (target, method, params, kind) => {
    if (signal.aborted) throw failure("REQUEST_ABORTED");
    if (
      ![
        "eth_chainId",
        "eth_getBlockByNumber",
        "eth_getBlockByHash",
        "eth_getBalance",
      ].includes(method) ||
      !(kind in limits)
    )
      throw failure("RPC_METHOD_DENIED");
    if (calls >= config.maxRpcRequests || counts[kind] >= limits[kind])
      throw failure("RPC_BUDGET_EXHAUSTED");
    calls++;
    counts[kind]++;
    const body = {
      jsonrpc: "2.0",
      id: crypto.randomInt(1, 2 ** 31),
      method,
      params,
    };
    const meta = {
      sourceId: target.sourceId || target.id,
      operatorId: target.operatorId,
      kind,
      request: body,
      requestedAt: new Date().toISOString(),
    };
    try {
      const response = await request(target.url || target.origin, {
        body,
        signal,
        timeoutMs: config.timeoutMs,
        maxBytes: config.maxResponseBytes,
      });
      const data = response.body;
      if (
        !data ||
        Array.isArray(data) ||
        data.jsonrpc !== "2.0" ||
        data.id !== body.id ||
        Object.hasOwn(data, "error") === Object.hasOwn(data, "result")
      )
        throw failure("RPC_ENVELOPE_INVALID");
      // Upstream error text may echo credentials. Retain only a normalized error code.
      if (Object.hasOwn(data, "error"))
        throw failure(
          data.error?.code === -32005 || data.error?.code === 429
            ? "RATE_LIMITED"
            : "RPC_REMOTE_ERROR",
        );
      const raw = response.rawBytes || Buffer.from(JSON.stringify(data));
      const evidenceRef = record({
        ...meta,
        receivedAt: new Date().toISOString(),
        responseBase64: raw.toString("base64"),
      });
      return { result: data.result, rawBytes: raw, evidenceRef };
    } catch (e) {
      record({
        ...meta,
        receivedAt: new Date().toISOString(),
        error: e.code || "RPC_UNAVAILABLE",
      });
      throw e;
    }
  };
  return { call, counts };
}

export async function resolveSnapshot(
  address,
  references,
  rpc,
  maxHeadSkew = 32,
) {
  const heads = [];
  for (const ref of references) {
    if (
      quantity((await rpc.call(ref, "eth_chainId", [], "reference")).result) !==
      1n
    )
      throw failure("REFERENCE_WRONG_CHAIN");
    heads.push(
      header(
        (
          await rpc.call(
            ref,
            "eth_getBlockByNumber",
            ["finalized", false],
            "reference",
          )
        ).result,
      ),
    );
  }
  // Providers can finalize at different instants. Pin the lower of their finalized heights.
  const skew = quantity(heads[0].number) - quantity(heads[1].number);
  if ((skew < 0n ? -skew : skew) > BigInt(maxHeadSkew))
    throw failure("REFERENCE_HEAD_SKEW");
  const height =
    quantity(heads[0].number) < quantity(heads[1].number)
      ? heads[0].number
      : heads[1].number;
  const blocks = [];
  for (const ref of references) {
    const block = header(
      (
        await rpc.call(
          ref,
          "eth_getBlockByNumber",
          [height, false],
          "reference",
        )
      ).result,
    );
    if (block.number !== height) throw failure("REFERENCE_HEIGHT_MISMATCH");
    blocks.push(block);
  }
  if (
    blocks[0].hash !== blocks[1].hash ||
    blocks[0].timestamp !== blocks[1].timestamp ||
    heads.some((h) => h.number === height && h.hash !== blocks[0].hash)
  )
    throw failure("REFERENCE_HASH_CONFLICT");
  const block = blocks[0],
    observations = [];
  for (const ref of references) {
    const value = await rpc.call(
      ref,
      "eth_getBalance",
      [address, { blockHash: block.hash, requireCanonical: true }],
      "reference",
    );
    observations.push({
      sourceId: ref.sourceId,
      operatorId: ref.operatorId,
      observedBlockHash: block.hash,
      fetchedAt: new Date().toISOString(),
      balanceWei: quantity(value.result).toString(),
    });
  }
  if (observations[0].balanceWei !== observations[1].balanceWei)
    throw failure("REFERENCE_BALANCE_CONFLICT");
  return {
    sourceChainId: "1",
    blockNumber: quantity(height).toString(),
    blockHash: block.hash,
    blockTimestamp: new Date(
      Number(quantity(block.timestamp)) * 1000,
    ).toISOString(),
    capturedAt: new Date().toISOString(),
    tag: "finalized",
    assurance: "RPC_CROSS_CHECKED",
    references: observations,
  };
}

export async function probeService(service, snapshot, rpc) {
  const chain = await rpc.call(service, "eth_chainId", [], "probe");
  if (quantity(chain.result) !== 1n) throw failure("PROVIDER_WRONG_CHAIN");
  const result = await rpc.call(
    service,
    "eth_getBlockByHash",
    [snapshot.blockHash, false],
    "probe",
  );
  const block = header(result.result);
  if (
    block.hash !== snapshot.blockHash ||
    quantity(block.number).toString() !== snapshot.blockNumber ||
    new Date(Number(quantity(block.timestamp)) * 1000).toISOString() !==
      snapshot.blockTimestamp
  )
    throw failure("PROVIDER_BLOCK_MISMATCH");
  return [chain.evidenceRef, result.evidenceRef];
}

export async function readBalance(service, address, snapshot, rpc) {
  const response = await rpc.call(
    service,
    "eth_getBalance",
    [address, { blockHash: snapshot.blockHash, requireCanonical: true }],
    "provider",
  );
  return {
    balanceWei: quantity(response.result).toString(),
    rawBytes: response.rawBytes,
    observation: {
      kind: "REQUEST_BOUND",
      sourceChainId: "1",
      asset: "ETH",
      blockHash: snapshot.blockHash,
      address,
      method: "eth_getBalance",
    },
  };
}
