import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhook } from "@/lib/providers/stripe";
import { fillVariables, mapStatus, verifySignature } from "@/lib/providers/twilio";
import { mapInvoice } from "@/lib/providers/moloni";
import { decryptJson, encryptJson } from "@/lib/crypto";

describe("stripe webhook signature", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
  const t = 1_800_000_000;
  const sig = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  it("accepts a valid signature", async () => {
    const e = await verifyWebhook(payload, `t=${t},v1=${sig}`, secret, 300, t * 1000);
    expect(e.id).toBe("evt_1");
  });
  it("rejects tampering, wrong secret and old timestamps", async () => {
    await expect(verifyWebhook(payload + " ", `t=${t},v1=${sig}`, secret, 300, t * 1000)).rejects.toThrow();
    await expect(verifyWebhook(payload, `t=${t},v1=${sig}`, "other", 300, t * 1000)).rejects.toThrow();
    await expect(verifyWebhook(payload, `t=${t},v1=${sig}`, secret, 300, (t + 1000) * 1000)).rejects.toThrow("too old");
    await expect(verifyWebhook(payload, null, secret)).rejects.toThrow();
  });
});

describe("twilio", () => {
  it("validates X-Twilio-Signature like Twilio's docs", async () => {
    const url = "https://app.example/api/webhooks/twilio";
    const params = { MessageSid: "SM1", MessageStatus: "delivered" };
    // url + each key+value, keys sorted alphabetically (MessageSid < MessageStatus)
    const expected = createHmac("sha1", "tok").update(url + "MessageSidSM1" + "MessageStatusdelivered").digest("base64");
    expect(await verifySignature(url, params, expected, "tok")).toBe(true);
    expect(await verifySignature(url, { ...params, MessageStatus: "read" }, expected, "tok")).toBe(false);
    expect(await verifySignature(url, params, null, "tok")).toBe(false);
  });
  it("maps statuses and fills template variables", () => {
    expect(mapStatus("undelivered")).toBe("failed");
    expect(mapStatus("queued")).toBeNull();
    expect(fillVariables('{"1":"{due}","2":"{invoice}"}', ["Rui", "FT 1", "10 €", "01/10/2026", "x", "S"])).toBe('{"1":"01/10/2026","2":"FT 1"}');
  });
});

describe("moloni mapping", () => {
  it("open amount = total − reconciled; drafts skipped", () => {
    expect(mapInvoice({ document_id: 7, customer_id: 3, number: 12, document_set_name: "FT A", net_value: "100.50", reconciled_value: "40", expiration_date: "2026-10-01 00:00:00", status: 1 }))
      .toMatchObject({ externalId: "7", customerExternalId: "3", number: "FT A 12", open: 60.5, dueDate: "2026-10-01" });
    expect(mapInvoice({ document_id: 8, customer_id: 3, number: 1, status: 0 })).toBeNull();
  });
});

describe("secrets encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  it("round-trips and detects tampering", async () => {
    const c = await encryptJson({ access: "a", refresh: "r" }, key);
    expect(await decryptJson(c, key)).toEqual({ access: "a", refresh: "r" });
    const broken = c.slice(0, -4) + (c.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(decryptJson(broken, key)).rejects.toThrow();
  });
});
