import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createSmartAccountBridge,
  toSmartCall,
  type RpcRequestArgs,
  type SmartTransactionSender,
} from "./bridge.ts";

const ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const HASH = "0xhash" as const;
const SIG = "0xsig" as const;

interface SenderLog {
  sends: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }[];
  messages: unknown[];
  typed: unknown[];
}

function makeFakeSender(): { sender: SmartTransactionSender; log: SenderLog } {
  const log: SenderLog = { sends: [], messages: [], typed: [] };
  const sender: SmartTransactionSender = {
    sendTransaction: (tx) => {
      log.sends.push(tx);
      return Promise.resolve(HASH);
    },
    signMessage: (args) => {
      log.messages.push(args.message);
      return Promise.resolve(SIG);
    },
    signTypedData: (td) => {
      log.typed.push(td);
      return Promise.resolve(SIG);
    },
  };
  return { sender, log };
}

function makeBridge(publicResult: unknown = "public-result") {
  const { sender, log } = makeFakeSender();
  const publicCalls: RpcRequestArgs[] = [];
  const bridge = createSmartAccountBridge({
    smart: sender,
    address: ADDRESS,
    chainId: 8453,
    publicRequest: (args) => {
      publicCalls.push(args);
      return Promise.resolve(publicResult);
    },
  });
  return { bridge, log, publicCalls };
}

test("toSmartCall: calldata, to, and value pass through verbatim", () => {
  const call = toSmartCall({
    from: ADDRESS,
    to: "0x1111111111111111111111111111111111111111",
    data: "0xdeadbeef",
    value: "0xde0b6b3a7640000", // 1 ether
    gas: "0x5208", // must be DROPPED — fees are the bundler's job
    gasPrice: "0x1",
    nonce: "0x0",
  });
  assert.deepEqual(call, {
    to: "0x1111111111111111111111111111111111111111",
    data: "0xdeadbeef",
    value: 1000000000000000000n,
  });
});

test("toSmartCall: missing optional fields are omitted; `input` aliases `data`", () => {
  assert.deepEqual(toSmartCall({ to: ADDRESS }), { to: ADDRESS });
  assert.deepEqual(toSmartCall({ to: ADDRESS, input: "0xabcd" }), { to: ADDRESS, data: "0xabcd" });
  assert.deepEqual(toSmartCall({ to: ADDRESS, value: 5n }), { to: ADDRESS, value: 5n });
});

test("toSmartCall: refuses deployments and malformed requests", () => {
  assert.throws(() => toSmartCall({ data: "0x600060" }), /without `to`/);
  assert.throws(() => toSmartCall(null), /malformed/);
  assert.throws(() => toSmartCall("0x00"), /malformed/);
});

test("bridge: eth_sendTransaction routes to the smart client and returns its hash", async () => {
  const { bridge, log, publicCalls } = makeBridge();
  const result = await bridge.request({
    method: "eth_sendTransaction",
    params: [{ from: ADDRESS, to: ADDRESS, data: "0x1234", value: "0x0a" }],
  });
  assert.equal(result, HASH);
  assert.deepEqual(log.sends, [{ to: ADDRESS, data: "0x1234", value: 10n }]);
  assert.equal(publicCalls.length, 0);
});

test("bridge: accounts and chainId answered locally", async () => {
  const { bridge, publicCalls } = makeBridge();
  assert.deepEqual(await bridge.request({ method: "eth_accounts" }), [ADDRESS]);
  assert.deepEqual(await bridge.request({ method: "eth_requestAccounts" }), [ADDRESS]);
  assert.equal(await bridge.request({ method: "eth_chainId" }), "0x2105"); // 8453
  assert.equal(publicCalls.length, 0);
});

test("bridge: personal_sign routes hex payloads as raw messages", async () => {
  const { bridge, log } = makeBridge();
  assert.equal(await bridge.request({ method: "personal_sign", params: ["0xcafe", ADDRESS] }), SIG);
  assert.deepEqual(log.messages, [{ raw: "0xcafe" }]);
});

test("bridge: eth_signTypedData_v4 parses the JSON payload", async () => {
  const { bridge, log } = makeBridge();
  const typedData = { domain: { name: "Mantua" }, primaryType: "X", types: {}, message: {} };
  const result = await bridge.request({
    method: "eth_signTypedData_v4",
    params: [ADDRESS, JSON.stringify(typedData)],
  });
  assert.equal(result, SIG);
  assert.deepEqual(log.typed, [typedData]);
});

test("bridge: reads fall through to the public transport untouched", async () => {
  const { bridge, log, publicCalls } = makeBridge("0x1b4");
  const args = { method: "eth_getTransactionReceipt", params: ["0xabc"] };
  assert.equal(await bridge.request(args), "0x1b4");
  assert.deepEqual(publicCalls, [args]);
  assert.equal(log.sends.length, 0);
});
