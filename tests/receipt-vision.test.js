const assert = require("assert");
const vision = require("../receipt-vision");

const jpeg = "data:image/jpeg;base64,aGVsbG8=";
assert(vision.validReceiptImages([{ dataUrl: jpeg }]), "valid JPEG data URL rejected");
assert(!vision.validReceiptImages([{ dataUrl: "https://example.test/receipt.jpg" }]), "remote image URL accepted");
assert(!vision.validReceiptImages(Array(4).fill({ dataUrl: jpeg })), "too many receipt images accepted");
assert.throws(() => vision.normalizeReceipt({ total: 0, items: [] }), /Gesamtsumme/);
const normalized = vision.normalizeReceipt({ merchant: "ALDI", date: "2026-09-29", total: 48.82, items: [
  { name: "Milch 1 l", line_total: 2.85, count: 3, unit_price: 0.95, is_deposit: false, is_adjustment: false },
  { name: "Pfand", line_total: 1.5, count: 6, unit_price: 0.25, is_deposit: true, is_adjustment: false }
] });
assert.strictEqual(normalized.total, 48.82, "printed total must be independent of OCR item sum");
assert.strictEqual(normalized.items[0].lineTotal, 2.85);
assert.strictEqual(normalized.items[0].count, 3);
assert.strictEqual(normalized.items[1].isDeposit, true);
assert.strictEqual(vision.normalizeReceipt({ merchant:"EDEKA", date:"2026-02-31", total:1, items:[] }).date, "", "impossible vision receipt dates must be rejected");
assert.strictEqual(vision.normalizeReceipt({ merchant:"EDEKA", date:"2026-09-29", total:1, items:[] }).date, "2026-09-29", "valid vision receipt dates should be retained");
const arithmeticGuard=vision.normalizeReceipt({merchant:"PENNY",date:"",total:8.46,items:[{name:"Red Bull",line_total:2.89,count:2,unit_price:2.89,is_deposit:false,is_adjustment:false}]});
assert.strictEqual(arithmeticGuard.items.length,0,"contradictory vision multipack arithmetic should be rejected instead of contaminating receipt analytics");
assert.strictEqual(vision.normalizeReceipt({merchant:"EDEKA",date:"",total:5,items:[{name:"Coupon",line_total:1,count:1,unit_price:1,is_deposit:false,is_adjustment:true}]}).items.length,0,"positive vision adjustments must be rejected");
assert.strictEqual(vision.normalizeReceipt({merchant:"EDEKA",date:"",total:5,items:[{name:"Pfand",line_total:-0.25,count:1,unit_price:0.25,is_deposit:true,is_adjustment:false}]}).items.length,0,"negative vision deposit charges must be rejected");
const visionSource = require("fs").readFileSync(require.resolve("../receipt-vision"), "utf8");
assert(visionSource.includes("ENDSUMME/RECHNUNGSBETRAG/BETRAG FÄLLIG"), "vision prompt should recognize expanded authoritative total labels");
assert(visionSource.includes("Rückgeld oder Kartenbeträge niemals mit der Gesamtsumme"), "vision prompt should keep payment/change amounts separate from printed total");

(async () => {
  let request;
  const parsed = await vision.readReceiptWithVision([{ dataUrl: jpeg }], {
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ merchant: "ALDI", date: "", total: 5.25, items: [] }) }) };
    }
  });
  assert.strictEqual(request.url, "https://api.openai.com/v1/responses");
  assert.strictEqual(request.options.headers.Authorization, "Bearer test-key");
  assert.strictEqual(request.body.store, false, "receipt vision request should not be stored as a response");
  assert.strictEqual(request.body.input[0].content[1].type, "input_image");
  assert.strictEqual(request.body.text.format.type, "json_schema");
  assert.strictEqual(parsed.total, 5.25);
  await assert.rejects(() => vision.readReceiptWithVision([{ dataUrl: jpeg }], { apiKey: "", fetchImpl: async () => { throw new Error("must not call API"); } }), /nicht eingerichtet/);
  console.log("receipt vision tests OK");
})().catch(error => { console.error(error); process.exitCode = 1; });
