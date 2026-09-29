const MAX_IMAGES = 3;
const MAX_DATA_URL_LENGTH = 2_500_000;

const receiptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    merchant: { type: "string" },
    date: { type: "string" },
    total: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          line_total: { type: "number" },
          count: { type: "number" },
          unit_price: { type: "number" },
          is_deposit: { type: "boolean" },
          is_adjustment: { type: "boolean" }
        },
        required: ["name", "line_total", "count", "unit_price", "is_deposit", "is_adjustment"]
      }
    }
  },
  required: ["merchant", "date", "total", "items"]
};

function validReceiptImages(images) {
  return Array.isArray(images) && images.length > 0 && images.length <= MAX_IMAGES && images.every(image =>
    image && typeof image.dataUrl === "string" && image.dataUrl.length <= MAX_DATA_URL_LENGTH &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/i.test(image.dataUrl)
  );
}

function responseText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function normalizeReceipt(result) {
  const total = Number(result.total);
  const items = (Array.isArray(result.items) ? result.items : []).slice(0, 250).flatMap(item => {
    const name = String(item.name || "").trim().slice(0, 120);
    const lineTotal = Number(item.line_total);
    const count = Number(item.count);
    const unitPrice = Number(item.unit_price);
    if (!name || !Number.isFinite(lineTotal) || lineTotal === 0 || Math.abs(lineTotal) > 100000) return [];
    if (!Number.isFinite(count) || count < 1 || count > 1000 || !Number.isFinite(unitPrice) || Math.abs(unitPrice) > 100000) return [];
    return [{ name, lineTotal: Number(lineTotal.toFixed(2)), count, unitPrice: Number(unitPrice.toFixed(2)), isDeposit: !!item.is_deposit, isAdjustment: !!item.is_adjustment }];
  });
  if (!Number.isFinite(total) || total <= 0 || total > 100000) throw new Error("KI konnte die aufgedruckte Gesamtsumme nicht sicher lesen.");
  const rawDate=String(result.date||"");let date="";if(/^20\d\d-\d\d-\d\d$/.test(rawDate)){const p=rawDate.split("-").map(Number),d=new Date(Date.UTC(p[0],p[1]-1,p[2]));if(d.getUTCFullYear()===p[0]&&d.getUTCMonth()===p[1]-1&&d.getUTCDate()===p[2])date=rawDate}
  return { merchant: String(result.merchant || "").trim().slice(0, 80), date, total: Number(total.toFixed(2)), items };
}

async function readReceiptWithVision(images, { apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_RECEIPT_MODEL || "gpt-5-mini", fetchImpl = fetch } = {}) {
  if (!apiKey) throw Object.assign(new Error("KI-Nachlesung ist noch nicht eingerichtet."), { status: 503 });
  if (!validReceiptImages(images)) throw Object.assign(new Error("Bonfoto ist ungültig oder zu groß."), { status: 400 });
  const content = [{
    type: "input_text",
    text: "Lies den deutschen Einkaufsbeleg aus den Bildern. Mehrere Bilder zeigen denselben Beleg in Leserichtung von oben nach unten. Gib ausschließlich sichtbare Informationen zurück. Lies die aufgedruckte Gesamtsumme bei SUMME/GESAMTBETRAG/ZU ZAHLEN/ZAHLBETRAG/ENDBETRAG/ENDSUMME/RECHNUNGSBETRAG/BETRAG FÄLLIG unabhängig von den Einzelpositionen. Verwechsle Bar gegeben, Bezahlt, Erhalten, Rückgeld oder Kartenbeträge niemals mit der Gesamtsumme. Erfinde keine Artikel oder Preise. Erfasse jede sichtbare Waren-, Pfand-, Rabatt- und Rückgabezeile genau einmal; negative Beträge bleiben negativ. Bei Mehrfachkauf: line_total ist der Zeilenbetrag, count die Stückzahl und unit_price der Stückpreis. Datum als YYYY-MM-DD, wenn lesbar, sonst leer; Händlername nur, wenn lesbar, sonst leer."
  }, ...images.map(image => ({ type: "input_image", image_url: image.dataUrl, detail: "high" }))];
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "german_receipt", strict: true, schema: receiptSchema } }
    }),
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) {
    const error = new Error("KI-Nachlesung ist gerade fehlgeschlagen.");
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const data = await response.json();
  let parsed;
  try { parsed = JSON.parse(responseText(data)); }
  catch { throw Object.assign(new Error("KI-Antwort konnte nicht gelesen werden."), { status: 502 }); }
  return normalizeReceipt(parsed);
}

module.exports = { MAX_IMAGES, MAX_DATA_URL_LENGTH, validReceiptImages, normalizeReceipt, readReceiptWithVision };
