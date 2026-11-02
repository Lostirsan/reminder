// Made-up invoices used when Moloni credentials are missing, and fake payment
// references used when easypay credentials are missing.
const day = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export function mockInvoices() {
  const rows = [
    ["FT 2026/131", "Tasca do Rui", "Rui", 380.0, -1],
    ["FT 2026/118", "Hotel Rio Azul", "Marta", 1240.5, -8],
    ["FT 2026/109", "Café Arcada", "António", 96.4, -41],
    ["FT 2026/097", "Restaurante Ponte Velha", "Joana", 2115.0, -67],
    ["FT 2026/140", "Pastelaria Sé", "Helena", 212.8, 3],
  ];
  return rows.map(([number, client, contact, amount, dueIn], i) => ({
    id: `mock-${i + 1}`, source: "mock", number, client, contact, phone: "", amount,
    dueDate: day(dueIn), daysLate: -dueIn,
  }));
}

let n = 0;
export function mockMultibanco() {
  n += 1;
  return { paymentId: `mock-pay-${n}`, entity: "12345", reference: String(900000000 + n * 7919).slice(0, 9) };
}
